# 15. 외부 시스템 동기화 (Synced Databases)

> 커버리지 비평 A-2에서 "통째로 누락"으로 판정된 도메인이다. 09-api-integrations.md의 F-09-11(link preview = 1회성 렌더)과 F-09-13(1회성 임포트)으로는 대체되지 않는 **지속적 단방향 동기화 서브시스템**을 다룬다.
>
> 조사 기준일: 2026-09-06. 1차 출처는 notion.com/help 및 notion.com/releases.

## 요약

| 항목 | 내용 |
|---|---|
| 대상 소스 | Jira, GitHub, GitLab, Asana 4종 (공식 문서 명시, "더 추가 예정") |
| 동기화 방향 | **기본 단방향(외부 → Notion)**. 예외: Jira Sync의 5개 필드만 Enterprise에서 양방향 |
| 요금제 게이팅 | Business / Enterprise (공식 help 명시). write-back은 Enterprise 전용 |
| 생성 경로 2종 | ① 링크 붙여넣기 → `Paste as database` ② Settings → Import → `Jira Sync`(관리자 토큰 기반) |
| 갱신 방식 | 외부 webhook push(실시간) + 뷰가 활성 조회될 때 resync(하루 최대 1회) + 초기 백필 |
| 수동 갱신 | **불가**. 사용자가 sync를 직접 트리거하는 UI 없음 |
| 소스 삭제 | 노션 행도 삭제 → 휴지통에 보이지만 **복원 불가** |
| 로컬 확장 | Notion 전용 프로퍼티 / relation / rollup / 뷰 / 필터 / 본문 블록은 자유롭게 추가 가능 |
| 이름 충돌 | 로컬 프로퍼티가 외부 프로퍼티와 동명이면 **그 프로퍼티는 동기화되지 않음** |
| 클론 판정 | 도메인 전체는 **v2급(post-MVP)**. 그러나 `origin` / `writable` 스키마 축은 **P0 시점에 결정해야 하는 되돌릴 수 없는 결정** |

### 이 도메인의 존재 이유 (다른 도메인과 무엇이 다른가)

| | F-09-11 link preview | F-09-13 서드파티 임포트 | **이 도메인 (Synced DB)** |
|---|---|---|---|
| 지속성 | 렌더 시점 fetch, 저장 안 함 | 1회성 복사, 이후 무관계 | **영속 바인딩, 계속 갱신** |
| 저장 단위 | 블록 1개 | 페이지/행(네이티브가 됨) | **행(page) + 외부 identity** |
| 소유권 | 외부 | 노션 | **행마다 필드별로 갈림** |
| 삭제 전파 | 없음 | 없음 | **있음 (복원 불가)** |
| 필요한 스키마 축 | 없음 | 없음 | **`origin`, `external_id`, `writable`** |

---

## 핵심 개념 / 데이터 모델

### 개념 지도

```
external_connection            (워크스페이스 ↔ 외부 앱 인증. Jira Sync=관리자 토큰 / 레거시=사용자 토큰)
   └─ external_binding         (커넥션 + 선택된 소스 범위 → data_source 1개에 바인딩)
        ├─ external_field_map  (외부 필드 ↔ property 매핑 + 동기화 정책)
        ├─ external_row_link   (external_id ↔ page_id, 멱등 upsert 키)
        ├─ sync_run / sync_cursor  (백필·증분·재조정 실행 이력과 워터마크)
        └─ sync_issue          (Sync failed / Sync stopped 등 상태 배지 소스)

user_external_identity         (외부 계정 ↔ notion user. people 프로퍼티 해소용)
external_write_back            (Enterprise 양방향: 노션 편집 → 외부 API 호출 큐)
```

**가장 중요한 구조적 사실**: 외부 소스는 **`database`가 아니라 `data_source` 수준에 바인딩된다.** 하나의 data_source 안에 외부 origin 프로퍼티와 로컬 origin 프로퍼티가 **공존**하며, 행(page)은 외부 origin이지만 그 행의 **본문 블록 트리는 완전히 로컬(편집 가능)**이다. 즉 `origin`은 페이지 단위 플래그 하나로 표현되지 않고 **(행, 프로퍼티, 블록) 세 층에서 각각 결정**된다. 이것이 이 도메인이 기존 03/04 스키마에 요구하는 핵심 변경이다.

### 의사 스키마 (이 도메인이 추가로 요구하는 테이블만. 기존 엔티티 변경 요구는 다음 절)

```sql
-- 워크스페이스 ↔ 외부 앱 인증 (F-15-02)
CREATE TABLE external_connection (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL,
  provider       text NOT NULL,          -- 'jira' | 'jira_sync' | 'github' | 'gitlab' | 'asana'
  auth_mode      text NOT NULL,          -- 'user_token' | 'admin_api_token' | 'oauth_app'
  installed_by   uuid NOT NULL,          -- 설치한 user (거버넌스 화면에 표시)
  external_tenant text NOT NULL,         -- Jira site URL / GitHub org / GitLab group / Asana workspace
  credential_ref text NOT NULL,          -- 시크릿 스토어 참조 (토큰 원문을 DB에 두지 않는다)
  status         text NOT NULL,          -- 'active' | 'invalid_token' | 'revoked'
  scopes         jsonb,
  created_at     timestamptz, updated_at timestamptz,
  UNIQUE (workspace_id, provider, external_tenant)   -- GitHub: org 1개 = 워크스페이스 1개 (공식 제약)
);

-- 커넥션 + 선택된 외부 범위 → data_source 바인딩 (F-15-01)
CREATE TABLE external_binding (
  id              uuid PRIMARY KEY,
  connection_id   uuid NOT NULL REFERENCES external_connection(id),
  data_source_id  uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  resource_kind   text NOT NULL,         -- 'jira_project' | 'github_repo_pr' | 'github_repo_issue' | ...
  resource_scope  jsonb NOT NULL,        -- { project_keys:[...] } / { repo:"org/name", kinds:["pr","issue"] }
  row_limit       int,                   -- 요금제 한도 (F-15-13)
  auto_relation   boolean NOT NULL DEFAULT false,  -- 본문 링크로 relation 자동 생성 (F-15-12)
  write_back      boolean NOT NULL DEFAULT false,  -- Enterprise 양방향 (F-15-10)
  state           text NOT NULL,         -- 'backfilling' | 'live' | 'failed' | 'stopped' | 'detached'
  last_synced_at  timestamptz,
  UNIQUE (data_source_id)                -- data_source 하나에 외부 바인딩은 최대 1개
);

-- 외부 필드 ↔ property 매핑 + 필드별 동기화 정책 (F-15-03, F-15-06)
CREATE TABLE external_field_map (
  binding_id     uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  external_key   text NOT NULL,          -- 'summary' | 'assignee' | 'customfield_10014' | 'reviewers'
  property_id    uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  sync_policy    text NOT NULL,          -- 'pull' | 'pull_push' | 'excluded'
  value_codec    text NOT NULL,          -- 외부 표현 → property_type 값 변환기 식별자
  excluded_reason text,                  -- 'name_collision' | 'unsupported_field' | 'too_many_options' | 'user_deselected'
  PRIMARY KEY (binding_id, external_key)
);

-- 행 정체성 매핑. 이 도메인의 심장 (F-15-04)
CREATE TABLE external_row_link (
  binding_id     uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  external_id    text NOT NULL,          -- Jira issue id(키가 아니라 불변 id), GitHub node_id
  page_id        uuid NOT NULL REFERENCES page(id),
  external_key   text,                   -- 사람이 읽는 키(PROJ-123). 변경 가능하므로 PK로 쓰지 않는다
  external_url   text,
  source_version text,                   -- Jira updated / GitHub updated_at / ETag
  payload_hash   bytea,                  -- 무변경 조기 종료용
  last_pulled_at timestamptz,
  tombstoned_at  timestamptz,            -- 소스에서 삭제됨
  detached_at    timestamptz,            -- sync 해제하고 데이터만 유지 (F-15-15)
  PRIMARY KEY (binding_id, external_id),
  UNIQUE (page_id)
);

-- 실행 이력 · 워터마크 (F-15-05)
CREATE TABLE sync_run (
  id           uuid PRIMARY KEY,
  binding_id   uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  kind         text NOT NULL,            -- 'backfill' | 'webhook' | 'view_triggered_resync' | 'reconcile' | 'schema_refresh'
  started_at   timestamptz, finished_at timestamptz,
  cursor_before text, cursor_after text, -- updated_since 워터마크 / 페이지 커서
  rows_upserted int, rows_tombstoned int,
  status       text,                     -- 'ok' | 'partial' | 'failed'
  error        jsonb
);

-- 상태 배지 소스 (F-15-11)
CREATE TABLE sync_issue (
  id          uuid PRIMARY KEY,
  binding_id  uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  code        text NOT NULL,             -- 'webhook_registration_failed' | 'invalid_token' | 'account_disconnected'
                                         -- | 'site_url_changed' | 'project_key_renamed' | 'rate_limited' | 'row_limit_exceeded'
  severity    text NOT NULL,             -- 'failed' | 'stopped' | 'warning'
  first_seen_at timestamptz, last_seen_at timestamptz, resolved_at timestamptz,
  detail      jsonb
);

-- 외부 계정 ↔ 노션 사용자 (F-15-07)
CREATE TABLE user_external_identity (
  id             uuid PRIMARY KEY,
  provider       text NOT NULL,
  external_tenant text NOT NULL,
  external_account_id text NOT NULL,     -- Jira accountId / GitHub login+id
  external_email text,
  external_name  text,
  user_id        uuid NULL REFERENCES "user"(id),   -- NULL = 미해소
  match_method   text,                   -- 'email' | 'name' | 'manual' | 'scim_external_id'
  matched_at     timestamptz,
  UNIQUE (provider, external_tenant, external_account_id)
);

-- 미해소 relation 지연 큐 (F-15-12)
CREATE TABLE external_relation_pending (
  binding_id   uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL,
  from_external_id text NOT NULL,
  to_external_id   text NOT NULL,
  to_binding_id    uuid,                 -- 크로스 프로젝트: 상대 바인딩이 없으면 NULL → 영구 미해소
  created_at   timestamptz,
  PRIMARY KEY (binding_id, property_id, from_external_id, to_external_id)
);

-- Enterprise 양방향 쓰기 (F-15-10)
CREATE TABLE external_write_back (
  id            uuid PRIMARY KEY,
  binding_id    uuid REFERENCES external_binding(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL,
  external_key  text NOT NULL,
  prev_value    jsonb,                   -- 실패 시 되돌림용
  new_value     jsonb,
  actor_user_id uuid NOT NULL,           -- 노션에서 편집한 사람
  actor_external_account_id text NOT NULL, -- 그 사람의 외부 계정 (워크스페이스 토큰이 아니다)
  status        text NOT NULL,           -- 'queued' | 'sent' | 'confirmed' | 'rejected' | 'reverted'
  attempt       int NOT NULL DEFAULT 0,
  error         jsonb,
  created_at    timestamptz, settled_at timestamptz
);
```

### 이 도메인이 **기존 엔티티에 요구하는 것** (새 스키마를 만드는 것이 아님)

> 커버리지 비평이 지적한 대로 이미 스키마가 문서마다 갈려 있으므로(C-1~C-16), 여기서는 **요구사항만** 적고 정본 결정은 00번 문서에 위임한다.

| # | 대상 엔티티 (정의 위치) | 요구 사항 | 없으면 무엇이 깨지는가 |
|---|---|---|---|
| R1 | `page` (03 F-03-01) / `row_page` (04) | `origin ∈ {native, external}` 축(단순 boolean이 아니라 external → native 승격이 가능한 **전이 상태**)과 `external_row_link`로의 역참조 | 외부 행과 사용자 생성 행을 구분할 수 없어 F-15-06(읽기 전용)·F-15-08(삭제 전파) 표현 불가 |
| R2 | `property` (03 / 04) | `origin ∈ {native, external}` + `writable ∈ {readonly, write_back, local}` **두 축이 독립적으로** 필요 | "제목은 못 고치는데 우선순위는 고칠 수 있다"를 표현 불가. **읽기 전용은 페이지 플래그가 아니라 프로퍼티 축이다** |
| R3 | `data_source` (03 / 04 F-04-23) | data_source 단위 `origin` + 외부 바인딩 0..1. 04의 `database_data_source` 조인(C-5)과 양립해야 함 | database에 origin을 달면 "외부 DS + 로컬 DS를 한 database에 묶기"(공식 기능)가 불가능 |
| R4 | `block` (01 / 05) | 외부 origin 행의 **본문 블록은 native origin**이어야 한다 (행 자체는 읽기 전용인데 본문은 편집 가능) | origin을 블록 트리에 상속시키면 외부 행에 메모를 못 남긴다 — 이 기능의 핵심 가치가 사라짐 |
| R5 | 삭제 상태 머신 (C-1: 02 I7 / 11 F-11-06) | `trash_reason ∈ {user, source_deleted, source_out_of_scope}` + `restorable BOOLEAN` 축 추가. **휴지통에 보이지만 복원 버튼이 없는 상태**는 현재 02·11 어느 enum에도 없다 | 소스 삭제 행을 사용자가 복원하면 다음 sync에서 다시 삭제되는 무한 루프 |
| R6 | `user` (14 도메인 신설 예정) | `user_external_identity` 다중 보유. 이메일 별칭 다중(계정당 최대 5)이 identity matching 후보 집합이 된다 | people 프로퍼티가 항상 미해소 텍스트로 남음 |
| R7 | `property`의 `UNIQUE (data_source_id, name)` (03, 현재 [확인필요] 태그) | **이 도메인이 이 제약을 요구한다.** "로컬 프로퍼티가 외부 프로퍼티와 동명이면 동기화 제외"라는 공식 규칙이 이름 유일성을 전제 | 동명 허용 시 필드 매핑이 비결정적 |
| R8 | `relation_edge` (03) | 외부 relation은 external_id 쌍으로 먼저 도착하므로 **지연 해소 큐** + "이 엣지의 소유자가 sync인가 사용자인가" 표시 필요 | 크로스 프로젝트 linked issue 유실, 또는 sync가 사용자 수동 relation을 삭제 |
| R9 | `acl` (C-7: 02/04/06 3종) | 외부 origin 행에도 통상 ACL이 그대로 적용됨(별도 축 아님). 단 **write-back의 actor는 "노션 user + 그 사람의 외부 계정" 복합**이며, 게스트·공개 링크 접근자는 write-back 불가 | 워크스페이스 토큰으로 대리 쓰기 → 외부 감사 로그에 실제 행위자가 안 남음 |
| R10 | 스케줄러 (U-4: 08 F-08-10에 부재) | resync·reconcile 잡이 automation·반복 템플릿·verification 만료와 **같은 스케줄러 엔티티**를 공유해야 함 | 도메인마다 별도 크론이 생김 |
| R11 | `plan_entitlement` (13 F-13-18) | `synced_database.count` / `synced_database.rows` / `write_back.enabled` 3개 축 | 요금제 게이팅 강제 지점이 코드에 흩어짐 |
| R12 | `search_document` (U-6: 07 F-07-06 정본 후보) | `origin` 필터 축 + 외부 행 재색인 트리거를 sync 파이프라인에 연결 | 대량 sync가 검색 인덱스를 조용히 낡게 만듦 |
| R13 | `notification` / `subscription` (C-13) | 외부 origin 변경은 **기본적으로 알림을 만들지 않아야** 한다 (webhook 폭주 = 인박스 폭주) | 하루 수천 건 알림 |
| R14 | 버전 히스토리 (C-12) | 외부 sync가 만든 리비전은 `reason='external_sync'`로 분리하고 GC를 더 공격적으로 | 히스토리가 sync 노이즈로 가득 참 |

---

## 기능 명세

### F-15-01 Synced Database 컨테이너 (외부 소스 바인딩과 생성 플로우)

- **한 줄 정의**: 외부 도구(Jira/GitHub/GitLab/Asana)의 특정 범위를 노션 데이터베이스 하나에 영속 바인딩하여, 외부 항목 1개 = 노션 행 1개로 계속 유지되게 한다.
- **사용자 시나리오**:
  1. (경로 A — 링크 붙여넣기) GitHub에서 PR 또는 이슈 링크 복사 → 노션 페이지에 붙여넣기 → 붙여넣기 옵션 메뉴에서 `Paste as database` 선택 → (미인증이면 인증 플로우) → **프로퍼티가 미리 채워진 빈 테이블 뷰가 즉시 생성**됨 → 수 분 내 행이 채워지고 DB 헤더에 `Synced just now` 표시.
  2. (경로 B — 관리자 임포트) Settings → Import → `Jira Sync` → 관리자 API 토큰 입력 → 동기화할 프로젝트 다중 선택 → 프로퍼티 선택 → 생성.
  3. 생성 후 사용자는 이 DB에 **Notion 전용 프로퍼티·relation·rollup·뷰·필터**를 자유롭게 추가한다.
- **동작 상세**:
  - 생성 즉시 스키마(프로퍼티)가 먼저 만들어지고, 행 백필은 비동기다. 초기 sync 소요는 "프로젝트 크기에 따라 수 분~수 시간"(공식).
  - 백필은 **페이지를 떠나도 계속 진행**된다(공식: "페이지를 벗어나도 계속 sync 된다"). 클라이언트 세션에 묶이면 안 된다.
  - 기본 뷰는 table. 이후 board/calendar/timeline 등 F-04 뷰 전부 사용 가능.
  - 소스 범위(프로젝트·리포·프로퍼티)는 생성 후 설정의 소스 메뉴에서 변경 가능.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 빈 프로젝트 바인딩 | 프로퍼티만 있는 0행 DB. 오류 아님 |
  | 요금제 행 한도 초과 | 백필 중단 + `row_limit_exceeded` sync_issue. **부분 백필 상태로 조용히 남는 것이 최악** → 잘라낸 사실을 배지로 노출 |
  | 같은 리포를 두 번 붙여넣기 | 별도 바인딩 2개(행 중복). 공식 문서에 중복 방지 언급 없음 [추정] → 클론은 `resource_scope` 중복 경고 권장 |
  | 백필 중 사용자가 로컬 프로퍼티 편집 | upsert가 로컬 프로퍼티를 건드리지 않으므로 안전(F-15-06) |
  | 권한 없는 멤버가 조회 | 바인딩은 워크스페이스 수준이지만 DB 자체는 통상 ACL. 접근 없으면 안 보임 |
  | 대용량(수만 행) | 커서 배치 백필 + 워크스페이스별 동시 실행 상한 필요 |
  | 소스 앱에서 프로젝트 자체 삭제 | 전체 행 tombstone → F-15-08 |
- **데이터 모델 함의**: `external_connection`, `external_binding`(data_source에 1:1), R3(data_source origin 축). 바인딩은 **database가 아니라 data_source**에 걸린다 — 그래야 F-04-23 다중 data source DB에서 "Jira DS + 로컬 DS"를 한 database에 묶을 수 있다.
- **UI/인터랙션**: 붙여넣기 시 컨텍스트 메뉴(`Paste as preview` / `Paste as database` / `Paste as URL` — F-09-11과 동일 메뉴 공유), DB 헤더의 sync 상태 배지, 소스 설정 메뉴(프로젝트·프로퍼티 다중 선택 체크박스).
- **의존 기능**: F-03-01(database/data_source/page 3계층), F-04-01(뷰), F-15-02(인증), F-15-03(매핑), F-15-05(엔진), F-09-11(붙여넣기 옵션 메뉴).
- **구현 난이도**: **L** — 컨테이너 자체는 기존 DB 생성 경로 재사용이지만, "스키마 먼저 / 행은 비동기 백필"이라는 2단계 생성과 진행 상태 표면이 새 경로다.
- **우선순위**: **P0(도메인 내)** — 도메인 전체는 v2. 이 기능 없이는 나머지 14개가 성립하지 않는다.
- **클론 시 현실적 대안**: 커넥터를 자체 구현하지 않고 Nango/Airbyte 같은 통합 게이트웨이에 위임하고, 클론은 `external_binding` + upsert 파이프라인만 소유한다. 소스 1개(GitHub)만으로 시작해도 스키마 축 요구는 동일하다.
- **참고 출처**: https://www.notion.com/help/synced-databases , https://www.notion.com/help/github , https://www.notion.com/connections/jira

---

### F-15-02 커넥터 인증 모델 (사용자 토큰 vs 관리자 토큰, 2세대 커넥션의 공존)

- **한 줄 정의**: 외부 앱에 대한 자격증명을 워크스페이스에 설치하고, 그 자격증명이 누구의 권한으로 무엇을 읽는지를 정의한다.
- **사용자 시나리오**:
  1. (레거시 `Jira` / `GitHub`) 개인이 Settings → Connections → 해당 앱 `Connect` → OAuth 동의 → 그 사람의 **사용자 토큰**으로 동작.
  2. (신형 `Jira Sync`) 워크스페이스 owner이면서 Jira admin인 사람이 Settings → Import → Jira Sync → **관리자 API 토큰**(scope 없는 토큰 권장) 입력 → 이후 **워크스페이스의 모든 멤버가 그 sync를 사용**.
- **동작 상세**:

  | 축 | 레거시 `Jira` | 신형 `Jira Sync` |
  |---|---|---|
  | 자격증명 | 사용자 토큰 | 관리자 API 토큰 |
  | 설치 주체 | 개인 멤버 | 워크스페이스 owner + Jira admin |
  | 지원 배포 | Jira Cloud / Data Center / Server | **Jira Cloud만** |
  | 용도 | link preview, mention, (구형) synced DB | 다중 프로젝트 지속 동기화 |
  | 안정성 | 설치자 퇴사·토큰 만료 시 sync 중단 | 조직 단위로 안정 |

  - GitHub은 **하나의 GitHub 조직에 하나의 노션 워크스페이스만** 연결할 수 있다(공식 제약).
  - Jira Sync는 "scope 있는 토큰"이 아니라 **scopeless 토큰**을 권장한다 — scope 토큰은 webhook 등록 권한이 빠지기 쉬워 `Sync failed`로 이어진다(F-15-11).
  - 이 2세대 구조는 클론에게 중요한 교훈이다: **개인 토큰 기반 통합은 조직에서 반드시 무너진다.** 클론은 처음부터 워크스페이스 소유 자격증명을 기본으로 설계해야 한다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 설치자 계정 비활성화 | 사용자 토큰 기반 커넥션은 전부 `Sync stopped` |
  | 토큰 만료·무효 | `invalid_token` → 배지 `Sync stopped`, 재인증 요구 |
  | 토큰 권한 부족(webhook 등록 실패) | 배지 `Sync failed` — **정상처럼 보이면서 데이터만 낡는 것이 최악**이므로 두 배지를 반드시 구분 |
  | 같은 Jira 사이트를 두 워크스페이스가 연결 | 공식 문서 미기재 [확인필요]. GitHub은 명시적으로 1:1 |
  | Enterprise 커넥션 정책이 이 커넥터를 미승인 | 설치 자체가 차단 → F-15-13 |
  | 토큰 로테이션 | 재인증 후 바인딩·매핑·행 링크가 **보존**되어야 함 (재임포트를 요구하면 UX 실패) |
  | 시크릿 유출 | 토큰 원문을 DB가 아니라 시크릿 스토어에 두고 `credential_ref`만 저장 |
- **데이터 모델 함의**: `external_connection`, `UNIQUE(workspace_id, provider, external_tenant)`. 06 F-06-13의 connection capability 모델과 **다른 축**이다 — F-06-13은 "외부가 노션을 읽는" 인바운드 토큰, 이 테이블은 "노션이 외부를 읽는" 아웃바운드 자격증명이다. 두 개를 같은 테이블에 합치면 안 된다.
- **UI/인터랙션**: Settings → Connections(개인), Settings → Import(관리자), 재인증 배너, 커넥션별 "설치한 사람" 목록(F-15-13에서 사용).
- **의존 기능**: F-06-13(커넥션 권한 모델), F-06-02(워크스페이스 역할 — owner 판정), 14 도메인(계정·세션).
- **구현 난이도**: **L** — OAuth 3종 + API 토큰 1종의 자격증명 수명주기, 시크릿 저장, 만료 감지·재인증 플로우.
- **우선순위**: **P0(도메인 내)**.
- **클론 시 현실적 대안**: 초기엔 관리자 PAT 입력 1종만 지원(OAuth 앱 등록·심사 비용 회피). 단 `auth_mode` 컬럼은 처음부터 두어 나중에 OAuth를 추가할 여지를 남긴다.
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/github , https://www.notion.com/connections/jira

---

### F-15-03 외부 스키마 → 노션 프로퍼티 매핑 (필드 매핑 규칙과 제외 규칙)

- **한 줄 정의**: 외부 항목의 필드 집합을 노션 property 집합으로 변환하고, 어떤 필드는 왜 동기화하지 않는지를 결정한다.
- **사용자 시나리오**: synced DB 생성 시 프로퍼티가 자동 생성된다. 사용자는 소스 설정에서 동기화할 프로퍼티를 선택/해제하고, 별도로 Notion 전용 프로퍼티를 추가한다.
- **동작 상세**:

  | 소스 | 매핑되는 필드 (공식 명시) | 명시적 미지원 |
  |---|---|---|
  | GitHub | Title, Assignees, Description, State, PR/Issue number, Creator, Created time, Merged/Updated/Closed time, Reviewers | **Labels·tags 미지원** |
  | Jira | "Time tracking, Resolution, Security level, Progress, Rank, StatusCategory, Restrict to를 제외한 표준 프로퍼티 전부". 이슈 타입(Epic/Story/Task/Bug)은 행이 되고, sprint·parent는 프로퍼티가 됨 | 위 7종 |
  | GitLab / Asana | 공식 필드 전수표 미공개 | [확인필요] |

  - **이름 충돌 규칙(공식)**: 사용자가 추가한 Notion 프로퍼티가 외부 프로퍼티와 **같은 이름이면 그 프로퍼티는 동기화되지 않는다.** → R7(프로퍼티 이름 유일성 제약)이 이 규칙의 전제다.
  - **값 개수 상한(Jira, 공식)**: 값이 1,000개 이상인 프로퍼티는 동기화에서 제외 → select/multi_select 옵션 레지스트리(F-03-04) 폭발 방지.
  - **첨부(Jira, 공식)**: 이슈당 최대 5개, 각 1MB.
  - **반영 지연(Jira, 공식)**: 소스에 새 필드를 만들면 노션에 나타나기까지 **최대 12시간**. Watcher 프로퍼티도 최대 12시간.
  - **status 근사 매칭(공식)**: 외부 상태값을 노션 status 옵션에 근사 매칭한다(문서 예시: "Working" → "Done"). **정확 매칭이 아니라는 사실이 공식 문서에 명시**되어 있고 이는 오분류의 정식 원인이다.
  - **날짜(공식)**: Jira가 타임존 정보를 빼고 주는 필드가 있어 **하루 어긋나는 현상**이 알려진 이슈로 기재됨 → codec은 타임존 부재를 명시적 정책(워크스페이스 타임존 가정)으로 처리해야 한다.
  - **select 옵션 소스(공식)**: Jira priority는 "실제로 사용된 값만" 옵션으로 나타난다 → 옵션 레지스트리는 **관측 기반 증분 생성**이지 스키마 선언 기반이 아니다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 외부에서 필드 삭제 | 노션 프로퍼티는 남고 값이 비게 됨 [추정] — 자동 삭제하면 사용자의 필터·뷰가 깨지므로 남기는 편이 안전 |
  | 외부 필드 타입 변경(text→select) | property 타입 변환(F-03-14) 트리거 또는 `excluded` 전환. 공식 안내는 "해당 필드 재임포트" |
  | 옵션 값이 1,000개 초과 | 그 프로퍼티만 `excluded_reason='too_many_options'` |
  | 커스텀 필드가 노션 타입에 대응 없음 | text 폴백 [추정] |
  | 동명 로컬 프로퍼티 존재 | 동기화 제외(공식). **UI에 이유를 노출하지 않으면 "왜 안 채워지지" 문의가 폭발** |
  | 프로퍼티 500개 한도(F-03-02) | 대형 Jira 프로젝트의 커스텀 필드가 한도를 넘길 수 있음 → 선택 UI 필수 |
  | 빈 값 / null | 프로퍼티는 만들되 값 없음. 필터의 is_empty로 처리 |
- **데이터 모델 함의**: `external_field_map`(binding × external_key → property_id + policy + codec + excluded_reason). **codec은 데이터여야 한다** — provider×field_type 조합마다 코드를 쓰면 소스가 늘 때마다 배포가 필요하다. `select_option`(F-03-04)에 관측 기반 upsert 경로가 추가로 필요하다.
- **UI/인터랙션**: 소스 설정의 프로퍼티 체크박스 목록, 제외된 프로퍼티에 사유 툴팁, "새 필드는 최대 12시간 후 반영" 안내, 컬럼 헤더의 소스 앱 아이콘.
- **의존 기능**: F-03-02(스키마 관리), F-03-04/F-03-05(옵션 레지스트리), F-03-14(타입 변환), F-15-01.
- **구현 난이도**: **L** — provider별 필드 카탈로그 + codec 레지스트리 + 제외 규칙 4종. 소스 1개 추가당 증분 M.
- **우선순위**: **P0(도메인 내)**.
- **클론 시 현실적 대안**: provider별 필드 전수 매핑 대신 **화이트리스트 10~15개 필드**만 지원하고 나머지는 `raw jsonb` 프로퍼티 하나로 몰아넣는다. 뷰·필터 가치의 80%를 20% 비용으로 얻는다.
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/github , https://www.notion.com/help/synced-databases , https://www.notion.com/help/common-jira-sync-issues

---

### F-15-04 external_id ↔ page_id 매핑과 멱등 upsert

- **한 줄 정의**: 외부 항목 하나가 노션 행 하나에 안정적으로 대응되게 하여, 같은 항목이 몇 번 동기화돼도 행이 중복 생성되지 않게 한다.
- **사용자 시나리오**: 사용자에게 직접 보이지 않는다. 사용자가 관찰하는 것은 "Jira에서 PROJ-123의 제목을 바꿨더니 노션의 **같은 행** 제목이 바뀌더라(새 행이 생기지 않더라)"는 사실뿐이다.
- **동작 상세**:
  - upsert 키는 `(binding_id, external_id)`이며, **external_id는 사람이 읽는 키(PROJ-123)가 아니라 불변 id**여야 한다. Jira 프로젝트 키는 rename되고(F-15-09), GitHub 이슈 번호는 리포 이전 시 바뀔 수 있다. **노션 자신이 키 rename에서 깨지는 것(F-15-09)이 이 설계 선택의 반증 사례다.**
  - 파이프라인: `이벤트 수신 → external_id 조회 → 없으면 page 생성(origin=external) + link 삽입 → 있으면 payload_hash 비교 → 다르면 sync_policy='pull'인 프로퍼티만 갱신`.
  - `payload_hash`가 같으면 즉시 종료한다. 이것이 없으면 하루 1회 resync가 전체 행의 `last_edited_time`을 갱신해 **버전 히스토리·활동 피드·알림을 오염**시킨다(R13, R14).
  - 행 생성 시 `unique_id`(F-03-09) 등 노션 자동 프로퍼티도 정상 부여된다. 이 값이 GitHub magic word 연동(F-15-12)의 앵커가 된다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 같은 external_id 이벤트 동시 도착 | `(binding_id, external_id)` 단위 직렬화(어드바이저리 락 또는 파티션 키). 없으면 행 중복 생성 |
  | 사용자가 외부 origin 행을 노션에서 삭제 | 다음 sync가 되살릴지 tombstone으로 둘지 정책 필요. **되살리는 편이 일관적**이지만 사용자에겐 "지워지지 않는 행"으로 보임 [확인필요] |
  | 항목이 다른 프로젝트로 이동(Jira move) | external_id는 유지되나 바인딩 범위 밖으로 나감 → 현재 바인딩에서는 삭제로 관측 → F-15-08과 사유 구분 필요 |
  | 백필과 webhook이 동시에 같은 행 처리 | `source_version` 단조 비교로 오래된 쪽 폐기 |
  | 매핑 행은 있는데 page가 하드 삭제됨 | `external_row_link` 고아 → 다음 sync에서 재생성. FK ON DELETE 정책 명시 필요 |
  | 요금제 다운그레이드로 한도 초과 | 신규 upsert만 차단하고 기존 행은 유지 [추정] |
  | 행 복제(Duplicate) | 복제본은 `origin=native`여야 함. 아니면 `UNIQUE(page_id)` 위반 |
- **데이터 모델 함의**: `external_row_link`(PK `(binding_id, external_id)`, **`UNIQUE(page_id)` 필수**), R1(page.origin), `payload_hash`, `source_version`. `UNIQUE(page_id)`가 없으면 한 노션 행이 두 외부 항목에 매핑될 수 있고 어느 sync가 이겨야 하는지 답이 없다.
- **UI/인터랙션**: 내부 기능이라 표면 없음. 단 행 우측에 원본 링크(`external_url`) 열기 버튼은 필수(읽기 전용 셀의 유일한 탈출구, F-15-06).
- **의존 기능**: F-15-01, F-15-03, F-03-01, F-03-09.
- **구현 난이도**: **M** — 테이블과 upsert는 단순하나 동시성 직렬화와 hash 기반 조기 종료가 정확해야 한다.
- **우선순위**: **P0(도메인 내)** — 여기가 틀리면 행 중복·알림 폭주로 즉시 신뢰를 잃는다.
- **클론 시 현실적 대안**: 없음. 이 도메인의 대체 불가한 최소 코어다.
- **참고 출처**: https://www.notion.com/help/synced-databases , https://www.notion.com/help/common-jira-sync-issues , https://en.wikipedia.org/wiki/Watermark_(data_synchronization)

---

### F-15-05 증분 동기화 엔진 (백필 · webhook push · 조회 트리거 resync · 재조정)

- **한 줄 정의**: 외부 변경을 노션에 반영하는 실행 엔진. 4가지 트리거가 서로 다른 지연·비용 특성으로 협력한다.
- **사용자 시나리오**: 사용자는 트리거를 선택하지 않는다. **수동 sync 버튼은 공식적으로 존재하지 않는다**(공식: 수동으로 sync를 트리거할 수 없고 자동으로만 동작). 사용자가 보는 것은 헤더의 `Synced just now` 뿐이다.
- **동작 상세**:

  | 트리거 | 발동 조건 | 지연 | 범위 |
  |---|---|---|---|
  | `backfill` | 바인딩 생성 직후 | 수 분 ~ 수 시간(프로젝트 크기 의존, 공식) | 전체 |
  | `webhook` | 외부 앱이 변경 이벤트 push (Jira 공식 명시) | 실시간 | 항목 1개 |
  | `view_triggered_resync` | **해당 컬렉션이 실제로 조회될 때** 발동, **하루 최대 1회** (Jira 공식 명시) | 조회 시점 | 워터마크 이후 전체 |
  | `schema_refresh` | 새 프로퍼티 감지 | 최대 12시간 (공식) | 스키마만 |

  - `view_triggered_resync`의 "조회될 때만 + 하루 1회"는 **비활성 DB에 비용을 쓰지 않는다**는 명확한 원칙이며, 클론이 그대로 채택할 가치가 있다.
  - webhook은 유실될 수 있으므로 resync가 **재조정(reconciliation)** 역할을 겸한다. 이 시스템은 "webhook = 즉시성, 주기 잡 = 정합성"이라는 표준 하이브리드 패턴이다.
  - 워터마크는 `updated_since` + 커서 페이지네이션. 소스가 `updated_at`을 주지 않으면 list-and-diff(payload_hash 비교)로 폴백한다.
  - 삭제는 webhook으로 오지 않을 수 있으므로, **전체 resync에서 "이번에 관측되지 않은 external_id" 집합을 tombstone**으로 처리해야 한다(F-15-08).
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | webhook 유실 | 다음 resync가 메움. **최대 24시간 낡을 수 있다**는 것이 이 설계의 수용된 한계 |
  | 외부 API rate limit | 백오프 + `rate_limited` sync_issue. 백필은 중단이 아니라 커서에서 재개 |
  | webhook 중복 재전송 | `source_version`/`payload_hash`로 멱등 처리 |
  | 순서 뒤바뀐 webhook | `source_version` 단조 비교로 오래된 이벤트 폐기 |
  | 부분 실패(1,000행 중 300행) | `sync_run.status='partial'` + 커서 저장. 전체 롤백하면 대형 프로젝트가 영원히 완료되지 않는다 → **05 F-05-01의 all-or-nothing 트랜잭션 규약과 의도적으로 다른 경로**임을 정본 문서에 명시해야 한다 |
  | DB가 6개월간 미조회 | resync 미발동 → 조회하는 순간 대량 변경 유입 (알림 억제 필수, R13) |
  | 워크스페이스에 바인딩 500개 | 워크스페이스별 동시 sync 상한 + 큐 필요 |
  | 외부 앱 장애 | 배지 유지, 백오프 재시도, 사용자 데이터 손상 없음 |
- **데이터 모델 함의**: `sync_run`(kind/cursor/status), `external_binding.state`, `last_synced_at`. **스케줄러 엔티티(R10)를 08 F-08-10과 공유**해야 한다 — cron 표현, 타임존, 다음 실행 시각, 지연 보정, 워크스페이스별 동시성 상한이 automation·반복 템플릿·verification 만료와 동일 요구사항이다.
- **UI/인터랙션**: 헤더 배지 `Synced just now` / `Synced N minutes ago` / `Syncing…`, 백필 진행률, 수동 버튼 없음.
- **의존 기능**: F-15-02, F-15-04, F-08-10(스케줄러 — 현재 미명세), F-09-09(webhook 수신 서명 검증 규약 재사용).
- **구현 난이도**: **XL** — 4가지 트리거, 워터마크, 멱등성, 백오프, 부분 실패 재개, 동시성 상한. 이 도메인 비용의 절반이 여기 있다.
- **우선순위**: **P0(도메인 내)**.
- **클론 시 현실적 대안**: v1은 **webhook 없이 `view_triggered_resync` 단독**(하루 1회 + 조회 시)으로 시작한다. webhook 수신 엔드포인트·서명 검증·재시도·유실 처리가 통째로 빠지므로 **XL → M**. 실시간성이 필요해지면 나중에 webhook을 얹어도 데이터 모델은 그대로다.
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/github , https://truto.one/blog/designing-reliable-webhooks-lessons-from-production/

---

### F-15-06 외부 origin 행의 읽기 전용성과 로컬 편집 가능 프로퍼티의 공존

- **한 줄 정의**: 같은 행 안에서 외부에서 온 값은 편집할 수 없고, 노션에서 추가한 값과 본문은 자유롭게 편집할 수 있게 한다.
- **사용자 시나리오**:
  1. 사용자가 synced DB 행의 Jira `Summary` 셀을 클릭한다 → **편집 커서가 서지 않고** "원본에서 편집하세요" 안내 + 원본 링크가 뜬다.
  2. 같은 행의 `Quarterly Goal`(노션 전용 select) 셀을 클릭한다 → 정상 편집된다.
  3. 행을 열어 본문에 회의 메모 블록을 작성한다 → 정상 저장된다.
  4. (Enterprise + Jira Sync) `Status` 셀을 클릭한다 → 편집 가능하고 Jira에 반영된다(F-15-10).
- **동작 상세**:
  - **읽기 전용은 페이지 단위 플래그가 아니라 프로퍼티 단위 축이다.** 한 행이 동시에 (읽기 전용 프로퍼티 12개) + (로컬 프로퍼티 3개) + (편집 가능 본문 블록 트리)를 가진다.
  - `property.writable`의 3값:

    | 값 | 의미 | 예 |
    |---|---|---|
    | `readonly` | 외부에서만 변경. 노션 UI·API 모두 거부 | Jira Summary, GitHub PR number, Creator |
    | `write_back` | 노션에서 편집 → 외부로 전송 (Enterprise) | Jira Status / Assignee / Priority / Attachments / Comments |
    | `local` | 노션만 소유. sync가 절대 덮어쓰지 않음 | 사용자가 추가한 모든 프로퍼티, relation, rollup, formula |

  - `origin`과 `writable`은 **독립 축**이다. 반례가 F-15-12의 자동 relation: 프로퍼티는 `origin=native`(노션 개념)인데 값은 sync가 관리(`sync_policy='pull'`)한다. 두 축을 하나로 합치면 이 조합을 표현할 수 없다.
  - 읽기 전용 강제 지점은 **최소 4곳**: ① 셀 편집 UI ② 공개 API 쓰기 경로(F-09-17) ③ 자동화·버튼 액션(F-08-07) ④ AI Autofill·에이전트 쓰기(F-10-05, F-10-13). 하나라도 빠지면 로컬 값이 외부와 어긋난 채 다음 sync에서 조용히 되돌아간다.
  - 잠금(F-06-16 / F-03-22)과는 **다른 축**이다. 잠금은 사용자가 켜고 끄는 정책이고, 이것은 데이터 출처가 강제하는 불변식이다. 같은 플래그로 구현하면 사용자가 잠금을 풀어 외부 필드를 편집하게 된다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 붙여넣기로 여러 셀 일괄 입력(F-03-16) | readonly 컬럼은 건너뛰고 나머지만 적용 + 스킵 개수 안내 |
  | 로컬 프로퍼티가 외부 프로퍼티와 동명 | 동기화 제외(F-15-03) → 결과적으로 `local` 취급 |
  | formula/rollup이 readonly 프로퍼티 참조 | 정상. 파생 값은 항상 local |
  | 자동화가 readonly 프로퍼티를 변경하려 함 | 실행 시점 거부 + `automation_run.error`. 자동화 저장 시점에 미리 경고하는 편이 낫다 |
  | 행 전체 복제(Duplicate) | 복제본은 `origin=native`가 되어 전 필드 편집 가능 |
  | 외부 origin 행을 다른 DB로 이동 | 바인딩을 벗어나므로 금지하거나 native 승격(detach) — 정책 결정 필요 [확인필요] |
  | 오프라인 편집(F-12-04) | readonly 셀은 오프라인 큐에도 들어가면 안 됨 |
  | 동시편집 | readonly 셀은 편집 자체가 불가하므로 사용자 간 충돌이 구조적으로 발생하지 않음 |
- **데이터 모델 함의**: **R2가 이 도메인 최대의 스키마 요구**다. `property.origin` + `property.writable` 두 축(독립). 추가로 R4(본문 블록은 native origin), R1(page.origin). 03의 EAV(`page_property_value`)든 04의 jsonb(`row_page.properties`)든 **쓰기 경로가 프로퍼티 단위로 writable을 조회할 수 있어야** 하며, 04의 jsonb 단일 컬럼 방식은 "일부 키만 쓰기 금지"를 DB 제약으로 표현할 수 없어 애플리케이션 검증에 전적으로 의존하게 된다 — **C-2 정본 결정에 EAV 쪽 근거를 하나 추가한다.**
- **UI/인터랙션**: readonly 셀 호버 시 자물쇠/외부 아이콘 + "Edit in Jira" 링크, 클릭 시 편집 대신 원본 열기, 컬럼 헤더에 소스 앱 아이콘.
- **의존 기능**: F-03-16(셀 편집 UX), F-15-03(매핑), F-06-16/F-03-22(잠금 — 축 분리 필요), F-09-17(API 쓰기 경로).
- **구현 난이도**: **M** — 축 자체는 컬럼 2개지만 강제 지점이 4곳이라 누락이 쉽다.
- **우선순위**: **P1(도메인 내)**이지만 **`origin`/`writable` 컬럼 자리는 MVP(P0) 시점에 잡아둬야 한다.** 수십만 행이 쌓인 뒤 프로퍼티 축을 추가하면 마이그레이션 + 전 쓰기 경로 재검토를 요구한다.
- **클론 시 현실적 대안**: v1은 `writable ∈ {readonly, local}` 2값만 사용(write_back 제외). 컬럼은 처음부터 3값 enum으로 선언한다.
- **참고 출처**: https://www.notion.com/help/synced-databases , https://www.notion.com/help/guides/synced-databases-bridge-different-tools , https://www.notion.com/help/jira

---

### F-15-07 Identity mapping (외부 계정 ↔ 노션 사용자)

- **한 줄 정의**: 외부 도구의 담당자/작성자/리뷰어를 노션 people 프로퍼티의 실제 멤버로 해소하여, 노션에서 "누가 무엇을 맡았는지"를 필터·그룹·멘션 가능한 값으로 만든다.
- **사용자 시나리오**:
  1. 사용자가 synced DB의 `Assignee` 컬럼을 본다 → 매핑 성공한 사람은 **노션 아바타**로, 실패한 사람은 텍스트(또는 빈칸)로 나타난다.
  2. 매핑 조건(공식): (Jira) 노션과 Jira의 **이름과 이메일이 동일**해야 하고 Jira 프로필 가시성을 `Anyone`으로 설정해야 한다. (GitHub) GitHub 이메일이 비공개가 아니어야 하고 GitHub 프로필에 노션 이메일을 추가해야 한다.
  3. 매핑되면 그 people 값으로 필터/그룹/멘션/알림 대상 지정이 가능해진다.
- **동작 상세**:
  - 매칭 순서 권장: 기존 `external_account_id` 매핑 → 이메일 정확 일치(노션 계정의 **모든 이메일 별칭** 대상, R6) → 이름 일치 → 미해소.
  - 미해소는 **오류가 아니라 정상 상태**다. 외부 계정 중 상당수는 노션 워크스페이스 멤버가 아니다(외부 협력사, 봇, 퇴사자).
  - 매핑은 행이 아니라 **계정 단위**로 캐시되어야 한다. 사람 1명이 새로 매핑되면 그 사람이 등장하는 **모든 행의 people 값이 소급 갱신**되어야 하며, 이는 대량 재색인(F-07-06, R12)과 권한 캐시(F-06-14)를 건드리는 팬아웃 지점이다.
  - Jira의 프로필 가시성 요구는 **외부 API가 이메일을 안 주면 매칭이 원천 불가능**하다는 뜻이다. 클론도 같은 벽에 부딪히므로 **수동 매핑 UI를 반드시 제공**해야 한다(노션은 이 UI를 공개 문서화하지 않았다 [확인필요]).
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 이메일이 비공개 | 미해소. 텍스트 폴백 |
  | 동명이인 2명 | 이름 매칭은 위험 → 이메일 실패 시 자동 적용하지 말고 **후보 제안**으로 둘 것 [추정] |
  | 노션 계정이 이메일 별칭 다수 보유 | 별칭 전체를 매칭 후보로 (R6) |
  | 외부 계정이 봇(dependabot 등) | 미해소 유지. 봇을 사람으로 매핑하면 알림·멘션이 오작동 |
  | 매핑된 사용자가 워크스페이스에서 제거됨 | people 값은 남되 유령 참조 → 06의 멤버 제거 경로와 연결 필요 |
  | SCIM 프로비저닝 사용 중 | `external_id`(F-06-12)를 매칭 키로 재사용 가능 — 가장 신뢰도 높은 경로 |
  | 매핑 변경 후 소급 갱신 | 수만 행 people 값 갱신 → 알림 억제(R13) + 배치 재색인(R12) 필수 |
  | 대용량(외부 계정 수천 개) | 계정 단위 캐시이므로 행 수와 무관하게 선형 |
- **데이터 모델 함의**: `user_external_identity`(R6). people 프로퍼티 값은 **`user_id` 직접 저장이 아니라 `external_account_id` 저장 + 조회 시 해소**로 두면 소급 갱신을 값 재작성 없이 처리할 수 있다 — 단 이는 F-03-07의 person 프로퍼티 값 표현에 "미해소 외부 참조" 변형을 추가하도록 요구한다.
- **UI/인터랙션**: 미해소 값에 흐린 아바타 + "Not linked" 툴팁, 설정에 매핑 관리 표(외부 계정 목록 × 노션 멤버 선택), 본인 계정 연결 유도 배너.
- **의존 기능**: F-03-07(person 프로퍼티), F-06-12(SCIM external_id), 14 도메인(이메일 별칭), F-07-06(재색인).
- **구현 난이도**: **M** — 매칭 자체는 단순하나 소급 갱신 팬아웃이 비용이다.
- **우선순위**: **P1(도메인 내)** — 매핑이 없으면 synced DB는 "읽기 전용 텍스트 표"로 전락한다. 필터·그룹·알림 가치의 대부분이 여기서 나온다.
- **클론 시 현실적 대안**: 자동 매칭은 이메일 정확 일치 1종만, 나머지는 수동 매핑 UI. 이름 매칭은 아예 구현하지 않는다(오매칭 비용 > 이득).
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/github , https://www.notion.com/help/synced-databases

---

### F-15-08 소스 삭제 전파와 "복원 불가 휴지통"

- **한 줄 정의**: 외부에서 항목이 삭제되면 노션의 대응 행도 삭제하되, 무엇이 사라졌는지 확인할 수 있도록 휴지통에는 남기고 복원은 막는다.
- **사용자 시나리오**: Jira에서 이슈를 삭제한다 → 다음 sync에서 노션 행이 사라진다 → 사용자가 휴지통을 열면 그 행이 보인다 → **복원할 수 없다**(공식: 무엇이 삭제됐는지 휴지통에서 볼 수는 있지만 복원할 수는 없다).
- **동작 상세**:
  - 삭제 관측 경로 2가지: ① 삭제 webhook 수신 ② 전체 resync에서 미관측(set difference).
  - ②는 위험하다 — 부분 실패한 resync를 완전한 것으로 오인하면 **대량 오삭제**가 발생한다. 따라서 **`sync_run.status='ok'`(전체 완주)일 때만 set-difference tombstone을 허용**해야 한다. 이것이 이 기능의 유일한 안전 불변식이다.
  - 행이 tombstone되면 그 행의 **본문 블록(사용자가 쓴 메모)도 함께 사라진다.** 이것이 복원 불가와 결합해 실질적 데이터 손실이 되며, 사용자에게 가장 놀라운 동작이다. 클론은 최소한 **본문 블록이 있는 행은 tombstone 대신 `orphaned` 상태로 유지**하는 완화책을 고려할 가치가 있다.
  - 복원 불가의 이유는 명확하다: 복원해도 소스에 원본이 없으므로 다음 sync에서 즉시 재삭제되어 무한 루프가 된다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 부분 실패 resync | set-difference 금지 (위 불변식) |
  | 프로젝트가 바인딩 범위에서 제외됨 | 삭제가 아니라 **범위 이탈**. 같은 tombstone으로 처리하면 사용자에게 데이터 소실로 보임 → `trash_reason='source_out_of_scope'`로 분리 |
  | 소스에서 아카이브(삭제 아님) | Jira/GitHub의 close·archive는 상태 변경이지 삭제가 아니다. 혼동 금지 |
  | 삭제된 행을 참조하던 relation | relation_edge 끊김 + 참조 측 rollup 재계산(F-03-13) |
  | 사용자가 복원 시도 | 버튼 비활성 + 사유 안내 |
  | 소스에서 삭제 후 같은 키로 재생성 | external_id가 다르므로 **새 행**. 사용자에겐 중복처럼 보임 |
  | 30일 후 휴지통 GC | 통상 GC 규칙(F-11-06)에 따름 |
  | 대량 삭제(프로젝트 전체) | 배치 tombstone + 알림 억제. 개별 알림을 보내면 인박스가 마비됨(R13) |
- **데이터 모델 함의**: **R5가 핵심** — "휴지통에 있으나 복원 불가"는 02의 `trashed_at/purged_at` 3상태에도, 11의 `lifecycle ENUM('live','trashed','retained','purged')`에도 표현되지 않는 상태다. `trash_reason` + `restorable BOOLEAN` 축을 요구한다. 추가로 `external_row_link.tombstoned_at`.
- **UI/인터랙션**: 휴지통에서 해당 항목에 소스 아이콘 + "원본에서 삭제됨 · 복원 불가" 라벨, 복원 버튼 비활성.
- **의존 기능**: F-11-05/F-11-06(휴지통·보존), F-02-11(soft delete), F-15-05(sync_run 완주 판정), F-03-13(rollup 재계산).
- **구현 난이도**: **S** — 로직은 작다. 다만 R5 축이 선행되어야 하고 set-difference 안전 조건을 반드시 지켜야 한다.
- **우선순위**: **P0(도메인 내)** — 삭제 전파 없이 sync를 켜면 데이터가 단조 증가만 하여 몇 달 뒤 신뢰를 잃는다.
- **클론 시 현실적 대안**: v1은 **삭제를 전파하지 않고 `Deleted in source` 체크박스 프로퍼티만 세워 기본 필터로 숨긴다.** 데이터 손실 위험이 0이 되고 "복원 불가"라는 난감한 UX도 사라진다 — **원본보다 나은 선택일 수 있다.**
- **참고 출처**: https://www.notion.com/help/synced-databases , https://www.notion.com/help/duplicate-delete-and-restore-content

---

### F-15-09 소스 구성 변경 대응 (프로젝트 키 변경 · 사이트 URL 변경 · 범위 추가/제거)

- **한 줄 정의**: 외부 시스템의 식별자나 범위가 바뀌었을 때 sync가 조용히 낡지 않게 감지하고, 필요하면 재임포트를 요구한다.
- **사용자 시나리오**:
  1. Jira 관리자가 프로젝트 키를 `PROJ` → `PLAT`으로 바꾼다 → 노션 데이터가 갱신을 멈추지만 **오류 표시 없이 낡은 상태로 보인다**(공식: "데이터가 오래돼 보임").
  2. 사용자가 소스 설정에서 해당 프로젝트를 **제거하고 새 키로 다시 추가**해야 한다(공식 해결책).
  3. Jira 사이트 URL을 바꾼 경우 → **sync 자체가 깨진다**(공식: URL과 sync는 직결되어 있어 생성 후 URL을 바꾸면 sync가 끊기고 실시간 갱신을 잃는다).
- **동작 상세**:
  - 공식 문서가 밝힌 3가지 구성 변경 사고:

    | 변경 | 결과 | 공식 해결책 |
    |---|---|---|
    | 프로젝트 키 rename | 데이터 정지(무증상) | 해당 프로젝트 제거 후 새 키로 재임포트 |
    | Jira 사이트 URL 변경 | sync 파손, 실시간 갱신 상실 | sync 재생성 |
    | select/multi-select 값 누락 | 값이 안 채워짐 | 해당 필드 재임포트 |

  - **셋의 공통 교훈**: 노션 구현이 사람이 읽는 키(프로젝트 키, 사이트 URL)를 식별자로 쓰고 있어 rename에 취약하다. **클론은 F-15-04대로 불변 id를 쓰면 프로젝트 키 rename 문제를 애초에 겪지 않는다** — 원본보다 나은 설계가 가능한 드문 지점이다.
  - 무증상 정지가 최악이므로 클론은 "마지막 성공 sync 이후 N시간 경과"를 **stale 감지 휴리스틱**으로 두고 배지를 띄워야 한다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 범위에서 프로젝트 제거 | 해당 행 tombstone 여부를 정책으로 결정 + `source_out_of_scope` 사유 분리(F-15-08) |
  | 범위에 프로젝트 추가 | 새 프로젝트만 백필. 기존 행 재처리 금지 |
  | 리포 이름 변경(GitHub) | node_id 불변이므로 URL만 갱신(클론 설계 시) |
  | 리포가 다른 org로 이전 | 커넥션 tenant 변경 → 재연결 필요 |
  | 재임포트 시 로컬 프로퍼티 | **반드시 보존되어야 한다.** 재임포트가 로컬 데이터를 날리면 기능 자체가 무의미 [추정: 공식 명문 확인 실패] |
  | 재임포트 중 중복 행 | external_id 기준 매칭이면 중복 없음. 키 기준이면 전량 중복 |
  | 대규모 범위 변경(프로젝트 20개 추가) | 백필 큐에 넣고 동시성 상한 적용 |
- **데이터 모델 함의**: `external_binding.resource_scope`(jsonb, 다중 프로젝트), `sync_issue.code ∈ {project_key_renamed, site_url_changed}`, `external_row_link.external_key`(사람이 읽는 키를 **보관만** 하고 매칭에는 쓰지 않음). 재임포트가 로컬 프로퍼티를 보존하려면 **행 삭제 후 재생성이 아니라 upsert 경로 재사용**이어야 한다.
- **UI/인터랙션**: 소스 설정의 프로젝트/리포 다중 선택, stale 경고 배너, "제거 후 다시 추가" 안내.
- **의존 기능**: F-15-04(불변 id), F-15-05(백필 재실행), F-15-11(배지).
- **구현 난이도**: **M** — 범위 변경 시 델타 백필과 stale 감지.
- **우선순위**: **P1(도메인 내)** — 없어도 첫 출시는 되지만, 없으면 몇 달 후 "조용히 낡은 데이터" 사고가 반드시 난다.
- **클론 시 현실적 대안**: stale 감지를 "마지막 성공 sync_run > 48시간" 단일 규칙으로 시작.
- **참고 출처**: https://www.notion.com/help/common-jira-sync-issues

---

### F-15-10 양방향 쓰기 백 (Enterprise 한정 · 화이트리스트 필드)

- **한 줄 정의**: 지정된 소수 필드에 한해 노션에서의 편집을 외부 시스템에 반영한다.
- **사용자 시나리오**:
  1. Enterprise 워크스페이스에 Jira Sync가 설치됨.
  2. 사용자가 **본인의 Jira 계정으로 개별 인증**한다(워크스페이스 토큰이 아니다).
  3. synced DB에 대해 `Full access` 또는 `Can edit` 권한이 있어야 한다.
  4. board 뷰에서 카드를 드래그해 `Status`를 옮긴다 → Jira 이슈 상태가 바뀐다.
  5. 노션에서 코멘트를 단다 → Jira 이슈에 코멘트가 추가된다. **단 이후 노션에서 그 코멘트를 수정할 수는 없다**(공식).
- **동작 상세**:
  - 편집 가능 필드(Jira Sync, 공식 명시): **Status, Assignee, Priority, Attachments, Comments 5종.** Description, Title, 날짜, 커스텀 필드는 노션에서 편집 불가.
  - 요금제: **Enterprise 전용**(2026-01-20 Notion 3.2 릴리스: Enterprise에서 핵심 Jira 필드를 노션에서 직접 편집하고 자동 반영).
  - **게스트와 공개 링크 접근자는 write-back 불가**(공식). write-back은 "노션 편집권 AND 외부 계정 인증"의 **AND 조건**이다 → 같은 셀이 사람마다 편집 가능/불가로 갈린다.
  - Priority 옵션은 "Jira에서 실제로 사용된 값만" 선택지로 뜬다 → 노션에서 임의 옵션을 만들어 보낼 수 없다.
  - GitHub·GitLab·Asana는 write-back이 공식 문서에 없다 → 단방향.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 외부 API가 거부(권한 부족·워크플로 전이 불가) | 노션의 낙관적 값을 **되돌리고** 사유 표시. 되돌리지 않으면 노션만 거짓 상태 |
  | Jira 워크플로가 그 상태 전이를 금지 | 위와 동일. 노션 status 옵션이 Jira 워크플로 그래프를 모른다는 것이 근본 한계 |
  | 사용자가 외부 계정 미연결 | 셀이 readonly로 폴백 |
  | 전송 중 외부에서 같은 필드 변경 | F-15-14 충돌 매트릭스 |
  | 오프라인 편집 후 재접속 | 전송 전 현재 외부 값과 비교, stale이면 폐기 + 알림 |
  | 자동화가 write_back 필드를 변경 | 자동화 실행 주체(F-08-10 `actor_id`)에 대응하는 외부 계정이 필요. 워크스페이스 봇으로 대리 전송하면 외부 감사 로그가 오염됨 → **자동화의 write-back은 금지가 안전** [추정] |
  | 재시도 중복 | 외부 API idempotency key 또는 "현재 값이 이미 목표값이면 스킵" |
  | 첨부 업로드 실패(1MB 초과) | 사전 검증으로 거부(F-15-03의 한도 재사용) |
- **데이터 모델 함의**: `external_write_back` 큐(**`actor_external_account_id` 필수** — R9, `prev_value` 보관 필수), `external_field_map.sync_policy='pull_push'`, `property.writable='write_back'`.
- **UI/인터랙션**: 편집 가능 셀은 일반 셀처럼 보이되 전송 중 스피너, 실패 시 인라인 오류 + 되돌림 토스트, 미연결 사용자에게 "Jira 계정 연결" CTA.
- **의존 기능**: F-15-06(writable 축), F-15-07(계정 연결), F-06-01(편집 권한), F-13-18(Enterprise 게이팅), F-05-04(낙관적 업데이트·롤백 경로 재사용).
- **구현 난이도**: **XL** — 외부 API 쓰기의 부분 실패·롤백·감사·사용자별 자격증명이 전부 걸린다. 읽기 전용 sync보다 훨씬 비싸다.
- **우선순위**: **P2(도메인 내)** — 노션 자신도 최초 출시(2022-06) 후 3년 반 만에(2026-01) 5개 필드에 한해 붙였다. 클론이 먼저 할 이유가 없다.
- **클론 시 현실적 대안**: write-back 대신 **"외부에서 열기" 딥링크 + 상태 프로퍼티 이원화**. `Jira Status`(readonly)와 `Our Status`(local)를 나란히 두고 노션 워크플로는 후자로 돈다. 구현비 **XL → S**이고 충돌이 원천 소멸한다.
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/releases/2026-01-20

---

### F-15-11 동기화 상태 표면 (배지 · 오류 코드 · 재인증 유도)

- **한 줄 정의**: 이 DB가 최신인지, 멈췄는지, 왜 멈췄는지를 사용자가 보는 곳에서 알린다.
- **사용자 시나리오**: DB 헤더를 본다 → `Synced just now` / `Syncing…` / `Sync failed` / `Sync stopped` 중 하나. 실패 배지를 클릭하면 사유와 조치(토큰 재발급, 계정 재연결, 프로젝트 재임포트)가 뜬다.
- **동작 상세**:

  | 배지 | 공식 정의 | 조치 |
  |---|---|---|
  | `Synced just now` | 백필/갱신 완료 | 없음 |
  | `Sync failed` | webhook 등록 실패 또는 프로젝트 sync 실패(토큰 권한 부족) | scopeless 관리자 토큰 재발급 |
  | `Sync stopped` | 토큰 무효 또는 계정 연결 해제 | 재인증 |
  | (무증상 stale) | 프로젝트 키 rename 등 — **공식 배지 없음** | 클론은 배지를 추가할 것(F-15-09) |

  - "변경이 안 보이면 페이지를 새로고침하라"가 공식 안내다 — 즉 **sync가 만든 변경이 05/12의 실시간 동기화 채널을 타지 않는 경로가 있다**는 뜻이다 [추정]. 클론은 sync 결과도 통상 실시간 경로로 흘려보내는 편이 낫다.
  - 상태는 바인딩 단위이며, 다중 프로젝트 바인딩에서는 **프로젝트별 부분 실패**가 표현되어야 한다(1개 프로젝트 문제로 전체를 stopped로 만들면 안 됨).
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 같은 오류 반복 | `sync_issue`를 매번 만들지 말고 `last_seen_at` 갱신(중복 알림 방지) |
  | 조치 권한 없는 일반 멤버가 봄 | 배지는 보이되 조치 버튼은 owner에게만. "관리자에게 문의" 안내 |
  | 오류 해소 | `resolved_at` 기록 + 배지 자동 회복 |
  | 부분 백필 중 | 진행률(처리/전체) 노출 — "완료됐는데 행이 적다"는 오해 방지 |
  | 알림 발송 | 실패 지속 시 **워크스페이스 owner에게만**(F-11-08 규칙 엔진 경유). 전체 멤버 알림은 금지(R13) |
  | 권한 없는 사용자가 오류 상세 조회 | 외부 시스템 오류 메시지에 내부 정보가 섞일 수 있으므로 owner 외에는 요약만 |
- **데이터 모델 함의**: `sync_issue`(code/severity/first_seen/last_seen/resolved), `external_binding.state`, `last_synced_at`.
- **UI/인터랙션**: DB 헤더 배지(호버 시 상세), 설정의 바인딩 목록 + 상태 열, 오류 상세 모달.
- **의존 기능**: F-15-05, F-15-02(재인증), F-11-08(알림 규칙).
- **구현 난이도**: **S** — 상태 테이블 + 배지 렌더.
- **우선순위**: **P0(도메인 내)** — 조용히 실패하는 sync는 없는 것보다 나쁘다.
- **클론 시 현실적 대안**: 없음(비용이 이미 작다).
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/common-jira-sync-issues , https://www.notion.com/help/github

---

### F-15-12 외부 관계 재구성 (크로스 프로젝트 링크 · 본문 링크 기반 자동 relation)

- **한 줄 정의**: 외부 시스템 내부의 항목 간 관계와, 외부 항목이 참조하는 노션 페이지를 relation 프로퍼티로 복원한다.
- **사용자 시나리오**:
  1. Jira에서 PROJ-1이 PLAT-9를 blocks한다 → 두 프로젝트를 **모두 sync 설정에 포함했다면** 노션에서 relation으로 나타난다. 한쪽이 빠졌으면 **관계는 임포트되지 않는다**(공식).
  2. GitHub PR 설명·커밋 메시지에 magic word(`fixes`, `closes`) + 노션 unique ID를 쓴다 → 노션 태스크와 PR이 연결되고 PR 상태에 따라 태스크 status가 자동 갱신된다(공식).
  3. 자동 relation 설정을 켜면, 외부 항목의 제목·설명에 노션 페이지 링크가 있을 때 relation이 자동으로 채워진다(공식).
- **동작 상세**:
  - 관계 3종류의 처리 경로가 다르다:

    | 종류 | 예 | 해소 방법 |
    |---|---|---|
    | 외부↔외부 (같은 바인딩) | 같은 프로젝트의 parent/subtask, sprint | external_id 쌍 → page_id 쌍 즉시 해소 |
    | 외부↔외부 (다른 바인딩) | 크로스 프로젝트 linked issue | 상대 바인딩이 존재해야만 해소. 없으면 **영구 미해소**(공식) |
    | 외부→노션 네이티브 | PR 설명의 노션 링크 / magic word + unique ID | URL 파싱 또는 unique ID 역조회 |

  - 순서 문제가 본질이다: A가 B를 참조하는데 B가 아직 백필되지 않았을 수 있다 → `external_relation_pending` 큐에 넣고 B upsert 시 해소한다. 큐가 없으면 백필 순서에 따라 관계가 무작위로 유실된다.
  - relation 프로퍼티는 노션 개념이므로 **컬럼은 `origin=native`이되 값은 sync가 관리(`sync_policy='pull'`)**하는 하이브리드다 — F-15-06의 두 축이 독립이어야 하는 근거.
  - magic word 경로는 **노션의 unique ID(F-03-09)를 외부에 노출**하는 것을 전제한다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 상대 프로젝트가 sync 범위 밖 | 관계 미임포트(공식). 나중에 추가 시 소급 해소되는지는 [확인필요] |
  | 참조된 노션 페이지 삭제 | relation 끊김 + rollup 재계산(F-03-13) |
  | 참조 링크가 접근 권한 없는 페이지 | relation은 만들되 렌더 시 권한 필터(F-06-14) |
  | 순환 참조(A→B→A) | relation은 그래프이므로 허용. rollup 재계산 사이클 감지 필요 |
  | 자동 relation off→on 전환 | 기존 행 전체 재스캔(대량 잡) |
  | 외부에서 관계 삭제 | pull 정책이므로 엣지 삭제. **사용자가 수동 추가한 엣지와 구분 불가하면 사용자 데이터를 지운다** → sync 소유 엣지 표시 필요(R8), 또는 자동 relation 전용 프로퍼티 분리 |
  | 대용량(관계 수만 건) | 지연 큐가 무한 증가하지 않도록 TTL 또는 미해소 상한 필요 |
- **데이터 모델 함의**: R8 — `external_relation_pending` 지연 해소 큐 + `relation_edge`에 소유자 표시. 03의 `relation_edge` 별도 테이블 설계가 **필수**임을 이 기능이 재확인한다(04의 jsonb-in-properties로는 역방향 해소·부분 삭제 불가) → **C-2 정본 결정의 추가 근거.**
- **UI/인터랙션**: 자동 relation 토글, 미해소 참조에 흐린 칩, GitHub 백링크 on/off 토글(공식).
- **의존 기능**: F-03-10(relation), F-03-09(unique ID), F-03-13(재계산), F-15-04, F-15-05.
- **구현 난이도**: **L** — 지연 해소 큐, 소유권 표시, 대량 재스캔.
- **우선순위**: **P1(도메인 내)** — "외부 데이터를 노션 계획과 잇는다"가 이 도메인의 목적이므로 relation이 없으면 목적의 절반이 사라진다.
- **클론 시 현실적 대안**: 외부↔외부 관계는 포기하고 **외부→노션 방향 1개만**(본문 링크 파싱) 구현. 나머지는 사용자가 F-03-10으로 수동 연결한다.
- **참고 출처**: https://www.notion.com/help/common-jira-sync-issues , https://www.notion.com/help/guides/synced-databases-bridge-different-tools , https://www.notion.com/help/github

---

### F-15-13 요금제 게이팅과 커넥션 거버넌스

- **한 줄 정의**: 어떤 요금제가 synced DB를 몇 개까지 쓸 수 있는지, 그리고 조직이 어떤 커넥터의 설치를 허용할지를 통제한다.
- **사용자 시나리오**:
  1. Plus 워크스페이스 사용자가 GitHub 링크를 붙여넣는다 → `Paste as database` 옵션이 없거나 업그레이드 안내가 뜬다.
  2. Enterprise owner가 Settings → Connections → Manage에서 `Approved only`를 켠다 → 멤버는 승인 목록의 커넥터만 설치 가능.
  3. owner가 커넥터별 **설치자 목록을 확인**하고 개별 또는 일괄 연결 해제를 실행한다.
- **동작 상세**:
  - **기능 게이팅**: 공식 help는 synced databases를 "Business 및 Enterprise 플랜에서 사용 가능"이라 명시. write-back은 Enterprise 전용.
  - **개수/행 한도**: 3자 블로그가 "Free 1개·100행 / 유료 100개·20,000행"을 주장하나 **공식 출처로 확인되지 않았고 Business/Enterprise 게이팅 서술과 상충**한다 → **[확인필요]. 클론은 자체 상수로 선언할 것.**
  - **커넥션 거버넌스(Enterprise, 공식)**: 설치 제한 3모드(제한 없음 / 승인+추천 / 승인만), 승인 목록 관리(승인하려면 먼저 누군가 설치해야 함), 노션 제작 커넥터 자동 승인 옵션, 커넥터별 설치자 목록·사용자 필터, 개별 해제 및 일괄 해제, 승인 목록에서 커넥터 제거.
  - 게이팅 강제 지점은 F-13-18이 정리한 4축 중 **①기능 온오프(붙여넣기 메뉴·설정 진입) ②개수 한도(바인딩 생성 트랜잭션) ③사용량 한도(백필 upsert 루프)** 3곳에 흩어진다. 단일 `hasFeature()`로 통합되지 않는다는 F-13-18의 결론이 그대로 적용된다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 다운그레이드로 게이트 상실 | 바인딩을 삭제하지 말고 **동기화만 정지 + 데이터 동결**. 삭제하면 F-15-08의 복원 불가와 겹쳐 파괴적 |
  | 행 한도 초과 | 백필 중단 + 배지. 잘린 사실을 반드시 노출 |
  | 커넥터가 사후에 승인 목록에서 제거됨 | 기존 설치 유지 여부 정책 필요. 공식은 "일괄 해제" 버튼 제공 |
  | 트라이얼 중 생성 후 만료 | 다운그레이드와 동일 |
  | 게스트가 synced DB를 봄 | 조회는 통상 ACL, write-back은 불가(공식) |
  | 일괄 해제 실행 | 영향 받는 바인딩 수를 사전 고지(F-15-15) |
- **데이터 모델 함의**: R11(`plan_entitlement`에 `synced_database.count`, `synced_database.rows`, `write_back.enabled` 3축), `connection_policy(workspace_id, mode, auto_approve_first_party)`, `approved_connection(workspace_id, provider)`. `external_connection.installed_by`가 거버넌스 화면의 데이터 소스다.
- **UI/인터랙션**: Settings → Connections → Manage 탭(제한 모드 라디오, 승인 목록, 설치자 표, 해제 버튼), 업그레이드 안내 모달.
- **의존 기능**: F-13-18(엔타이틀먼트 엔진), F-06-13(커넥션 권한), F-06-02(owner 판정).
- **구현 난이도**: **M** — 엔타이틀먼트 엔진이 이미 있다면 축 3개 추가 + 관리 화면.
- **우선순위**: **P2(도메인 내)** — 클론은 초기에 전 사용자 허용으로 시작해도 된다. 단 **다운그레이드 시 데이터 동결 규칙**만은 처음부터 정해둘 것.
- **클론 시 현실적 대안**: 거버넌스 화면 없이 `workspace_setting.allowed_providers text[]` 한 줄로 시작.
- **참고 출처**: https://www.notion.com/help/synced-databases , https://www.notion.com/help/enterprise-connection-settings , https://www.notion.com/releases/2026-01-20

---

### F-15-14 동기화 충돌 처리 (원격 갱신 × 로컬 편집 × write-back 경합)

- **한 줄 정의**: 같은 행/셀에 대해 외부 갱신과 노션 편집이 겹칠 때 무엇이 이기는지를 결정론적으로 정한다.
- **사용자 시나리오**: 사용자가 board 뷰에서 카드를 `In Progress`로 드래그하는 사이, 같은 이슈가 Jira에서 `Done`으로 바뀐다. 잠시 후 카드가 `Done`으로 되돌아간다 — 이 되돌림이 **예측 가능하고 설명 가능**해야 한다.
- **동작 상세**:
  - **충돌 대부분이 설계로 제거된다.** 프로퍼티가 `readonly`/`write_back`/`local` 중 하나로 분류되므로, 충돌 가능 지점은 `write_back` 프로퍼티 5종에 한정된다. 이것이 F-15-06 축의 진짜 가치다.
  - 충돌 매트릭스:

    | 프로퍼티 종류 | 외부 변경 | 노션 변경 | 해소 |
    |---|---|---|---|
    | `readonly` | 적용 | 애초에 불가 | 충돌 없음 |
    | `local` | 없음 | 적용 | 충돌 없음 |
    | `write_back` | 적용 | 큐 전송 | **외부가 진실. 전송 실패 시 노션 값 되돌림** |
    | 본문 블록 | 없음 | 적용(CRDT) | F-05-01 통상 경로 |

  - 원칙: **외부 시스템이 source of truth**다. write-back은 "제안"이며 외부의 확인으로만 확정된다: `queued → sent → confirmed | rejected → reverted`.
  - 노션 사용자 간 충돌(같은 write_back 셀을 두 사람이 동시 수정)은 05의 통상 경로로 먼저 승자를 정하고, 그 승자만 외부로 전송한다.
  - F-12-04가 1차 출처로 확인한 "비텍스트 편집은 사실상 LWW"와 정합적이다 — 다만 여기서는 **last writer가 항상 외부**라는 더 강한 규칙이다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | 전송 후 confirm 전에 외부에서 다른 값으로 변경 | 외부 값 채택. 사용자 편집이 소리 없이 사라지므로 **토스트로 반드시 알림** |
  | 외부 API가 202만 주고 비동기 반영 | confirm을 webhook 수신으로 판정. 타임아웃 시 `unknown` 상태 필요 |
  | 오프라인에서 write_back 셀 편집 → 24시간 후 재접속 | 전송 전 현재 외부 값과 비교, stale이면 폐기 + 알림 |
  | resync가 미확정 write-back을 덮어씀 | 큐에 `sent` 상태인 (page, field)는 resync에서 **일시 제외**, 또는 덮어쓴 뒤 confirm 시 재적용 |
  | sync가 `local` 프로퍼티를 건드림 | 버그. `sync_policy` 검사를 upsert의 **유일한 쓰기 게이트**로 만들 것 |
  | 행 tombstone과 write-back 경합 | tombstone 우선, 큐 항목 폐기 |
  | 권한이 sync 도중 변경됨 | 다음 조회 시 권한 필터가 적용될 뿐 sync는 무관(바인딩은 워크스페이스 수준) |
- **데이터 모델 함의**: `external_write_back.status` 상태 머신 + `prev_value` 보관(되돌림용), `external_row_link.source_version`(단조 적용), upsert 시 `sync_policy` 게이트. **05 F-05-01의 all-or-nothing 규약과 이 도메인의 부분 적용(F-15-05)이 다른 경로임을 정본 문서에 명시**해야 한다.
- **UI/인터랙션**: 되돌림 토스트("Jira에서 값이 변경되어 되돌렸습니다" + 원본 링크), 전송 중 셀 표시, 실패 사유 인라인.
- **의존 기능**: F-15-06, F-15-10, F-05-01/F-05-04(낙관적 업데이트·롤백), F-12-04(오프라인 큐).
- **구현 난이도**: **M** — 매트릭스는 단순. 비용은 상태 머신 완결성과 토스트 UX.
- **우선순위**: **P1(도메인 내)** — 실질적으로 F-15-10과 함께 움직인다. write-back이 없으면 대부분 자동 해소.
- **클론 시 현실적 대안**: write-back을 만들지 않으면 이 기능의 90%가 불필요해진다. `readonly`/`local` 2분류만으로 충돌이 구조적으로 소멸한다 — **이것이 클론이 취해야 할 기본 자세**다.
- **참고 출처**: https://www.notion.com/help/jira , https://www.notion.com/help/use-pages-offline , https://www.notion.com/help/synced-databases

---

### F-15-15 연결 해제 · 바인딩 detach · 데이터 잔존 수명주기

- **한 줄 정의**: sync를 끊었을 때 이미 들어온 데이터와 로컬로 덧붙인 데이터가 어떻게 되는지를 정한다.
- **사용자 시나리오**:
  1. owner가 Settings → Connections에서 GitHub 커넥션을 해제한다 → 그 커넥션에 걸린 모든 바인딩이 `Sync stopped`가 된다.
  2. 사용자가 synced DB 자체를 삭제한다 → 통상 휴지통 경로(F-11-05).
  3. (바람직한 경로) "sync 중지하고 데이터는 유지"를 선택하면 행이 `origin=native`로 승격되어 완전히 편집 가능해진다 [공식 미문서화 — 확인필요].
- **동작 상세**:
  - 3가지 종료 경로를 구분해야 한다:

    | 경로 | 데이터 | 편집 가능성 | 되돌리기 |
    |---|---|---|---|
    | 커넥션 해제(자격증명 상실) | 유지 | 여전히 readonly | 재인증하면 재개 |
    | 바인딩 detach(sync 중지, 데이터 유지) | 유지 | **native 승격 → 편집 가능** | link 보존 시 재연결 가능 |
    | DB 삭제 | 휴지통 | — | 30일 내 복원 |

  - detach는 사용자에게 가장 유용한 종료지만 순진하게 구현하면 비가역이다: link를 지우면 재연결 시 전부 중복 생성된다. **`external_row_link`를 삭제하지 말고 `detached_at`으로 보존**하면 재연결 시 재매칭이 가능하다 — 원본보다 나은 설계 여지.
  - 커넥션 해제는 **여러 바인딩에 팬아웃**한다. owner에게 "이 커넥터를 해제하면 synced DB N개가 멈춥니다"를 반드시 고지해야 한다. Enterprise 일괄 해제(F-15-13)는 사용자 수십 명분을 한 번에 끊으므로 같은 고지가 필요하다.
- **엣지 케이스**:

  | 상황 | 동작 |
  |---|---|
  | detach 후 로컬 프로퍼티 | 그대로 유지(원래부터 local) |
  | detach 후 readonly 프로퍼티 | native 승격되어 편집 가능. **이후 재연결하면 사용자 편집이 외부 값으로 덮인다**는 것을 고지 |
  | 커넥션 해제 후 재인증 | 바인딩·매핑·행 링크 모두 보존되어야 함 |
  | DB 삭제 후 복원 | 바인딩도 함께 복원. 그 사이 외부 변경분은 다음 resync로 따라잡음 |
  | 워크스페이스 삭제 | 커넥션·토큰 폐기(시크릿 스토어에서도) |
  | 사용자 계정 삭제(레거시 사용자 토큰) | 그 사람이 설치한 커넥션 전부 무효 → 관리자 토큰 방식(F-15-02)이 존재하는 이유를 재확인 |
  | detach된 DB에 남은 미해소 relation | pending 큐 정리 필요(고아 방지) |
- **데이터 모델 함의**: `external_binding.state='detached'` + `external_row_link.detached_at`, page의 `origin: external → native` **전이 경로**(R1이 단순 boolean이 아니라 전이 가능한 상태여야 하는 이유), 시크릿 폐기.
- **UI/인터랙션**: 해제 확인 모달(영향 받는 DB 수 표시), "Stop syncing and keep data" vs "Delete database" 2지선다, detach 후 상단 배너("이 데이터베이스는 더 이상 동기화되지 않습니다").
- **의존 기능**: F-15-02, F-15-13, F-11-05(휴지통), F-15-06(origin 전이).
- **구현 난이도**: **M** — 상태 전이와 팬아웃 고지.
- **우선순위**: **P1(도메인 내)** — 사용자가 빠져나올 길이 없는 통합은 도입 자체가 꺼려진다. detach는 신뢰의 전제 조건이다.
- **클론 시 현실적 대안**: v1은 detach만 지원하고 "재연결 시 중복 가능" 경고 문구로 대체(링크 보존 로직 생략) → **S**로 축소.
- **참고 출처**: https://www.notion.com/help/enterprise-connection-settings , https://www.notion.com/help/jira , https://www.notion.com/help/duplicate-delete-and-restore-content

---

## 구현 우선순위 요약표

> **도메인 전체는 클론 로드맵상 v2(post-MVP)다.** 아래 P0/P1/P2는 "이 도메인에 착수한다고 가정했을 때의 내부 순서"다. 유일한 예외는 **F-15-06이 요구하는 `origin`/`writable` 스키마 축으로, 이것은 MVP 시점에 컬럼 자리를 잡아두어야 한다.**

| F-ID | 기능 | 난이도 | 도메인 내 우선순위 | MVP 시점 요구 | 핵심 의존 |
|---|---|---|---|---|---|
| F-15-01 | Synced DB 컨테이너·생성 플로우 | L | P0 | — | F-03-01, F-04-01 |
| F-15-02 | 커넥터 인증 (user/admin 토큰) | L | P0 | — | F-06-13, 14 도메인 |
| F-15-03 | 외부 필드 → property 매핑 | L | P0 | — | F-03-02, F-03-14 |
| F-15-04 | external_id ↔ page_id 멱등 upsert | M | P0 | **R1 page.origin** | F-15-01 |
| F-15-05 | 증분 동기화 엔진 | XL | P0 | — | 스케줄러(R10 / U-4) |
| F-15-06 | readonly × local 프로퍼티 공존 | M | P1 | **R2 property.origin/writable** | F-03-16, F-09-17 |
| F-15-07 | Identity mapping | M | P1 | — | F-03-07, F-06-12 |
| F-15-08 | 소스 삭제 전파 · 복원 불가 | S | P0 | **R5 trash_reason/restorable** | F-11-05/06 |
| F-15-09 | 소스 구성 변경 · 재임포트 | M | P1 | — | F-15-04 |
| F-15-10 | 양방향 write-back (Enterprise) | XL | P2 | — | F-15-06/07, F-13-18 |
| F-15-11 | 동기화 상태·오류 표면 | S | P0 | — | F-15-05 |
| F-15-12 | 외부 relation 재구성 | L | P1 | **R8 relation_edge 별도 테이블** | F-03-10, F-03-13 |
| F-15-13 | 요금제 게이팅 · 커넥션 거버넌스 | M | P2 | — | F-13-18 |
| F-15-14 | 동기화 충돌 처리 | M | P1 | — | F-15-06/10 |
| F-15-15 | 해제 · detach · 데이터 잔존 | M | P1 | — | F-15-02 |

### 이 도메인의 구현 착수 순서

```
1) 스키마 축 확보     : R1(page.origin) → R2(property.origin/writable) → R5(restorable)
2) 인증 + 바인딩      : F-15-02 → F-15-01
3) 매핑 + upsert      : F-15-03 → F-15-04
4) 엔진(축소판)       : F-15-05(조회 트리거만) → F-15-11
5) 안전장치           : F-15-08 → F-15-15
6) 가치 확장          : F-15-07 → F-15-12 → F-15-09
7) (선택) 양방향      : F-15-10 → F-15-14
```

### 최소 실용 버전 (원본의 20% 비용으로 80% 가치)

| 결정 | 효과 |
|---|---|
| 소스 1개(GitHub 또는 Jira)만 지원 | provider 카탈로그·codec 비용 1/4 |
| webhook 없이 조회 트리거 resync만 | F-15-05 **XL → M** |
| 필드 화이트리스트 12개 + `raw jsonb` 1개 | F-15-03 **L → M** |
| write-back 미구현(`readonly`/`local` 2분류) | F-15-10 XL 제거, F-15-14 대부분 소멸 |
| 삭제 전파 대신 `Deleted in source` 체크박스 | F-15-08 S, 데이터 손실 위험 0 |
| identity는 이메일 정확 일치 + 수동 매핑 | F-15-07 **M → S** |
| **총합** | **L~XL 1개 스프린트급으로 축소** |

---

## 오픈소스 클론 구현 참고

| 대상 | 무엇을 참고할 것인가 | 주의 |
|---|---|---|
| Nango / Airbyte / Fivetran | 커넥터 카탈로그를 **데이터로** 두는 구조, 워터마크·커서·재개, rate limit 백오프 | 적재 대상이 일반 테이블이 아니라 **블록 트리를 가진 페이지**라는 점이 근본적으로 다르다 |
| Unito / Getint (상용 양방향 sync) | 양방향 필드 매핑 UI, 충돌 정책 선택지 제공 방식 | 클론이 write-back을 자체 구현하지 않고 이런 iPaaS에 위임하는 것이 합리적 선택지 |
| Iframely (F-09-11이 참조) | provider 레지스트리를 코드가 아닌 데이터로 두는 선례 | 언퍼링은 상태가 없고 sync는 상태가 있다 — 재사용 범위는 레지스트리 구조까지 |
| 일반 webhook 신뢰성 패턴 | webhook(즉시) + 주기 잡(정합성) 하이브리드, 멱등 키, DLQ, 재조정 | 노션의 "조회될 때만 하루 1회 resync"는 비용 억제 아이디어로 특히 유용 |
| AppFlowy / Focalboard 등 노션 클론 | 참고 가치 낮음 — 외부 지속 동기화를 구현한 오픈소스 노션 클론은 확인되지 않았다 [확인필요] | 이 도메인은 클론 생태계에서 사실상 미개척 |

---

## 미해결 / 확인필요

| # | 항목 | 상태 |
|---|---|---|
| Q1 | synced DB 개수·행 한도의 정확한 수치 | **[확인필요]** 3자 블로그의 "Free 1개/100행, 유료 100개/20,000행"은 공식 "Business·Enterprise 전용" 서술과 상충. 공식 출처 미발견 → **클론 자체 상수로 선언 권고** |
| Q2 | GitLab·Asana의 필드 전수표와 sync 지속성 | **[확인필요]** 공식 help는 4종 모두 "지속 동기화"라 하나, 3자 글은 Asana를 "1회성 복제"라 서술. 상충 |
| Q3 | 사용자가 외부 origin 행을 노션에서 삭제하면 다음 sync가 되살리는가 | **[확인필요]** 공식 미기재. 클론은 "되살림 + 안내"를 권고 |
| Q4 | 외부 origin 행을 다른 DB로 이동 가능한가 | **[확인필요]** 금지 또는 native 승격 중 정책 결정 필요 |
| Q5 | identity mapping의 수동 매핑 UI 존재 여부 | **[확인필요]** 공식 문서는 이메일/이름 일치만 안내. 클론은 수동 UI를 필수로 판단 |
| Q6 | 크로스 프로젝트 relation의 소급 해소 | **[확인필요]** 나중에 상대 프로젝트를 추가하면 기존 관계가 채워지는지 미기재 |
| Q7 | sync가 만든 변경이 실시간 채널(F-05-02 / F-12-04)을 타는가 | **[추정]** 공식 트러블슈팅이 "새로고침하라"고 안내하는 것으로 보아 타지 않는 경로 존재. 클론은 타게 하는 편이 낫다 |
| Q8 | 같은 Jira 사이트를 여러 노션 워크스페이스가 연결 가능한가 | **[확인필요]** GitHub은 1:1 명시, Jira는 미기재 |
| Q9 | 재임포트 시 로컬 프로퍼티 보존 여부 | **[추정]** 보존되지 않으면 기능이 성립하지 않으므로 확실시되나 명문 확인 실패 |
| Q10 | 커스텀 필드가 노션 타입에 대응 없을 때의 폴백 | **[추정]** text 폴백으로 가정 |
| Q11 | 외부에서 필드가 삭제되면 노션 프로퍼티가 삭제되는가 | **[추정]** 남기는 것이 안전(뷰·필터 보호). 공식 미기재 |
| Q12 | 노션 3.2(2026-01) 이후 GitHub에도 write-back이 붙었는가 | **[확인필요]** 릴리스 노트는 Jira만 명시 |

### 정본 결정(arbitration)에 넘기는 요구사항

위 "이 도메인이 기존 엔티티에 요구하는 것" 표(R1~R14)가 이 문서의 실질 산출물이다. 특히 비평이 지목한 모순 중 세 건에 대해 이 도메인이 추가하는 근거:

- **C-1(삭제 상태 5종) → 다단계 상태 머신 지지 + `restorable` 축 추가 요구.** boolean `alive`(01/05/12)로는 "휴지통에 있으나 복원 불가"를 표현할 수 없다. 02의 3상태나 11의 4값 enum으로도 부족하며 `trash_reason` 축이 필요하다.
- **C-2(행 저장 방식) → EAV(03) 지지.** ① 프로퍼티 단위 `writable` 게이트를 쓰기 경로에서 강제하려면 셀이 1급 행이어야 한다 ② `relation_edge` 별도 테이블이 F-15-12의 지연 해소·부분 삭제에 필수다. 04의 `row_page.properties jsonb`로는 두 요구를 모두 애플리케이션 검증으로 밀어내야 한다.
- **C-4(property id 타입) → 짧은 문자열 id(04) 약하게 지지.** `external_field_map`이 외부 필드 키와 property id를 나란히 저장하므로 사람이 읽고 디버깅할 수 있는 id가 유리하다. 다만 uuid여도 기능은 성립하므로 약한 근거다.

---

## 출처

1. https://www.notion.com/help/synced-databases — 지원 4개 앱(Jira/GitHub/GitLab/Asana), Business·Enterprise 게이팅, 단방향 지속 동기화, 로컬 프로퍼티 이름 충돌 규칙, 소스 삭제 시 휴지통 표시·복원 불가, identity mapping 언급, `Paste as database` 생성 플로우
2. https://www.notion.com/help/jira — Jira vs Jira Sync 2세대 커넥션, 관리자 API 토큰(scopeless 권장), 미지원 필드 7종, Enterprise 양방향 5필드(Status/Assignee/Priority/Attachments/Comments), webhook push + 조회 트리거 resync(하루 최대 1회), 새 필드·Watcher 12시간 지연, 1,000+ 값 프로퍼티 제외, 첨부 5개·1MB, 게스트·공개링크 write-back 불가, 수동 sync 불가, `Sync failed`/`Sync stopped` 배지 정의, 초기 sync 수 분~수 시간
3. https://www.notion.com/help/github — GitHub 필드 매핑 전수(Title/Assignees/Description/State/number/Creator/타임스탬프/Reviewers), labels·tags 미지원, GitHub org 1개 = 노션 워크스페이스 1개, magic words(fixes/closes)·자동 status 갱신·백링크 토글, identity mapping 조건(이메일 공개 + 노션 이메일 등록), 페이지를 떠나도 백필 계속
4. https://www.notion.com/help/common-jira-sync-issues — 프로젝트 키 rename 시 제거 후 재임포트, 사이트 URL 변경 시 sync 파손, 크로스 프로젝트 관계는 양쪽 모두 선택 시에만 임포트, 날짜 하루 오차(Jira 타임존 누락), status 근사 매칭, 필요한 권한 레벨(Full access / Can edit), select 값 누락 시 필드 재임포트
5. https://www.notion.com/help/guides/synced-databases-bridge-different-tools — 읽기 전용 근거 문장("변경은 원본 도구에서"), 로컬 relation/rollup/뷰/필터 추가, 자동 relation(제목·설명의 노션 링크 기반), Jira 이슈 타입·스프린트·parent 매핑
6. https://www.notion.com/help/enterprise-connection-settings — 설치 제한 3모드, 승인 목록(먼저 설치해야 승인 가능), 노션 제작 커넥터 자동 승인, 커넥터별 설치자 목록·필터, 개별/일괄 해제, Enterprise 전용
7. https://www.notion.com/releases/2026-01-20 — Notion 3.2 Jira 통합 개선, Enterprise write-back("핵심 Jira 필드를 노션에서 직접 편집하고 자동 반영") 공식 발표
8. https://www.notion.com/connections/jira , https://www.notion.com/connections/github — 커넥션 제품 페이지(synced database와 link preview의 구분, 설정 주체·소스 메뉴 커스터마이즈)
9. https://www.notion.com/blog/synced-databases — 2022-03 기능 예고(GitHub·Jira로 시작), "링크 하나 붙여넣기로 대량 데이터 파이프"라는 설계 의도
10. https://www.notion.com/releases/2022-06-29 — Notion 2.17에서 Synced Databases 최초 출시
11. https://www.notion.com/help/duplicate-delete-and-restore-content — 휴지통 30일 규칙(F-15-08의 GC 상위 규칙)
12. https://www.notion.com/help/use-pages-offline — 비텍스트 편집의 LWW 성격(F-15-14 정합성 근거, F-12-04와 공유)
13. https://truto.one/blog/designing-reliable-webhooks-lessons-from-production/ , https://en.wikipedia.org/wiki/Watermark_(data_synchronization) — webhook + 주기 잡 하이브리드, 워터마크 기반 증분 동기화, list-and-diff 폴백 (2차 출처, 일반 설계 패턴)
