# 00. 정본 데이터 모델 (Canonical Data Model)

> **작성일** 2026-09-07 · **입력** `_canon/block-tree.md` · `_canon/database.md` · `_canon/permission.md` · `_canon/sync-version.md` (판결문 4건, 총 188KB) + 신규 도메인 요구사항 `14-auth-accounts.md` · `15-external-sync.md` · `16-item-layout.md` · `17-ops-governance.md`

---

## 1. 이 문서의 지위

| 항목 | 내용 |
|---|---|
| **효력** | 이 저장소에서 **스키마에 관한 유일한 정답지**다. 도메인 문서 01~17의 의사 스키마가 이 문서와 충돌하면 **이 문서가 이긴다.** 예외 없다. |
| **역할 분담** | 도메인 문서(01~17) = **기능 명세**(사용자 시나리오·엣지케이스·난이도·우선순위). 이 문서 = **스키마 정본**(테이블·컬럼·불변식·인덱스). 도메인 문서는 이 문서를 참조만 하고 재선언하지 않는다. |
| **판결 근거** | 각 테이블·컬럼의 결정 근거는 `_canon/*.md` 의 판결 ID(C-N / V-N / U-N)로 각주한다. 근거를 다시 읽으려면 판결문을 보라. **이 문서는 근거를 요약하지 재판하지 않는다.** |
| **예외 — 이 문서가 새로 판결하는 것** | 판결문 4건은 **서로를 모르는 상태로** 동시에 쓰였다. 클러스터 경계에서 발생한 모순은 §5에서 `X-N` 판결로 최종 확정하며, **이 부분만이 기존 판결을 뒤집을 수 있다.** |
| **태그 규약** | `[판결]` 판결문이 확정 · `[X-N]` 이 문서가 클러스터 간 모순을 해소하며 확정 · `[요구]` 신규 도메인(14~17)이 요구해 흡수 · `[추정]` 근거 없이 클론이 선택 · `[확인필요]` 실측 미완 |

### 1.1 이 문서가 뒤집은 것 (전부 §5에 근거)

| 뒤집힌 원판결 | 판결문 | 이 문서의 최종 결정 | 판결 |
|---|---|---|---|
| `search_document.principals uuid[]` 채택 | sync U-6 | **폐기.** `perm_scope_id` 단일 축 | X-8 |
| `search_document.version = doc_update.seq` | sync U-6 / C-11 | **`= block.version`** (셀 편집이 CRDT 밖이므로 seq는 불완전) | X-6 |
| 모든 블록에 `lifecycle` 3값 적용 | block-tree C-1 | **`type='page'` 블록에만 유효**. 나머지는 항상 `'live'` + CRDT 삭제 | X-3 |
| `block.order_key` 가 형제 순서의 **유일한 정본** | block-tree C-10 | `parent_type='block'` 인 경우 **Y.Doc 이 정본, order_key 는 파생** | X-1 |
| `block.path text` (materialized path) 요구 | permission C-8부속 | **폐기.** `ancestor_path uuid[]` 로 단일화 | X-7 |
| `database.is_locked boolean` | database C-5 절 DDL | **폐기.** `node_lock` 테이블 (permission 판결 우선) | X-9 |
| `subscription` = 결제 구독(13) | 13 F-13-18 | **`subscription` 은 페이지 팔로우**(sync C-13). 결제는 `billing_subscription` 으로 개명 | X-10 |

---

## 2. 엔티티 전체 목록

> 소유 클러스터: **BT**=block-tree · **DB**=database-storage · **PM**=permission · **SV**=sync-version · **AU**=auth(14) · **XS**=external-sync(15) · **IL**=item-layout(16) · **OG**=ops-governance(17) · **MISC**=단일 도메인 소유(정본 결정 대상 아님)

| 엔티티 | 소유 | 한 줄 설명 | 주 사용 도메인 문서 |
|---|---|---|---|
| `workspace` | PM/OG | 과금·보존정책·리전의 파티션 키. 모든 데이터의 최상위 격리 단위 | 02, 06, 13, 17 |
| `organization` | OG | 워크스페이스 N개를 묶는 Enterprise 계층. 도메인 검증·설정 잠금의 주체 | 06, 14, 17 |
| `teamspace` | PM | 워크스페이스 하위 공간. **block 의 parent 가 될 수 있는 트리 노드** | 02, 06 |
| `teamspace_member` | PM | teamspace 멤버십(user 또는 group) | 06 |
| `user` | AU | 사람·봇·에이전트의 단일 아이덴티티. 삭제되지 않고 tombstone 으로 남는다 | 06, 09, 14 |
| `user_email` | AU | 계정당 최대 5개. **시스템 전역 유니크**. 로그인·공유수신·멘션의 키 | 14 |
| `credential` | AU | password / passkey / oauth 자격증명 | 14 |
| `mfa_method`·`mfa_backup_code`·`otp_challenge` | AU | 2FA 수단과 1회용 코드 | 14 |
| `user_session` | AU | 서버측 폐기 가능 세션. `auth_method`·`mfa_satisfied` 를 권한 게이트에 공급 | 14, 06 |
| `session_policy` | AU | 워크스페이스별 세션 수명 정책(Enterprise) | 14 |
| `auth_event` | AU | 세션 없는 상태의 인증 시도까지 담는 저수준 로그 | 14, 17 |
| `workspace_invite` | AU | 이메일형/링크형 초대와 수락 감사 | 14, 06 |
| `workspace_member` | PM | 역할 5값 × 상태 4값 × 임시성. **좌석 산식의 유일한 원천** | 02, 06, 13, 14 |
| `group` / `group_member` | PM | 대량 권한 부여 단위. SCIM 동기화 대상 | 06, 14 |
| `sso_config` / `scim_token` | AU | SAML·SCIM 설정 (06에서 이관) | 06, 14 |
| `block` | BT | **모든 콘텐츠의 단일 테이블.** 페이지도 DB 행도 block 이다 | 01, 02, 03, 04, 05, 06, 07, 11, 12 |
| `page` | DB | **DB 행 전용 1:1 확장 테이블**(block 확장). 일반 페이지는 행이 없다 | 03, 04, 15 |
| `database` | DB | data_source N개를 담는 컨테이너 블록의 확장 | 03, 04, 16 |
| `data_source` | DB | **스키마와 행 집합의 소유자.** property·page 의 FK 대상 | 03, 04, 15, 16 |
| `database_data_source` | DB | 부착(attachment) 조인. linked database 를 표현 | 04 |
| `property` | DB | 프로퍼티 정의. **id 는 전역 유니크 text(nanoid 21)** | 03, 04, 09, 15, 16 |
| `select_option` | DB | select/multi-select/status 옵션 | 03 |
| `status_group` | DB | status 의 세 범주(To-do · In progress · Complete). `select_option.group_id` 가 가리킨다 `[보강]` | 03 |
| `page_property_value` | DB | **셀 값 EAV 정본** + 타입별 사이드카 컬럼 | 03, 04, 09 |
| `relation_edge` | DB | relation 셀의 유일한 정본. 역방향 조회를 가능하게 하는 축 | 03, 04, 15 |
| `property_dependency` / `derived_value` | DB | formula·rollup 의존 그래프와 값 캐시 | 03 |
| `view` | DB(views) | 뷰 본체. `owner_kind` 로 DB뷰/레이아웃탭/대시보드위젯 구분 | 04, 16 |
| `view_property` | DB | 뷰별 컬럼 설정 (행 단위 테이블) | 03, 04 |
| `row_position` | DB | 뷰별·그룹별 수동 행 순서 | 04 |
| `view_user_override` | DB | 개인 필터/정렬 | 04 |
| `page_layout` / `layout_tab` / `layout_module` | IL | 행 페이지 화면 정의. data_source 당 최대 1벌 — 없으면 기본(lazy · §3.6 [보강] 8f-2) | 16, 03 |
| `page_layout_history` | IL | **[추가 3e-1]** 레이아웃의 직전 버전 한 단계 — 되돌리기(§3.6 [보강] 레이아웃의 직전 버전) | 16 |
| `acl_entry` | PM | **권한의 유일한 저장 지점.** deny 계층 없음 | 02, 04, 06, 07 |
| `block_acl_meta` | PM | 상속 차단 플래그와 머티리얼라이즈 시각 | 06 |
| `level_capability` | PM | (대상종류, 레벨) → capability 매핑. 정수 서열 비교 금지 | 06 |
| `public_link` / `page_access_rule` / `access_request` | PM | 노드 로컬 grant 3종과 접근 요청 | 06, 13 |
| `node_lock` | PM | 페이지·DB 잠금. 행 존재 여부로 표현 | 04, 06, 16 |
| `security_policy` / `org_security_policy` | PM | `effective()` 의 0단계 deny 게이트 | 06, 17 |
| `doc_update` | SV | **append-only Yjs update 로그.** 페이지 본문의 정본 | 05, 07, 11, 12 |
| `doc_snapshot` | SV | 머지된 CRDT state + state_vector (페이지당 1행) | 05, 11 |
| `page_version` | SV | 사용자 노출 버전. blob 은 `state_ref` 로 분리 | 02, 05, 11 |
| `device_offline_manifest` | SV | 오프라인 사본 권한 회수 축 | 12 |
| `activity_event` | SV | 알림·피드·웹훅의 단일 이벤트 소스 | 05, 09, 11 |
| `subscription` | SV | **페이지 팔로우**(결제 구독 아님) | 05, 11 |
| `notification` / `notification_delivery` | SV | 인박스 항목과 채널별 배달 상태 | 05, 11 |
| `user_notification_pref` / `reminder` | SV | 채널 설정과 리마인더 | 05, 11 |
| `suggestion` | SV | 제안 편집 **메타데이터 인덱스**(본문 진실은 Y.Doc mark) | 05, 11 |
| `search_document` | SV | 검색 인덱스 정본. 색인 단위 = block | 07, 09, 12 |
| `recent_visit` / `favorite` | MISC(07) | **[추가]** 사용자별 내비게이션 상태(최근 방문 · 즐겨찾기). 권한이 아니라 표시용 | 07 |
| `discussion` / `comment` / `reaction` | MISC(05) | 코멘트 스레드. **CRDT 밖 관계형 테이블** | 05, 11 |
| `automation` / `automation_trigger` / `automation_action` / `automation_run` | MISC(08) | 버튼·DB 자동화 정의와 실행 로그 | 08, 15 |
| `file` | MISC(01/09) | blob 참조와 refcount | 01, 09, 11 |
| `scheduled_job` | MISC | **[추가 4a-1]** 공용 스케줄러 — "시각이 되면 실행"의 단일 행 큐(GC · 리마인더 · 만료 · 반복) · `FOR UPDATE SKIP LOCKED`(§3.10 [보강] 공용 스케줄러) | 마스터 §6 · 11 |
| `plan` / `plan_entitlement` / `billing_subscription` | MISC(13) | 플랜 → 기능/한도 매핑. **코드가 아니라 데이터** | 13, 15, 17 |
| `external_sync_source` | XS | 외부 커넥션 + 범위 → data_source 바인딩 (구 `external_binding`) | 15 |
| `external_connection` / `external_field_map` / `external_row_link` / `sync_run` / `sync_issue` / `user_external_identity` / `external_write_back` | XS | 외부 동기화 부속 | 15 |
| `region` / `analytics_rollup` / `moderation_case` / `setting_definition` / `setting_value` / `setting_lock` / `admin_role*` | OG | 리전·분석·모더레이션·설정 IA. `setting_definition` 은 표가 아니라 코드 상수 · `setting_value` 는 전용 칸이 없는 첫 설정과 함께(§3.1 [보강] 설정 정보구조 · 8g-1) | 17 |

---

## 3. 정본 스키마

> **읽는 법**: 각 테이블 헤더의 `⟨판결ID⟩` 가 그 테이블의 결정 근거다. 컬럼 주석의 `[X-N]` 은 이 문서가 §5에서 새로 판결한 것이다.
> **명명 규약**: ① 블록 형제 순서 컬럼은 `order_key`(BT 소유), 그 외 모든 순서 컬럼은 `order_idx`(DB/IL 소유) — 두 이름은 **의도적으로 다르다**(C-10). ② 순서 값은 전부 fractional index `text`. ③ soft delete 는 `*_at timestamptz NULL`, 상태 머신은 명시적 ENUM + CHECK.

### 3.0 공통 타입

```sql
CREATE TYPE block_lifecycle    AS ENUM ('live','trashed','purged');                      -- <C-1/V-4>
CREATE TYPE block_parent_type  AS ENUM ('workspace','teamspace','block','data_source');  -- <C-9/V-9>
CREATE TYPE origin_kind        AS ENUM ('native','external');                            -- <15 R1/R2/R3>
CREATE TYPE moderation_state   AS ENUM ('none','reported','restricted','taken_down','reinstated'); -- <17 1.4>
CREATE TYPE user_type          AS ENUM ('person','bot','agent');                         -- <PM 규칙 A3>
CREATE TYPE user_status        AS ENUM ('active','suspended','deleted');                 -- <14 R-3>
```

---

### 3.1 워크스페이스 · 조직 · 리전 ⟨02 / C-14 / 17 §2.1⟩

```sql
CREATE TABLE region (                                   -- <17 F-17-05> 중앙 1개 테이블
  id            text PRIMARY KEY,                       -- 'us','eu', ...
  display_name  text NOT NULL,
  endpoints     jsonb NOT NULL                          -- {db, search, vector, blob, kafka} 리소스 매핑
);
-- 불변식 RG1: 모든 파생 저장소 접근은 region_of(workspace_id) 헬퍼를 거친다. 엔드포인트 상수 하드코딩 금지.

CREATE TABLE organization (                             -- <17: 정본 엔티티로 승격>
  id                          uuid PRIMARY KEY,
  name                        text NOT NULL,
  verified_domains            text[] NOT NULL DEFAULT '{}',  -- DNS 검증됨. managed user/SAML/claim 의 전제 <14 R-6>
  default_new_workspace_region text REFERENCES region(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE workspace (
  id                     uuid PRIMARY KEY,
  name                   text NOT NULL,
  icon                   jsonb,
  organization_id        uuid NULL REFERENCES organization(id),   -- <17> NULL = 개인/무료
  region_id              text NOT NULL REFERENCES region(id),     -- <17 F-17-05> 소급 불가 축
  migration_state        text NOT NULL DEFAULT 'stable'
                         CHECK (migration_state IN ('stable','migrating_out','migrating_in')),
  plan_code              text NOT NULL DEFAULT 'free',            -- 파생 캐시. 정본은 billing_subscription
  allowed_email_domains  text[] NOT NULL DEFAULT '{}',            -- 자기신고. 자동가입 트리거 <14 R-6>
  analytics_enabled      boolean NOT NULL DEFAULT true,           -- <17 F-17-03>
  trash_days             int NOT NULL DEFAULT 30 CHECK (trash_days BETWEEN 1 AND 3650), -- <C-1 상수>
  version_history_days   int NULL,                                -- NULL = 무제한 <C-12>
  acl_epoch              bigint NOT NULL DEFAULT 0,               -- <U-3> 권한 캐시 세대. Redis 미러
  created_at timestamptz NOT NULL,
  deleted_at timestamptz NULL
);
CREATE INDEX ON workspace (organization_id) WHERE organization_id IS NOT NULL;
-- 불변식 W1: region_id 는 region_migration_job 을 거치지 않고 변경할 수 없다. <17 F-17-07>
-- 불변식 W2: allowed_email_domains(자기신고) 와 organization.verified_domains(DNS검증) 는
--            절대 합치지 않는다. 전자는 자동가입, 후자는 계정 소유권. <14 R-6>
-- 불변식 W3: 단독 owner 의 계정 삭제는 워크스페이스 삭제를 연쇄시킨다. <14 R-15>
```

**[보강] 설정 정보구조 — 정의는 코드 · 값은 제자리** ⟨잔여 묶음 8g-1 / 마이그레이션 없음⟩

> 17 F-17-12 는 설정 항목을 **데이터로 선언**하고 화면 · 권한 · 감사를 그 선언에서 만들라고 했다(*"설정이 5개 시스템으로 흩어진 뒤 통합은
> 4곳 동시 리팩터"*). 같은 절의 클론 대안: *"`setting_definition` 은 DB 테이블 대신 타입 안전한 TS 상수 객체 1개로 시작해도 좋다 … 중요한
> 것은 테이블이냐 상수냐가 아니라 선언이 한 곳에 모여 있고 화면이 거기서 생성된다는 것이다."*
>
> ① **`setting_definition` 은 표가 아니라 코드의 상수 하나다**(`src/lib/settings/registry.ts`). 정의가 바뀌는 것은 배포이고 런타임에
> 바뀌지 않는다. 표로 두면 코드(컨트롤 · 검사)와 표가 둘 다 진실이 된다 — `level_capability` 는 판정 SQL 이 읽으므로 표가 필요했지만 설정
> 정의는 SQL 이 읽지 않는다. §2 목록의 `setting_definition` 은 이 상수를 가리킨다.
> ② **값은 그 설정이 이미 사는 칸에 그대로 둔다** — 워크스페이스 이름은 `workspace.name`, 내 이름은 `"user".name`, 정책은 `security_policy`
> 의 칸. 레지스트리가 키마다 읽고 쓰는 자리를 가리킨다(`src/lib/settings/settings.ts` — 키마다 하나). 화면 · 권한 · 값 검사가 한 선언에서
> 나온다는 F-17-12 의 요점은 이것으로 선다. **`setting_value` 표는 전용 칸이 없는 첫 설정**(account · workspace 범위)이 생길 때 만든다 —
> 지금 그런 설정이 없다. 12 의 `user_setting` 은 만들지 않는다(F-17-12 *"이 테이블의 부분집합이 되어야 한다"*).
> ③ **범위는 넷**(`device` · `account` · `workspace` · `organization`)이고 지금 쓰는 것은 account · workspace 둘이다. `device`(고대비 — 12)는
> 서버에 저장하지 않는다. [정정 8h] 처음에 "`device`(테마 · 고대비)"로 적었으나 **테마는 account 다** — 12 F-12-03 *"다크모드 선택은 계정에
> 로그인된 모든 워크스페이스에 동일 적용"* · device 는 고대비뿐이다(*"This setting is saved per device"*). `organization` 과 그 잠금
> (`setting_lock` · F-17-13)은 조직 기능이 생길 때 — 그때 정의에 `lockable` 이 붙는다.
> ④ **누가 보고 누가 고치는가는 정의의 칸이다** — 워크스페이스 **역할 이름**으로 묻는다(권한 레벨이 아니다 — 설정은 노드가 아니다).
> 보이지 않는 설정은 화면에 없고 쓰기는 `forbidden`, 보이지만 고칠 수 없으면 읽기 전용으로 선다. 계정 범위는 누구나(게스트 포함 — 자기
> 계정이다), 워크스페이스 범위는 게스트에게 보이지 않는다.
> ⑤ **"내 이름"은 `"user".name` 을 고친다** — 화면 전체(멤버 · 코멘트 · 멘션 · 공유 목록 · 기록)가 그것을 그때그때 읽는다(이름을 복사해 둔
> 칸이 없다). `preferred_name`(14 R-4)은 관리형 계정(F-14-12)이 들어올 때 쓴다 — 조직이 `name` 을 채우면 사용자가 고치는 이름이 그것이고,
> R-4 의 다툼은 관리형 계정에서만 생긴다. 이름의 규칙은 워크스페이스 이름과 같다(앞뒤 공백 · 연속 공백 접기 · 1~100자).
> ⑥ **플랜 게이트**(F-13-18 `plan_entitlement`)와 **감사 이벤트**(F-11-12 `audit_event`)는 그 표가 생길 때 정의의 칸(`requiredPlan` ·
> `auditEvent`)으로 더한다 — 지금 걸 곳이 없는 칸을 미리 두지 않는다. 설정은 CRDT 대상이 아니다(마지막 쓰기가 이긴다).
> ⑦ **[보강 4b-3] 요금제 게이트 칸은 엔타이틀먼트 키다** — ⑥ 의 `requiredPlan` 을 요금제 이름이 아니라 **boolean 엔타이틀먼트 키**
> (`requires`)로 단다(PE1 — `if (plan === 'business')` 를 코드에 두지 않는다 · 요금제 표가 바뀌어도 정의가 거짓이 되지 않는다). 그 키가
> 거짓인 워크스페이스에서 항목은 **보이되 읽기 전용**이고 "요금제 필요"가 붙는다(보는 사람은 ④ 그대로 — 무엇을 얻을 수 있는지 보여야
> 올릴 까닭이 선다). 쓰기는 `plan_required`(403 · [보강] 요금제 게이트 ⑤). 요금제를 내려도 값은 그대로다(같은 절 ④ — 새로 바꾸는 것만
> 막는다).
> ⑧ **[보강 4b-3] 숫자 컨트롤** — 정수 · 범위(`min` ~ `max`) · 단위. 범위 밖 · 정수가 아닌 값은 `invalid_value`. 첫 항목은
> `workspace.trash_days`(§3.10 [보강] 휴지통 보관 기간).

**[보강] 설정 값 표 · 테마** ⟨잔여 묶음 8h / 마이그레이션 0045⟩

```sql
CREATE TABLE setting_value (                 -- 전용 칸이 없는 설정의 값(위 [보강] ②). 17 의 (scope, scope_id, key) 를 FK 둘로 [보강 8h]
  scope        text NOT NULL CHECK (scope IN ('account','workspace')),
  user_id      uuid NULL REFERENCES "user"(id),                         -- account 의 주인(U1 — 사용자는 지우지 않는다)
  workspace_id uuid NULL REFERENCES workspace(id) ON DELETE CASCADE,    -- workspace 의 주인
  key          text NOT NULL,
  value        jsonb NOT NULL,
  updated_by   uuid NULL REFERENCES "user"(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'account')   = (user_id IS NOT NULL)),
  CHECK ((scope = 'workspace') = (workspace_id IS NOT NULL)),
  CHECK (split_part(key, '.', 1) = scope),                              -- 키는 범위로 시작한다(account.theme)
  CHECK (jsonb_typeof(value) IN ('string','boolean','number'))          -- 값은 스칼라 — 모양은 레지스트리가 본다
);
CREATE UNIQUE INDEX ux_setting_value_account   ON setting_value (user_id, key)      WHERE scope = 'account';
CREATE UNIQUE INDEX ux_setting_value_workspace ON setting_value (workspace_id, key) WHERE scope = 'workspace';
```

> ① **모양** — 17 은 `(scope, scope_id, key)` 를 적었다. `scope_id` 하나로는 FK 를 걸 수 없어 지워진 워크스페이스의 값이 남고 없는 사람의
> 값이 들어온다. 그래서 주인을 **FK 둘 중 정확히 하나**로 가리킨다(범위와 맞물리는 CHECK 둘). 키는 범위로 시작해야 하고(다른 범위의 키를
> 잘못 넣는 실수를 표가 막는다), 값은 스칼라다. 행은 주인 · 키마다 하나(부분 UNIQUE).
> ② **행이 없으면 기본값이다** — 기본값은 키의 자리(`settings.ts`)가 쥔다. NULL 을 "꺼짐"으로 읽지 않는다(17 F-17-12 *"기본값이 true 인 설정이
> 많다"*). 기본으로 되돌려도 행을 지우지 않는다(사용자가 고른 값이다 — 기본값이 바뀌어도 그대로 남아야 한다).
> ③ **테마는 셋** — `system`(OS 의 `prefers-color-scheme` 을 따른다 · 기본) · `light` · `dark`. **첫 페인트 전에 정한다**: 루트 레이아웃이 세션의
> 사람의 테마를 읽어 `<html data-theme>` 에 싣는다(요청마다 한 줄 · 로그인 전은 `system`). 쿠키 · localStorage 에 복제하지 않는다 — 정본이
> 둘이 되고 다른 기기에서 고친 값이 늦게 온다. `system` 의 판정은 CSS 가 한다(미디어 쿼리 · 서버는 OS 를 모른다).
> ④ 어디서든 `cmd/ctrl + shift + L` 이 밝게 ↔ 어둡게를 바꾼다(지금 보이는 것의 반대 — `system` 이면 OS 가 고른 것의 반대) — 같은 설정을 쓴다.
> ⑤ 고대비(`device` · 베타 · P2)는 이번에 없다 — 기기마다의 값이라 서버에 두지 않는다(그때 클라이언트의 자리를 연다).
> ⑥ **[10d-2] 이 기기의 고대비 · 움직임 줄이기**(12 F-12-13 *"contrast(system | standard | high) · reduce_motion — device scope"*) —
> **쿠키가 정본**(`nc_contrast` · `nc_motion` — 이 브라우저의 값 · 다른 기기로 번지지 않는다 · 400일). 계정의 설정 표가 아니고 테마처럼
> 복제도 아니다(기기의 값이 사는 곳이 기기다). **브라우저가 쓰고 서버는 읽기만** 한다 — 루트 레이아웃이 첫 HTML 의 `<html data-contrast
> data-motion>` 에 싣는다(첫 페인트 전). 값은 셋씩 — 고대비 `system`(OS `prefers-contrast: more`) · `standard` · `high` / 움직임 `system`(OS
> `prefers-reduced-motion`) · `reduce` · `full`. 모르는 값은 `system`. 고대비는 Tailwind 의 회색 단계(CSS 변수)를 바꿔 끼운다 — 글자의 회색
> (400 · 500)은 밝은 테마에서 짙게 · 어두운 테마에서 밝게, 테두리(200 · 300)는 밝은 테마에서 짙게(어두운 테마의 700 · 800 은 배경으로도
> 쓰여 건드리지 않는다), 포커스 표시를 굵게. 움직임 줄이기는 전이를 **끄고**(`transition: none` — 길이만 줄이면 `transition-property` 의
> 기본 `all` 때문에 꺼져 있던 전이가 모든 속성에 켜진다) 애니메이션을 한 번에 끝내고 부드러운 스크롤을 바로 옮기기로(스크립트가 굴리는 곳은
> `reducesMotion` — 기기의 값이 OS 를 이긴다). 설정 → 내 계정 → 환경설정의 "접근성" 패널
> ⑦ **[10d-4] 글자 크기** — 같은 자리(쿠키 `nc_font_scale` · 루트 레이아웃이 `<html data-font-scale>`). 12 *"font_scale — 브라우저 확대와
> 별개인 앱 내 텍스트 배율"*. 다섯 — 90 · 100(기본) · 110 · 125 · 150(%). 루트의 글자 크기를 그 비율로 두면(`font-size: N%`) rem 으로 잰
> 글자 · 간격이 함께 커진다(Tailwind · 편집기 CSS 가 rem 이다). 모르는 값은 100. "접근성" 패널의 셋째 고르개
> ⑧ **[10d-5] 블록 색의 고대비 팔레트** — 12 *"고대비 + 사용자 지정 블록 색 조합에서 WCAG 대비 미달이 발생할 수 있어, 고대비 모드에서는
> 블록 색 팔레트를 별도 세트로 치환"*. 블록 글자색 9개를 CSS 변수(`--block-text-<색>`)로 두고 고대비가 그 값을 바꿔 끼운다 — 인라인 색 ·
> 블록 색 · 메뉴의 견본 · 공개 페이지가 같은 `[data-color]` 규칙이라 한 자리에서 바뀐다. **기준 둘** — 화면 바탕(밝게 `#ffffff` · 어둡게
> `#0a0a0a`)과 **7:1 이상**(WCAG AAA) · 같은 테마의 배경 9색 위에서도 **4.5:1 이상**(AA — 배경색 블록 안의 색 글자). 밝은 테마는 같은
> 색상을 짙게, 어두운 테마는 밝게. **표준 팔레트(노션의 값)는 그대로** — 노랑 2.8:1 · 주황 3.4:1 처럼 AA 에도 못 미치는 것이 있고 그것이
> 고대비를 켜는 까닭이다. **배경 9색은 바꾸지 않는다** — 기본 글자와 이미 7:1 이상이다(밝게 15.5 · 어둡게 7.8 이 가장 낮다). 이 수치는
> 단위 테스트가 CSS 파일을 읽어 강제한다(값을 고친 사람이 기준을 깨면 막는다). **편집기 CSS 는 `globals.css` 만 싣는다** — 공개 화면
> (`/p` · `/s`)의 틀이 그것을 한 번 더 import 하고 있었는데, 따로 컴파일되면 우리 변형을 모른다(`contrast-high` 는 빌드가 깨지고 · `dark` 는
> Tailwind 의 기본 — OS 의 미디어 쿼리 — 로 풀려 테마를 "밝게" 고른 사람에게도 OS 가 어두우면 어두운 칠이 섰다). 루트 레이아웃이 이미 싣는다
> ⑨ **[10d-6] 어두운 테마의 블록 글자색** — 01 F-01-21 *"같은 color 토큰이 라이트/다크에서 다른 실제 색으로 렌더되어야 한다"*. 8h 는 배경
> 9색만 어두운 값으로 바꿨고 글자색은 밝은 테마의 값 그대로였다(어두운 바탕과 4.3~4.5:1 인 색이 여럿). 어두운 테마에서 `--block-text-<색>` 을
> 노션의 어두운 값으로 바꿔 끼운다(배경 9색과 같은 출처) — **어두운 바탕과 4.5:1 이상**(AA · 단위 테스트가 강제한다). 밝은 테마의 표준은 그대로
> (노션의 값 — 노랑 · 주황은 AA 에 못 미친다 · 고대비가 그 일을 한다). 테마 × 고대비 네 조합이 모두 제 세트를 갖는다

**[보강] 문서의 언어 · 화면 제목** ⟨플랫폼 잔여 10d-7a · F-12-13⟩

> 화면 읽기 프로그램은 문서의 언어로 발음을 고르고(WCAG 3.1.1 "페이지 언어"), 탭 · 창 목록 · 방문 기록은 문서의 제목으로 화면을 가린다
> (WCAG 2.4.2 "페이지 제목"). 둘 다 템플릿의 값(`lang="en"` · "Create Next App")이 남아 있었다.
>
> ① `<html lang="ko">` — 화면의 글이 한국어다. 글 안의 다른 언어는 표시하지 않는다(블록마다의 언어는 없다)
> ② **제목 틀** `%s · notion-clone`(기본 `notion-clone`) — 루트 레이아웃이 틀을 정하고 화면이 `%s` 를 준다(`nav/screen-title.ts`). 고정
> 화면 일곱 — 홈 · 인박스 · 라이브러리 · 설정 · Teamspace 둘러보기 · 로그인 · 초대
> ③ **공개 화면은 틀을 씌우지 않는다**(`absolute`) — 게시 페이지(`/p` · `/s`) · 폼(`/f`) · 신고. 쓴 사람의 글이고 앱 이름을 붙이지 않는다(지금과
> 같다)
> ④ **[10d-7b] 내용의 이름** — 페이지(평문 제목 · 행 페이지도 같다) · 데이터베이스(이름) · 템플릿 편집("템플릿 — 데이터베이스 이름") ·
> teamspace(이름). 공백을 접고 비면 "제목 없음" · 80자에서 자른다(글자 단위). **화면이 이미 읽은 값으로 브라우저에서 쓴다**(`DocumentTitle`) —
> `generateMetadata` 로 하지 않는다: Next 16 은 화면에 보이는 링크마다 그 경로의 메타데이터를 미리 받는다(세그먼트의 미리받기를 꺼도 —
> 문서). 내용의 이름은 권한을 거친 읽기라 링크 수만큼 서버 일(세션 · 페이지)이 늘고, 화면을 떠나면 끊긴 미리받기가 서버 로그에 남았다(재서
> 확인했다). 그래서 **첫 HTML 의 `<title>` 은 기본값**이다(이름을 싣지 않는다 — 볼 수 없는 페이지의 이름이 샐 길도 없다). 피크는 탭을 바꾸지
> 않는다(화면은 데이터베이스다). 이름이 바뀌면(제목 저장 뒤 새로 읽기) 다시 쓴다. 떠날 때 되돌리지 않으므로 **클라이언트 이동으로 닿는 화면은
> 저마다 이름이 있어야 한다** — 워크스페이스 고르기(`/` — "워크스페이스") · 접근 요청 화면("접근 요청")
> ⑤ **세션 게이트는 한 요청에 한 번** — 레이아웃과 화면이 같은 세션을 묻는다 — React `cache` 로 요청마다 한 번(`requirePageVisitor` 하나를
> `requirePageSession` 이 나눠 쓴다). `SessionContext` 의 발급자는 그대로 둘이다 — 같은 요청의 결과를 다시 줄 뿐이다

---

### 3.2 계정 · 인증 · 세션 ⟨14 소유, V-8 로 경계 확정⟩

```sql
CREATE TABLE "user" (
  id                uuid PRIMARY KEY,
  type              user_type   NOT NULL DEFAULT 'person',   -- <PM A3 + 14 R-2> agent 포함 3값
  bot_integration_id uuid NULL,                              -- type='bot' 일 때만
  status            user_status NOT NULL DEFAULT 'active',   -- <14 R-3> 하드 삭제 금지
  deleted_at        timestamptz NULL,
  primary_email_id  uuid NULL,                               -- -> user_email(id). 순환 FK: DEFERRABLE
  name              text NOT NULL,
  preferred_name    text NULL,                               -- <14 R-4> name 과 분리
  avatar_url        text,
  is_managed        boolean NOT NULL DEFAULT false,          -- <14 R-4 / F-14-12>
  managed_by_org_id uuid NULL REFERENCES organization(id),
  external_id       text NULL,                               -- IdP 안정 식별자(SCIM)
  analytics_opt_out boolean NOT NULL DEFAULT false,          -- <17 F-17-03> per-account
  support_access_granted_until timestamptz NULL,             -- <17 F-17-12> 기본 28일 만료
  perm_gen          bigint NOT NULL DEFAULT 0,               -- <U-3> 주체축 권한 캐시 세대. Redis 미러
  created_at        timestamptz NOT NULL
);
-- 불변식 U1: user 행은 물리 삭제하지 않는다. created_by/last_edited_by/editor_ids[] 가 dangling 이 된다.
-- 불변식 U2: type='bot'|'agent' 인 user 도 acl_entry(principal_type='user') 로만 권한을 받는다. <PM A3>
-- 불변식 U3: is_managed=true 이면 managed_by_org_id IS NOT NULL.

CREATE TABLE user_email (                                    -- <14 R-1 / R-16>
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES "user"(id),
  email       citext NOT NULL,
  verified_at timestamptz NULL,                              -- NULL = 로그인/자동가입 불가
  is_primary  boolean NOT NULL DEFAULT false,
  added_at    timestamptz NOT NULL,
  UNIQUE (email)                                             -- 워크스페이스가 아니라 시스템 전역
);
CREATE UNIQUE INDEX ux_user_primary_email ON user_email (user_id) WHERE is_primary;
-- 불변식 A1: user 당 is_primary 행 정확히 1개
-- 불변식 A2: is_primary -> verified_at IS NOT NULL
-- 불변식 A3: user 당 행 개수 <= 5 (MAX_EMAILS_PER_ACCOUNT)
-- 불변식 A4: 계정 알림(notification_delivery.channel='email')의 수신 주소는 is_primary 행이다 <14 R-9>

CREATE TABLE credential (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES "user"(id),
  kind text NOT NULL CHECK (kind IN ('password','passkey','oauth')),
  password_hash text NULL,                                   -- argon2id
  cred_id bytea NULL, public_key bytea NULL, sign_count bigint NULL,
  aaguid uuid NULL, transports text[] NULL, backup_eligible boolean NULL,
  provider text NULL, provider_sub text NULL, is_private_relay boolean NULL,
  label text NULL, created_at timestamptz NOT NULL, last_used_at timestamptz NULL,
  UNIQUE (kind, cred_id), UNIQUE (provider, provider_sub)
);
-- 불변식 A5: kind='password' 행은 user 당 <=1 (0 이 정상 — 비밀번호 없는 계정) [보강 8i-1a — 부분 UNIQUE 로 승격]
-- 불변식 A6: kind='passkey' 행은 user 당 <=5

CREATE TABLE mfa_method (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES "user"(id),
  kind text NOT NULL CHECK (kind IN ('totp','sms')),
  label text NOT NULL, totp_secret bytea NULL,               -- KMS 봉인
  phone_e164 text NULL, confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL, last_used_at timestamptz NULL
);
CREATE TABLE mfa_backup_code (
  user_id uuid NOT NULL, code_hash text NOT NULL, used_at timestamptz NULL,
  batch_id uuid NOT NULL, PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE otp_challenge (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('login','email_verify','password_reset','mfa_sms')),
  email citext NULL, user_id uuid NULL, code_hash text NOT NULL,
  expires_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz NULL, request_ip inet, request_ua text,
  created_at timestamptz NOT NULL
);
-- 불변식 A7: kind='totp' <=2 AND kind='sms' <=2 (합계 4)

CREATE TABLE user_session (                                  -- <14 B. `session` 에서 개명 — X-11>
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES "user"(id),
  token_hash text NOT NULL UNIQUE,
  auth_method text NOT NULL
    CHECK (auth_method IN ('login_code','password','passkey','google','apple','microsoft','saml')),
  mfa_satisfied boolean NOT NULL DEFAULT false,
  device_id uuid NULL,                                       -- device_offline_manifest 와 연결 <C-11>
  device_label text, device_kind text CHECK (device_kind IN ('web','desktop','mobile')),
  ip inet, approx_location text,
  created_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz NULL, revoked_reason text NULL
);
CREATE INDEX ON user_session (user_id) WHERE revoked_at IS NULL;
-- 불변식 A8: 유효 세션 = revoked_at IS NULL AND expires_at > now()
-- 불변식 A9: effective() 의 입력은 user_id 가 아니라
--            (user_id, workspace_id, auth_method, mfa_satisfied, session_id) 다.
--            SSO 강제는 이 컨텍스트가 없으면 UI 장식이다. <14 R-11>
--            [보강 · 자동화 5b-1] 발급자는 둘이다 — 로그인 세션(resolveSessionContext)과 자동화의 위임(resolveDelegatedContext:
--            DB automation 을 만든 사람으로 · auth_method 'automation' · session_id 자리에 automation id · 세션 표를 가리키지 않는다).
--            위임도 발급 전에 그 사람의 멤버십을 지금 다시 본다(§3.10 [보강] DB automation ①).

CREATE TABLE session_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  max_lifetime interval NOT NULL DEFAULT '90 days',          -- 범위 [모순] -> 6-4
  updated_by uuid, updated_at timestamptz
);

CREATE TABLE workspace_invite (                              -- <14 R-7>
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  kind text NOT NULL CHECK (kind IN ('email','link')),
  email citext NULL, token_hash text UNIQUE, role text NOT NULL,   -- [정정] token -> token_hash. 아래 참조
  created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  expires_at timestamptz NULL, revoked_at timestamptz NULL,
  accepted_by_user_id uuid NULL, accepted_at timestamptz NULL,
  page_id uuid NULL REFERENCES block(id) ON DELETE CASCADE,  -- [보강 7g-1] 게스트의 대기 초대 — 받을 페이지
  page_level text NULL CHECK (page_level IN ('view','comment','edit')),  -- 게스트의 레벨은 편집까지
  CHECK ((kind = 'email') = (email IS NOT NULL)),            -- 암묵 규약을 CHECK 로 승격
  CHECK (role IN ('owner','membership_admin','member','guest')),
  CHECK ((role = 'guest') = (page_id IS NOT NULL AND page_level IS NOT NULL)),
  CHECK (role <> 'guest' OR kind = 'email')
);
-- 대기 중인 게스트 초대는 (page_id, email)마다 하나 — 부분 UNIQUE [보강 7g-1 / 0035 · §3.3 게스트 ⑨]
-- [정정 2026-09-09] token text -> token_hash text.
--   초대 토큰은 세션 토큰과 같은 bearer 자격증명이다. 링크를 가진 사람이 곧
--   워크스페이스 멤버가 된다. 그런데 이 표만 평문으로 저장하고 있었다 —
--   같은 문서의 user_session.token_hash / scim_token.token_hash 와 어긋난다.
--   DB 가 유출되면 대기 중인 초대를 그대로 수락해 남의 워크스페이스에 들어갈 수 있다.
--   원문은 메일에만 두고 DB 에는 해시만 남긴다. 조회는 해시로 한다.
--   반영: db/migrations/0005_invite_token_hash.sql

CREATE TABLE sso_config (                                    -- <V-8: 06 -> 14 이관>
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  idp_metadata_url text, entity_id text, sso_url text, x509_cert text,
  jit_provisioning boolean NOT NULL DEFAULT false,
  enforced boolean NOT NULL DEFAULT false,
  updated_by uuid, updated_at timestamptz
);
CREATE TABLE scim_token (                                    -- <V-8: 06 -> 14 이관>
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  token_hash text NOT NULL UNIQUE, created_by uuid,
  created_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz
);
-- 게이트: can_enter_workspace(session, ws) =
--   NOT sso_config.enforced OR session.auth_method='saml' OR member.role IN ('owner','guest')

CREATE TABLE auth_event (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL,
  email citext NULL, user_id uuid NULL,                      -- 둘 다 NULL 가능(계정 열거 시도)
  kind text NOT NULL, ip inet, user_agent text, meta jsonb
);
-- 불변식 A10: 인증 이벤트는 세션이 없는 상태에서도 기록된다. actor NOT NULL 을 강제하면
--             로그인 실패를 감사에 남길 수 없다. <14 R-10>
```

**[보강] 비밀번호 — 해시 · 정책 · 바꾸는 사람 · 로그인 · 재설정** ⟨잔여 묶음 8i-1a / 마이그레이션 0046⟩

> 14 F-14-03 *"선택적으로 붙일 수 있는 영구 자격증명. 없는 것이 기본 상태"*. 비밀번호는 `credential(kind='password')` 한 줄이고 `"user"` 에
> 칸을 두지 않는다(14 의 데이터 모델 함의 그대로).
>
> ① **해시는 argon2id**(위 DDL 의 주석) — Node 24.7 의 내장 `crypto.argon2` 로 만든다(의존성 없음 · #169). 저장은 PHC 문자열
> `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` — 매개변수가 값 안에 있어 나중에 올려도 옛 해시를 읽는다(OWASP 의 m=19MiB · t=2 · p=1 ·
> 소금 16바이트 · 태그 32바이트). 비교는 상수 시간.
> ② **A5 를 표로 올린다** — 사람마다 비밀번호 0~1줄(부분 UNIQUE) · 비밀번호 줄에만 해시가 있고 해시는 argon2id 모양이다(CHECK 둘).
> ③ **정책**(14 F-14-03 그대로) — 8자 이상 · 서로 다른 글자 4개 이상 · 14자까지는 글자와 숫자가 하나씩 · 15자부터 그 요구가 풀린다. 256자까지
> (해시 비용의 상한). 서버가 판정하고 화면은 같은 함수로 체크리스트를 그린다.
> ④ **바꾸는 사람** — 자기 계정이다(SessionContext 의 주인). 처음 정할 때는 지금 비밀번호가 없다. **바꾸기 · 지우기는 지금 비밀번호**를 묻는다 —
> 단 **10분 안에 로그인 코드로 들어온 세션**은 묻지 않는다(그것이 재설정이다 — 아래 ⑥). 바꾸면 **이 세션을 뺀 모든 세션을 폐기**한다
> (`revoked_reason='password_change'` — 14 의 엣지 케이스 *"미구현 시 탈취 세션이 살아남음"*). 2단계 인증이 켜져 있으면 지우지 못한다(14
> *"2FA 는 비밀번호를 전제로 한다"* — 8i-2 가 켠다).
> ⑤ **로그인** — 이메일 + 비밀번호. 실패는 모두 같은 말이다(없는 이메일 · 비밀번호 없는 계정 · 틀린 비밀번호 — 열거 방지 · 없는 쪽도 가짜 해시를
> 비교해 시간을 맞춘다). 실패는 `auth_event(kind='password_failed', email)` 로 남고, **15분에 10번** 틀린 이메일은 맞아도 막는다
> (`too_many_attempts`). 성공하면 세션의 `auth_method='password'`. SSO 를 요구하는 워크스페이스는 진입 게이트가 따로 막는다(F-14-11).
> ⑥ **재설정은 로그인 코드다** — 노션은 재설정 링크가 로그인시켜 설정 화면으로 보낸다(*"Settings 화면으로 이동해 새 비밀번호 설정"*). 우리의
> 로그인 코드가 같은 일을 한다(이메일 소유를 방금 증명했다) — 그래서 ④ 의 "10분 안의 코드 세션"이 재설정 링크의 자리다. `otp_challenge` 의
> `password_reset` 목적은 쓰지 않는다.

**[보강] 2단계 인증 — TOTP · 봉인 · 백업 코드 · 진입 게이트** ⟨잔여 묶음 8i-2a / 마이그레이션 없음⟩

> 14 F-14-05 *"1차 인증 통과 후 추가 소유 증명을 요구하는 계정 단위 옵트인 보안 계층"* · 클론 대안 *"TOTP(RFC 6238)만 구현하고 SMS 는
> 생략 … 백업 코드는 반드시 함께"*.
>
> ① **수단은 TOTP 뿐이다**(SHA-1 · 30초 · 6자리 · 비밀값 20바이트 — 인증 앱들이 받는 기본값). SMS(`kind='sms'`)는 만들지 않는다(14 의 클론
> 대안 — 게이트웨이 비용 · SIM 스와핑). A7 의 TOTP 둘까지는 애플리케이션이 지킨다(개수는 CHECK 으로 쓸 수 없다). **비밀번호가 있어야 켠다**
> (14 *"Must have a password set"* — [보강] 비밀번호 ④ 의 역방향과 짝).
> ② **`totp_secret` 의 "KMS 봉인"은 애플리케이션 키로 한다** — `AUTH_SECRET` 에서 HKDF-SHA256(`info='notion-clone/mfa-totp/v1'`)으로 유도한
> AES-256-GCM 키 · 저장은 `판(1) ‖ IV(12) ‖ 태그(16) ‖ 암호문`. DB 만 새면 비밀값을 읽을 수 없다(14 *"DB 유출 시 즉시 전 계정 무력화"*).
> KMS 는 운영에서 `AUTH_SECRET` 을 감싼다 — 키를 바꾸는 날은 판 번호로 가른다.
> ③ **등록은 두 걸음이다** — 시작하면 확정되지 않은 줄(`confirmed_at` NULL)과 봉인한 비밀값이 생기고(QR · base32 를 그때 한 번 보인다), 앱의
> 코드로 확정한다. 30분 안에 확정하지 않은 줄은 없는 것으로 본다. **처음으로 확정하는 순간 백업 코드 6개**(노션과 같은 수 — `xxxxx-xxxxx` ·
> SHA-256 으로만 저장 · 한 번 쓰면 `used_at`)가 생기고 그 한 번만 보인다. 그 세션은 소유를 방금 증명했으므로 `mfa_satisfied` 가 된다.
> ④ **진입 게이트** — 확정된 수단이 하나라도 있는 사람의 세션은 `mfa_satisfied` 가 될 때까지 **아무 데도 들어오지 못한다**: 워크스페이스
> 진입(`resolveSessionContext` → `mfa_required`) · 밖의 사람의 신원(`resolveOutsiderContext`) · 지금 사용자(`getCurrentUser`) 셋 모두. 둘째 단계는
> 그 세션으로 코드 하나(TOTP 또는 백업 코드)를 내는 것이다. 켜기 전에 열려 있던 다른 기기의 세션도 둘째 단계를 거쳐야 한다(켠 세션만 통과).
> ⑤ **재사용 막기** — TOTP 는 ±1 창(±30초)을 받되 **이미 쓴 창과 그 앞의 창은 받지 않는다**(수단의 `last_used_at` 이 쓴 창을 가리킨다).
> 둘째 단계의 실패는 `auth_event('mfa_failed')` 로 남고 15분에 10번이면 막는다(그 세션으로는 로그아웃 뒤 다시).
> ⑥ **끄기 · 백업 코드 새로 받기는 지금 코드로** — 그 수단의 TOTP 또는 백업 코드. 마지막 수단을 지우면 백업 코드도 지운다(2단계 인증이 꺼진다
> — 비밀번호를 지울 수 있게 된다). 새로 받으면 옛 묶음은 지운다.
> ⑦ **[보강 10n-52] 수단 이름 바꾸기 · 백업 코드 인쇄** — 이름(`label`)은 비밀이 아니고 보안 상태를 바꾸지 않는다. 그래서 **지금 코드를 묻지
> 않는다**(그 세션은 이미 둘째 단계를 지났다 — ④) · 만들 때와 같은 다듬기(공백을 접고 1~40자 — 아니면 `invalid_label`) · 확정된 자기 수단만
> (남의 것 · 확정 전 · 없는 것은 `not_found`) · `auth_event` · 감사 기록을 남기지 않는다(보안 사건이 아니다 — 켜기 · 끄기 · 수단 더하기 · 빼기 ·
> 백업 코드 새로 받기만 남는다). 백업 코드의 인쇄는 화면의 일이다 — 코드를 보여 주는 그 한 번(③) 안에서 인쇄하고, 인쇄 스타일이 코드 상자만
> 남긴다. 서버는 코드를 다시 주지 않는다.

**[보강] 다중 계정 — 한 브라우저의 세션 묶음** ⟨잔여 묶음 8j-2 / 마이그레이션 없음⟩

> 14 F-14-09 *"하나의 앱 인스턴스가 여러 계정에 동시에 로그인한 상태를 유지 … 클라이언트는 계정별 토큰을 각각 보관한다 … 서버 스키마
> 변경은 거의 없다 — 이 기능은 클라이언트 상태 모델이 본체다"*.
>
> ① **스키마는 그대로다** — 계정마다 `user_session` 행이 하나씩 있을 뿐이다. 브라우저는 쿠키 둘을 든다: **지금 계정의 세션**(`nc_session` — 모든
> 게이트가 읽는 그대로 · A9 의 입력은 여전히 세션 하나)과 **함께 로그인한 다른 계정의 세션들**(`nc_accounts` — 토큰 원문 · httpOnly ·
> sameSite=lax). 계정은 모두 다섯까지 — 넘치면 오래된 쪽을 폐기한다. 같은 사람은 한 번(새로 들어오면 옛 토큰을 폐기).
> ② **더하기는 로그인 요청의 표시(`addAccount`)다** — 앞의 활성 세션이 **다른 사람의 살아 있는** 세션이면 로그아웃하지 않고 목록의 맨
> 앞으로 옮긴다. 같은 사람이면 새 세션이 대신하고 옛 것은 폐기한다. 표시가 없는 로그인은 이 조각 전과 같다(앞의 활성은 쿠키에서 빠질 뿐).
> ③ **바꾸기는 목록의 살아 있는 세션과 맞바꾸는 것이다** — 화면은 사람의 id 로 고르고 서버가 쿠키에서 토큰을 찾는다. 둘째 단계 전의 세션이어도
> 바꾸고 알린다 — 게이트가 둘째 단계로 보낸다(바꾼다고 건너뛰지 않는다 · [보강] 2단계 인증 ④). 죽은 세션(만료 · 폐기)으로는 못 바꾼다.
> ④ **로그아웃은 범위가 셋이다** — 지금 계정만(남은 것 중 살아 있는 첫째가 지금 계정이 된다) · 목록의 한 계정만 · 모두. 14 엣지 *"다중
> 계정 로그인 중 한 계정 전체 로그아웃 — 다른 계정 세션에 영향 없음"*.
> ⑤ **화면에는 토큰을 주지 않는다** — 사람(id · 이름 · 이메일)과 상태만: 들어와 있음 · 2단계 인증이 남음 · **다시 로그인**(죽은 세션 — 목록에
> 남는다 · 14 엣지 *"A만 재로그인 필요 표시. 앱 전체를 로그아웃시키면 안 된다"*). "살아 있다"와 "둘째 단계 전"은 게이트의 조건 그대로다.
> ⑥ 같은 사람이 두 계정으로 같은 워크스페이스에 있으면 별개의 멤버 둘이다(14 엣지 — 별칭 F-14-07 로 합치는 것은 이월). 오프라인 보존본은 이미
> 사람마다 따로다(`pendingEditKey` — 12 F-12-04 의 *"계정×워크스페이스 단위 분리"*).

---

### 3.3 멤버십 · 권한 ⟨C-7 · C-8/V-1 · C-14 · U-3 · V-8⟩

```sql
CREATE TABLE workspace_member (                              -- <C-14>
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  user_id      uuid NOT NULL REFERENCES "user"(id),
  role text NOT NULL
    CHECK (role IN ('owner','membership_admin','member','restricted_member','guest')),
  is_temporary boolean NOT NULL DEFAULT false,               -- 좌석 미소비. 역할과 직교한 수명 축
  expires_at   timestamptz NULL,                             -- is_temporary 일 때 필수. 최대 today+1y
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','suspended','removed')),
  join_method text NULL                                      -- <14 R-5>
    CHECK (join_method IN ('invite_email','invite_link','allowed_domain','saml_jit','scim','guest_upgrade',
                           'access_request')),                -- 접근 요청을 허락받아 게스트로 [보강 7g-2 / 0036]
  invited_by uuid NULL, invited_at timestamptz,
  accepted_at timestamptz NULL,
  removed_at timestamptz NULL,                               -- 30일 복원 창의 기준점
  PRIMARY KEY (workspace_id, user_id),
  CHECK (NOT is_temporary OR expires_at IS NOT NULL),
  CHECK (NOT is_temporary OR role = 'member')                -- temp 는 member-level access
);
CREATE INDEX ON workspace_member (workspace_id, status) WHERE status = 'active';
CREATE INDEX ON workspace_member (workspace_id, expires_at) WHERE is_temporary;

-- 좌석의 유일한 원천. billing_subscription.seats 를 세지 말 것. <C-14부속 / 14 R-14>
CREATE VIEW workspace_seat_count AS
SELECT workspace_id, count(*) AS seats FROM workspace_member
WHERE status='active' AND is_temporary=false AND role <> 'guest' GROUP BY workspace_id;
-- 불변식 M1: 멤버 제거는 물리 삭제가 아니라 status='removed' + removed_at 이다.
--            30일 내 재가입 시 private/공유 페이지 · group · teamspace 멤버십이 복원되어야 한다.
-- 불변식 M2: restricted_member 는 좌석을 소비한다(1차 출처). guest/temporary 는 소비하지 않는다.
-- 불변식 M3: status='invited'(미수락)는 좌석에 세지 않는다.

CREATE TABLE "group" (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  name text NOT NULL, icon text NULL,
  external_id text NULL,                                     -- SCIM IdP 그룹 id. 멱등성 키
  deleted_at timestamptz NULL,
  -- [정정] 전체 UNIQUE → **부분 UNIQUE**. 근거는 이 블록 다음.
  -- UNIQUE (workspace_id, lower(name)),
  UNIQUE (workspace_id, external_id)
);
CREATE UNIQUE INDEX ON "group" (workspace_id, lower(name)) WHERE deleted_at IS NULL;  -- [정정]
CREATE TABLE group_member (
  group_id uuid NOT NULL REFERENCES "group"(id),
  user_id  uuid NOT NULL REFERENCES "user"(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz NULL,                               -- soft delete. 30일 복원용
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX ON group_member (user_id) WHERE removed_at IS NULL;
-- 불변식 G1: 중첩 그룹 금지. group 은 user 만 담는다.
-- 불변식 G2: role='guest' 인 멤버는 group_member 가 될 수 없다(앱 가드 + 야간 정합성 검사).
--            [보강] 넣는 쪽은 트리거로 승격했고, 읽는 쪽 P(U) 가 guest 의 그룹을 무시한다 — 아래 참조.
-- 불변식 G3: role='restricted_member' 는 group_member 가 될 수 있다. 그것이 유일한 대량 부여 수단이다.

CREATE TABLE teamspace (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  name text NOT NULL, icon text NULL,                        -- [보강] 7c-14 · 이모지 한 글자 · CHECK 길이(0032)
  visibility text NOT NULL CHECK (visibility IN ('open','closed','private')),
  is_default boolean NOT NULL DEFAULT false,                 -- visibility 와 직교
  who_can_invite text NOT NULL DEFAULT 'all_members'
                 CHECK (who_can_invite IN ('owners','all_members')),
  default_member_level text NULL,                            -- [확인필요] 6-5
  archived_at timestamptz NULL,
  CHECK (NOT is_default OR archived_at IS NULL)               -- [보강] 7c-11 · 기본 teamspace 는 보관하지 않는다
);
CREATE TABLE teamspace_member (
  teamspace_id uuid NOT NULL REFERENCES teamspace(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group')),
  principal_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','member')),
  removed_at timestamptz NULL,
  PRIMARY KEY (teamspace_id, principal_type, principal_id)
);

CREATE TABLE acl_entry (                                     -- <C-7> 권한의 유일한 저장 지점
  id uuid PRIMARY KEY,
  node_kind text NOT NULL CHECK (node_kind IN ('block','teamspace')),
  node_id   uuid NOT NULL,
  principal_type text NOT NULL
    CHECK (principal_type IN ('user','group','teamspace','workspace_everyone','public')),
  principal_id uuid NULL,
  level text NOT NULL
    CHECK (level IN ('view','comment','edit_content','create','edit','full_access')),
  hidden_from_search boolean NOT NULL DEFAULT false,         -- [확인필요] 6-6
  granted_by uuid NULL, granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_kind, node_id, principal_type, principal_id),
  CHECK ((principal_type IN ('workspace_everyone','public')) = (principal_id IS NULL)),
  CHECK (NOT hidden_from_search OR principal_type = 'workspace_everyone'),
  CHECK (node_kind <> 'teamspace' OR level IN ('full_access','edit','comment','view'))  -- [보강] 7c-12
);
CREATE INDEX ON acl_entry (node_kind, node_id);
CREATE INDEX ON acl_entry (principal_type, principal_id);
-- 규칙 A1: level='none' 행은 존재하지 않는다. 권한 회수 = 행 DELETE. deny 계층이 없다.
-- 규칙 A2: level 은 전순서가 아니다. 비교는 반드시 level_capability 를 거친다
--          (create 는 view 를 포함하지 않는다).
-- 규칙 A3: integration/agent 는 principal_type 값이 아니다. user(type='bot'|'agent') 행으로
--          만들고 principal_type='user' 로 부여한다.
-- 규칙 A4: ACL 대상 축에 data_source 는 없다. 권한은 database 레벨이다(1차 출처).
--          data_source 별로 갈리는 것은 page_access_rule 뿐이다.

CREATE TABLE level_capability (
  target_kind text NOT NULL CHECK (target_kind IN ('page','database','teamspace','form_submitter')),
  level text NOT NULL,
  cap_view boolean NOT NULL, cap_comment boolean NOT NULL, cap_edit_content boolean NOT NULL,
  cap_create_child boolean NOT NULL, cap_edit_structure boolean NOT NULL,
  cap_share boolean NOT NULL, cap_manage_perm boolean NOT NULL,
  PRIMARY KEY (target_kind, level)
);
```

| target_kind | level | view | comment | edit_content | create_child | edit_structure | share | manage_perm |
|---|---|---|---|---|---|---|---|---|
| page/database | full_access | O | O | O | O | O | O | O |
| page/database | edit | O | O | O | O | O | X | X |
| database | edit_content | O | O | O | O | X | X | X |
| database | create | **X** | X | X | O | X | X | X |
| page/database | comment | O | O | X | X | X | X | X |
| page/database | view | O | X | X | X | X | X | X |

```sql
CREATE TABLE block_acl_meta (                                -- <C-8 / V-1>
  node_id uuid PRIMARY KEY,                                  -- -> block(id)
  inherits_from_parent boolean NOT NULL DEFAULT true,
  materialized_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 불변식 P1: inherits_from_parent=FALSE 인 노드는 절단 시점의 상속 집합이 acl_entry 로
--            머티리얼라이즈되어 있다. 깨지면 "1명 제거"가 "전원 상실"이 된다.
-- 불변식 P2: 절단된 노드는 이후 조상 ACL 변경을 받지 않는다.
-- 불변식 P3: 절단은 되돌릴 수 있다(inherits:=TRUE + 부모 유래 행 삭제).
-- 불변식 P4: page_access_rule / public_link / form_submitter 는 노드 로컬 grant 이므로
--            절단의 영향을 받지 않는다.
-- 상속 차단은 사용자 가시 토글이 아니라 Share 패널에서 '상속됨' principal 을
-- Remove 하는 순간의 부수효과다. 쓰기 알고리즘은 3.11 참조.

CREATE TABLE public_link (
  node_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  level text NOT NULL DEFAULT 'view' CHECK (level IN ('view','comment','edit')),
  token text UNIQUE, expires_at timestamptz NULL,
  allow_duplicate boolean NOT NULL DEFAULT true,
  robots_directive text NOT NULL DEFAULT 'noindex'          -- [정정 6a-1] 'index' → 'noindex' (마스터 §9.4)
    CHECK (robots_directive IN ('index','noindex')),          -- <17 F-17-11>
  ai_crawler text NOT NULL DEFAULT 'deny'                    -- [정정 6a-1] 'allow' → 'deny'
    CHECK (ai_crawler IN ('allow','deny')),                   -- <17 F-17-11> 2축 분리
  created_by uuid, created_at timestamptz
);
-- [정정 6a-1] public_link 는 effective() 의 항이 아니다 — 공개 경로가 따로 판정한다. §3.3 끝의 [정정] 웹 게시 참조.

CREATE TABLE page_access_rule (                              -- <C-7: data_source 단위가 정본>
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('person_property','created_by')),
  source_property_id text NULL REFERENCES property(id),      -- uuid 아님. text <C-4> [X-12]
  level text NOT NULL CHECK (level IN ('view','comment','edit','full_access')),
  CHECK ((source_kind='person_property') = (source_property_id IS NOT NULL))
);
-- [보강 6f-2a] 원천마다 하나: UNIQUE (data_source_id, source_kind, COALESCE(source_property_id, '')) · 판정은 그 행의 ACL 행으로 합성한다
--              (§3.3 끝 [보강] 행 단위 접근 규칙)

CREATE TABLE node_lock (                                     -- <C-7 부속. database.is_locked 폐기 X-9>
  node_id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('page','database')),
  scope text NOT NULL DEFAULT 'content_and_layout'
    CHECK (scope IN ('content','content_and_layout')),        -- <16 R8> 레이아웃 포함 [추정]
  locked_by uuid, locked_at timestamptz
);
-- 잠금은 행의 존재로 표현한다. locked BOOL 컬럼을 두지 않는다(해제 = DELETE).
-- kind 는 그 블록의 type 과 같다(트리거) · 블록이 지워지면 잠금도 간다 · 전이는 협업 신호다 [보강 7f-1 / 0034]

CREATE TABLE security_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  allow_publish_sites_and_forms boolean NOT NULL DEFAULT true,
  allow_duplicate_to_other_workspace boolean NOT NULL DEFAULT true,
  allow_export boolean NOT NULL DEFAULT true,
  allow_member_invite_guests boolean NOT NULL DEFAULT true,
  allow_member_request_add_guests boolean NOT NULL DEFAULT true,
  allow_member_request_add_members boolean NOT NULL DEFAULT true,
  allow_nonmember_page_access_request boolean NOT NULL DEFAULT true,
  allow_guest_request_membership boolean NOT NULL DEFAULT true,
  require_mfa_for_guests boolean NOT NULL DEFAULT false,
  who_can_add_restricted_members text NOT NULL DEFAULT 'owners'
);
-- 행이 없으면 모든 칸이 기본값이다(행은 처음 바꿀 때 생긴다) · 바꾸는 사람은 워크스페이스 owner [보강 7g-2 / 0036]
-- 지금 읽는 칸: allow_nonmember_page_access_request(접근 요청 ⑩) · allow_publish_sites_and_forms(웹 게시 6a-1) ·
-- allow_export · allow_member_invite_guests(6e-1 — 아래 [보강] 보안 정책). 나머지는 그 기능이 생길 때 건다
CREATE TABLE org_security_policy (
  org_id uuid REFERENCES organization(id), policy_key text,
  mode text CHECK (mode IN ('workspace_managed','enabled_for_everyone','disabled_for_everyone')),
  PRIMARY KEY (org_id, policy_key)
);

CREATE TABLE access_request (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('page_access','edit_access','join_workspace','add_member','add_guest')),
  node_id uuid NULL, requester_id uuid NULL, requester_email citext NULL,
  requested_level text NULL, message text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','ignored')),
  decided_by uuid NULL, decided_at timestamptz NULL, created_at timestamptz NOT NULL
);
-- 불변식: pending 은 만료되지 않는다(1차 출처는 accept/ignore 2택만 서술).
-- 대기 중인 요청은 (node_id, requester_id, kind)마다 하나 · 페이지 요청은 node_id · requester_id 가 있다 [보강 7e-1 / 0033]
```

**[보강] 보안 정책 — 내보내기 · 멤버의 게스트 초대** ⟨게시 · 공유 6e-1 · F-06-11 / 마이그레이션 없음⟩

> 06 F-06-11 *"정책은 ACL 보다 상위에서 평가된다 — 유일하게 deny 가 존재하는 계층"* · *"게이트 누락 하나가 곧 정책 우회"*. 쓰는 곳이
> 생긴 칸 둘을 건다. 바꾸는 길은 설정(소유자 — §3.1 [보강] 설정 정보구조 ②)이고, 바꾸면 감사 로그에 남는다(§3.8 [보강] 감사 로그).
>
> ① **`allow_export` — 끄면 소유자만 내보낸다**(06 *"Disable export — Don't let members export pages"*). 페이지 · 데이터베이스의 내보내기가
> 소유자가 아니면 `policy_disabled`(403 — 권한 거부와 코드가 다르다). 워크스페이스 전체는 원래 소유자만이다. 공개 API 가 생기면 같은
> 게이트를 지난다(06 엣지 *"API 도 함께 막지 않으면 정책이 우회된다"*).
>
> ② **`allow_member_invite_guests` — 끄면 소유자 · 멤버 관리자만 게스트를 들이고 게스트와 공유한다**(06 *"Allow members to invite guests
> to pages"*). 게스트에게 주는 **모든 길**이 같은 게이트를 지난다: 공유 패널의 게스트 부여(`grantAccessIn` — 대상이 게스트면) · 이메일
> 초대(이미 있는 계정 · 대기 초대) · 접근 요청의 허락(밖의 사람을 게스트로) · **대기 초대의 수락**(초대한 사람의 지금 역할로 — 정책이 바뀐
> 뒤에 받은 초대는 들어오지 않는다). 거부는 `policy_disabled`. **이미 들어온 게스트의 접근은 그대로다**(06 엣지 *"게스트 존재 상태에서
> 게스트 금지 — 결정 필요"* → 막는 것은 새 초대 · 새 공유다. 걷으려면 게스트 관리에서 뺀다).
>
> ③ 요금제 게이트는 두지 않는다 — 웹 게시 정책(6a-1)과 같다(노션은 Enterprise 기능이지만 이 클론의 정책은 소유자의 안전장치다). 조직
> 계층(`org_security_policy`)은 조직이 생길 때.

**[보강] 데이터베이스의 레벨 — 레벨의 뜻은 레벨이 정한다 · 부여는 노드의 종류가 정한다** ⟨게시 · 공유 6f-1 · F-06-10 / 마이그레이션 없음⟩

> `level_capability` 는 page · database 두 매트릭스를 두고, **공통 레벨(view · comment · edit · full_access)은 두 곳에서 같은 능력**이다.
> `edit_content` · `create` 는 database 에만 있다. 초판의 판정은 대상 종류를 page 로 고정해 그 둘을 **조용히 무시**했다(HANDOFF §7).
>
> ① **판정 — 레벨은 page 매트릭스에서, 없으면 database 매트릭스에서 읽는다.** 공통 레벨은 어느 쪽이든 같으므로 page 를 먼저 읽어도 뜻이
> 바뀌지 않고, 데이터베이스 전용 레벨은 그 뜻 하나뿐이다. 노드의 종류를 판정에 흘리지 않아도 된다. 상속은 능력의 합집합이므로(§3.11)
> 데이터베이스에 준 `edit_content` 는 그 행(페이지)들에 그 능력 그대로 내려간다 — 행의 내용 · 셀은 고치고 데이터베이스의 구조(속성 · 뷰 ·
> 템플릿)는 못 고친다(06 F-06-10 *"Can edit content — 속성 정의 · 뷰 · 정렬 · 필터 등 구조는 변경 불가"*).
>
> ② **절단의 복사(P1)가 데이터베이스 전용 레벨을 잃지 않는다** — 행에서 상속을 끊으면 데이터베이스가 준 `edit_content` 가 그 레벨 그대로
> 행에 복사되고 ① 로 같은 능력을 읽는다(초판은 복사할 페이지 레벨이 없어 "1명 제거가 전원 상실" 이 되는 자리였다).
>
> ③ **부여는 노드의 종류가 정한다** — 페이지에는 네 레벨, 데이터베이스에는 여섯(정본 매트릭스 그대로). 그 밖의 조합은 `invalid_level`
> (초판의 공유 API 는 페이지에 `create` 를 받아 판정이 무시하는 행을 남겼다). 절단의 복사 · 초대의 수락처럼 **안에서 쓰는 길**은 상속된
> 레벨을 그대로 옮긴다(② — 검사하지 않는다).
>
> ④ **데이터베이스 화면에 공유 패널** — 페이지와 같은 패널(주체 · 상속 · 접근 요청)에 레벨 "내용 편집"(`edit_content`)이 더 선다. 웹
> 게시 절은 처음엔 서지 않았다(페이지만) — 데이터베이스 게시(6a-2c-2 · [정정] 웹 게시 ⑫)부터 선다. "만들기만"(`create`) 은 처음에 고를 수 없었다 — 06 *"새 row 생성만 가능. 기존 row 는
> 보이지 않음"* 은 그 사람이 데이터베이스를 열어 자기 행만 보는 화면(행 단위 규칙 `page_access_rule` 과 행마다의 걸러내기)이 있어야
> 뜻이 선다. 그 화면이 선 뒤(6f-2b) **6f-2c 부터 고른다**(아래 [보강] 행 단위 접근 규칙 ⑧). 판정은 ① 로 이미 맞다(`create` = `create_child`
> 하나). 고르개에 없는 레벨을 이미 가진 줄(API 로 준 `create` — 6f-2c 전)은
> **그 줄에만 그 레벨을 덧붙여 보인다** — 목록에 없는 값의 select 는 첫 옵션("읽기")으로 보여 그 사람이 다른 것을 가진 것처럼 속인다. 행
> 화면에는 여전히 공유 패널이 없다(8f-1 — 행의 권한은 데이터베이스가 정한다) · 행의 절단(②)은 API 로만 닿는다.

**[보강] 행 단위 접근 규칙(`page_access_rule`) — 규칙의 부여는 그 행의 ACL 행처럼 읽는다 · 지금은 "만든 사람" 만** ⟨게시 · 공유 6f-2a · F-06-10 / 마이그레이션 0089⟩

> 06 F-06-10 *"Page-level access rule: person 속성 / created by 기반 … 문서 권고 조합: DB 전체는 Can create + Created by → Can edit
> 규칙 → 자기가 만든 것만 보고 편집"*. DDL(§3.3 위)은 판결 C-7 그대로 data source 단위다.
>
> ① **판정 — 규칙의 부여는 그 행 노드의 ACL 행으로 합성한다.** `created_by` 규칙이면 `('user', 행의 block.created_by, level)`,
> 사람 속성 규칙이면 그 칸의 사람마다 한 줄. 합성한 행은 주체와 무관하므로(그 행의 사람이 주체다) 판정 함수 · 여러 사람을 한 번에
> 판정하는 길(관리자 찾기 등)이 그대로 읽는다. §3.11 의 `page_access_rule_grant(U,N)` 이 이것이다. **노드 로컬**(P4) — 행을 끊어도
> 그 행의 규칙 부여는 남고, 행을 끊을 때 복사하는 것은 조상(데이터베이스)의 것뿐이다. 행의 하위 페이지는 상속으로 받는다 — 하위를
> 끊으면 그 순간의 것(규칙 부여 포함)이 복사된다(P1). 여러 규칙 · ACL 은 합집합(06 *"가장 높은 레벨"* 과 같다). **템플릿 행은 받지
> 않는다**(R1 — 템플릿은 항목이 아니다).
>
> ② **규칙은 data source 마다 원천마다 하나**(`UNIQUE (data_source_id, source_kind, COALESCE(source_property_id, ''))`) — 레벨만 바꾼다.
> 레벨은 페이지 레벨 넷(대상이 행 — 페이지다 · [보강] 데이터베이스의 레벨 ③).
>
> ③ **사람 속성 규칙** ⟨6g-3a · 마이그레이션 0091⟩ — 처음엔 사람 속성(F-03-07)이 없어 `unsupported_source` 였다. 이제 원천은 **그 data
> source 의 살아 있는 사람 속성** 하나다(다른 표의 속성 · 지운 속성 · 사람이 아닌 속성은 `invalid_property`). 판정은 ① 과 같은 합성 —
> 그 행의 칸에 든 사람마다 `('user', 사람, 레벨)` 한 줄. 속성을 지우면(휴지통) 규칙은 남지만 판정에 들지 않고, 되살리면 돌아온다.
> **칸이 바뀌면 권한 신호** — 규칙의 원천인 속성의 칸을 넣고 · 고치고 · 지울 때 0016 과 같은 신호(`collab_access` 'ws:…')를 보낸다(06 엣지
> *"person 속성 값 변경 → 이전 담당자의 접근 즉시 소멸"* — 협업 서버가 그 워크스페이스의 연결을 다시 판정한다). 같은 값으로 고치기 · 원천이
> 아닌 칸은 보내지 않는다(셀 쓰기는 잦다). 원천 속성을 휴지통에 넣거나 되살릴 때도 같은 신호다. 규칙의 칸 찾기에 부분 색인
> (`source_property_id`)을 둔다. 06 엣지 *"규칙이 부여한 접근으로 사용자가 담당자를 자기 자신으로 변경 — 권한 상승 경로"*: 칸을 고칠 수
> 있는 사람(그 행의 편집)은 자기를 빼면 잃고, **남을 넣으면 공유 권한(`manage_perm`) 없이 그 사람에게 그 행을 연다.** 그것이 규칙의 뜻이다
> — 규칙을 둔 사람(데이터베이스의 `manage_perm`)이 "담당을 정하는 사람이 접근을 나눠 준다" 를 고른 것이다(노션도 같다). 막는 선은 셋 —
> 넣을 수 있는 사람은 이 워크스페이스의 활동 중인 사람뿐([보강] 사람 속성 ②) · 주는 레벨은 규칙의 레벨을 넘지 않는다 · 자기 레벨을 올리지
> 못한다(칸에 자기를 넣어도 규칙의 레벨이다). 감사 로그는 셀 쓰기라 남지 않는다 — 공유 기록으로 보려면 별도 조각이다.
>
> ④ **명령은 데이터베이스의 `manage_perm`** — 공유의 일이다(못 보면 not_found · 보지만 관리 못 하면 forbidden). 바뀌면 감사 로그
> (`page.permission_changed` · `rule_set` / `rule_removed`)와 권한 신호(트리거 — 협업 서버가 그 워크스페이스의 연결을 다시 판정한다).
>
> ⑤ **목록 · 검색에는 걸리지 않는다** — 규칙으로만 열리는 행은 `perm_scope_id` 스코프에 없다. §6.1-3(검색 제외) 그대로. **인박스는 예외**
> ⟨6h⟩ — 알림은 받는 사람의 것이고 배달 시점 권한(§3.8 [보강] 인앱 인박스 ②)은 판정과 같은 답을 내야 한다: 스코프 **또는** 규칙이 그
> 사람에게 그 행을 연다(⑥ 의 술어와 같은 식 · 한 곳 — `ruleOpensRowSql`). 아니면 "담당 → 편집" 으로 행을 받은 사람이 담당 알림을 못 본다.
> 그 행은 주소 · 데이터베이스 화면(6f-2b — 볼 수 없는 사람이 자기 행만 보는 표)으로 연다.
>
> ⑥ **"만들기만" 은 표를 열고 자기가 열 수 있는 행만 본다** ⟨6f-2b-1⟩ — `create_child` 는 있고 `view` 는 없는 사람(`create` 레벨)에게
> 표의 문(데이터베이스 머리 · 스키마 · 뷰 설정)을 연다 — 행을 더하려면 속성을 알아야 한다. 행은 **술어**로 거른다: 그 행의 스코프를
> 볼 수 있다(행에 따로 준 부여 — `readableScopes`) 또는 만든 사람 규칙이 이 사람을 연다(①과 같은 조건). 판정과 같은 답을 SQL 로 낸다
> — 행마다 판정하지 않는다(06 *"10만 row DB — 쿼리 필터로"*). 행 질의 · 보드(카드 · 개수 · 머리 값) · 캘린더(날짜 없음의 수) · 열
> 집계가 **같은 WHERE 자리**에 넣는다 — 필터보다 먼저(F-03-17 · 06 *"롤업 · 집계에도 같은 필터를 적용해야 누출이 없다"*).
> 행을 더하는 문은 볼 수 없어도 열린다 — 뷰의 기본 템플릿으로 만드는 것도(만드는 것과 같은 권한 · 템플릿 **목록**은 보는 일이다).
> **셀 쓰기는 그 행의 권한으로 묻는다** — 셀은 그 행의 것이다. 행은 데이터베이스에서 상속하므로 보통은 같은 답이고, 규칙 · 행에 따로
> 준 부여 · 행의 절단이 있으면 그 행의 답이다("만들기만 + 만든 사람 → 편집" 이 자기 행의 칸을 고치고, 행을 끊어 빠진 사람은 그 행의
> 칸을 고치지 못한다). **[10l-3] 데이터베이스를 볼 수 있는 사람에게도 같은 술어를 건다** — 행을 끊고 그 사람을 빼면 그 행은 표 ·
> 보드 · 캘린더 · 개수 · 열 집계에서도 빠진다(전에는 행 화면 · 셀 쓰기만 막히고 목록에는 제목 · 칸이 그대로 섰다 — 누출). 판정 · 행
> 화면과 같은 답이다: 끊기지 않은 행은 데이터베이스의 스코프를 가리켜 그대로 지나고(같은 스코프는 권한이 같다), 끊긴 행은 그 행의
> 스코프를 볼 수 있을 때 · 규칙이 그 사람을 열 때 선다. 스코프 목록은 요청마다 한 번이고 싸서(§3.11 의 스코프 후보 · 10l-2) 모든 행
> 질의에 붙인다. 템플릿 목록 · 구조 · 내보내기는 여전히 보는 사람의 것이다.
>
> ⑦ **화면** ⟨6f-2b-2⟩ — "만들기만" 의 표 화면은 "내가 열 수 있는 행만 보인다(개수 · 합계도)" 고 말하고, 그 사람에게 실패하는 것(내보내기 ·
> 공유 · 템플릿 패널 · 새로 만들기의 템플릿 목록)을 세우지 않는다 — 새로 만들기는 뷰의 기본 템플릿으로 그대로 만든다. **변경 알림(SSE)의
> 문은 표의 문과 같다** — 알림은 "바뀌었다" 뿐이고 다시 읽는 길이 그 사람의 행 술어를 건다. **행 화면은 그 행을 볼 수 있으면 행이다** —
> 데이터베이스를 못 열어도(규칙 · 행에 따로 준 부여로만 본다) 속성 이름 · 값을 보인다(그 행을 보는 데 필요하다 · 노션도 공유받은 행에
> 속성을 보인다). 그때 경로에 데이터베이스를 세우지 않고(못 여는 표의 이름 · 404 링크) 데이터베이스의 접근은 모두 닫는다. 칸 편집은 그
> 행의 권한이다(⑥ — 셀 쓰기와 같다). 행 화면의 재료를 읽는 함수가 **그 행의 열람을 직접 묻는다** — 칸 값을 돌려주므로 부르는 쪽에만
> 기대지 않는다(전에는 "데이터베이스를 볼 수 있는가" 가 그 문을 겸했다).
>
> ⑧ **공유 패널의 "페이지 단위 접근"** ⟨6f-2c⟩ — 06 F-06-10 *"DB Share 패널의 `Page-level access` 섹션, 규칙 행(속성 셀렉터 + 레벨
> 셀렉터)"*. 데이터베이스의 공유 패널에 절 하나 — 이 데이터베이스가 **소유한** data source 마다 "만든 사람" 줄과 레벨(없음 · 읽기 · 댓글 ·
> 편집 · 전체 권한 — 페이지 레벨 넷 · ②). "없음" 은 규칙을 지운다. 관리할 수 있는 사람(`manage_perm`)만 고르고, 보는 사람에게는 상태만
> 말한다. 붙인 소스(linked)는 원본 데이터베이스의 패널에서 정한다(규칙은 소유한 쪽의 것 — `ownsDataSource`). 레벨 고르개에 "만들기만"
> 이 선다 — 둘을 함께 쓰면 06 의 권고 조합("만들기만 + 만든 사람 → 편집")이다. 사람 속성 규칙은 그 타입(F-03-07)과 함께 이 절에 줄이 는다.
>
> ⑨ **사람 속성 줄** ⟨6g-3b⟩ — ⑧ 의 "줄이 는다". 소유한 data source 마다 "만든 사람" 줄 아래 **살아 있는 사람 속성마다 줄** 하나("담당에
> 든 사람" · 같은 레벨 고르개 — 원천은 ③). 원천 속성이 휴지통인 규칙은 "휴지통" 줄로 남는다 — 레벨을 고르지 못하고(휴지통의 속성으로는
> 두지 못한다 · ③) 지우기만, 보는 사람에게는 "되살리면 다시 적용" 만 말한다. 줄에 필요한 것은 규칙 목록(`GET …/access-rules`)이 함께
> 준다 — 규칙마다 원천 속성의 이름 · 휴지통 여부(`propertyName` · `propertyTrashed`), 그리고 규칙이 아직 없는 것까지 **소유한 data source
> 의 살아 있는 사람 속성**(`peopleProperties` — 스키마 순). 보는 사람 누구나(스키마를 이미 본다). 절의 설명은 두 원천을 말한다.

**[정정] `"group"` 의 `UNIQUE (workspace_id, lower(name))` → 살아있는 그룹에만 거는 부분 UNIQUE** ⟨Teamspace · 게스트 · 그룹 7a / 마이그레이션 0027⟩

> `property` 의 이름 UNIQUE 를 고친 것(§3.5)과 같은 사정이다. 이 표도 `deleted_at` 으로 지우므로(soft delete),
> 전체 UNIQUE 면 "디자인팀"을 지운 뒤 같은 이름으로 다시 만들 수 없다 — 지운 그룹은 어디에도 보이지 않으니
> 사용자는 **보이지 않는 것과 이름이 겹친다**는 답을 받는다. 동명 금지(대소문자 무시)는 살아있는 그룹 사이의
> 규칙으로 남는다. 0003 은 원안대로 만들었고 0027 이 부분 인덱스로 바꿨다.

**[보강] G2 의 집행 — 넣는 쪽은 DB, 반대쪽은 P(U)** ⟨7a / 마이그레이션 0027⟩

> 초판은 *"앱 가드 + 야간 정합성 검사"* 라고만 적었다. ① **넣는 쪽**은 트리거로 승격했다 — 살아있는
> `group_member` 행(`removed_at IS NULL`)은 그룹의 워크스페이스에 게스트가 아닌 멤버 행이 있는 사용자만 가질 수
> 있다(다른 워크스페이스 사람도 함께 막힌다). ② **반대쪽** — 이미 그룹에 있는 멤버가 게스트가 되는 것 — 은
> 막을 수 없다: M1 이 떠난 멤버의 그룹 멤버십을 30일 **남겨 두라**고 하므로, 떠났다 게스트로 다시 초대받은 사람은
> 살아있는 그룹 행을 가진 게스트가 되고 그 수락을 거부할 수 없다. 그래서 §3.11 의 **P(U) 가 guest 에게는 그룹
> 주체를 주지 않는다** — 야간 검사보다 강하다(틀린 행이 있어도 판정이 틀리지 않는다).
>
> 그룹을 지우면(`deleted_at`) 그 그룹이 받은 `acl_entry` 행은 **지운다**(06 F-06-03 *"그 group principal 의 ACL
> 전부 캐스케이드 삭제, 개인 직접 부여는 유지"*). 행 삭제이므로 §3.11 의 재계산 트리거 ② 가 그대로 걸리고,
> 지우면 관리할 사람이 남지 않는 노드가 생기면 지우기를 거부한다.

**[보강] teamspace 노드의 `acl_entry` 가 뜻하는 것 · 누가 쓰는가** ⟨Teamspace · 게스트 · 그룹 7c-1 / 마이그레이션 0028⟩

> 초판은 `node_kind='teamspace'` · `principal_type='teamspace'` · `level_capability.target_kind='teamspace'` 를 열어 두기만
> 하고 그 행이 무엇을 주는지, 누가 쓰는지 적지 않았다(target_kind 'teamspace' 의 행도 없다).
>
> ① **teamspace 노드의 행은 그 아래 페이지가 물려받는 부여다** — `effective()` 는 페이지의 조상 사슬 끝에 teamspace 노드를
> 붙여 그 행을 함께 읽는다(루트 페이지가 상속을 끊었으면 거기서 멈춘다). 그래서 level 은 **page 매트릭스로 읽는다**.
> teamspace 자체의 관리(설정 · 멤버)는 ACL 이 아니라 `teamspace_member.role` 이 정한다 — `target_kind='teamspace'` 의 행은
> 여전히 필요 없다.
> ② teamspace 를 만들면 두 종류의 행이 선다: `('teamspace', T) → 멤버 기본 레벨`(멤버 전원) · owner 마다
> `('user' | 'group', id) → full_access`(06 F-06-04 *"owner 는 모든 페이지에 기본 full access"*). **이 행들은 teamspace 명령만
> 쓴다** — 공유 명령은 블록 노드만 받는다. owner 행은 멤버의 역할과 같은 트랜잭션에서 맞춘다.
> ③ 멤버의 기본 레벨은 `full_access` 다 — 워크스페이스 직속 페이지가 모든 멤버에게 주던 것과 같다. `default_member_level`
> 컬럼은 **쓰지 않는다**([확인필요] 6-5 를 위 첫 행의 level 로 푼다 — 같은 사실을 두 곳에 두지 않는다).
> **[7c-12]** 만들 때의 값이 `full_access` 이고 owner 가 바꾼다 — 아래 [보강] "멤버 기본 레벨을 바꾸는 것" 참조.
> ④ teamspace 는 `ancestor_path` 에 **들어가지 않는다** — 판결문 C-9 의 정의 *"루트(비block parent 직하)→parent 까지의
> block id 배열"* 그대로다. B8 의 *"ancestor_path 상의 teamspace 노드로 해석"* 은 그 배열의 **루트 블록의 부모**로 읽는다.
> ⑤ 멤버는 이 워크스페이스의 게스트 아닌 사람 · 살아 있는 그룹이고(F-06-04), `parent_type='teamspace'` 인 블록은 같은
> 워크스페이스의 teamspace 를 가리키는 페이지 · 데이터베이스다 — 둘 다 다형 참조라 트리거로 건다. 게스트가 된 사람의
> 남은 멤버 행은 P(U) 가 무시한다(G2 와 같은 모양).

**[보강] `teamspace.visibility` 가 정하는 것 — 존재 · 참여 · 그리고 open 의 열람** ⟨Teamspace · 게스트 · 그룹 7c-5 · **7c-9 에서 ②를 뒤집었다** / 마이그레이션 없음⟩

> **[7c-9 정정]** 아래 ① ② ③ 의 "open 도 멤버만 본다"는 **되돌렸다.** open 의 멤버가 아닌 워크스페이스 멤버는 콘텐츠를
> **읽는다(view)** — F-06-04 의 표 그대로다. ②가 적은 재검토 조건("Shared 섹션을 만들 때 다시 본다")이 7c-7 로 채워졌다.
> 구현은 **행 하나**다: open 인 teamspace 노드에 `('workspace_everyone') → view`. 판정 기계는 그대로라 게스트 ·
> `restricted_member`(그 주체를 받지 않는다)는 자동으로 빠지고, 보관되면 노드의 행을 판정이 읽지 않으므로(7c-6) 함께
> 닫힌다. 그래서 ①의 문장은 "visibility 는 effective() 의 **직접** 입력이 아니다 — open 은 노드의 행으로 판정에 닿는다"로
> 읽고, ③은 **open ↔ closed·private 전환이 권한 변화다**로 바뀐다(그 변화는 acl_entry 쓰기가 나르고 0016 의 노드 신호가
> 협업 서버에 알린다). ②가 걱정한 사이드바 범람은 사이드바의 가르기가 막는다 — **멤버가 아닌 open teamspace 의 뿌리는
> 세우지 않는다**(읽는 길은 검색 · 링크, 사이드바에 두려면 참여). ④ ⑤ 는 그대로다. 표의 넷째 열은 이제 이렇다:
> `open` **본다(view · 고치려면 참여)** · `closed` 못 본다 · `private` 못 본다.

> 초판은 `visibility text CHECK (visibility IN ('open','closed','private'))` 컬럼만 두고 그 값이 무엇을 바꾸는지 적지 않았다.
> 06 F-06-04 의 표는 세 축(존재 노출 · 자유 참여 · 콘텐츠 열람)을 적었는데, 그중 **콘텐츠 열람**을 우리는 좁게 간다.
>
> ① **`visibility` 는 `effective()` 의 입력이 아니다.** 셋의 차이는 (ㄱ) 멤버가 아닌 사람의 둘러보기 목록에 뜨는가와
> (ㄴ) 스스로 참여할 수 있는가뿐이다. `open` teamspace 의 페이지도 **멤버만** 본다.
>
> | visibility | 둘러보기 목록 | 스스로 참여 | 멤버가 아닌 사람의 콘텐츠 |
> |---|---|---|---|
> | `open` | 보인다 | O | 못 본다 |
> | `closed` | 보인다 | X — 초대받아야 한다 | 못 본다 |
> | `private` | **안 보인다** | X — 없는 것과 같은 답을 준다 | 못 본다 |
>
> ② F-06-04 의 표는 `open` 의 콘텐츠 열람을 O 로 적었다(공식 문구 *"Anyone can join and view the content inside this
> teamspace."*). 그것을 그대로 두지 않는 까닭은 **우리 모델에서 그 문장이 행 하나가 되기 때문**이다 — "워크스페이스 전원이
> 읽는다"는 teamspace 노드의 `('workspace_everyone') → …` 행이고, 그 행을 두면 그 teamspace 의 최상위 페이지가 **전원의
> 사이드바**에 선다(스코프로 거르는 목록이 그 행을 읽는다). 그 페이지들이 설 자리(Shared 섹션)를 아직 정하지 않았다.
> 참여가 한 번 누르기이므로 "참여하면 본다"도 그 문장을 만족하고, 좁은 쪽이 되돌리기 싸다(`open` → `closed` 로 되돌릴 때
> 이미 내려간 접근을 어떻게 할지 정할 필요가 없다). Shared 섹션을 만들 때 다시 본다.
>
> ③ 그래서 **`visibility` 를 바꾸는 것은 권한 변화가 아니다** — `perm_gen` · `perm_ver` · `acl_epoch` 를 올리지 않고 협업
> 서버에도 알리지 않는다(0028 의 teamspace 신호 트리거가 `archived_at` 만 보는 것이 맞다). **참여는 멤버십**이므로
> `teamspace_member` 의 트리거를 그대로 탄다.
>
> ④ 좁히는 것(`open` → `closed` · `private`)은 **이미 들어온 멤버를 건드리지 않는다**(F-06-04 엣지 케이스의 권장).
> 막는 것은 앞으로의 참여뿐이다.
>
> ⑤ **둘러보기와 참여를 할 수 있는 워크스페이스 역할은 `owner` · `membership_admin` · `member` 다.**
> `restricted_member` 와 `guest` 에게는 멤버가 아닌 teamspace 가 **없는 것과 같다**(F-06-04 *"추가 전에는 이 사람에게
> teamspace 자체가 존재하지 않는 것과 같음"*) — 목록이 비고, 참여는 `private` 와 같은 답을 받는다.

**[보강] `teamspace.archived_at` 이 뜻하는 것 — 아무도 못 보고, 되살릴 사람만 존재를 본다** ⟨Teamspace · 게스트 · 그룹 7c-6 / 마이그레이션 없음⟩

> 초판은 `archived_at` 컬럼과 0028 의 신호 트리거만 두고, 보관이 판정에 무엇을 하는지 적지 않았다. 06 F-06-04 는
> *"Teamspace는 삭제되지 않고 archive만 된다. archive 시 모든 멤버의 사이드바에서 제거된다"* 와 복원 경로만 적었다.
>
> ① **보관된 teamspace 노드의 `acl_entry` 는 판정에서 읽지 않는다.** 멤버는 이미 잃는다 — P(U) 가 보관된 teamspace 를
> 주체로 주지 않는다. 그러나 owner 의 행은 `('user', id) → full_access` 라 주체가 늘 있으므로, 사슬에서 그 노드를 빼지
> 않으면 **owner 만** 보관된 teamspace 의 페이지를 계속 본다. 그러면 목록과 판정이 어긋난다 — `user_accessible_scopes` 는
> 보관된 teamspace 를 스코프 후보에서 빼므로 사이드바 · 검색 · 멘션에는 안 나오는데 주소를 알면 열린다. 판정과 목록은
> 나란히 간다.
>
> ② **행은 건드리지 않는다.** `acl_entry` · `teamspace_member` 를 그대로 두므로 복원은 정확하다(멤버 · 역할 · owner 부여가
> 그대로 돌아온다). 페이지에 따로 준 부여(블록 노드의 행)는 보관과 무관하게 살아 있다 — 그 페이지는 자기 자신이 경계다.
>
> ③ **보관된 teamspace 는 이름도 새 자리도 주지 않는다** — 만들기 · 넣기 · 옮기기 · 설정 · 참여 · 둘러보기가 모두
> `not_found` 다(이미 그랬다: 그 명령들은 `archived_at IS NULL` 인 행만 잠근다). 되살릴 사람만 **보관된 목록**으로 그
> 존재를 본다.
>
> ④ 보관 · 복원은 **그 teamspace 의 owner** 다. F-06-04 은 복원을 *"workspace owner이면서 teamspace owner"* 로 적었지만
> 좁히지 않는다 — 워크스페이스 owner 가 아닌 사람이 만든 teamspace 를 보관하면 아무도 되살릴 수 없게 되기 때문이다
> (워크스페이스 owner 가 멤버가 아닌 teamspace 에 손대는 경로는 아직 없다). 그 경로가 생기면 "워크스페이스 owner 도
> 되살릴 수 있다"를 **더한다** — 조건을 빼는 쪽이 아니다.
>
> ⑤ 신호는 0028 의 `tg_collab_access_teamspace`(`archived_at` 변경) 그대로다 — 보관도 복원도 그 트리거를 탄다.

**[보강] `teamspace.is_default` 가 하는 일 — 들여보내기만 한다** ⟨Teamspace · 게스트 · 그룹 7c-11 / 마이그레이션 0030⟩

> 초판은 `is_default boolean -- visibility 와 직교` 만 적었다. 06 F-06-04 는 *"켜면 기존 멤버 전원이 즉시 추가되고, 이후
> 가입자도 자동 추가"* · *"동기 처리 금지, 배치 삽입"* · *"마지막 default 는 archive 불가"* `[추정]` 을 적었고, 공식 문서는
> *"Workspace owners can designate default teamspaces"* 를 더한다. 나가기 · 공개 범위와의 관계는 어디에도 없다.
>
> ① **`is_default` 는 판정의 입력이 아니다 — 멤버 행을 넣는 규칙일 뿐이다.** 켜는 순간과 사람이 워크스페이스에 들어오는
> 순간에 `teamspace_member` 행이 서고, 그 뒤의 일은 보통 멤버와 같다(판정 · 목록 · 나가기 · 빼기). 그래서 협업 신호도
> 멤버 행의 트리거(0028 ③)가 나른다 — `is_default` 컬럼에는 신호 트리거가 필요 없다.
>
> ② **켜고 끄는 사람은 워크스페이스 `owner` 이면서 그 teamspace 의 owner 다.** 공식 문서는 워크스페이스 owner 만 적었지만,
> 켜면 그 teamspace 의 콘텐츠가 워크스페이스 전원에게 열린다 — 누구에게 여는지는 teamspace owner 가 정할 일이다(F-06-04
> *"owner … will also have access to teamspace settings"*). 멤버가 아닌 워크스페이스 owner 는 먼저 **드러나게 들어간다**
> (§3.11 [보강] 고아 teamspace ② — 역할로 여는 분기를 두지 않는 규칙 그대로).
>
> ③ **들어오는 사람은 활성 `owner` · `membership_admin` · `member` 다** — 역할은 늘 `member`. 게스트는 멤버가 될 수 없고,
> `restricted_member` 는 넣지 않는다: 초대받기 전에는 teamspace 가 존재하지 않는 것과 같다는 것(F-06-04)이 그 역할의 뜻이라
> 자동 추가는 그것을 지운다. 그룹은 넣지 않는다 — 사람마다 한 행이다. 이미 살아 있는 행(owner 포함)은 그대로 두고, 빠졌던
> 행은 `member` 로 되살린다(M1 · 스스로 참여와 같은 규칙).
>
> ④ **배치 삽입은 한 문장이다** — `INSERT … SELECT` 하나가 켜는 명령과 같은 트랜잭션에서 전원을 넣는다. 한 사람씩 명령을
> 부르지 않는다는 것이 F-06-04 의 *"동기 처리 금지"* 를 지키는 방식이다. 비동기 큐로 미루지 않는 까닭: 지금은 잡 인프라가
> 없고, 미루면 "켰는데 아직 안 들어왔다"는 중간 상태를 판정 · 화면이 모두 알아야 한다. 잰 값: 멤버 5,000명에 372ms
> (행마다 도는 0028 의 트리거 포함 · 개발 PC). 규모가 문제가 되면 옮긴다.
>
> 들어오는 순간(초대 수락)은 켜는 명령과 엇갈릴 수 있다 — 서로 상대의 커밋 전 쓰기를 못 봐 그 사람이 빠진다. 들어오는 쪽이
> 그 워크스페이스의 teamspace 행을 **`FOR SHARE` 로 잠근 뒤** `is_default` 를 읽어 순서를 세운다(켜는 쪽은 `FOR UPDATE`).
>
> ⑤ **끄면 앞으로의 자동 추가만 멈춘다** — 이미 들어온 멤버는 그대로다(공개 범위를 좁힐 때와 같은 규칙 · 이 절 visibility
> [보강] ④). **나가기도 막지 않는다** — 기본 teamspace 의 멤버도 스스로 나간다. 막는 규칙은 어느 출처에도 없고, 나중에
> 더하는 쪽이 싸다 `[추정]`.
>
> ⑥ **기본 teamspace 는 보관하지 않는다 — `CHECK (NOT is_default OR archived_at IS NULL)`.** F-06-04 의 *"마지막 default 는
> archive 불가"* 보다 넓다. 보관된 teamspace 는 판정이 읽지 않으므로 그리로의 자동 추가는 헛돌고, 되살리는 순간 보관 중에
> 들어온 사람들이 한꺼번에 열린다 — 보관 중에도 뜻이 있는 상태를 만들지 않는다(이 절 archived_at [보강] ② — 행을 건드리지
> 않아야 복원이 정확하다). 보관하려면 먼저 끈다. 기본이 **하나도 없어도 된다** — 워크스페이스는 teamspace 없이 시작하고,
> "마지막 하나"를 붙들면 기본을 바꾸는 순서까지 강제하게 된다.
>
> ⑦ `visibility` 와는 직교 그대로다. 비공개도 기본일 수 있다 — 그러면 존재를 모르는 사람은 게스트 · `restricted_member` 뿐이다.

**[보강] 멤버 기본 레벨을 바꾸는 것 — 행 하나의 level 이다** ⟨Teamspace · 게스트 · 그룹 7c-12 / 마이그레이션 0031⟩

> 06 F-06-04 는 *"member — will receive access to pages within the teamspace as determined by teamspace owners"* 와
> `default_member_access`([추정] · UI 값 미확인)를 적었다. 이 절 teamspace 노드 [보강] ③ 이 그 값을 `('teamspace', T)` 행의
> level 로 두었으므로, 바꾸는 것은 **그 행 하나의 `UPDATE`** 다.
>
> ① **값은 넷 — `full_access` · `edit` · `comment` · `view`.** teamspace 노드의 행은 page 매트릭스로 읽는다(위 ①).
> `edit_content` · `create` 는 database 전용 레벨이라 그 아래 페이지에서 뜻이 없다. **teamspace 노드의 모든 행**(멤버 · owner ·
> open 의 열람)에 `CHECK (node_kind <> 'teamspace' OR level IN (넷))` 를 건다(0031) — 판정이 page 매트릭스에 없는 레벨을
> 만나지 않게.
>
> ② **바꾸는 사람은 그 teamspace 의 owner** 다(설정과 같다). owner 는 자기 owner 행으로 늘 `full_access` 다 — 멤버 레벨을
> 낮춰도 owner 는 잃지 않는다. open 의 열람 행(`workspace_everyone → view`)은 그대로다.
>
> ③ **권한 변화다** — 행의 `UPDATE` 이므로 0016 의 노드 신호가 협업 서버에 알린다(낮추면 열린 편집기가 닫힌다).
>
> ④ **상속을 끊은 페이지는 바뀌지 않는다** — 끊을 때 복사한 행(P1)이 그 순간의 레벨을 지니고, P2 *"절단된 노드는 이후 조상
> ACL 변경을 받지 않는다"* 그대로다. 화면이 바꾸기 전에 그 말을 한다.
>
> ⑤ 낮추면 최상위에 **만들기**가 함께 바뀐다 — `comment` · `view` 는 `create_child` 가 없어 멤버가 최상위에 페이지 ·
> 데이터베이스를 두지 못한다(`teamspaceCaps`). 옮기기 피커 · 사이드바의 `+` 가 같은 판정을 쓴다. `edit` 는 만들고 고치지만
> 공유(`share` · `manage_perm`)는 못 한다 — 뿌리가 바뀌는 이동(7c-3 · `manage_perm`)도 못 한다.

**[보강] `teamspace.icon` — 이모지 한 글자** ⟨Teamspace · 게스트 · 그룹 7c-14 / 마이그레이션 0032⟩

> 초판은 `icon text NULL` 만 두었다(페이지의 `icon jsonb` 와 달리 text 다). 06 F-06-04 는 만들기에 *"이름/아이콘 입력"* 만 적었다.
>
> ① **값은 이모지 한 글자(grapheme 하나)다** — 없으면 NULL 이고 화면은 기본 표시(▣)를 쓴다. 이미지 업로드는 아직 없다 — 페이지
> 아이콘(`icon jsonb`)이 생길 때 그 모양(이모지 | 파일)을 따라 넓힌다. text 로 두었으므로 그때는 새 컬럼이 아니라 이 칸의 뜻을
> 넓히는 [보강]이 필요하다.
>
> ② "한 글자 · 이모지"는 명령이 검사한다(grapheme 수는 SQL 로 셀 수 없다). DB 는 **표현할 수 있는 부분만** 막는다 —
> `CHECK (icon IS NULL OR (char_length(icon) BETWEEN 1 AND 16 AND icon !~ '[[:space:]]'))`(0032). 16 은 가장 긴 표준 이모지
> 시퀀스(ZWJ 가족 · 깃발 하위 구역 — 코드포인트 10개 안팎)를 넉넉히 받는 상한이다.
>
> ③ 바꾸는 사람은 owner 다(설정 · 만든 사람). 권한과 무관하므로 신호는 없다(이름과 같다).
>
> ④ **[8c-1]** 페이지 아이콘은 `icon jsonb` 컬럼이 아니라 `block.format.page_icon`(노션 API icon 객체의 모양)으로 정했다(§3.4 [보강] 페이지
> 아이콘). 이 칸과 **같은 규칙**(`isSingleEmoji` — 키캡도 받게 넓혔다)을 쓴다. 경로(breadcrumb)는 이 값을 페이지 아이콘의 모양으로 옮겨
> 그린다 — 이미지로 넓힐 때 두 칸이 같은 모양을 따른다는 ① 의 말은 그대로다.

**[보강] 게스트를 들이는 길 — 페이지에서, 이미 있는 계정을, 곧바로** ⟨Teamspace · 게스트 · 그룹 7d-1 / 마이그레이션 없음⟩

> 초판은 `workspace_member.role='guest'` 와 불변식(M2 좌석 · G2 그룹)만 두었고, 게스트가 **어떻게 생기는지** 적지 않았다
> (이메일 초대 `workspace_invite.role` 은 워크스페이스 역할 셋만 받는다). 06 F-06-09: *"페이지 Share 에서 외부 이메일 입력 →
> 게스트로 추가"* · *"게스트도 자체 Notion 계정이 필요하다"*.
>
> ① **게스트는 페이지에서 생긴다** — 그 페이지를 공유할 수 있는 사람(`manage_perm`)이 이메일과 레벨을 준다. 한 트랜잭션에서
> 페이지 부여(`acl_entry`)와 멤버십(`role='guest'`)을 함께 쓴다 — 부여가 거부되면 멤버십도 남지 않는다.
>
> ② **이미 있는 계정만, 수락 없이 곧바로** — 이메일은 **검증된** `user_email` 로 찾는다(미검증 주소는 누구나 등록할 수 있어
> 남의 초대를 가로챈다 — 워크스페이스 초대와 같은 규칙). 계정이 없으면 거부하고 먼저 가입하라고 말한다. 가입 뒤에 적용되는
> 대기 초대(`workspace_invite` 에 페이지 · 레벨을 싣는 것)는 ⑨(7g-1)다 — 거부하지 않고 대기 초대를 남긴다.
>
> ③ 그 이메일이 **이미 이 워크스페이스의 멤버**면 역할을 바꾸지 않고 부여만 한다(멤버를 게스트로 내리지 않는다). 이미 게스트면
> 부여만, 떠났던 사람(`removed`)은 게스트로 돌아온다(M1 의 행을 되살린다). 멈춘 사람(`suspended`)은 들이지 않는다.
>
> ④ **게스트에게 주는 레벨은 편집까지다** — `full_access` 는 공유(`share` · `manage_perm`)를 품어 게스트가 다른 게스트를 초대하는
> 순환이 생긴다(F-06-09 *"게스트에게 share capability 를 주지 않으면 원천 차단 — 클론 기본값 권장"*). 이 초대와 공유 패널의
> 사람 부여가 같은 규칙으로 거부한다. 역할을 게스트로 바꾸는 명령이 생기면 그 사람의 `full_access` 행을 함께 다룬다.
>
> ⑤ 게스트는 좌석을 소비하지 않는다(M2) · 기본 teamspace 에 들어가지 않는다(teamspace.is_default [보강] ③). 게스트 한도
> (`plan_entitlement`) · 정책(`security_policy.allow_member_invite_guests`)은 그 표들이 생길 때 이 명령에 건다.
>
> ⑥ **[7d-2] 공유의 사용자 주체는 이 워크스페이스의 사람이다** — `workspace_member` 가 `active` · `suspended` 인 사람(멤버든
> 게스트든). 초대만 받은 · 떠난 · 처음 보는 사람에게 주는 부여는 `invalid_principal` 로 거부한다 — 워크스페이스 밖의 사람에게
> 주는 길은 ① 의 게스트 초대 하나다(부여와 멤버십을 함께 쓴다 · 그래서 초대는 멤버십을 부여보다 먼저 쓴다).
>
> ⑦ **[7d-2] 게스트는 워크스페이스 멤버 목록을 받지 않는다**(F-06-09 *"게스트는 … 멤버 목록에 접근하지 못한다"* `[추정]`을
> 따른다). 게스트가 이름을 보는 사람은 **자기가 받은 페이지에 이미 나오는 사람**뿐이다 — 그 페이지의 공유 행 · 코멘트를 쓰고
> 해결하고 반응한 사람 · 본문의 멘션. `@` 의 사람 후보는 없다(페이지 후보는 권한으로 거른 그대로). `restricted_member` 는
> 멤버 목록을 받는다 — 막는 출처가 없다.
>
> ⑧ **[7d-3] 게스트를 멤버로 올리고, 워크스페이스에서 뺀다 — owner · `membership_admin`**(워크스페이스 초대와 같은 역할).
> 올리면 `role='member'` · `join_method='guest_upgrade'` 로 바뀌고 **받은 부여는 그대로다**(F-06-09 *"기존 페이지 ACL 유지 +
> 워크스페이스 접근 추가, 좌석 소비 시작"*). 멤버가 되는 길이므로 기본 teamspace 에 함께 들어간다(teamspace.is_default [보강]).
> 빼면 `status='removed'` 와 함께 **그 게스트가 받은 부여를 모두 거둔다** — 그룹을 지울 때(`dropGrantsOf`)와 같은 규칙(경계를
> 풀고, 관리할 사람이 남지 않는 노드가 생기면 거부한다). 거두지 않으면 M1 의 멤버십 행이 남아 있으므로 **다시 초대받는 순간 옛
> 페이지들이 한꺼번에 돌아온다** — 빼기는 "모든 공유를 걷는다"로 읽혀야 한다. 멤버 제거는 이 명령이 아니다(teamspace 의 마지막
> owner 를 물어야 한다 — §3.11 [보강] 고아 teamspace).
>
> ⑨ **[7g-1] 계정이 없는 이메일에게는 대기 초대를 남긴다** — ② 의 "먼저 가입하라"를 넓혔다. `workspace_invite` 의 한 종류
> (`role='guest'` + `page_id` · `page_level`)이고, 멤버 초대와 **같은 메일 · 같은 수락 화면 · 같은 이메일 소유 검사**(검증된
> 주소 — 링크만으로는 받지 못한다)를 지난다. 받는 사람은 링크로 가입(첫 로그인)하고 받아들인다.
> (a) 초대할 때의 게이트는 그대로 — 공유할 수 있는 사람만, 계정 유무를 말하기 전에 게이트(7d-1 의 순서).
> (b) 받아들이는 순간 **멤버십 → 부여**를 한 트랜잭션에 쓴다 — 부여 없이 들어온 게스트가 생기지 않는다(① 의 순서).
> (c) 받아들일 때 **초대한 사람이 지금도 그 페이지를 공유할 수 있는지** 다시 센다 — 받는 쪽에는 초대한 사람의 세션이 없으므로
> 판정과 같은 규칙을 그 사람으로 돌린다(활성 멤버 · `manage_perm`). 부여를 **정한** 것은 초대할 때 그 사람의 세션이었고(A9),
> 이 재확인은 그 결정을 **좁히기만** 한다 — 공유 권한을 잃었거나 떠났거나 페이지가 살아 있지 않으면 초대는 쓸모가 없다.
> (d) 받는 사람이 이미 이 워크스페이스의 사람이면 역할을 건드리지 않고 부여만 한다(③) · 멈춘 사람은 받지 못한다.
> (e) 부여는 권한을 낮추지 않는다(접근 요청 ⑥ 과 같다 — 이미 직접 받은 행이 품으면 쓰지 않는다).
> (f) 대기 중인 게스트 초대는 (페이지, 이메일)마다 하나 — 다시 초대하면 레벨 · 토큰 · 만료를 새로 쓴다(옛 링크는 죽는다).
> 멤버 초대의 "대기 중이면 역할을 바꾼다"(F-14-10)는 게스트 초대를 건드리지 않는다 — 둘은 다른 초대다.
> (g) 목록 · 취소는 워크스페이스 초대와 같은 곳(홈 · owner · membership_admin)이다. 목록은 **페이지 제목을 싣지 않는다** — 보는
> 사람이 그 페이지를 볼 수 없을 수 있다. 수락 화면도 제목을 싣지 않는다(받기 전에는 볼 수 없는 사람이다).

**[보강] 멤버 내보내기 · 역할 바꾸기 — owner 를 지키고, M1 을 지킨다** ⟨멤버 관리 10o-1 · F-06-02 / 마이그레이션 없음⟩

> 초판은 역할 값과 M1(제거는 `status='removed'` · 30일 복원)만 두었다. 06 F-06-02 는 *"마지막 owner 제거 · 탈퇴 → 차단"* ·
> *"멤버 → restricted member 강등 → 기존 명시 ACL 은 유지되나 teamspace 자동 접근이 끊김"* · *"멤버 제거 → 팀 페이지는 잔존,
> private 페이지 이관 · 삭제 정책 `[확인필요]`"* 를 적었다. 게스트를 빼는 길은 [보강] 게스트 ⑧ 이 따로 있다(이것이 아니다).
>
> ① **누가 · 누구를 · 무엇으로** — owner 와 `membership_admin`(워크스페이스 초대와 같은 역할). 대상은 이 워크스페이스의 **활성 ·
> 게스트 아닌** 사람이고 바꿀 수 있는 역할은 `owner` · `membership_admin` · `member` · `restricted_member` 다. **관리 역할(`owner` ·
> `membership_admin`)을 주거나 가진 사람을 건드리는 것은 owner 만이다** — `membership_admin` 은 `member` ↔ `restricted_member` 와
> 그 둘의 내보내기만 한다. 같은 규칙을 **초대에도** 건다: `owner` · `membership_admin` 으로 초대하는 것은 owner 만이다(그 전에는
> `membership_admin` 이 다른 사람을 owner 로 초대할 수 있었다 — 자기보다 높은 역할을 만드는 길이었다).
> ② **활성 owner 는 늘 하나 이상이다** — owner 를 내보내거나 owner 가 아닌 역할로 바꾸면 남는 활성 owner 가 있어야 한다(없으면
> `last_owner`). 셀 때 활성 owner 행을 모두 잠근다 — 두 owner 가 서로를 동시에 내리면 둘 다 "다른 owner 가 있다" 를 보고 0 이 된다.
> 자기 자신을 이 명령으로 내보내지는 않는다(`self` — 나가기는 다른 길이다 · 아직 없다). 자기 역할은 바꿀 수 있다(② 를 지나면).
> ③ **teamspace 의 마지막 owner 는 내보내지 않는다** — 그 사람이 어느 teamspace(보관된 것 포함)의 마지막 **행동할 수 있는** owner 면
> 거부하고(`teamspace_last_owner` · 그 teamspace 들의 이름을 준다) 먼저 owner 를 넘기게 한다. 셈은 §3.11 [보강] 고아 teamspace ① 그대로
> — 활성 · 게스트 아닌 사람 또는 지워지지 않은 그룹. 멤버급 역할 사이의 바꾸기는 그 셈을 바꾸지 않는다(`restricted_member` 도 행동할
> 수 있는 owner 다).
> ④ **내보내기는 M1 이다 — 받은 부여 · 그룹 · teamspace 멤버십을 거두지 않는다.** `status='removed'` · `removed_at` 만 쓴다. 30일
> 안에 다시 들어오면 그대로 돌아온다(M1). 떠난 사람의 행은 0단계 게이트(`can_enter_workspace`)가 쓰지 못하게 한다. 게스트 빼기(⑧)가
> 부여를 거두는 것과 다른 까닭: 게스트는 페이지에 속한 사람이라 "빼기 = 공유를 걷는다" 로 읽히고, 멤버에게는 M1 의 복원 약속이 있다.
> 개인 페이지도 남는다(30일 뒤의 처리 — 이관 · 삭제 — 는 아직 · HANDOFF §7).
> ⑤ **역할만 바꾼다** — `restricted_member` 로 내려도 명시 부여 · 그룹 · teamspace 멤버십은 남는다(그 역할에게는 명시 멤버십이 유일한
> 길이다 — 06). 끊기는 것은 `workspace_everyone` 의 부여뿐이다(권한 엔진이 역할로 가른다 · P(U)). `restricted_member` 에서 멤버급으로
> 올리면 **기본 teamspace 에 들어간다**(게스트 올리기와 같다 — `DEFAULT_TEAMSPACE_ROLES`).
> ⑥ **게스트로 내리기는 이 명령이 아니다** — 게스트는 `full_access` 부여를 가질 수 없고(⑦ 위 게스트 레벨) 그룹 · teamspace 에
> 들어가지 않으므로, 그것들을 함께 물어야 한다(다음 조각 · HANDOFF §7). `invited` · `suspended` · `removed` · 게스트는 대상이 아니다.
> ⑦ 바뀌면 그 사람의 권한 세대와 워크스페이스의 `acl_epoch` 를 올리고(게스트 명령과 같다) 협업 서버는 멤버십 행의 트리거(0016)로 알고
> 닫는다. 감사 로그는 `workspace.member_removed`(역할) · `workspace.member_role_changed`(전 · 후).
> ⑧ **[10o-2] 화면 — 설정의 사람 절 멤버 목록.** 역할은 이름으로(`roleLabel` — "소유자" · "멤버 관리자" …) 보인다. **다룰 수 있는 줄에만**
> 역할 고르개와 "내보내기" 가 서고, 고르개의 선택지는 **줄 수 있는 역할만**이다 — 판정은 명령과 **같은 함수**(`mayManage` · 순수 모듈)라
> 화면과 서버가 다른 답을 하지 않는다. 게스트 · 초대만 받은 · 멈춘 사람의 줄에는 서지 않는다(게스트는 게스트 절). 내보내기는 **한 번 더
> 묻는다**(그 자리에서 ④ 를 말한다 — 들어오지 못하고, 30일 안에 다시 초대하면 돌아온다). 거부는 이유를 말한다 — teamspace 의 마지막
> owner 면 그 이름들을. 초대 폼의 역할 고르개도 같은 규칙으로 줄인다(membership_admin 에게는 "멤버" 만).
> ⑨ **[10o-3] 스스로 나가기** — 14 F-14-10 *"Settings → Workspace → General → Danger zone → Leave workspace. 내부 콘텐츠 접근을 전부
> 잃으며 관리자가 다시 추가할 수 있다"*. 활성 · 게스트 아닌 사람이 자기를 뺀다 — **내보내기와 같은 규칙**이다: 마지막 활성 owner 는
> 나가지 못하고(`last_owner` — 먼저 다른 사람을 owner 로), teamspace 의 마지막 행동할 수 있는 owner 도 나가지 못한다(그 이름들) · M1
> (`status='removed'` · 부여 · 그룹 · teamspace 멤버십은 남는다 — 30일 안에 다시 초대받으면 돌아온다) · 권한 세대 · `acl_epoch`. 감사
> 로그는 `workspace.member_removed` 에 `left: true` 를 싣는다(행위자 = 대상 · 이벤트 종류를 늘리지 않는다 — CHECK 제약이 있다).
> 게스트의 나가기는 이 길이 아니다(게스트는 받은 페이지의 공유에서 빠진다 — 아직). 화면은 설정의 워크스페이스 일반 절 끝 —
> 한 번 더 묻고(무엇을 잃는지 · 다시 초대받으면 돌아온다는 것), 나가면 처음 화면(워크스페이스 목록)으로 간다.

**[보강] 접근 요청의 길 — 볼 수 없는 페이지에서, 공유할 수 있는 사람에게** ⟨Teamspace · 게스트 · 그룹 7e-1 / 마이그레이션 0033⟩

> 초판은 표와 상태 넷만 두었다. 06 F-06-15: *"권한 없는 사용자가 페이지 URL 을 연다 → `No access` 화면 → 요청 전송 → 페이지의
> creator/editor 가 Inbox 에서 승인/거부"*.
>
> ① **7e-1 은 `page_access` 하나다** — 이 워크스페이스의 사람(멤버 · 게스트 — 세션을 받는 사람)이 볼 수 없는 **살아 있는 페이지**의
> 주소를 열면 "접근 권한이 없습니다"와 요청 버튼을 본다. 워크스페이스 밖의 사람(가입했지만 멤버가 아닌 사람)의 요청은 7g-2 가
> 더했다(⑩ — `security_policy.allow_nonmember_page_access_request`). 편집 권한 요청(`edit_access`)은 7e-2 가 더했다(⑨).
>
> ② **그 화면은 페이지가 있다는 것을 알려 준다 — 제목은 아니다.** 02 F-02-03 *"접근 권한 없는 페이지는 존재도 노출 금지"* 를
> 06 F-06-15 가 좁힌다(1차 출처: *"If you open a page that you don't have access to, you can select `No access` on the page to
> send a request"*). 좁히는 범위: 이 워크스페이스의 사람에게만(세션이 0단계를 지났다), 그 주소를 가진 사람에게만이다(id 는 추측할
> 수 없는 uuid). 다른 워크스페이스의 페이지 · 휴지통의 페이지 · 없는 id · **보관된 teamspace 의 페이지**(아무도 못 보고 되살릴
> 사람만 존재를 본다 — `teamspace.archived_at` [보강] · 허락할 사람도 없다)는 여전히 404 이고, **API 는 그대로다** — 볼 수 없는
> 페이지의 공유 · 이동 · 휴지통 요청은 여전히 없는 페이지와 같은 답(`not_found`)을 받는다. 페이지 화면 하나만 요청을 받는다.
> 06 엣지 *"요청 UI 자체 미노출 + 권한 없음만 표시(존재 여부 노출 최소화)"* 는 정책이 요청을 끈 경우의 말이다 — 그 정책은
> `security_policy` 가 생길 때 건다.
>
> ③ **대기 중인 요청은 (페이지, 사람, 종류)마다 하나** — 다시 눌러도 새 행 · 새 알림이 없다(부분 UNIQUE · 동시에 눌러도 같다).
> **무시(`ignored`)는 요청한 사람에게 알리지 않는다**(06 *"accept or ignore"* — 무시가 정식 결말이다). 무시된 뒤 **하루** 동안은
> 요청한 사람에게 "보냈습니다"로 보이고 새 요청을 받지 않는다 — 06 엣지의 *"쿨다운"*(스팸 억제)과 무시를 드러내지 않는 것이 같은
> 규칙이다. 하루가 지나면 다시 보낼 수 있다. `denied` 는 쓰지 않는다.
>
> ④ **승인할 수 있는 사람 = 그 페이지를 공유할 수 있는 사람**(`manage_perm` — 공유 설정의 게이트 그대로 · 볼 수 없으면 없는
> 요청과 같다). 06 은 *"creator/editor"* 라 적고 엣지에서 *"creator 단일 지정은 취약 → 가장 가까운 full access 보유자"* 라 했다 —
> 판정은 공유 권한 하나로 하고, **알림을 받는 사람**만 좁힌다(⑤).
>
> ⑤ **알림은 이름이 걸린 관리자에게** — 사슬(절단까지 · teamspace 노드 포함)에서 **사람에게 직접** 공유를 품은 레벨을 준 행의 그
> 사람들과 페이지를 만든 사람 중, 지금 그 페이지를 공유할 수 있는 사람. 아무도 없으면 워크스페이스 owner 중 공유할 수 있는
> 사람. 그룹 · teamspace 멤버 전원 · `workspace_everyone` 으로 공유 권한을 받은 사람들 전원에게는 보내지 않는다 — 그러면 워크스페이스
> 최상위 페이지(모두가 전체 권한)에 온 요청 하나가 멤버 전원의 인박스로 간다. 알림을 받지 못한 공유 가능자도 공유 패널에서 요청을
> 보고 처리한다.
>
> ⑥ **승인은 공유 설정의 부여를 거친다**(`grantAccessIn`) — 게스트의 레벨 상한(편집까지) · 사용자 주체 규칙(떠난 사람에게 주지
> 않는다)이 같은 한 곳에서 걸린다. 레벨은 승인하는 사람이 고른다(요청한 사람은 고르지 않는다 — `page_access` 의 `requested_level`
> 은 NULL). **승인은 권한을 낮추지 않는다** — 그 사람에게 이 페이지에 직접 준 행이 이미 고른 레벨을 품으면(capability 부분집합
> — 정수 비교가 아니다 · A2) 쓰지 않는다. 요청 행을 잠그므로 두 사람이 동시에 처리하면 나중 사람은 "이미 처리됨"을 받는다.
>
> ⑦ **이미 볼 수 있게 된 사람의 요청은 목록에 세우지 않는다** — 06 엣지는 다른 길로 권한이 생기면 *"자동 close(`superseded`)"*
> 라 했지만 상태를 늘리지 않는다: 목록이 읽을 때 거른다(판정과 같은 규칙 — `resolveCaps` 를 그 사람들로 돌린다). 다시 못 보게
> 되면 그 요청이 다시 선다. ~~요청한 사람이 워크스페이스를 떠나도 세우지 않는다(허락하면 ⑥ 이 거부한다).~~ **[7g-2]** 떠난 사람은
> 워크스페이스 밖의 사람이다 — 그 사람의 접근 요청은 ⑩ 의 요청으로 선다(정책이 허락할 때 · 허락하면 게스트로 들어온다). 떠난
> 사람의 편집 요청은 세우지 않는다(밖의 사람은 볼 수 없다 — 다시 들어오면 선다).
>
> ⑧ 페이지가 지워지면(물리 삭제) 요청도 간다(`ON DELETE CASCADE` — 06 엣지 *"삭제 시 요청 자동 취소"*). 휴지통의 페이지는 없는
> 페이지와 같다 — 요청도 승인도 없고, 복원하면 대기 중이던 요청이 돌아온다.
>
> ⑨ **[7e-2] 편집 권한 요청(`edit_access`) — 볼 수는 있지만 고칠 수 없는 사람이, 공유 패널에서.** 06 F-06-15 *"view/comment
> 권한자가 편집이 필요하면 Share 탭의 현재 권한 드롭다운에서 `Request edit access`"*. `requested_level='edit'` — 허락하는 사람의 기본
> 선택이 되고, 그 사람이 다른 레벨을 고를 수 있다(게스트는 편집까지). ③~⑧ 은 그대로다 — 열린 요청과 쿨다운은 **종류마다** 센다
> (대기 중인 접근 요청이 편집 요청을 막지 않는다), 알림 · 승인 · 처리의 문이 같다. ⑦ 은 종류마다의 "이미 가졌다"로 읽는다 — 접근
> 요청은 볼 수 있게 되면(`view`), 편집 요청은 고칠 수 있게 되면(`edit_content`) 목록에서 빠진다. **볼 수 없는 사람은 이 종류로
> 요청하지 못한다**(`not_found`) — 그 사람의 길은 ① 의 요청 화면이고, 공유 패널의 요청 API 가 요청 화면과 다른 말을 하지 않는다
> (볼 수 없는 페이지를 편집 요청으로 두드려 존재를 알아내지 못한다). 06 은 승인 주체를 *"페이지 creator"* 로 적었지만 ④ ⑤ 를
> 그대로 쓴다 — 접근 요청과 편집 요청의 승인 주체를 가를 출처가 없다.
>
> ⑩ **[7g-2] 워크스페이스 밖의 사람의 접근 요청 — 허락하면 게스트로 들어온다.** 06 F-06-15 의 흐름(*"권한 없는 사용자가 페이지
> URL 을 연다 → No access 화면 → 요청 전송"*)은 멤버에 한정되지 않고, 정본의 `security_policy.allow_nonmember_page_access_request`
> (기본 true)가 그 길을 전제한다.
> (a) **밖의 사람** = 로그인했지만 이 워크스페이스에 멤버십이 없거나 떠난(`removed`) 사람. 멈춘(`suspended`) · 초대만 받은
> (`invited`) 사람은 아니다 — 멈춘 사람을 요청으로 돌아오게 하면 멈춤을 우회한다.
> (b) **② 를 넓힌다 — 페이지 화면 하나만.** 정책이 허락하면 밖의 사람도 살아 있는 페이지(보관된 teamspace 밖)의 주소에서 요청
> 화면을 본다. 제목 · 워크스페이스 이름은 싣지 않는다. 그 밖의 모든 주소(홈 · 인박스 · 데이터베이스 · teamspace)와 API, 정책이 끈
> 경우는 여전히 404 다 — **없는 워크스페이스와 구별되지 않는다**(없는 워크스페이스에도 멤버십이 없다). 주소를 가진 사람에게만
> 이라는 좁힘(추측할 수 없는 uuid)은 그대로다.
> (c) **요청은 판정이 아니다.** 밖의 사람은 이 워크스페이스에서 아무것도 보지 못하므로 `SessionContext` 가 없다(A9 그대로 —
> 0단계를 지나지 않았다). 요청 명령은 세션 토큰에서 "이 워크스페이스의 사람이 아니다"를 확인한 **신원**(`OutsiderContext` —
> 브랜디드 · 그 확인만 발급한다)으로 요청 행과 알림을 쓴다. 권한을 묻는 함수에는 넣지 않는다. 종류는 `page_access` 하나다.
> (d) 목록 · 알림 받는 사람 · 쿨다운 · 처리의 문은 ③~⑧ 그대로. 공유 패널은 그 줄에 "워크스페이스 밖"과 이메일을 싣는다(허락하는
> 사람이 누군지 알아야 한다 · 멤버 목록으로는 찾을 수 없다).
> (e) **허락하면 게스트로 들어온다** — 멤버십(`role='guest'` · `join_method='access_request'`) → 부여를 한 트랜잭션에(게스트
> 초대 [보강] ① 의 순서 · 같은 도우미). 레벨은 편집까지(④) — 전체 권한을 고르면 `guest_level` 로 거부하고 멤버십도 남지 않는다.
> 게스트 한도(`plan_entitlement`) · `allow_member_invite_guests` 는 그 도우미에 건다(뒤의 조각).
> (f) **정책을 끄면** 새 요청을 받지 않고(요청 화면이 404 가 된다) 대기 중인 밖의 요청은 목록에서 빠지며 허락 · 무시할 수 없다
> (`not_found`). 상태는 바꾸지 않는다 — 다시 켜면 돌아온다(⑦ 과 같은 방식).
> (g) 정책을 바꾸는 사람은 워크스페이스 owner 다(§3.2 `security_policy` [보강]).

**[보강] 잠금이 막는 것 — 판정이 아니라 게이트 · 페이지는 본문과 제목** ⟨Teamspace · 게스트 · 그룹 7f-1 / 마이그레이션 0034⟩

> 초판은 `node_lock` 의 칸과 §3.11 의 한 줄(*"node_lock(N) 이 있고 action ∈ {edit_content, edit_structure, edit_layout} 이면
> BLOCK"*)만 두었다. 06 F-06-16: *"ACL 과 무관하게 노드의 편집을 동결하는 플래그 — 권한이 아니라 실수 방지 장치"* ·
> *"잠금은 소유자에게도 적용된다"* · *"edit 이상이면 누구나 해제할 수 있다"*.
>
> ① **잠금은 capability 가 아니다** — `effective()` 는 그대로다(잠긴 페이지의 편집자는 여전히 `edit_content` 를 가진다). 쓰기
> 명령이 capability 를 확인한 **뒤에** 잠금을 묻는다(`permissions/lock.ts`). 그래서 공유 패널 · 이동 · 공유 설정처럼 capability 를
> 묻는 다른 판단이 잠금에 흔들리지 않는다.
>
> ② **페이지 잠금이 막는 것: 본문과 제목.** 본문은 협업 접속이 읽기 전용이 되고(접속 판정이 잠긴 페이지를 `view` 로 준다),
> 참여자 update 는 `locked` 로 거부된다. 제목은 이름 바꾸기가 거부한다.
>
> ③ **막지 않는 것: 코멘트(달기 · 해결) · 트리 연산(하위 페이지 만들기 · 옮기기 · 휴지통 · 복원 · 복제) · 공유 설정.** 06 엣지
> *"잠긴 페이지를 이동/삭제 — 정책 결정 필요 `[확인필요]`. 클론 권장: 콘텐츠 편집만 막고 트리 연산은 허용"* 을 따른다. 트리
> 연산은 부모 본문의 하위 페이지 참조를 넣고 뺀다 — 잠긴 페이지의 본문이라도 그 참조는 따라 바뀐다(참조는 트리의 투영이다).
> 복제본은 잠기지 않는다(새 노드다).
>
> ④ **잠그고 푸는 사람 = 그 페이지를 고칠 수 있는 사람**(`edit_content` — 06 *"full or edit access"*). 잠금은 잠근 사람에게도
> 걸린다(주체 예외가 없다) — 풀어야 고친다. 누가 언제 잠갔는지는 행에 남는다(`locked_by` · `locked_at`). 볼 수만 있는 사람은
> 잠겼다는 것만 본다.
>
> ⑤ **상속되지 않는다**(§6.1-8 · 06 엣지 *"상속시키면 트리 전체가 얼어붙는다"* `[추정]`) — 잠긴 페이지의 하위 페이지는 따로 잠근다.
>
> ⑥ **잠기는 순간 열린 편집기가 읽기 전용이 된다** — 잠금 행의 삽입 · 삭제가 협업 신호(`collab_access`)를 내고, 서버가 그
> 워크스페이스의 연결을 다시 판정해 편집 연결을 닫는다. 브라우저는 확인받지 못한 편집을 버리고 읽기 전용으로 다시 연다(06 엣지
> *"미커밋 로컬 op 처리 정책 — 폐기 vs 마지막 커밋 허용"* — 권한이 줄 때와 같은 폐기다). 풀어도 읽기 전용 연결은 올라가지
> 않는다 — 다시 열면 편집이다(권한이 늘 때와 같다).
>
> ⑦ `kind` 는 그 블록의 `type` 이다(트리거) · 블록이 지워지면 잠금도 간다(CASCADE). `scope` 는 기본값(`content_and_layout`)으로
> 쓴다 — 페이지에서는 가르지 않는다. 데이터베이스 잠금(구조 — 뷰 · 프로퍼티)과 행 페이지의 셀은 ⑨ ⑩(7f-2)이다.
>
> ⑧ 06 의 *"Re-lock"*(잠깐 풀었다 다시 잠그기 · breadcrumb 의 임시 해제 표시)은 없다 — 풀기와 잠그기 두 동작뿐이다.
>
> ⑨ **[7f-2] 데이터베이스 잠금은 구조를 막는다**(06 *"구조(뷰 · property)만 잠기고 데이터(행 · 값) 편집은 계속 허용"*) —
> 속성(더하기 · 이름 · 설정 · 지우기 · 옵션 더하기 · relation · rollup) · 뷰(만들기 · 이름 · 종류 · 필터 · 정렬 · 그룹 · 컬럼 ·
> 지우기 · 기본 템플릿) · 템플릿 만들기 · 지우기 · 데이터베이스 이름. 구조를 여는 문(스키마 잠금 · 뷰의 `edit_structure` ·
> 데이터 소스의 `edit_structure` · 이름 바꾸기)이 capability 뒤에 묻는다. **막지 않는 것**: 행 만들기(템플릿으로 만들기 포함) ·
> 행 휴지통 · 셀 값 · 카드 옮기기 · 연결. 템플릿의 **내용**(셀 · 본문)은 행과 같은 길이라 막지 않는다 — 템플릿 행 페이지를
> 따로 잠근다. 양방향 relation 을 더하면 대상 표의 스키마도 바뀌므로 **대상이 잠겼으면** 거부한다. 잠그고 푸는 사람은 구조를
> 고칠 수 있는 사람(`edit_structure` — 행만 고치는 사람이 구조의 잠금을 풀 수 있으면 잠금이 뜻이 없다). 상속 안 됨 — 잠긴
> 데이터베이스의 행 페이지는 잠기지 않는다(§6.1-8).
>
> ⑩ **[7f-2] 행 페이지를 잠그면 그 행의 셀도 막는다** — 페이지 잠금이 제목을 막는 것과 같다(행 제목은 셀이다). 연결 칸도
> 셀이다. 양방향의 거울상은 대상 행이 잠겨 있어도 따라간다 — 이 행의 연결이 바뀐 결과이지 대상 행을 고치는 것이 아니다(하위
> 페이지 참조가 트리를 따라가는 것과 같다). 같은 열 안에서 카드의 자리만 옮기는 것(`row_position`)은 셀이 아니라 막지 않고,
> 다른 열로 옮기면 그룹 셀이 바뀌므로 거부한다.

**[정정] 웹 게시 — 공개는 `effective()` 의 항이 아니다 · 색인 기본값은 `noindex`** ⟨게시 · 공유 6a-1 · F-06-08 · F-06-07(웹 링크) · F-17-11 · F-06-11 / 마이그레이션 0084⟩

> 초판 DDL 은 `public_link` 의 칸만 두었고, §3.11 은 공개를 판정의 한 항(`public_link_grant(U,N)` · `P(U)` 의 `('public',NULL)`)으로
> 적었으며, X-8 은 그 위에 `perm_scope_id` 재계산 트리거 ⑤ 를 더했다. 6a-1 에서 게시를 만들며 셋 다 바로잡는다.
>
> ① **[정정] 기본값** — `robots_directive` 의 `'index'` → **`'noindex'`**, `ai_crawler` 의 `'allow'` → **`'deny'`**. 마스터 §9.4 가
> 결정으로 종결한 것(*"공개 페이지 색인 기본값 `noindex` — 며칠만 index 로 운영해도 비공개 의도 콘텐츠가 색인되고 되돌릴 수
> 없다"*) · F-17-11 *"기본 noindex"* 를 DDL 이 거슬렀다. 색인 · AI 크롤러 허용은 사람이 켠다.
>
> ② **[정정] 공개는 `effective()` 의 항이 아니다** — 공개 링크는 **링크를 아는 사람**에게 주는 것이다. 판정의 항으로 두면 공개
> 페이지가 워크스페이스의 모든 멤버 · 게스트의 사이드바 · 검색 · 멘션 후보 · 백링크(`perm_scope_id = ANY(readableScopes)`)에
> 들어온다 — 그들은 링크를 모른다. 공개 경로는 따로 판정한다(③ — 마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR ·
> 내부 조회 함수 재사용 금지"*). 따라서:
>    - `P(U)` 에 `('public',NULL)` 이 없고, **`acl_entry.principal_type = 'public'` 행을 쓰지 않는다**(CHECK `ck_acl_no_public` — 0084).
>      공개의 레벨 · 만료 · 주소는 `public_link` 한 곳에 산다. 두 곳에 두면 어느 쪽이 공개의 정본인지가 생긴다.
>    - `perm_scope_id` 재계산 트리거 ⑤(`public_link.enabled` 전이 · X-8 부수 판결)는 **없다**. 스코프는 판정의 경계이고 공개는 판정
>      밖이다. 익명 검색(사이트 · 6c 이후)은 게시 루트의 서브트리(`ancestor_path`)와 ③ 의 사슬 조건으로 거른다.
>    - 로그인한 멤버도 공개 링크로는 공개 경로에서 본다 — 앱 안(`/w/…`)에서 보려면 공유받아야 한다.
>
> ③ **공개 경로의 판정**(`publish/public-access.ts`) — **`SessionContext` 를 만들지 않는다**(발급자는 여전히 둘 — 공개 방문자는
> 워크스페이스에 들어온 사람이 아니다). 토큰 → 게시 루트. 열 수 있는 페이지는 **루트와, 루트에서 그 페이지까지 상속이 끊기지 않은
> 하위 페이지**다(06 *"Publishing a Notion page to the web means all of its subpages will be published too"* · *"하위에서 상속을 끊어
> 공개 대상에서 제외"* — 루트 아래 사슬의 어느 노드든 `inherits_from_parent = false` 면 그 아래는 공개가 아니다). 그리고 아래가
> **모두** 참일 때만 연다:
>    `enabled` · 만료 전(`expires_at IS NULL OR expires_at > now()`) · 워크스페이스 정책이 허용(`security_policy.allow_publish_sites_and_forms`
>    — 06 *"기존 `public_link.enabled` 를 런타임 정책 게이트로 무효화(행 삭제 아님) → 정책 해제 시 원복"*) · 워크스페이스가 지워지지
>    않음 · 루트부터 그 페이지까지 모두 `live` · 그 사슬 어디에도 `moderation_state ∈ (restricted, taken_down)` 이 없음(테이크다운은
>    서브트리를 덮는다 — 17 `moderation_action.scope`).
>    어긴 이유는 **만료만** 구별해 돌려준다(06 엣지 *"만료된 링크 접근 → 만료 안내 화면"*). 나머지는 모두 없는 페이지다 — 정책 ·
>    테이크다운 · 휴지통을 익명에게 구별해 주면 그 주소가 무엇이었는지를 알려 준다.
>
> ④ **게시하는 사람 = 그 페이지에 `manage_perm` 이 있는 사람**(전체 권한 — 06 *"Share → Publish"* 는 공유 패널의 일이다). 볼 수 없으면
> `not_found` · 볼 수만 있으면 `forbidden`(공유 설정의 게이트와 같다 · §3.2-18). **페이지와 데이터베이스**(6a-2c-1 — ⑫ · 처음엔
> 페이지만이었다). 템플릿 행은 게시할 수 없다(R1 — 항목이 아니다 · `not_page`). 휴지통의 페이지는 게시할 수 없다. 워크스페이스 정책이 막으면 `policy_disabled` — 게시 해제는 정책과
> 무관하게 된다(끄는 것은 언제나 된다). 잠금은 막지 않는다(잠금은 본문 · 제목의 게이트 — 위 [보강] 잠금 ③).
>
> ⑤ **게시 해제 = `enabled := false`** — 행과 토큰은 남는다(다시 게시하면 **같은 주소**). 주소를 바꾸는 것은 토큰을 새로 만드는
> 별도 동작이다(화면과 함께 — 6a-3). 토큰은 무작위 128비트의 base64url 22자(CHECK `ck_public_link_token`) · 처음 게시할 때 만든다 ·
> **`enabled` 면 토큰이 있다**(CHECK `ck_public_link_enabled_token`).
>
> ⑥ **레벨은 지금 `view` 하나** — comment · edit 은 06 *"댓글 · 편집에는 로그인 필요 · 로그인 후 그 사용자는 게스트가 아닌
> 익명-인증 주체"* 다. 워크스페이스에 들어오지 않은 사람의 주체가 필요하고 `SessionContext` 는 들어온 사람만 받는다 — 그 주체를 정할
> 때까지 명령이 `view` 만 쓴다(DDL 의 CHECK 은 정본대로 셋을 둔다).
>
> ⑦ `node_id` 는 `block(id)` 의 FK(**`ON DELETE CASCADE`** — 물리 삭제가 지울 표 목록에 손으로 더하지 않는다) · `created_by` 는
> `"user"(id)` 의 FK · `created_at NOT NULL DEFAULT now()` · 마지막으로 바꾼 사람 · 시각(`updated_by` · `updated_at`)을 더한다.
> 복제는 공개를 옮기지 않는다(새 노드다 — 표가 따로라 복제가 읽지 않는다).
>
> ⑧ **`block.public_exposure` 는 아직 쓰지 않는다** — 파생 칸이고 읽는 곳(모더레이션 큐 · 6b)이 그때 생긴다. 지금 채우면 하위
> 페이지 만들기 · 이동 · 상속 절단마다 다시 계산해야 하는 값이 읽는 곳 없이 생긴다. `search_document.is_public` 도 같다.
>
> ⑨ **정책 칸 `allow_publish_sites_and_forms` 를 바꾸는 길은 설정이다**(`workspace.allow_publish_sites_and_forms` · 소유자 — §3.1
> [보강] 설정 정보구조 ②). 끄면 이미 게시한 주소가 **곧바로** 열리지 않고(③), 다시 켜면 돌아온다.
>
> ⑩ **[6a-3] 공유 패널이 바꾸는 것** — 게시 · 해제 · **검색 엔진 노출**(`robots_directive`) · **주소 바꾸기**(토큰을 새로 — 옛 주소는
> 곧바로 닫힌다 · ⑤ 의 "주소를 버리는 별도 동작"). 둘 다 게시된 링크에만(`not_published`) · 게시하는 사람과 같은 `manage_perm` ·
> 정책 · 휴지통과 무관(좁히는 쪽이다). AI 크롤러 칸은 열지 않는다([보강] 공개 화면 ⑥). 만료(`expires_at`)는 ⑬ 이 요금제 게이트와
> 함께 열었다. 게시 상태는 **위 페이지의 게시로 이 페이지도 공개되었는가**(`coveredBy`)를 함께 말한다 —
> 가장 가까운 게시된 조상 중 공개 경로의 판정(③)이 이 페이지를 여는 것. 그 조상을 볼 수 없는 사람에게는 id · 제목 없이 사실만.
> 정책이 막았거나 만료된 게시는 덮지 않는다. 보기만 하는 사람은 게시 여부만 본다(토큰은 ④ 대로 `manage_perm` 에게만).
>
> ⑪ **[6a-4] 옮기기 전에 웹 공개가 바뀌는지 말한다** — 06 엣지 *"이동으로 상속 원천이 바뀌어도 public_link 는 노드 로컬이라 그대로
> 살아남는다 → 비공개 영역으로 옮긴 페이지가 계속 공개되는 사고가 가능. 이동 시 공개 상태 경고 필수"*. 이동 미리보기(§3.4 [보강] 이동
> 미리보기 · 실제로 옮겨 보고 되돌린다)가 옮기기 **전과 뒤에** 그 페이지가 웹에서 열리는지(③ 의 판정 그대로 — 정책 · 만료 · 사슬)와 자기
> 게시인지를 잰다. 공개가 바뀌면(위 페이지의 게시 안으로 · 밖으로) **볼 수 있는 사람이 같아도 한 번 더 묻는다** — 웹의 방문자도 볼 수 있는
> 사람이다. 자기 게시는 옮겨도 남는다고 말한다(취소는 공유 메뉴에서).
>
> ⑫ **[6a-2c-1] 데이터베이스를 게시한다** — 루트가 데이터베이스면 그 아래의 행(페이지)과 행의 하위 페이지가 ③ 의 같은 조건으로 열린다
> (이 앱의 데이터베이스는 최상위에만 서므로 게시된 페이지 트리 안에는 없다 — 데이터베이스는 자기가 루트일 때만 공개다). 사슬의 끝은
> 페이지이거나 루트인 데이터베이스 자신이다. **템플릿 행과 그 아래는 열지 않는다**(R1). data source 를 휴지통에 보내면 그 행도 함께
> 휴지통에 가므로 `live` 조건이 닫는다. 공개 표 · 공개 행의 속성은 [보강] 공개 화면 ⑩.
>
> ⑬ **[보강 10n-50] 만료를 정한다** ⟨마이그레이션 0115⟩ — 06 *"만료는 유료 플랜 기능"*. 엔타이틀먼트 `publish.link_expiry`(boolean —
> Plus · Business · Enterprise). 공유 패널이 ⑩ 의 설정과 같은 길(게시된 링크에만 · `manage_perm` · 정책 · 휴지통과 무관)로
> `expires_at` 을 정하고 지운다. **정하기만 요금제가 막는다**(`plan_required`) — 지우기는 언제나 된다(요금제를 내려도 남은 만료를 걷을 수
> 있어야 한다 · 남은 만료는 그대로 듣는다 — 좁히는 쪽이다). 값은 **지금보다 뒤이고 1년 안**(멤버의 임시 만료와 같은 상한)이다 — 아니면
> `invalid_input`. 판정은 ③ 그대로다(`expires_at > now()` 가 아니면 열리지 않고 만료 안내를 그린다) — 만료된 링크도 `enabled` 이므로
> 게시 상태는 "게시됨 · 만료됨" 을 말하고, 새 만료를 정하거나 지우면 같은 주소로 다시 열린다. 게시 해제 · 다시 게시는 만료를 건드리지
> 않는다(주소와 같은 결 — ⑤). 게시 상태는 **그 사람이 만료를 정할 수 있는가**(요금제)를 함께 싣는다 — 화면이 미리 막는다.

**[보강] 공개 화면 — 무엇을 그리고 무엇을 가리는가** ⟨게시 · 공유 6a-2a · F-06-08 · F-17-11 / 마이그레이션 없음⟩

> 마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR. 내부 조회 함수 재사용 금지"* 를 따른다. 공개 화면은 편집기를 띄우지
> 않는 서버 화면이고, 읽기는 `publish/public-read.ts` 의 자기 질의뿐이다 — 판정은 [정정] 웹 게시 ③(`resolvePublicPage`) 하나.
> 순수 부품(행 → 문서 `rowsToDoc` · 목차 계산 · 표 셀 읽기 · KaTeX 래퍼)만 앱과 함께 쓴다.
>
> ① **주소** — 게시 루트는 `/p/{token}`, 공개 하위 페이지는 `/p/{token}/{pageId}`(같은 토큰 아래 — 토큰마다 열 수 있는 범위가 다르다).
>
> ② **본문은 투영된 행이다** — 06 엣지 *"공개 경로는 커밋된 스냅샷만 읽는다"*. 참여자의 확인 전 편집은 행에 없다(투영 디바운스 뒤에
> 보인다). 문서 범위는 앱과 같은 규칙이다 — 재귀가 페이지에서 멈춘다(자식 페이지의 본문은 그 페이지의 것).
>
> ③ **그리는 것**: 제목 · 아이콘(이모지) · 글 블록 전부(문단 · 제목 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 · 구분선 · 코드 · 수식 · 표 ·
> 컬럼 · 목차 · 이동 경로) · 글자 서식 · 색 · **[6a-2b] 이미지 블록 · 이미지 아이콘**(⑨). **그리지 않는 것**: 버튼 블록(누를 수
> 없다 — 액션은 본문의 내용이 아니다) · 데이터베이스(읽기 전용 표로 — 6a-2c) · 모르는 블록.
>
> ④ **공개 밖을 가리킨 것은 가린다** — 하위 페이지 참조는 그 토큰으로 열 수 있는 페이지만 링크로 두고 나머지는 **뺀다**. 페이지
> 멘션도 열 수 있으면 링크, 아니면 "비공개 페이지" 로 — **제목을 싣지 않는다**(06 엣지 *"공개 페이지에 비공개 하위 링크가 인라인
> 언급 → 방문자에게 마스킹"* · §3.2-22 와 같은 누출). 이동 경로(블록 · 머리)는 루트에서 그 페이지까지의 사슬만이다 — 루트 위의
> 조상은 그리지 않는다. 사람 멘션은 이름이다(쓴 사람이 본문에 넣은 것이다).
>
> ⑤ **주소가 자격이다** — 공개 화면은 `Referrer-Policy: no-referrer` 다(바깥 링크를 누르면 토큰이 든 주소가 `Referer` 로 새지 않게).
> 바깥 링크는 `rel="noopener noreferrer nofollow"`. 링크 주소는 앱과 같은 소독(`isSafeLinkUrl`)을 지난다.
>
> ⑥ **색인** — `<meta name="robots">` 가 링크의 `robots_directive` 를 따른다(기본 `noindex, nofollow`). `ai_crawler = 'deny'` 면
> `noai, noimageai` 를 더한다. `robots.txt` 는 앱 경로(`/w/` · `/api/` · 로그인 · 초대)를 막고, 알려진 AI 크롤러에게는 `/p/` 를 막는다 —
> 링크마다 여는 것(`ai_crawler = 'allow'`)은 robots.txt 로 표현할 수 없다(토큰을 적으면 주소가 퍼진다) · 사이트(6c)가 경로를 가질 때.
> 그때까지 공유 패널은 AI 크롤러 칸을 열지 않는다.
>
> ⑦ **만료는 안내 화면**(색인 제외) · 그 밖의 거절은 404 — [정정] 웹 게시 ③ 그대로.
>
> ⑧ 로그인한 사람이 열어도 공개 화면이다 — 세션을 읽지 않는다(테마는 루트 레이아웃이 정한다).
>
> ⑨ **[6a-2b] 공개 파일은 블록 id 로 연다 — 파일 id 로 열지 않는다** — `/p/{token}/blocks/{blockId}/image`(본문의 이미지 블록) ·
> `/p/{token}/blocks/{pageId}/icon`(페이지의 이미지 아이콘). 앱의 파일 경로는 세션이 판정한다(그 워크스페이스 사람이면 id 로 어느
> 파일이든). 공개 쪽은 세션이 없으므로 **그 블록이 든 페이지(가장 가까운 페이지 조상 · 아이콘이면 그 페이지)가 이 토큰으로 열리고,
> 그 블록이 지금 가리키는 이 워크스페이스의 파일**일 때만 준다 — 공개 주소를 알아도 다른 파일 id 를 찍어 읽을 수 없고, 본문에서
> 이미지를 지우거나 페이지를 닫으면 그 주소도 닫힌다. 응답은 `X-Robots-Tag`(링크의 색인 설정 — 화면의 meta 와 같은 규칙) ·
> `Referrer-Policy: no-referrer` · `nosniff` · **짧은 개인 캐시**(`private, max-age=60` — 앱의 파일은 id 로 불변이라 1년이지만 공개
> 여부는 바뀐다: 해제 · 정책 · 휴지통이 곧 닿아야 한다). 바깥 주소 이미지는 그 주소를 그대로 쓴다(`referrerpolicy="no-referrer"`).
>
> ⑩ **[6a-2c-1] 공개 표 · 공개 행의 속성** — 게시된 데이터베이스를 여는 화면은 **소유한 data source 의 첫 뷰**(탭 순서 — 붙인 소스는
> 다른 데이터베이스의 행이라 고르지 않는다)의 **공유** 필터 · 정렬(개인 필터 · 정렬은 방문자에게 없다)로 고른 행을 그 뷰의 보이는 열로
> 그린다. 필터 · 정렬의 SQL 은 앱과 같은 순수 컴파일러(같은 뷰가 같은 행을 같은 순서로) — 질의는 자기 것이다(`publish/public-database.ts`).
> **표에 서는 행 = 공개로 열리는 행**(템플릿 · 상속을 끊은 행 · 휴지통 · 막는 모더레이션은 표에도 없다 — ③ 의 사슬 조건을 행에 건 것).
> 처음 100줄(넘으면 그렇다고 말한다 · 페이지 넘기기는 뒤로) · 하위 항목은 평평하게. **열은 값이 행에 있는 타입만** — 제목 · 글 · 숫자 ·
> 선택 · 상태 · 체크박스 · 날짜 · 고유 ID. 관계형(대상의 공개 여부를 따로 물어야 한다) · 롤업 · 수식(읽을 때 계산 — 보는 사람의 권한이
> 든다) · 버튼은 그리지 않는다. 수식으로 거르는 뷰는 그 캐시가 낡을 수 있다(공개 경로는 캐시를 채우지 않는다). 공개로 연 **행**은 속성
> 묶음을 함께 그린다 — 스키마 순서 · 제목은 머리 · 행 레이아웃이 숨긴 것은 빼고(앱의 행 화면과 같다 · 8f-2) · 같은 타입만. 숨긴 열의
> 값은 싣지 않는다(재료에 없다). **[6a-2c-2] 화면** — 게시된 데이터베이스를 여는 공개 화면은 본문 대신 표를 그린다(열 머리 · 제목 칸은
> 그 행의 공개 주소로 가는 링크 · 옵션은 편집기와 같은 색의 칩 · 체크박스는 이름과 함께 · 100줄이면 그렇다고 말한다 · 머리의 아이콘은
> 데이터베이스의 칸 `database.icon` — 이미지면 공개 파일 경로가 그 칸을 읽는다). 행을 열면 제목 아래에 속성 묶음. 데이터베이스의 공유
> 패널에 웹 게시 절이 서고, 게시 전에 무엇이 열리는지 데이터베이스의 말로 말한다(첫 번째 뷰의 표와 그 행 · 숨긴 열과 관계형 · 롤업 ·
> 수식 열은 보이지 않는다).

**[보강] 사이트 주소 — 워크스페이스의 주소 · 페이지의 슬러그** ⟨게시 · 공유 6c-1 · F-13-08 / 마이그레이션 0093⟩

> 13 F-13-08 *"URL slug 를 편집한다(최대 60자, 영문/숫자/하이픈)"* · 데이터 모델 함의의 `site_domain`(13 제안 — 정본에 없었다). 공개 주소는
> 지금까지 토큰(`/p/{token}`)뿐이었다 — 무작위 22자는 나눠 줄 수는 있어도 사람이 읽고 기억할 수 없다. 사이트는 **같은 공개를 읽을 수 있는
> 주소로 한 번 더 여는 것**이다 — 판정 · 읽기는 토큰의 것을 그대로 쓴다.

```sql
CREATE TABLE site_domain (                    -- [보강 6c-1] 워크스페이스의 사이트 주소(13 의 site_domain — 지금은 하위 주소만)
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'subdomain' CHECK (kind IN ('subdomain')),   -- 'custom' 은 F-13-09(DNS 검증)과 함께 넓힌다
  name text NOT NULL CHECK (name ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),  -- 3~40자 · 소문자 · 숫자 · 하이픈(끝은 아니다)
  created_by uuid NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_site_domain_name ON site_domain (name);                              -- 주소는 모두에게 하나
CREATE UNIQUE INDEX ux_site_domain_workspace ON site_domain (workspace_id) WHERE kind = 'subdomain';  -- 워크스페이스마다 하나

ALTER TABLE public_link
  ADD COLUMN workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,  -- 슬러그의 이름 공간(기존 행은 블록에서 채운다)
  ADD COLUMN slug text NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 60);
CREATE UNIQUE INDEX ux_public_link_slug ON public_link (workspace_id, slug) WHERE slug IS NOT NULL;
```

> ① **주소** — `/s/{워크스페이스 주소}/{슬러그}`(하위 페이지는 `/s/{주소}/{슬러그}/{pageId}`). 운영에서는 `{주소}.{사이트 호스트}/{슬러그}` 로
> 받아 같은 처리로 넘긴다(호스트를 경로로 바꾸는 것은 배포의 일 — 경로 꼴이 정본이다). 토큰 주소는 그대로 산다 — 사이트 주소는 **덧붙는
> 이름**이지 공개의 정본이 아니다(공개 여부 · 만료 · 색인은 `public_link` 한 곳 — [정정] 웹 게시 ①).
>
> ② **판정은 토큰의 것** — 주소 → 워크스페이스 → 그 워크스페이스의 슬러그 → 그 링크의 토큰 → `resolvePublicPage`(만료 · 정책 · 휴지통 ·
> 모더레이션 · 사슬 — 모두 같다). 게시를 해제하면(`enabled = false`) 슬러그 주소도 닫힌다(슬러그는 남는다 — 다시 게시하면 다시 열린다).
> 열 수 없는 이유를 말하지 않는다(404 — 토큰과 같다).
>
> ③ **워크스페이스 주소** — 소유자만 정한다(설정). 3~40자 · 소문자 · 숫자 · 하이픈. **모두에게 하나**(다른 워크스페이스가 쓰면 `taken`) ·
> 앱이 쓰는 이름(`www` · `api` · `app` · `admin` 등 — `reserved`)은 받지 않는다. 바꾸면 옛 주소는 곧바로 닫힌다(넘겨주는 길은 없다 —
> v1). 지우면 사이트 주소가 모두 닫힌다(토큰 주소는 산다). 감사 로그(`workspace.setting_changed` · 키 `site.domain`).
>
> ④ **슬러그** — 그 페이지를 게시할 수 있는 사람(`manage_perm`)이 게시 설정에서 정한다(`updatePublicLink` 의 한 칸). 소문자 · 숫자 ·
> 하이픈 · 60자 · **워크스페이스 안에서 하나**(`slug_taken`). 대문자는 소문자로 받는다 — 주소는 대소문자를 가르지 않는 편이 덜 헷갈린다.
> 비우면 슬러그 주소가 닫힌다. 슬러그는 게시 설정의 한 칸이라 **게시된 링크에만**(`not_published` — 다른 설정과 같다) · 해제해도 남는다.
>
> ⑤ **화면 안의 주소** — 사이트 주소로 연 화면은 링크(하위 페이지 · 이동 경로 · 공개 표의 행)를 사이트 주소로 만든다(기준 경로 —
> `/s/{주소}/{슬러그}`). 이미지 · 아이콘 · 신고는 토큰 경로 그대로다(같은 공개를 여는 같은 열쇠 — v1).
>
> ⑥ **뒤로** — 커스텀 도메인 · DNS 검증(F-13-09) · 사이트의 홈 지정 · SEO 제목 · 설명 · 분석(유료) · 하위 페이지의 슬러그 · 슬러그를
> 바꿀 때 옛 주소 넘겨주기.
>
> ⑦ **[6c-2] 화면** — 설정 → 워크스페이스 → **사이트**(소유자의 절 · 패널 하나): 주소 칸 · 저장 · 지우기 · 지금 주소의 모양
> (`{앱 주소}/s/{주소}/…`) · 실패 문구(모양 · 예약 · 다른 워크스페이스). 공유 패널의 웹 게시 절 — 게시되어 있고 바꿀 수 있으면
> **사이트 주소** 칸: 워크스페이스 주소가 없으면 "소유자가 설정 → 사이트에서 정한다" 고만 말하고, 있으면 슬러그 칸(저장 · 비우기 —
> 비우면 슬러그 주소가 닫힌다) · 슬러그가 있으면 사이트 주소(복사 · 열기). 토큰 주소는 그대로 함께 선다.

**[보강] 공개 페이지 신고 — 신고는 케이스로 묶이고 사람이 본다** ⟨게시 · 공유 6b-1a · F-17-08 · F-17-09 / 마이그레이션 0085⟩

> 17 의 `abuse_report` · `moderation_case` 를 정본으로 들인다(17 단독이던 축 — §7 의 *"17 고유"*). 17 F-17-08 클론 대안 *"모더레이션
> 큐 없이 신고 → 운영자 알림 + `abuse_report` 행 적재 · 처리는 사람이"* 그대로 시작한다 — 큐 화면은 없고 운영자 경로(테이크다운)는 6b-2.
>
> ```sql
> CREATE TABLE moderation_case (
>   id uuid PRIMARY KEY,
>   target_type text NOT NULL CHECK (target_type IN ('page')),      -- 17 의 site · form · comment · file 은 그것이 공개될 때
>   target_id uuid NOT NULL,                                         -- FK 없음 — 대상이 파기돼도 케이스는 남는다(moot · 재범 판정)
>   workspace_id uuid NOT NULL REFERENCES workspace(id),
>   state text NOT NULL DEFAULT 'open'
>     CHECK (state IN ('open','investigating','actioned','dismissed','moot')),
>   report_count int NOT NULL DEFAULT 0 CHECK (report_count >= 0),
>   first_reported_at timestamptz NOT NULL, last_reported_at timestamptz NOT NULL,
>   closed_at timestamptz NULL,
>   CHECK ((state IN ('actioned','dismissed','moot')) = (closed_at IS NOT NULL))
> );
> CREATE UNIQUE INDEX ux_moderation_case_open ON moderation_case (target_type, target_id)
>   WHERE state IN ('open','investigating');                        -- 열린 케이스는 대상마다 하나(같은 페이지에 100건이 와도 하나)
>
> CREATE TABLE abuse_report (
>   id uuid PRIMARY KEY,
>   case_id uuid NOT NULL REFERENCES moderation_case(id),
>   target_type text NOT NULL CHECK (target_type IN ('page')), target_id uuid NOT NULL,
>   via_root_id uuid NULL,                                           -- 어느 게시 루트(토큰)로 들어와 신고했나 — 조치의 범위를 정할 때
>   reason text NOT NULL CHECK (reason IN ('phishing_spam','inappropriate','dmca','other')),
>   detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 2000),
>   reporter_hash text NULL,                                         -- HMAC(AUTH_SECRET, ip · ua) — 원문 IP 를 남기지 않는다
>   content_snapshot jsonb NOT NULL,                                 -- 신고 시점에 방문자가 본 것(제목 · 본문)
>   created_at timestamptz NOT NULL DEFAULT now()
> );
> ```
>
> ① **신고자는 주체가 아니다** — 공개 화면은 세션을 읽지 않으므로(공개 화면 ⑧) `reporter_user_id` 를 두지 않는다(17 은 NULL 허용으로
> 적었다 — 우리는 늘 NULL 이라 칸을 두지 않는다). 원문 IP · UA 도 남기지 않는다 — `AUTH_SECRET` 키의 HMAC 하나(`reporter_hash`)로
> 같은 사람의 반복만 알아본다(17 *"허위 신고 — fingerprint 별 정확도"* 의 재료).
>
> ② **신고는 공개 경로로만 들어온다** — 토큰 · 페이지 id 를 받아 공개 화면과 같은 판정(`resolvePublicPage`)을 지난 페이지만. 비공개
> 페이지는 신고할 길이 없다(17 *"비공개 페이지는 신고 버튼 자체가 없다"*). 만료된 링크도 신고할 수 없다(볼 수 없다).
>
> ③ **신고 시점 스냅샷** — 17 *"신고 접수 후 소유자가 내용을 수정 → 신고 시점 스냅샷을 첨부하지 않으면 검토가 불가능"*. 공개 화면이
> 그린 재료 그대로(제목 · 본문 문서 — 공개 밖은 이미 가려진 것)를 `content_snapshot` 에 남긴다. 256 KiB 를 넘으면 제목만 남기고
> `truncated: true`(오브젝트 저장소로 옮기는 것은 큐 화면과 함께).
>
> ④ **케이스는 대상마다 하나 열린다** — 신고가 오면 열린 케이스에 붙고(`report_count` · `last_reported_at`), 없으면 새로 연다(닫힌
> 케이스는 다시 열지 않는다 — 새 케이스다). 동시에 두 신고가 와도 하나(부분 UNIQUE + `ON CONFLICT`).
>
> ⑤ **신고만으로 내리지 않는다** — 17 *"자동 테이크다운 금지(사람 검토 필수)"*. 대상 페이지의 `moderation_state` 가 `none` ·
> `reinstated` 면 `reported` 로 바꾼다(큐를 좁히는 표지 — 공개 경로는 `reported` 를 연다 · [정정] 웹 게시 ③). `restricted` ·
> `taken_down` 은 건드리지 않는다.
>
> ⑥ **신고 자체가 공격 벡터다**(17 — 2021 대량 피싱 신고로 도메인 차단) — 레이트리밋 둘: 보내는 사람마다(`reporter_hash` — 모르면
> 한 통) 10분에 5건 · 대상 페이지마다 1시간에 30건. 넘으면 받지 않는다(429). 저장소(Valkey)가 죽으면 연다(로그인과 같은 fail-open
> — 신고를 막는 피해가 더 크다 · 로그를 남긴다).
>
> ⑦ 운영자에게 알리는 길은 서버 로그 한 줄(`[moderation] 새 신고 …`)이다 — 메일 · 메신저 연동은 운영 도구(6b-2)와 함께.
>
> ⑧ 사유의 DMCA 는 받되 공식 통지 절차를 안내한다(17 *"별도 DMCA 정책 페이지의 공식 통지 절차로 안내"*) — 화면의 일(6b-1b).
>
> ⑨ **[6b-1b] 신고 화면** — 공개 화면 아래의 "이 페이지 신고" → `/p/{token}/report`(하위면 `?page=`) — 공개 화면과 같은 판정으로 열고
> (열 수 없으면 404) 색인하지 않는다. **스크립트 없이 도는 HTML 폼**이 `/p/{token}/report/submit` 으로 보내고 303 으로 돌아온다(접수 ·
> 실패 까닭). 쓰기 경로 방어(F-17-10 의 최소): **같은 출처만**(`Origin` 이 있으면 이 서버의 것 — **[10n-78] "이 서버"는 요청이 닿은 주소 ·
> 설정한 공개 주소(`NEXT_PUBLIC_APP_URL`) · 더 받을 출처(`APP_ALLOWED_ORIGINS`)** — 프록시가 호스트 · 스킴을 바꾸는 배포 · 다른 사이트의 방문자를 시켜 신고를
> 퍼붓지 못하게) · **허니팟**(사람에게 보이지 않는 칸이 차 있으면 받은 척하고 남기지 않는다). 신고 화면의 referrer 는 `same-origin` 이다 —
> `no-referrer` 면 브라우저가 같은 출처 POST 에도 `Origin: null` 을 보낸다(Fetch 규격). 그 화면에서 나가는 링크는 같은 출처뿐이다.

**[보강] 모더레이션 조치 — 운영자는 주체가 아니다 · 조치는 쌓기만 한다** ⟨게시 · 공유 6b-2 · F-17-09 / 마이그레이션 0086⟩

> 17 F-17-09 클론 대안 *"운영자 콘솔 대신 관리자 CLI 1개(`takedown --page <id> --reason <code>`)로 시작 … L → M 이면서 법적 대응 능력은
> 확보된다"* 그대로다 — *"반드시 P1 인 부분은 테이크다운을 실행할 수 있는 경로와 `moderation_state` 축"*.
>
> ```sql
> CREATE TABLE moderation_action (
>   id uuid PRIMARY KEY,
>   case_id uuid NULL REFERENCES moderation_case(id),             -- 신고 없이 하는 조치(법적 요청 메일 등)도 있다
>   target_type text NOT NULL CHECK (target_type IN ('page')), target_id uuid NOT NULL,   -- FK 없음 — 파기돼도 이력은 남는다
>   workspace_id uuid NOT NULL REFERENCES workspace(id),
>   action text NOT NULL CHECK (action IN ('take_down','dismiss','reinstate')),
>   reason_code text NULL CHECK (reason_code IN ('phishing','malware','illegal','harassment','copyright','spam','other')),
>   note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
>   actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
>   created_at timestamptz NOT NULL DEFAULT now(),
>   CHECK ((action = 'take_down') = (reason_code IS NOT NULL))       -- 내리는 데는 까닭이 있다
> );
> -- append-only — 고치기 · 지우기를 트리거가 막는다(17 *"moderation_action 이력은 파기 대상에서 제외"*)
> ```
>
> ① **운영자는 워크스페이스의 주체가 아니다** — 조치 함수는 `SessionContext` 를 받지 않고(셋째 발급자를 만들지 않는다) HTTP 에서 부르지
> 않는다. 부르는 곳은 서버 셸의 운영자 명령 하나(`npm run moderation`)이고, 누가 했는지는 운영자가 적은 이름(`actor`)으로 남는다(17 은
> `staff_user` 를 말했다 — 콘솔이 생길 때). 워크스페이스 owner 는 모더레이션을 보지 못한다(17 *"owner 가 자기 워크스페이스 케이스를
> 보면 신고자가 노출된다"*).
>
> ② **테이크다운 = `moderation_state := 'taken_down'`** — `lifecycle` 은 건드리지 않는다(마스터 §9.4 · 17 §1.4). 공개 경로가 그 페이지와
> **그 아래 전체**를 닫는다([정정] 웹 게시 ③ 의 사슬 — 17 의 범위 `node` / `subtree` 는 이 모델에서 늘 서브트리다). 워크스페이스
> 안에서는 그대로 보이고 고쳐진다. 그 페이지의 열린 케이스는 `actioned` 로 닫힌다. 이미 내려져 있으면 `already`.
>
> ③ **기각 = 케이스를 `dismissed` 로 닫고** 그 페이지가 `reported` 였으면 `none` 으로 — 열린 케이스에만(`not_open`).
>
> ④ **복구 = `taken_down` · `restricted` → `reinstated`** — 공개 경로가 다시 연다(게시 · 정책 · 휴지통이 허락하면). 내려져 있지 않으면
> `not_moderated`.
>
> ⑤ **소유자가 안다** — 게시 상태(`PublishState.moderation`)가 그 페이지 또는 위 페이지가 내려졌는지 말하고, 공유 패널이 "운영 정책에
> 따라 웹 공개가 내려졌다" 를 보인다. 내려진 페이지를 다시 게시하면 `moderated` 로 거부한다(해제 · 다시 게시로 우회할 수 없다 —
> 상태가 블록에 있다). 인박스 알림은 활동 이벤트와 함께(§7).
>
> ⑥ **[6b-3a · 마이그레이션 0103] 워크스페이스 게시 차단** — 17 F-17-09 *"반복 위반 → 워크스페이스 단위 게시 차단(F-06-11 의
> `Disable publishing sites and forms` 를 운영자가 강제)"* · F-17-13 *"하위가 상위보다 더 허용적일 수 없다"* · Q14 *"잠금 해제 시 자동
> 재게시는 위험(의도치 않은 공개) — 수동 재게시 권고"*.
>
> ```sql
> ALTER TABLE workspace ADD COLUMN publishing_blocked_at timestamptz NULL;   -- 운영자의 잠금 — 비면 없다
> -- moderation_action: target_type IN ('page','workspace') · action 에 'block_publishing' · 'unblock_publishing' 를 더한다
> --   CHECK ((target_type = 'workspace') = (action IN ('block_publishing','unblock_publishing')))   -- 대상과 조치가 맞는다
> --   CHECK ((action IN ('take_down','block_publishing')) = (reason_code IS NOT NULL))              -- 막는 데는 까닭이 있다
> ```
>
>   · **잠금은 워크스페이스 행에** — 소유자의 설정(`security_policy.allow_publish_sites_and_forms`)과 따로 둔다. 소유자가 쓰는 길(설정)은
>     이 칸에 닿지 않는다 — 설정으로 되돌릴 수 없다. 쓰는 것은 운영자 명령뿐이다(`blockWorkspacePublishing` · `unblockWorkspacePublishing` ·
>     서버 셸 — ①)
>   · **효과 정책은 둘의 곱** — `allowPublish = 설정 AND 잠금 없음`. 판정 한 곳(`readSecurityPolicyIn` — 설정 값 `allowPublishSetting` 과
>     잠금 `publishingBlocked` 도 함께 낸다)과 공개 경로의 SQL 두 곳(공개 화면 · 이동 미리보기)이 같은 조건이다. 그래서 게시 · 웹 공개 폼 ·
>     공개 화면 · 공개 폼 화면이 모두 함께 닫힌다. 막힌 동안 새로 게시하거나 폼을 웹에 열면 `publishing_blocked`(소유자 정책의
>     `policy_disabled` 와 가른다 — 화면이 "운영 정책" 이라고 말한다). 워크스페이스 멤버만의 폼(§3.6 [보강] 폼 ⑨ — 밖으로 내보내는 것이
>     아니다)은 그대로 열고 받는다. 설정 화면은 소유자의 설정 값을 그대로 보인다(잠금이 설정을 바꾸지 않는다)
>   · **막을 때 지금 열린 것을 내린다** — 그 워크스페이스의 켜진 공개 링크를 모두 끄고(`enabled := false` · 토큰 · 검색 엔진 · 슬러그는
>     남는다 — 다시 게시하면 같은 주소) 웹 공개 폼을 닫는다(`access := 'closed'` · 토큰은 남는다). 한 트랜잭션에서 잠금 · 조치 한 줄과
>     함께. 몇 개를 내렸는지 운영자 명령이 말한다
>   · **풀어도 다시 열지 않는다** — 해제는 잠금만 지운다. 내린 게시 · 폼은 소유자가 다시 연다(Q14). 막을 때 내리는 까닭이 이것이다 —
>     잠금만 걸고 링크를 켜 둔 채면 풀 때 저절로 다시 열린다
>   · 이미 막혀 있으면 `already` · 막혀 있지 않은데 풀면 `not_blocked` · 지운 워크스페이스는 `not_found`. 소유자에게 보이는 것(설정 ·
>     공유 패널 · 폼 편집 화면의 "운영 정책에 따라 막혔다")은 6b-3b
>
> ⑦ **[6b-3b] 소유자가 안다 — 세 화면이 "운영 정책" 이라고 말한다** — 운영자는 주체가 아니므로 소유자의 감사 로그 · 인박스에 남기지
> 않는다(①). 대신 게시를 다루는 화면 셋이 막힌 것을 말한다(⑤ 의 페이지 테이크다운과 같은 길).
>   · **설정 → 보안의 "웹 게시" 줄** — 토글은 소유자의 설정 값 그대로 · 고칠 수 있는 채로 둔다(풀리면 그 값이 다시 정책이 된다). 그 줄
>     아래에 "운영 정책에 따라 웹 게시가 막혔다 — 설정으로 풀 수 없다" 한 줄. 설정 항목이 안내 한 줄(`notice`)을 싣는 일반 칸을 얻었다 —
>     값과 함께 서버가 읽는다
>   · **공유 패널의 웹 게시 절** — 게시 상태가 잠금을 싣는다(`PublishState.publishingBlocked`) · 소유자 정책의 "정책이 막았다" 대신
>     "운영 정책에 따라 막혔다 — 게시한 페이지는 내려졌다" · 게시 단추는 서지 않는다(정책이 막았을 때와 같다)
>   · **폼 편집 화면의 공유 절** — 폼 읽기가 잠금을 싣는다(`FormDetail.publishingBlocked`) · 같은 한 줄 · "웹 공개" 는 고를 수 없고
>     "워크스페이스 멤버만" 은 그대로 고른다(⑥)

---

### 3.4 블록 트리 ⟨C-1/V-4 · C-3/V-6 · C-9/V-9 · C-10 · X-1 · X-3 · X-7⟩

```sql
-- 모든 콘텐츠의 단일 테이블. 페이지도 블록이고(type='page'),
-- 데이터베이스 행도 블록이다(type='page' AND parent_type='data_source').
CREATE TABLE block (
  id            uuid PRIMARY KEY,            -- v4, 클라이언트 생성(오프라인/낙관적 업데이트)
  workspace_id  uuid NOT NULL REFERENCES workspace(id),
  type          text NOT NULL,               -- 'page'|'paragraph'|'heading_1'|'column'|'button'|...

  -- 트리 <C-9, C-10>
  parent_type   block_parent_type NOT NULL,
  parent_id     uuid NOT NULL,               -- 다형 참조. DB FK 불가 -> 트리거/앱으로 강제
                                             --   'block'       -> block(id)
                                             --   'data_source' -> data_source(id)
                                             --   'teamspace'   -> teamspace(id)
                                             --   'workspace'   -> workspace(id)
  order_key     text NOT NULL,               -- fractional index. 형제 정렬의 유일한 축.
                                             -- [X-1] parent_type='block' 이면 Y.Doc 에서 파생되는
                                             --       읽기 모델이다(프로젝터만 쓴다).
                                             --       그 외 3값이면 이 컬럼이 정본이다.
  ancestor_path uuid[] NOT NULL DEFAULT '{}',-- 루트->parent 까지의 block id 순서 배열.
                                             -- [X-7] permission 이 요구한 `path text` 를 대체한다.
  owner_user_id uuid NULL,                   -- parent_type='workspace' 인 Private 루트일 때만 NOT NULL
  perm_scope_id uuid NOT NULL,               -- <C-8부속> 권한 재귀 종료점 + 검색 필터 키

  -- 내용 (parent_type='block' 인 비페이지 블록에서는 Y.Doc 파생 [X-1])
  properties    jsonb NOT NULL DEFAULT '{}', -- { title: RichText[], checked, language, ... }
  format        jsonb NOT NULL DEFAULT '{}', -- { block_color, code_wrap, column_ratio, ... }

  -- 수명주기 <C-1> [X-3: type='page' 인 블록에서만 'live' 이외의 값을 가진다]
  lifecycle     block_lifecycle NOT NULL DEFAULT 'live',
  trashed_at    timestamptz NULL,
  trashed_by    uuid NULL,
  trash_root_id uuid NULL,                   -- 삭제 조작이 일어난 조상 id. 복원 범위의 유일한 근거
  trash_reason  text NOT NULL DEFAULT 'user' -- <15 R5>
                CHECK (trash_reason IN ('user','source_deleted','source_out_of_scope')),
  purge_after   timestamptz NULL,            -- trashed_at + workspace.trash_days
  purged_at     timestamptz NULL,

  -- 거버넌스 <17 1.4> lifecycle 과 직교
  moderation_state moderation_state NOT NULL DEFAULT 'none',
  public_exposure  boolean NOT NULL DEFAULT false,  -- 파생. 모더레이션 큐 대상 집합을 좁힌다

  -- 감사 / 동시성
  created_by    uuid NULL,                   -- <17 F-17-10> 익명 폼 제출 행은 NULL
  created_at    timestamptz NOT NULL,
  last_edited_by uuid NULL, last_edited_at timestamptz NOT NULL,
  version       bigint NOT NULL DEFAULT 0,   -- [X-6] 페이지 단위 단조 변경 카운터.
                                             -- 프로젝터 배치 + 셀 쓰기 + 구조 변경이 함께 올린다.
                                             -- search_document.version 의 소스.
  CONSTRAINT ck_private_root CHECK (owner_user_id IS NULL OR parent_type = 'workspace'),
  CONSTRAINT ck_lifecycle_page CHECK (type = 'page' OR lifecycle = 'live'),          -- [X-3]
  CONSTRAINT ck_lifecycle_ts CHECK (
       (lifecycle='live'    AND trashed_at IS NULL     AND purged_at IS NULL)
    OR (lifecycle='trashed' AND trashed_at IS NOT NULL AND purged_at IS NULL AND trash_root_id IS NOT NULL)
    OR (lifecycle='purged'  AND trashed_at IS NOT NULL AND purged_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_block_sibling_order ON block (parent_id, order_key);
CREATE INDEX ix_block_children_live ON block (parent_id, order_key) WHERE lifecycle = 'live';
CREATE INDEX ix_block_trash        ON block (workspace_id, trashed_at DESC)
                                   WHERE lifecycle = 'trashed' AND type = 'page';
CREATE INDEX ix_block_purge_due    ON block (purge_after) WHERE lifecycle = 'trashed';
CREATE INDEX ix_block_hard_del_due ON block (purged_at)   WHERE lifecycle = 'purged';
CREATE INDEX ix_block_ancestor     ON block USING gin (ancestor_path);
CREATE INDEX ix_block_perm_scope   ON block (workspace_id, perm_scope_id);
CREATE INDEX ix_block_moderation   ON block (workspace_id, moderation_state)
                                   WHERE moderation_state <> 'none';

-- 모든 일반 조회는 이 뷰만 본다. 개별 쿼리에서 lifecycle 조건을 빼먹는 것이 1순위 버그다.
CREATE VIEW live_block AS SELECT * FROM block WHERE lifecycle = 'live';
```

**block 관련 불변식**

| # | 불변식 | 근거 |
|---|---|---|
| B1 | 모든 블록은 parent 를 정확히 하나 가진다. 재귀 종료는 `parent_type ∈ {teamspace, workspace}`. `data_source` 는 종료가 아니라 **경유**(→ 부모 database 블록 → 계속 상향) | C-9 |
| B2 | 삭제 시 `parent_id`·`order_key` 를 **절대 변경하지 않는다**. 원위치 복원이 공짜가 된다 → `trash_entry` 테이블은 존재하지 않는다 | C-1 |
| B3 | 복원 범위 = 대상 + `trash_root_id` 가 대상 id 인 자손만. 먼저 독립적으로 버려진 자손은 `trashed` 유지 | C-1 |
| B4 | 조상이 `purged` 인 노드를 복원하면 **복원 실행자의 Private 루트**로 재부모화하고 배너 고지. 조용히 실패시키지 않는다 | C-1 |
| B5 | `lifecycle` 전파는 **`type='page'` 인 자손에만** 적용된다. 비페이지 블록은 소속 Y.Doc 안에 있으므로 건드리지 않는다 | **X-3** |
| B6 | `content uuid[]` 컬럼은 존재하지 않는다. 자식 목록은 `parent_id` 인덱스로 재구성하고 순서는 `order_key` 가 준다. API 응답에서만 배열로 직렬화 | C-10 |
| B7 | 결정적 정렬은 `ORDER BY order_key, id`. `ORDER_KEY_MAX_LEN=32` 초과 시 형제 전체 재균형(유휴 배치) | C-10 |
| B8 | `block.space_id` 컬럼은 존재하지 않는다. teamspace 소속은 `ancestor_path` 상의 teamspace 노드로 해석한다 | C-9 |
| B9 | 외부 origin 행의 **본문 블록은 언제나 native** 다. block 에 `origin` 컬럼을 두지 않는다(negative requirement) | 15 R4 |
| B10 | `is_alive`/`alive`/`archived`/`deleted_at`/`position`/`order_idx`(형제 순서 용도)/`path` 컬럼은 존재하지 않는다 | C-1, C-10, X-7 |

**[보강] 코드 블록(`type='code'`)의 저장 모양** ⟨잔여 묶음 8a-1 ①~③ · 8a-2 ④~⑧ · 8a-3 ⑨ · 플랫폼 잔여 10k-1 · 10k-2 · 10k-3 ⑩ · F-01-14 · F-01-22⟩

> 초판은 `properties` 주석에 `language`, `format` 주석에 `code_wrap` 만 적었다. 01 F-01-14 *"공개 API 페이로드: `rich_text[]`(코드
> 본문), `language`, `caption[]`. 자식 블록 불가"* · 데이터 모델 함의 *"`language` 는 enum 이 아니라 문자열로 저장"*.
>
> ① `properties.title` = 코드 본문 — **서식 · 멘션 · 수식이 없는 평문 런**이다(줄바꿈은 글자 `\n`). 다른 블록에서 코드로 바꾸면
> 서식을 버리고 멘션 · 수식은 보이는 글자로 편다. `properties.language` = 문자열(없으면 plain text) — 지원 목록 밖의 값도 **그대로
> 보존**한다(표시만 plain text). `properties.caption` = RichText[](8a-2). `format.code_wrap` = boolean(8a-2). 색(`block_color`)은
> 없다 · 자식은 없다.
> ② **Y.Doc 의 요소 이름은 `code_block` 이다** — 블록 타입 이름(`code`)이 인라인 서식 마크 `code` 와 겹쳐 ProseMirror 스키마가 같은
> 이름의 노드를 받지 않는다. 블록 타입 `page` ↔ 노드 `page_ref` 와 같은 사상이다. 요소 이름은 저장 포맷이므로(§3.7 · `ydoc.ts`)
> 바꾸려면 마이그레이션이다. `block.type` 은 `code` 다(공개 API 와 같은 이름).
> ③ 편집 규칙은 레지스트리 항목(`plainText`)이 끈다 — Enter 는 줄바꿈, Tab 은 들여쓰기 글자, 마크다운 입력 규칙 · `/` · `@` · 서식은
> 꺼진다, 붙여넣기는 평문. 블록 타입 이름으로 분기하지 않는다(01 F-01-14 *"컨텍스트 분기가 4개 기능에 침투"* — 분기를 한 곳에 둔다).
> ④ **[8a-2] `language` 의 저장값은 노션 공개 API 의 이름 그대로다** — 엔드포인트 레퍼런스의 OpenAPI `languageRequest`(= 공식 SDK
> `LanguageRequest`)의 90개, 소문자 · 공백 · 기호 포함(`'c++'` · `'plain text'` · `'java/c/c++/c#'`). Block object 레퍼런스의 표
> (72개)는 2021-11 에서 멈춰 낡았다. `'plain text'` 는 저장하지 않는다(키가 없다 = plain text). 목록 밖의 값은 보존하고 화면은 원문을
> 라벨로 쓴다 — 목록은 고르는 화면과 라벨의 것이지 검증의 것이 아니다(01 F-01-14 는 *"20종으로 시작"* 을 권했지만 목록을 줄이면
> 가져온 값이 목록 밖으로 떨어질 뿐 얻는 것이 없다). 저장 API 는 문자열이 아니거나(null 포함) 비었거나 64자를 넘는 값을 거부한다(⑧ 과
> 같은 문 — 받은 뒤 읽을 때마다 고쳐 쓰지 않게).
> ⑤ **[8a-2] `caption` 은 RichText[] — 화면은 평문으로 고친다.** 여러 줄이다(줄바꿈은 글자다). 2000자마다 런을 나눈다 — **자르지
> 않는다**(받은 캡션은 더 길 수 있다 · 입력칸은 친 글자만 2000자로 막는다). 글자가 바뀌지 않았으면 쓰지 않는다 — 앞뒤 공백만 다른 것도
> 같다. 받은 서식 · 링크 · 멘션을 지키고, 고치면 평문이 된다고 먼저 말한다. 화면은 **연 순간의 글자**와 비교해 사용자가 고쳤을 때만
> 쓴다 — 연 뒤에 다른 참여자가 바꾼 캡션을 열고 닫기만 해서 되돌리지 않는다. 비우면 키를 지운다.
> ⑥ **[8a-2] `format.code_wrap` 은 켜졌을 때 `true` 로만 있다** — 끄면 키를 지운다. 평문 본문 타입(코드)이 아니면 버린다(코드를
> 문단으로 바꾸면 사라진다 · `normalizeFormat`).
> ⑦ **[8a-2] `props` · `format` 은 Y.Doc 요소의 attr 하나다(객체 통째)** — 한 블록의 언어와 캡션을 두 사람이 동시에 고치면 한쪽이
> 진다(이기는 쪽은 시각이 아니라 Yjs 맵 키 규칙이 정한다). 01 F-01-14 의 *"`language`/`wrap` 은 LWW"* 보다 넓은 단위지만, 키마다 attr 을
> 가르면 옛 클라이언트의 `updateYFragment` 가 모르는 attr 을 지운다 — 받아들인다.
> ⑧ **[8a-2] 본문을 읽을 때 attr 을 정화한다**(정규화 — 협업 참여자는 검증을 거치지 않고 Y attr 에 lib0 이 인코딩하는 무엇이든 쓸 수
> 있다). 모양이 틀린 캡션 하나(원소가 객체가 아니거나 `plain_text` 가 문자열이 아닌 런)가 그 페이지의 투영 · 색인 · 복제를 **영구히**
> 멈췄다(로그는 지우지 않는다 — S1). bigint 하나도 같다(행에 쓰는 JSON 직렬화가 던진다). 규칙 — 정규화는 **던지지 않는다**:
>   · JSON 으로 나타낼 수 없는 값(bigint · 바이트 배열 · 공유 타입 · NaN …)은 뺀다 — 모든 타입의 `props` · `format`(하위 페이지 참조 ·
>     `unsupported` 도: 행이 jsonb 라 어차피 보존할 수 없다). 평범한 객체가 아닌 `props` · `format` 은 빈 객체(`invalid_attrs_reset`)
>   · 글자 · 문자열 attr · 키의 U+0000 은 U+FFFD 로(`nul_replaced` — JSON 은 나타내지만 jsonb 가 거부해 투영이 영구히 멈췄다)
>   · `caption`(이미지 · 코드): 배열이 아니면 키를 지운다. 계약(`validateRichText`)을 어긴 런은 **글자를 살린다**(서식 없는 글자 런 ·
>     2000자 단위) — 살릴 글자가 없으면 뺀다. 남은 런의 `plain_text` 는 다시 계산한다(응답 전용 파생값이다). 빈 배열은 그대로
>   · `language`(코드): 문자열이 아니거나 비었거나 64자를 넘으면 지운다. `format`: `normalizeFormat`(타입이 받지 않는 색 · ⑥)
>   · 인라인 원자: 식이 문자열이 아닌 수식 · 대상이 평범한 객체가 아닌 멘션은 뺀다. 멘션의 보이는 글자가 문자열이 아니면 비운다.
>     서식의 거울(`marks` attr)은 되살린 마크에서 다시 만든다 — 읽기가 원본 Y 값(공유 타입 · 하위 문서 · bigint)을 그대로 실어 편집기의
>     마크 비교가 던지고 수선의 비교가 스택을 넘겼다(`invalid_inline_fixed`)
>   · 하위 페이지 참조 · `unsupported` 의 그 밖의 속성은 건드리지 않는다(보존)
> 고친 것은 수선이 Y.Doc 에 써 모두에게 퍼진다 — **null 만 다른 차이(`[null]` → `[]` · `{language: null}` → `{}`)도 쓴다**
> (y-prosemirror 의 비교가 null 을 "없음"으로 세어 보지 못하므로 따로 맞춘다). **저장 API 는 이 정화가 고칠 값을 Y.Doc 에 쓰지
> 않는다** — 계약을 어긴 값은 거부하고(④ · 캡션은 런마다 계약 · 읽기가 잘라 낼 만큼 깊은(32단계) 속성), 계약 안의 값은 쓰기 전에 같은
> 정규형으로 고친다(요청 모양 런의 `plain_text` 를 다시 계산 · U+0000). 그러지 않으면 같은 본문을 저장할 때마다 수선이 고쳐 써 로그가
> 자랐다.
> ⑨ **[8a-3] 문법 강조는 저장하지 않는다** — 보는 사람의 화면에만 있다(편집기의 데코레이션). `properties.title` 은 ① 그대로 서식 없는
> 평문 런이고, Y.Doc · `doc_update` · 행 · 색인 · 내보내기 어디에도 색이 들어가지 않는다. 저장값(④ 의 이름) → 칠할 문법의 표는 코드에
> 둔다(`editor/code-grammars.ts` — 01 F-01-14 *"지원 목록은 코드 레지스트리에"*): 하이라이터를 바꾸거나 문법을 더해도 마이그레이션이
> 없다. **목록 밖의 값 · plain text · 문법이 없는 언어는 칠하지 않는다**(보존한 값은 라벨처럼 원문 그대로 둔다 — 별칭으로 어림하지
> 않는다).
> ⑩ **[10k-1] 큰 코드의 글자는 조각으로 그린다 — 50줄 · 4,000자(`PIECE_LINES` · `PIECE_MAX_CHARS`)** — 저장 모양이 아니라 화면이다(⑨ 와
> 같은 자리 · 데코레이션). 편집 영역 안에서 글자 하나를 치면 브라우저가 접근성 트리를 다시 직렬화하고, 그 비용은 **가장 큰 글자 노드의
> 크기**에 비례한다 — 그 노드를 건드리지 않아도(앱 밖에서 쟀다 — 1만 줄 노드 하나는 한 글자에 0.5 ~ 1.9초 · 50줄 조각이면 45 ~ 80ms ·
> 줄마다 노드(1만 개)면 다시 0.3 ~ 0.5초 — 노드 수도 비용이다). 조각은 속성 없는 인라인 데코레이션 — PM 이 경계에서 글자 노드만 가르고
> `span` 을 만들지 않아 모양 · CSS 가 그대로다. **줄 머리에서만** 가른다(글자 가운데를 가르면 그 앞에서 치는 동안 뒤의 조각이 모두 한 글자씩
> 밀려 다시 쓰인다 — 줄 머리는 그 줄 위에서 치는 동안 움직이지 않는다) · 한 줄이 상한보다 길면 그 줄이 한 조각이다(압축 코드 — 자르지
> 않고 받아들인다) · 문법 · 창과 상관없이 가른다(plain text 의 1만 줄도 같은 비용이다). 01 F-01-22 의 *"가상 스크롤보다 `content-visibility:
> auto` 를 먼저"* 는 그리기 비용의 처방이고 이것은 접근성 트리의 처방이다 — 다른 비용이다. **[10k-2] 그리기도 쟀다** — 문단 2,000 · 3,000 ·
> 코드 1만 줄 페이지의 열기(FCP 0.75~0.9초) · 스크롤(50ms 초과 작업 0)은 괜찬다. 수천 블록의 **입력**은 글자마다 0.5~1초인데 그것은
> **브라우저 프로세스의 접근성 처리**(`BrowserAccessibilityManager::OnAccessibilityEvents` · 블록 수에 비례 · 보조 기술이 붙은 사용자에게만)라
> 화면 쪽 처방이 없다. `content-visibility: auto` 는 그 입력을 3~5배 줄이지만 스크롤의 주 스레드를 8~12배 무겁게 하고(IntersectionObserver)
> 코드 페이지의 첫 그리기를 4배 늦춘다 → **넣지 않는다**(HANDOFF §3.2-258). 처방은 편집기에 한 번에 올리는 블록을 줄이는 부분 로드(01 F-01-22
> 의 큰 그림) 또는 블록 상한이다. **[10k-3] 조각의 머리는 움직이지 않는다** — 글자마다 처음부터 다시 가르면 줄을 넣을 때 뒤의 모든 조각이 한
> 줄씩 밀려 다시 쓰인다(Enter 한 번에 조각 190개 · 접근성이 모두 다시 읽는다). 지난 머리를 트랜잭션으로 옮겨 쓰고(줄 머리에 남아 있으면 그대로 ·
> 줄바꿈이 지워지면 앞 조각과 합침), 상한의 **2배**를 넘는 조각만 그 자리에서 다시 가른다. **조각을 블록 상자(`display: block`)로 두는 것은
> 시도했다가 뺐다** — 앱 밖에서는 레이아웃이 조각 안에 갇혔지만(54 → 2ms), 편집기에서는 입력만 좋아지고 스크롤 · Enter 가 더 나빠졌다(HANDOFF
> §3.3-459). 까닭은 PM 의 자리 맞춤이다 — 코드 본문이 PM 글자 노드 하나라 끝맞춤(노드 동일성)이 조각에 걸리지 않고 앞맞춤은 다음 5개만 보므로,
> **칠하는 창 안에서 노드 수가 늘면(창 이동 · 창 안의 Enter) 그 뒤의 모든 조각이 자리로 덧쓰인다.** 블록 조각은 그 덧쓰기를 조각마다 따로
> 레이아웃해 더 비싸게 했다. 이 비용은 조각이 못 고친다 — 고치려면 PM 쪽이거나 코드 본문을 줄 노드로 가르는 스키마(저장 포맷 — 마이그레이션)다.
> 받아들인다(HANDOFF §7).

**[보강] 목차(`type='table_of_contents'`)의 저장 모양** ⟨잔여 묶음 8b-1 · F-01-16⟩

> 01 F-01-16 *"공개 API: `table_of_contents` 는 페이로드가 `color` 뿐 … **콘텐츠를 저장하지 않는다**는 사실이 스키마로 확인된다"* ·
> *"렌더러가 같은 페이지의 heading 블록을 조회해 파생 … 서버 렌더/내보내기에서도 동일 계산 필요"*.
>
> ① **내용을 저장하지 않는다** — `properties` 는 비었다(`title` 없음 · API 로 실어 보내도 행 · Y.Doc 에 남지 않는다). `format.block_color` 만
> 있다(목차는 색을 받는다). 자식은 없다. Y.Doc 의 요소 이름은 타입 이름 그대로 `table_of_contents`(원자 노드).
> ② **줄은 그릴 때 이 페이지의 헤딩에서 계산한다** — 편집기와 Markdown 내보내기가 같은 규칙을 쓴다(`block/toc.ts`). 01 이
> `[확인필요]` 로 남긴 수집 범위를 정했다: 본문의 **모든 헤딩**(제목 1~3)을 깊이와 상관없이(토글 · 목록 · 콜아웃 안도) 문서 순서로 ·
> 접힌 토글 안도(접힘은 보는 사람의 상태다) · 하위 페이지의 본문은 아니다 · **글자가 없는 헤딩은 뺀다**(멘션 · 수식만 있는 헤딩은
> 남긴다) · 들여쓰기는 **쓰인 수준의 순위**(제목 1 없이 제목 3 만 있으면 맨 왼쪽 — 01 *"최상위 레벨로 평탄화"*).
> ③ 항목의 자리는 **블록 id** 다(같은 제목이 여럿이어도 갈린다) — 주소는 블록 링크와 같은 `#{blockId}`. 저장된 참조가 없으므로 헤딩이
> 지워지면 다음 그리기에서 빠진다 · 동시 편집의 충돌이 없다.
> ④ Markdown 내보내기는 같은 계산으로 **정적 목록**을 쓴다 — 헤딩의 글자만(앵커 링크는 렌더러마다 규칙이 달라 달지 않는다).
> 블록 복사의 평문에는 줄을 남기지 않는다(고른 블록만으로는 페이지의 헤딩을 모를 수 있다).
> ⑤ **[T-1] 스크롤 스파이** ⟨목차의 나머지 트랙 T-1 / 마이그레이션 없음 · 화면만⟩ — 01 F-01-16 `[확인필요]` 의 "지금 위치의 헤딩 강조". 편집기의
> 목차는 **기준선**(창 위에서 높이의 30% · 160px 를 넘지 않는다 — 고정된 상단 바 아래)을 지난 **마지막 헤딩**의 항목을 현재 위치로 표시한다
> (`aria-current="location"` — 화면 읽기 프로그램이 "현재 위치" 로 읽는다). 아직 아무 헤딩도 기준선을 지나지 않았으면 표시가 없다 · 접힌
> 토글 안의 헤딩(그려지지 않았다)은 건너뛴다. 판정은 순수 함수(`currentTocIndex` — 헤딩들의 위쪽 끝 · 기준선)이고, 노드 뷰가 스크롤 · 창
> 크기 바꿈을 한 프레임에 한 번 묶어 다시 센다. 문서를 바꾸지 않는다(읽기 전용에서도 된다). 공개 화면은 브라우저 스크립트가 없어 표시도 없다.

**[보강] breadcrumb(`type='breadcrumb'`)의 저장 모양** ⟨잔여 묶음 8b-2 · F-01-16⟩

> 01 F-01-16 *"`breadcrumb` 와 `divider` 는 빈 객체 `{}`"* · *"`/breadcrumb` 삽입 → 페이지의 조상 경로가 링크로 표시"* · *"권한 없음 —
> breadcrumb 의 조상 페이지에 접근 불가 → 제목 숨김 처리"*.
>
> ① **내용을 저장하지 않는다** — `properties` 는 비었고 **색도 없다**(API 의 페이로드가 `{}` — `block_color` 가 와도 버린다). 자식은 없다.
> Y.Doc 의 요소 이름은 타입 이름 그대로 `breadcrumb`(원자 노드).
> ② **경로는 그릴 때 페이지 머리의 breadcrumb 과 같은 데이터로** — 워크스페이스 · (teamspace) · 볼 수 있는 조상 · 지금 페이지
> (`block/breadcrumb.ts` — 머리와 블록이 같은 함수를 지난다). 경로는 **보는 사람마다 다르다** — 그래서 Y.Doc 에 넣지 않는다(넣으면 한
> 사람의 권한으로 거른 경로가 협업 참여자에게 퍼진다).
> ③ 권한 — 01 의 *"제목 숨김"* 대신 **볼 수 없는 조상을 건너뛴다**(이미 내린 판결 HANDOFF §3.3-100 · #76 — 자리 표시를 두면 위에 무엇이
> 있다는 것과 그 개수를 알려 준다 · 사이드바가 같은 페이지를 가장 가까운 볼 수 있는 조상 밑에 둔다). teamspace 는 멤버에게만
> (§3.3-194 · #120).
> ④ Markdown 내보내기 · 블록 복사의 평문은 **아무것도 쓰지 않는다** — 내보내기는 ZIP 의 폴더 구조가 곧 경로이고 렌더러는 조상의 제목을
> 모른다. 저장된 내용이 없으므로 잃은 것으로 세지 않는다.

**[보강] 블록 수식(`type='equation'`)의 저장 모양 · 인라인 수식** ⟨Phase 2 1a ①~⑧ · 1b ⑨~⑪ · F-01-20⟩

> 01 F-01-20 *"블록: `type='equation'`, 페이로드는 `expression`(KaTeX 문자열) 하나뿐. `rich_text` 없음, 자식 없음, `color` 없음"* ·
> *"저장은 원문 문자열만 한다. 렌더 결과(HTML/MathML)를 저장하면 KaTeX 버전 업그레이드 때 전 페이지 마이그레이션이 필요해진다"* ·
> *"`trust: false`(기본값)를 유지 … `maxExpand` 및 `maxSize` 유지"*.
>
> ① `properties.expression` = KaTeX 문자열 하나(1000자 — 공개 API 의 상한 · JS 문자열 길이). **비면 키가 없다**(화면은 "수식을 입력하세요").
> 색 · 자식 · rich text 는 없다(`block_color` 가 와도 버린다). 행(투영)의 `properties` 는 `{ expression }` 뿐이다.
> ② **Y.Doc 의 요소 이름은 `equation_block`** — 인라인 수식의 노드가 이미 `equation` 이다(rich text 의 원자 · 3b조각). 코드 블록의
> `code_block` 과 같은 사상이다. **저장 포맷이라 바꾸면 마이그레이션이다.**
> ③ **렌더 결과는 어디에도 저장하지 않는다**(Y.Doc · 행 · 색인) — 그리는 쪽이 매번 그린다. 렌더 캐시가 필요해지면 따로 버릴 수 있는 표로.
> ④ 읽을 때 정화한다(정본 §3.4 [보강] 코드 블록 ⑧ 과 같은 자리) — 문자열이 아니거나 공백뿐이면 키를 지우고, 상한을 넘으면 자른다
> (서로게이트 쌍을 가르지 않는다). 지우지 않고 자르는 까닭: 넘는 것은 입력칸을 거치지 않은 쓰기뿐이고, 지우면 쓴 식을 통째로 잃는다.
> ⑤ 그리기는 KaTeX — `trust: false` · `maxExpand` · `maxSize` · `strict` 를 **고정**한다. 틀린 식은 저장을 유지하고 원문을 붉게 보이며
> 까닭을 함께 보인다(블록을 날리지 않는다). mhchem(`\ce` · `\pu`)은 그 식이 쓸 때 불러 온다.
> ⑥ 검색 색인에 식을 넣지 않는다(본문 검색을 더럽히지 않는다 — F-01-20 이 권하는 별도 필드는 색인이 그 축을 가질 때).
> ⑦ Markdown 내보내기 · 블록 복사의 평문은 `$$` 울타리(빈 줄은 뺀다 — 마크다운의 문단을 끊는다). 가져오기는 **문단이 통째로
> `$$ … $$`** 일 때만 블록 수식으로 되읽는다 — 왕복이 닫힌다.
> ⑧ 동시 편집은 props 통째 LWW(정본 [보강] 코드 블록 ⑦ 과 같다) — 입력창은 **저장할 때 한 번** 쓴다(글자마다 Y.Doc 을 쓰지 않는다 ·
> 미리보기는 입력창 안).
>
> **인라인 수식(1b)** — 저장 모양은 rich text 의 `type='equation'` 조각(3b 부터 · Y.Doc 의 원자 노드 `equation` · 서식은 마크와 그 거울 attr).
> ⑨ **빈 인라인 수식은 편집기가 지운다** — 비워 저장하면 그 조각을 지우고, 새로 넣은 빈 수식을 저장하지 않고 닫으면 지운다(F-01-20
> *"인라인 빈 수식은 저장 전 제거"*). **저장 모양은 빈 식을 받는다** — 정규화가 지우면 입력창이 막 넣은 빈 수식을 서버의 수선이 지워
> 입력창이 대상을 잃는다. 그리는 쪽은 "빈 수식" 자리 표시.
> ⑩ 인라인 수식에는 id 가 없다 — 고칠 대상은 **(블록 id, 그 블록 안 수식의 순번)** 으로 가리킨다(위치는 협업 바인딩이 원격 변경을
> 문서 통째 교체로 적용할 때 잃는다). 순번은 수식끼리만 센다.
> ⑪ Markdown — 내보내기는 코드 스팬 안의 `$식$`(식 안의 `*` · `_` 를 강조로 읽지 않게 · 8m 이전부터), 가져오기는 그것과 노션의 `$식$` ·
> `$$식$$`. `$` 하나짜리는 pandoc 의 규칙으로만(여는 `$` 뒤 · 닫는 `$` 앞이 공백이 아니고 닫는 `$` 뒤가 숫자가 아니다 — `$5 와 $10` 은
> 글자) · 렉서의 확장으로 강조보다 먼저 떼어 낸다. 상한(1000자)은 블록 수식과 같다.

**[보강] 컬럼(`type='column_list'` · `type='column'`)의 저장 모양** ⟨Phase 2 1c-1 ①~⑤ · 1c-2 ⑥⑦ · 1c-3 ⑧⑨ · F-01-12⟩

> 01 F-01-12 *"구조: `column_list`(자식은 `column`만) → `column`(자식은 임의 블록). 2계층 고정"* · *"컬럼이 1개만 남음 → `column_list`를
> 해제하고 자식을 부모로 승격 — 자동 정리 로직 필수"* · *"중첩 — 컬럼 안에 또 다른 column_list: 스키마로 명시 필요(권장: 금지)"* ·
> *"마크다운/HTML 내보내기: 컬럼은 표현 불가 → 순차 나열로 평탄화"*.
>
> ① 둘 다 **보통의 블록 행**이다(C-3 · 새 표 없음) — 페이지 → `column_list` → `column` → 블록의 부모 사슬. 글 · 색이 없고(`properties` ·
> `format` 은 빈 객체 — 폭 `format.column_ratio` 는 1c-2) Y.Doc 의 요소 이름은 타입 이름 그대로(내용 노드는 고를 수 없는 원자 — 화면에
> 보이지 않는 껍데기다). **배치 타입**이라 본문 타입 목록 밖이다 — `/` 블록 · 바꾸기 · 입력 규칙에 서지 않고 `/2열` · `/3열` 이 틀째로 만든다.
> ② 구조의 규칙은 레지스트리의 칸이다 — 컬럼 목록의 자식은 컬럼뿐(`childTypes`) · 컬럼은 컬럼 목록 안에만(`parentTypes`) · 컬럼 바로 안의
> 컬럼 목록은 없다(`excludedChildTypes` — 깊은 곳(토글 안)은 막지 않는다) · 컬럼은 둘 이상 · 컬럼에는 블록이 하나 이상.
> ③ **읽을 때 고친다**(정규화 ④ · 결정론 · 잃지 않음 · 두 번 돌려도 같다) — 컬럼 목록 밖의 컬럼은 풀어 자식을 그 자리에 · 컬럼 바로 안의
> 컬럼 목록은 편다 · 컬럼이 아닌 자식은 앞 컬럼의 끝(앞이 없으면 뒤 컬럼의 처음)으로 · 컬럼이 하나면 풀고 없으면 컬럼 목록을 뺀다 · 빈
> 컬럼은 빈 문단(씨앗에서 만든 id). 저장 API(`validateDoc`)는 같은 규칙을 거부한다.
> ④ 편집기는 경계를 넘지 않는다 — 들여쓰기는 틀 밑으로 가지 않고 컬럼의 직속 블록은 내어쓰지 않으며 병합(Backspace · Delete)은 컬럼
> 경계를 넘지 않는다(키는 삼킨다). 이웃 찾기 · 블록 선택은 틀을 건너뛰고 그 안의 블록을 본다.
> ⑤ Markdown 내보내기 · 블록 복사의 평문은 컬럼마다 차례로 편다(잃은 것으로 세지 않는다 — 내용은 다 있다). 검색 색인은 틀에 글이 없다.
> ⑥ **폭은 컬럼의 `format.column_ratio`**(1c-2 · 공개 API 의 `width_ratio`) — 0 초과 1 이하의 수, 한 컬럼 목록의 합이 1 이 되게 **컬럼 목록 전체를
> 한 번에** 쓴다(바닥 0.1 · 소수 넷째 자리). 컬럼마다 LWW 라 동시에 고치면 합이 1 이 아닐 수 있어 **읽을 때 합으로 나눈다** · 하나라도 없거나
> 틀리면 모두 같은 폭. 정화는 컬럼의 올바른 수만 남긴다(다른 타입이 되면 사라진다). 화면은 노드 데코레이션의 `flex-grow`, 조절은 경계의
> 손잡이를 끌어 **놓을 때 한 번** 쓴다(끄는 동안 쓰지 않는다 — 협업 로그가 포인터만큼 자란다).
> ⑦ **편집기는 비게 된 컬럼을 지운다**(1c-2) — 마지막 블록을 끌어내거나 블록 선택으로 지운 컬럼 · 유일한 빈 문단에서 Backspace 를 친 컬럼.
> 남은 컬럼이 하나면 컬럼 목록을 풀어 그 블록들을 제자리에, 남은 컬럼의 폭은 다시 나눈다. 정규화(③)가 빈 컬럼을 **채우는** 것과 다르다 —
> 정규화가 만나는 빈 컬럼은 동시 편집이 남긴 것이라 지우면 남이 쓰던 자리가 사라지고, 편집기가 만나는 것은 지금 이 사람이 비운 것이다.
> 끌어 놓기는 줄을 **차선**(컬럼마다 · 본문)으로 나눠 포인터가 있는 차선 안에서 자리를 찾는다 — 컬럼 안으로 끌어 넣을 수 있다. 컬럼 목록은
> 컬럼 바로 안에 놓지 않는다(③ 의 중첩 금지).
> ⑧ **옆에 놓아 만든다**(1c-3 · 01 F-01-08 의 세 번째 드롭 존) — 블록을 다른 블록 줄의 **오른쪽 끝 구역**(줄 안 · 오른쪽 48px 부터 바깥까지)으로
> 끌면 세로 가이드가 서고, 놓으면 컬럼 밖의 블록은 **컬럼 목록으로 감싸고**(그 블록 | 끈 블록들 · 틀의 id 는 새로 · 폭은 쓰지 않는다 — 같은 폭)
> 컬럼의 직속 블록은 **그 컬럼 오른쪽에 컬럼을 더한다**(폭이 다 있었으면 새 컬럼이 1/(n+1) · 나머지는 비율대로 줄인다). 컬럼 안의 더 깊은 블록
> 옆 · 컬럼 목록을 끌어 옆에는 놓지 않는다(③ 의 중첩 금지 · `/2열` 과 같은 판결). 왼쪽 옆은 두지 않는다 — 핸들이 왼쪽 여백에 있어 세로로
> 끄는 길이 늘 그곳을 지난다. 컬럼이 세로로 쌓이는 좁은 화면에서는 옆이 없다.
> ⑨ **블록 선택은 틀을 고르지 않는다**(1c-3) — 두 경계 사이의 최상위 블록을 고를 때 컬럼은 뿌리가 되지 않고 안으로 들어가며, 컬럼 목록은
> 범위가 **통째로 덮을 때**(또는 경계 자신일 때)만 뿌리다. 한 컬럼의 블록에서 옆 컬럼의 블록까지 고르면 그 사이의 블록들(문서 순서)이고, 위에서
> Shift+↓ 로 내려오면 컬럼 안을 한 줄씩 지나 목록 뒤로 가는 순간 목록째가 된다. Shift+↑↓ 의 다음 자리는 줄의 id 가 아니라 **위치로** 찾는다
> (목록째인 뿌리는 화면의 줄이 아니다).

**[보강] 심플 테이블(`type='table'` · `type='table_row'`)의 저장 모양** ⟨Phase 2 1d-1 ①~⑤ · 1d-2 ⑥ · 1d-3 ⑦ · F-01-18⟩

> 01 F-01-18 *"구조는 `column_list`/`column`과 같은 **2계층 고정 컨테이너**다: `table`(자식은 `table_row`만) → `table_row`(자식 불가,
> `cells`에 rich text만)"* · *"셀은 블록을 담을 수 없다"* · *"헤더는 별도 블록 타입이 아니라 `table`의 boolean 플래그 2개"* · *"`cells` 길이 ≠
> `table_width` — 불법 상태"* · *"셀 텍스트는 셀 단위 CRDT"* · *"MVP는 병합 없는 고정 격자만"*.
>
> ① 둘 다 **보통의 블록 행**이다(C-3 · 새 표 없음) — 페이지 → `table` → `table_row`. 표의 `properties` 는 머리 플래그 둘(`has_column_header` ·
> `has_row_header` — 참 거짓만), 행의 `properties.cells` 는 **RichText[][]**(가로 표시 순서 · 셀마다 계약 정규형). 글(title) · 색 · 행의 자식이
> 없다(F-01-02 GAP: `table` 에는 color 필드가 없다). 열 수(`table_width`)는 **저장하지 않는다** — 행의 셀 수가 정한다(모든 행이 같다 · 공개
> API 를 붙일 때 계산한다). 셀의 병합은 저장 모양에 자리가 없다(F-01-18 *"병합 셀은 P2"*).
> ② **편집기 · Y.Doc 에서는 행이 표의 내용 노드 안에 산다** — `blockContainer(표 id) > table > table_row(rowId · props) > table_cell > 인라인`.
> 행은 컨테이너가 아니다: 이웃 찾기 · 핸들 · 끌기 · 블록 선택 · 들여쓰기에서 표는 줄 하나이고, 셀이 Y 요소라 셀 글자가 셀 단위 CRDT 다.
> 레지스트리의 `childrenInContent` 가 이 차이를 말하고 어댑터가 옮긴다(행 노드 ↔ 행 블록 — id 는 `rowId`, 셀 밖의 행 속성은 `props`). 행 id 는
> 블록 id 와 같은 이름 공간이다(찍기 · 중복 규칙이 같다). 노드 이름(`table` · `table_row` · `table_cell`)은 저장 포맷이다. `prosemirror-tables`
> (MIT · `@tiptap/pm/tables`)의 역할을 달아 셀 선택 · 행 · 열 명령을 쓴다 — 그 라이브러리가 요구하는 셀 칸(colspan · rowspan · colwidth)은
> 늘 1 · 1 · null 이다.
> ③ **읽을 때 고친다**(정규화 ⑤) — 행이 아닌 것 · 셀이 아닌 것은 버린다 · 셀의 인라인은 텍스트 블록과 같은 청소 · 병합 칸은 1 · null · 행 id
> 는 블록 id 와 같은 규칙(컨테이너가 먼저 갖는다) · 셀 밖의 행 속성은 평범한 객체(셀 키는 뺀다) · **셀 수가 모자란 행은 가장 긴 행에 맞춰 빈
> 셀로 채운다**(열을 버리지 않는다 — F-01-18 은 *"길면 거부"* 지만 동시 편집에서 열을 더한 쪽의 글자를 잃는다) · 행이 없으면 빈 셀 하나의 행
> 하나 · 표 컨테이너의 자식 그룹은 뒤 형제로 올린다. 저장 API(`validateDoc`)는 행 없는 표 · 셀 수가 다른 행 · 행이 아닌 자식 · 표 밖의 행 ·
> 셀 모양 · 셀의 런 계약을 거부한다.
> ④ 셀은 rich text 만 담는다 — 셀 안에 블록을 붙이면 평문으로 편다(블록 묶음 · 글자 → 그 셀의 글자). 셀 안의 `/` 는 글자다. 블록을 다루는
> 명령(병합 · 분할 · 들여쓰기 · 바꾸기)은 셀 안에서 물러서고, 표는 다른 타입으로 바뀌지 않는다(셀이 갈 곳이 없다).
> ⑤ Markdown 내보내기는 **GFM 파이프 표**(첫 행이 머리 — GFM 은 머리 줄이 필수다 · 셀 안의 `|` 는 `\|` · 줄바꿈은 `<br>`), 블록 복사의
> 평문은 행마다 한 줄 · 셀은 탭. 셀을 읽는 다른 길은 ⑦.
> ⑥ **행 · 열 · 머리의 편집은 블록 id 와 자리로 한다**(1d-2) — 캐럿이 어디 있든 같은 결과다(셀 위 손잡이 · 블록 메뉴가 같은 명령). 새 행은
> 만드는 트랜잭션 안에서 id 를 받는다(찍기 플러그인을 기다리지 않는다 — 협업 참여자가 같은 id 를 본다). 마지막 남은 행 · 열은 지우지
> 않는다(표를 지우는 것은 블록 지우기다). 머리 플래그는 켜면 `true`, 끄면 키를 지운다(정화와 같은 모양 — 거짓을 남기지 않는다).
> ⑦ **셀은 사용자가 쓴 글이다 — 글을 읽는 길이 모두 셀을 읽는다**(1d-3) — 검색 색인은 셀의 글자를 그 행 블록의 글로(문서 순서), 백링크는
> 셀 안의 멘션을 그 행 블록의 멘션으로, 복제는 셀 안의 페이지 멘션을 사본으로 옮긴다. 가져오기는 GFM 표를 표로(첫 행이 머리 · 머리 표시를
> 켠다 · 칸 수는 marked 가 머리 줄에 맞춘다 · 글자 안의 `<br>` 은 줄바꿈 — 우리 내보내기를 다시 가져오면 같은 격자다). 바깥 HTML 의 맨
> `<table>` 을 붙이면 표다(`<thead>` 거나 첫 행이 `<th>` 면 머리 줄) — 편집기의 기본 붙여넣기는 글자 블록이 아닌 블록을 지금 블록의 자식으로
> 끼우므로, HTML 을 블록으로 읽어 블록 붙여넣기의 자리 잡기를 지난다.

**[보강] 블록 색(`format.block_color`)을 쓰는 길 · 마지막 색** ⟨Phase 2 1e-1 ①~③ · 1e-2 ④ · F-01-21 · F-01-03⟩

> 01 F-01-21 *"문자 범위 단위인 rich text `annotations.color`(F-01-03)와는 별개의 두 번째 색상 계층"* · *"`/색상이름`(예: `/red`,
> `/blue background`) 입력 → 블록 전체가 그 색"* · *"`Cmd/Ctrl + Shift + H` → 마지막으로 사용한 텍스트/하이라이트 색을 재적용"* ·
> *"'마지막 사용 색'은 사용자별 클라이언트 상태다 … 서버 저장은 불필요(localStorage로 충분)"*.
>
> ① 블록 색은 `format.block_color`, 인라인 색은 런의 `annotations.color` — **같은 19색 enum 의 다른 계층**이다. 블록 색을 쓰는 편집은 한
> 길(`setBlockColorAt`)을 지난다 — 칠할 수 있는 타입은 레지스트리의 `supportsColor` 에서 **하위 페이지 참조를 뺀 것**(참조 노드에 칠한
> 색은 프로젝터가 쓰지 않는다) · `default` 는 키를 지운다 · 같은 값은 쓰지 않는다. 받지 않는 타입에 온 색은 정화가 지운다(`normalizeFormat`).
> ② `/` 의 색 명령 19개(기본 · 글자색 9 · 배경색 9)는 **그 블록 전체**를 칠한다. 메뉴는 쿼리의 공백에서 닫히므로(F-01-04) 두 낱말 이름은
> 붙여 쓴 꼴(`/빨강배경` · `/bluebackground`)로 찾는다.
> ③ **마지막 색은 서버에 두지 않는다** — 이 브라우저의 `localStorage`(저장소가 막히면 그 탭의 기억). 블록 메뉴의 '색' · `/` 의 색 명령이
> 기억하고 Ctrl/Cmd+Shift+H 가 다시 쓴다: 고른 글자면 그 글자(인라인), 블록 선택이면 그 블록들, 캐럿만이면 그 블록. 없으면 아무것도 하지 않는다.
> ④ **인라인 서식의 화면 길 — 서식 툴바**(1e-2 · F-01-03) — 비지 않은 글자 선택 위에 선다(코드 블록 · 블록 선택 · 셀 사각 선택 · 원자의
> 노드 선택에는 서지 않는다). 다섯 서식 · 링크 · 인라인 수식 · 색(글자색 10 · 배경색 9 — 그 글자만, 블록 색과 다른 계층 · 마지막 색으로
> 기억). **사람이 넣는 링크 주소는 http · https · mailto 만**(스킴이 없으면 `https://` · 제어 문자를 걷은 모양으로 판정 · 상한
> `MAX_LINK_URL`) — 저장 계약은 길이만 보고 가져오기 · API 로 들어온 주소는 그대로다. Ctrl/Cmd+K 가 툴바의 입력칸을 연다. 그 대신
> **그리는 쪽이 거른다**(#196 · 보안) — 편집기의 링크 마크는 누를 수 없는 주소(`javascript:` · `data:` …)에 `href` 를 달지 않는다
> (`contracts/link-url.ts` — 내보내기와 같은 규칙 · 글자와 마크는 남는다). 협업 참여자는 Y.Doc 에 무엇이든 쓸 수 있다.
> ⑤ **[보강 10n-54] 콜아웃의 파생 — 글자색이면 흰 바탕 + 연회색 테두리** — 01 F-01-21 *"글자색을 기본(검정) 아닌 색으로 바꾸면 블록 배경이 흰색 +
> 연회색 테두리가 된다(공식 명시)"*. **표시 규칙이다** — 저장은 그대로 `format.block_color` 하나(파생 칸을 두지 않는다). 배경색(`*_background`)이면
> 그 배경 · 색이 없으면 기본의 연회색 바탕이다. 편집기와 공개 화면이 같은 규칙을 따른다(어두운 테마는 바탕 · 테두리를 그 테마의 값으로).

**[보강] 콜아웃 아이콘(`properties.icon`)** ⟨디자인 트랙 4c · F-01-02 / 마이그레이션 없음⟩

> 01 F-01-02 의 블록 표 *"콜아웃 | `callout` | `rich_text[]`, `icon`, `color`"*. 초판은 콜아웃의 아이콘을 저장하지도 그리지도 않았다(글자와
> 바탕만). 노션은 새 콜아웃에 💡 를 단다.
>
> ① **자리는 콜아웃 블록의 `properties.icon`** — 노션 API 의 callout 페이로드(`rich_text` · `icon` · `color`)와 같은 자리다. 페이지
> 아이콘(`format.page_icon` — 페이지 **행**의 것 · 아래 [보강] 페이지 아이콘)과 다르다: 콜아웃은 본문 블록이라 **본문(Y.Doc)이 정본**이고
> (X-1) 행은 투영이다. `format.page_icon` 을 빌리지 않는 까닭 — 그 키는 DB 가 페이지 행에만 허용하고(0037) 정화가 본문의 모든 타입에서
> 지운다(페이지 아이콘 ③). 새 칸 · 마이그레이션이 없다(`properties` 는 통째로 오간다 — 편집기 · Y.Doc · 투영 · 복제 · 템플릿).
> ② **값은 v1 에 이모지 하나** — `{"type":"emoji","emoji":"💡"}`(노션 API icon 객체의 모양 · 페이지 아이콘과 같은 "이모지 한 글자" 규칙
> `contracts/emoji.ts` · 다른 키 없음). 이미지 · 커스텀 이모지 아이콘은 나중이다 — 올린 파일을 가리키면 그 참조 수(`file.ref_count`)를
> 본문 프로젝터가 세야 한다(페이지 아이콘 ⑤ 는 행을 쓰는 명령이 센다 — 다른 길). **없으면 키가 없고, 화면은 💡 를 그린다**(저장하지 않는
> 기본값 — 옛 콜아웃도 같은 모습이 된다). "제거" 는 키를 지운다(💡 로 돌아간다) — 아이콘 없는 콜아웃은 v1 에 없다.
> ③ **검증 · 정화** — 본문 저장 API 는 `validateDoc` 이 모양이 틀린 `icon` 을 거부한다(`validateCalloutProperties`). 협업 참여자는 검증을
> 거치지 않으므로 본문을 읽을 때(정규화) 틀린 `icon` 을 지우고 수선이 퍼뜨린다(`block/props.ts` — 캡션 · 언어와 같은 길). 콜아웃이 아닌
> 타입의 `icon` 은 건드리지 않는다(그 타입의 뜻이 아니다 — JSON 안전만).
> ④ **바꾸는 길** — 아이콘을 누르면 이모지 고르개(페이지 아이콘의 것 — 이모지 탭만). 고르면 한 명령(`setCalloutIconCommand`)이 그 콜아웃의
> `properties.icon` 을 쓴다 · 같은 값이면 쓰지 않는다 · 편집할 수 없는 편집기(읽기 전용 · 잠금)에서는 열리지 않는다.
> ⑤ **그리기 · 옮기기** — 편집기와 공개 화면이 같은 모습: 아이콘 칸 24×24(이모지 21.6px) · 글자는 아이콘 옆(노션 실측 ·
> `docs/design/notion-measurements.md`). 마크다운 내보내기는 노션처럼 `<aside>` 의 첫 줄 앞에 이모지와 공백을 쓴다 — **저장된 아이콘만**
> (기본 💡 는 쓰지 않는다 — 없는 값을 만들지 않는다). 가져오기는 `<aside>` 의 첫 글자가 이모지 한 글자 + 공백이면 아이콘으로 올린다
> (노션의 내보내기를 되읽는다 — 글이 이모지로 시작하는 콜아웃은 그 이모지가 아이콘이 된다. 노션도 같다).

**[보강] 이미지의 대체 텍스트(`block.format.alt_text` · `alt_decorative`)** ⟨플랫폼 잔여 10d-1a · F-12-13 / 마이그레이션 없음⟩

> 12 F-12-13 *"대체 텍스트와 캡션 분리 — 캡션=모두에게 보이는 설명, alt=스크린리더 전용. 겸용 금지"* · *"`alt_decorative` — '장식용이라 alt
> 불필요' 명시 선언"* · *"되돌릴 수 없는 결정 2개 — 헤딩을 type 으로 저장할 것인가(이미 type 이다), alt 를 caption 과 분리할 것인가"*. 초판은
> `<img alt>` 에 캡션을 넣었다(겸용).
>
> ① **자리는 이미지 블록의 `format`** — `alt_text`(글자 · 1000자 이하) · `alt_decorative`(참거짓 — 참이면 장식). 캡션(`properties.caption` —
> rich text · 모두에게 보인다)과 따로다. 새 칸 · 마이그레이션이 없다(`format` 은 통째로 오간다 — 편집기 · Y.Doc · 복제 · 내보내기). 없으면 **키가
> 없다**(빈 말 · 거짓을 두지 않는다 — 쓰는 쪽이 지운다)
>
> ② **검증은 문서 검증에서**(`validateImageFormat` — `validateDoc`) — 글자가 아니거나 1000자를 넘는 `alt_text` · 참거짓이 아닌 `alt_decorative`
> 는 거부한다(화면에서만 막으면 API 로 직접 쓰는 길이 열려 있다)
>
> ③ **`<img alt>` 의 말은 한 함수가 정한다**(`imageAltText` — 편집기 · 공개 화면 · 마크다운 내보내기가 함께): 장식이면 빈 말 · 대체 텍스트가
> 있으면 그것 · **없으면 캡션**(대체 텍스트가 생기기 전의 이미지는 캡션이 그 일을 했다 — 아무 말도 없는 것보다 낫다 · 저장은 겸하지 않는다)
>
> ④ 마크다운 가져오기의 `![글](주소)` 는 지금처럼 캡션이다(노션의 가져오기와 같다 — 마크다운에는 캡션이 없어 그 글이 보이는 설명의 자리다).
> 편집 화면(대체 텍스트 · 장식 고르기)은 10d-1b
>
> ⑤ **[10d-1b] 편집 화면** — 그림이 있는 이미지 블록의 "대체 텍스트" 단추(편집할 수 있을 때만 · 말이 있으면 "대체 텍스트 ✓" · 장식이면
> "장식 이미지") → 편집기 밖의 대화상자(글 칸 1000자 · "장식 이미지" — 고르면 글 칸이 잠긴다 · 저장 · 취소 · `Esc` 는 저장하지 않고 ·
> `Ctrl/Cmd+Enter` 는 저장). 저장은 편집기 명령으로 형식에 쓴다(`setImageAltCommand` — `withImageAlt` · 같은 값이면 쓰지 않는다 · 되돌리기의
> 한 걸음). 닫으면 편집기로 포커스. **다른 타입으로 바뀌면 두 키가 사라진다**(`normalizeFormat` — 코드 줄바꿈 · 컬럼 폭과 같은 규칙)

**[보강 10n-62] 이미지의 캡션 편집 — 코드 캡션과 같은 규칙 · 편집기 밖의 입력칸** ⟨§7 정리 10n-62 · 01 F-01-15 / 마이그레이션 없음⟩

> 01 F-01-15 이미지의 캡션(`properties.caption` — RichText[])은 저장 · 읽기 · 검증이 있었고 편집 화면만 없었다(원자 노드 안에 편집 영역을
> 두면 캐럿 · 선택이 두 개가 된다).
>
> ① **쓰는 규칙은 코드 블록의 캡션 ⑤ 그대로**(`withCodeCaption`) — 평문 런 · **글자가 바뀌지 않았으면 쓰지 않는다**(앞뒤 공백만 다른 것도 같다 ·
> 받은 서식 · 링크 · 멘션을 지킨다) · 비우면 키를 지운다 · 자르지 않는다(2000자마다 런을 나눈다). 같은 값이면 명령이 거절한다(되돌리기 기록을
> 더럽히지 않게 — `setImageCaptionCommand`)
>
> ② **화면은 코드 캡션의 입력칸을 같이 쓴다**(편집기 밖 · 여러 줄 · Enter · 바깥 누르기로 저장 · Shift+Enter 줄바꿈 · Esc 는 저장하지 않고 ·
> 열고 닫기만 하면 쓰지 않는다 · 받은 캡션에 서식이 있으면 고치면 평문이 된다고 먼저 말한다). 그림 아래의 "캡션 추가" · "캡션 고치기" 단추
> (편집할 수 있을 때만 · 대체 텍스트 단추 옆)가 연다 — 자리는 그림 바로 아래 · 같은 폭(캡션이 있으면 그 글자를 가린다)
>
> ③ 대체 텍스트가 없는 이미지의 `<img alt>` 는 캡션이다(위 [보강] 이미지의 대체 텍스트 ③) — 캡션을 고치면 그 말도 따라 바뀐다

**[보강 10n-63] 이미지의 폭 · 정렬 — `format.block_width` (비율) · `format.block_align`** ⟨§7 정리 10n-63 · 01 F-01-15 *"크기 조절 핸들, 정렬(좌/중/우)"* / 마이그레이션 없음⟩

> 01 F-01-15 의 데이터 모델 함의는 키 이름(`format.block_width` · `block_aspect_ratio`)만 남겼다. 단위를 정한다.
>
> ① **`block_width` 는 그 블록이 놓인 칸(본문 · 컬럼 · 토글 안) 폭에 대한 비율** — 0.1 이상 1 이하의 수 · 소수 둘째 자리로 맞춘다(쓰는 쪽이
> 둥근다). 픽셀로 두면 좁은 화면 · 컬럼 안에서 넘치거나 뜻이 달라진다(01 엣지 *"컬럼/토글 안의 이미지 — 컨테이너 폭 기준으로 리사이즈"*).
> **없으면 지금처럼** — 그림의 원래 크기로, 칸 폭을 넘지 않는다. 있으면 그림은 그 폭을 채운다(높이는 비율대로 · 원래보다 크게 늘 수 있다).
> 캡션도 그림의 폭을 따른다. `block_aspect_ratio` 는 두지 않는다 — 그림의 비율은 그림이 정한다(늘이기 · 자르기는 하지 않는다)
>
> ② **`block_align` 은 `'left'` · `'center'` · `'right'`** — 그림과 캡션이 칸 안에서 선다. **없으면 왼쪽**(지금의 그리기 · 다른 블록과 같다).
> 칸을 다 채우는 그림(폭 1 · 원래 크기가 칸보다 넓다)에는 뜻이 없지만 지우지 않는다(폭을 줄이면 다시 뜻을 갖는다)
>
> ③ **이미지의 것** — 다른 타입으로 바뀌면 두 키가 사라진다(`normalizeFormat` — 대체 텍스트와 같은 규칙). **검증은 문서 검증에서**
> (`validateImageFormat`) — 수가 아니거나 범위 밖의 폭 · 셋이 아닌 정렬은 거부한다. 쓰는 모양은 한 함수(`withImageLayout` — 왼쪽 · 없는 폭은
> 키를 지운다 · 모르는 키는 그대로)
>
> ④ **편집기 · 공개 화면이 같은 규칙으로 그린다**(`readImageLayout`). 마크다운 내보내기에는 폭 · 정렬의 자리가 없어 싣지 않는다(그림은 원래
> 크기다). 화면: 그림 아래의 정렬 단추 셋(편집할 수 있을 때만 · 고른 것이 눌려 있다 — 10n-63) · 끌어서 폭 바꾸기는 10n-64

**[보강] 편집기 메뉴의 접근성 — 편집기 루트가 열린 목록과 지금 항목을 가리킨다** ⟨플랫폼 잔여 10d-3 · F-12-13 / 마이그레이션 없음⟩

> 12 F-12-13 *"슬래시 메뉴/멘션 팝업은 role="listbox" + aria-activedescendant 로 조합 위젯 패턴을 따라야 하며, 포커스를 입력에서 빼앗으면
> 안 된다"*. 초판은 목록 · 항목의 role 만 있어 ↑↓ 로 바뀌는 항목을 화면 읽기 프로그램이 몰랐다(포커스는 편집기에 있다).
>
> ① 슬래시 · 멘션 · 커스텀 이모지 메뉴가 열려 있는 동안 **편집기 루트**(`role="textbox"` · 여러 줄)에 `aria-autocomplete="list"` ·
> `aria-controls`(목록의 id) · `aria-activedescendant`(지금 항목의 id — 항목이 없으면 달지 않는다). `aria-expanded` 는 textbox 의 속성이 아니라
> 달지 않는다. 닫히면 셋 다 없다
> ② 루트의 속성은 ProseMirror 가 쥔다 — 플러그인의 `attributes`(`combobox-a11y.ts`)로 단다. 지금 항목의 번호는 화면의 상태라 화면이 메타
> 트랜잭션으로 알린다(같은 값이면 보내지 않는다). 메뉴가 둘 열리면 슬래시 · 멘션 · 이모지 차례(여는 쪽이 다른 메뉴를 닫는다)
> ③ 목록 · 항목의 id 는 고정(`blk-slash-menu` · `blk-slash-option-{n}` · 멘션 · 이모지도 같은 모양) — 한 화면에 편집기가 하나다

**[보강] 페이지 아이콘(`block.format.page_icon`)** ⟨잔여 묶음 8c-1 · 8c-4 · F-02-05 / 마이그레이션 0037 · 0039 · 0097⟩

> 초판의 `block` 에는 아이콘 자리가 없다(`database` 에는 `icon jsonb` 가 있다 — 데이터베이스 자신의 아이콘은 그 칸이다 · §3.5 [보강]
> 데이터베이스 아이콘 · 8c-3b). 02 F-02-05 의 데이터 모델 함의 *"`page_meta.icon_type` +
> `icon_value`"* 는 폐기된 `page_meta` 표의 것이다(페이지는 블록이다 — C-3). 노션 API 의 page 객체는 `icon` 을 `emoji` · `external` · `file`
> (· `custom_emoji` · `icon`) 중 하나의 모양으로 준다. F-02-05 클론 대안: *"1단계는 이모지 전용 … 이미지 업로드와 내장 아이콘 세트는 v1 로 미룸"*.
>
> ① **자리는 페이지 행의 `format.page_icon` 이다** — 새 컬럼을 두지 않는다. 아이콘은 제목(`properties.title`)과 달리 페이지의 **모습**이고
> (노션 내부 모델의 자리와 같다), 복제(#110)가 이미 `format` 을 통째로 사본에 옮긴다. 값은 노션 API icon 객체의 모양 — 지금은
> `{"type":"emoji","emoji":"🌱"}` 하나. 없으면 **키가 없다**(`null` 을 두지 않는다). 공개 API 투영은 `format.page_icon` → `icon`(없으면 `null`).
> DB 행(`parent_type='data_source'`)도 같은 자리다.
> ② "이모지 한 글자"(grapheme 하나 — 가족 · 피부색 · 깃발 · 키캡도 한 글자)는 명령이 검사한다 — teamspace 아이콘(§3.3 [보강]
> `teamspace.icon` ②)과 **같은 규칙**이다(`contracts/emoji.ts`). 7c-14 의 규칙이 키캡(`1️⃣`)을 거부하던 틈은 함께 고쳤다(키캡은 그림 문자
> 속성이 없다). DB 는 표현할 수 있는 부분을 CHECK 으로 막는다(0037): **페이지 행만** · 객체 · `type='emoji'` · `emoji` 는 1~16 코드포인트의
> 공백 없는 문자열 · 다른 키 없음. 이미지(업로드 · 외부 URL)는 8c-4 가 이미지 블록의 `source` 와 같은 모양(`{type:'file', file_id}` ·
> `{type:'external', url}`)으로 넓혔다 — 이 CHECK 과 데이터베이스 아이콘의 0038 을 함께(0039 · ⑤).
> ③ **본문(Y.Doc)은 아이콘을 싣지 않는다** — 하위 페이지 참조 노드는 행에서 본문을 지을 때(옮기지 않은 페이지 · 복제) 자식 행의 `format`
> 을 받아 왔다(`rowsToDoc` → `docToPm`). 그대로면 **볼 수 없는 하위 페이지의 아이콘**이 부모 본문을 타고 협업 참여자에게 퍼진다(제목이
> 그랬다 — HANDOFF §3.2-22). 세 층이 각자 버린다 — 행에서 문서를 지을 때 · 문서에서 편집기 · Y.Doc 노드를 지을 때(본문의 format 규칙
> `normalizeFormat` 은 어느 타입에서나 이 키를 버린다) · Y.Doc 을 읽을 때(정규화 — 참여자가 attr 에 직접 넣은 것은 수선이 지운다). 하위
> 페이지 참조 · 멘션이 아이콘을 그릴 때는 제목처럼 **권한으로 거른 맵**으로 준다(8c-2 — `pageIcons`: 볼 수 있고 아이콘이 있는 것만).
> ④ 바꾸는 사람은 그 페이지를 고칠 수 있는 사람(`edit_content`)이고 잠기면 막는다(제목과 같다). **DB 행도 받는다** — 행의 제목은 셀이
> 정본이라 셀로만 고치지만 아이콘은 셀이 아니다(행의 권한은 셀과 같은 축 — 데이터베이스에서 상속한 `edit_content` · 행 페이지 잠금).
> 같은 아이콘이면 쓰지 않고, 바뀌면 `last_edited_*` · `version` 을 올린다. 검색 색인은 다시 쓰지 않는다(찾는 글자가 아니다).
> ⑤ **[8c-4 · 마이그레이션 0039] 이미지 아이콘** — 모양은 **이미지 블록의 `source` 와 같다**: `{"type":"file","file_id":"…"}`(우리가
> 호스팅하는 파일 — 주소는 파생값이고 서명 URL 을 저장하지 않는다 · FS2) · `{"type":"external","url":"https://…"}`(값 자체가 주소).
> 노션 API 의 중첩 모양(`{type:'external', external:{url}}`)은 받지 않는다 — 공개 API 투영이 생기면 그때 바꿔 낸다.
>   · DB 는 두 자리(페이지 행의 `format.page_icon` · `database.icon`)를 **한 판정 함수** `icon_shape_ok(jsonb)` 로 막는다(0039 — 둘을 따로
>     적으면 한쪽만 넓히는 날이 온다): 객체 · `type` 셋 중 하나 · 그 종류의 키 하나 말고 다른 키 없음 · emoji 는 0037 과 같다 · `file_id` 는
>     소문자 uuid · `url` 은 http · https 로 시작하는 1~2048자 · 공백 없음. 받기(`parsePageIconInput`)는 같은 규칙에 앞뒤 공백을 벗기고
>     id 를 소문자로 한다
>   · **올린 파일은 이 워크스페이스의 이미지여야 한다** — 명령이 `file` 표에 묻는다(jsonb 안의 id 에 FK 를 걸 수 없다). 다른
>     워크스페이스의 파일 · 없는 id · 이미지가 아닌 파일은 `invalid_icon` 이다. 파일 내용은 워크스페이스로 한정되어 읽히므로(파일 경로가
>     세션으로 인증한다) 같은 워크스페이스의 파일을 가리키는 것은 새로 열어 주는 것이 없다 — 파일 id 는 그것을 볼 수 있는 곳에서만 알게 된다
>   · **파일 아이콘은 그 파일의 참조다** — `file.ref_count` 에 센다(§3.10 · FS1). 이미지 블록은 본문 프로젝터가 세지만 아이콘은 블록의
>     `properties` 가 아니므로 **아이콘을 쓰는 명령이 같은 트랜잭션에서** 센다 — 바꾸기(옛 파일 −1 · 새 파일 +1 · 같은 파일이면 그대로)와
>     복제(사본이 같은 파일을 가리킨다 — 다시 올리지 않는다 · 템플릿으로 만든 행도 이 길). 내릴 때 바닥은 0. 휴지통 · 영구 삭제는 내리지
>     않는다(이미지 블록과 같다 — 물리 삭제는 GC 의 몫)
>   · 화면은 `<img>` 다 — 올린 파일은 세션으로 인증되는 워크스페이스의 파일 경로, 외부 주소는 그대로 · **referrer 를 보내지 않는다**
>     (사이드바 · 목록은 아이콘을 보는 모든 사람의 브라우저가 그 주소를 부른다). 불러오지 못하면 깨진 그림 대신 없을 때의 표시로 바꾼다
>     (페이지로 가는 줄은 기본 글리프 · 글자 속의 경로는 없음)
> ⑥ **[7c-2a · 마이그레이션 0097] 넷째 종류 — 커스텀 이모지** `{"type":"custom_emoji","custom_emoji":{"id":"…"}}`. 규칙은 [보강] 커스텀
> 이모지 ⑤ 에 있다 — 그리기는 ⑤ 의 이미지 아이콘과 같은 `<img>` 다.

**[보강] 커스텀 이모지 — 워크스페이스의 이모지 라이브러리** ⟨인접 제품 7c-1 · F-13-16 / 마이그레이션 0096⟩

> 13 F-13-16 *"워크스페이스 구성원이 직접 올린 이미지를 유니코드 이모지처럼 페이지 아이콘 · 반응 · 인라인에 사용한다"* · 데이터 모델 함의의
> `custom_emoji`(정본에 없었다). 노션 API 는 아이콘을 `{"type":"custom_emoji","custom_emoji":{"id","name","url"}}` 로 준다.

```sql
CREATE TABLE custom_emoji (                     -- [보강 7c-1] 13 의 custom_emoji — 이미지는 파일 표의 것이다(참조 수를 센다)
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-z0-9_-]{1,40}$'),    -- `:이름:` 의 이름 — 소문자 · 숫자 · 밑줄 · 하이픈
  file_id uuid NOT NULL REFERENCES file(id),
  created_by uuid NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL                   -- 지워도 행은 남는다(쓰인 곳이 이름을 찾는다 · 13 *"tombstone"*)
);
CREATE UNIQUE INDEX ux_custom_emoji_name ON custom_emoji (workspace_id, name) WHERE deleted_at IS NULL;  -- 살아 있는 것끼리 이름이 하나
```

> ① **이모지는 이미지 파일 하나와 이름**이다 — 이미지는 올린 파일(그 워크스페이스의 이미지 · 1MB 까지 — 아이콘보다 작게)이고, 이모지가
> 그 파일을 참조한다(`file.ref_count` +1 — 아이콘 ⑤ 와 같은 규칙 · 같은 트랜잭션). 이름은 `:이름:` 으로 쓰일 말 — 소문자 · 숫자 · 밑줄 ·
> 하이픈 · 40자(받을 때 소문자로) · **살아 있는 것끼리 하나**(`duplicate_name`). 워크스페이스마다 **500개**(살아 있는 것 · 13 —
> `too_many`).
>
> ② **누가** — 이 워크스페이스의 멤버(게스트는 아니다)가 올린다. 소유자가 설정(`workspace.emoji_owners_only`)을 켜면 소유자만 올린다
> (13 *"Limit custom emoji creation to workspace owners"*). 이름 바꾸기 · 지우기는 **올린 사람이나 소유자**(13 *"소유자는 누가 올렸든"*).
> 목록은 멤버 · 게스트 모두(페이지에 쓰인 이모지를 그려야 한다).
>
> ③ **지우기는 표시만** — `deleted_at` 을 찍고 파일 참조를 내린다(이미지는 더 그리지 않는다). 쓰인 곳은 id 로 가리키므로 지운 이모지는
> "지운 이모지"(이름만)로 그린다 — 13 *"하드 삭제는 위험 · tombstone 유지 + 플레이스홀더"*. 지운 이름은 다시 쓸 수 있다(부분 UNIQUE).
>
> ④ **쓰이는 곳은 다음 조각들** — 페이지 아이콘(`{type:'custom_emoji', custom_emoji:{id}}` · 7c-2) · 설정의 관리 화면 · 고르개(7c-2) ·
> 본문 인라인 · 반응(7c-3).
>
> ⑤ **[7c-2a · 마이그레이션 0097] 페이지 · 데이터베이스 아이콘으로** — 모양은 노션 API 의 것에서 **id 만** 남긴다:
> `{"type":"custom_emoji","custom_emoji":{"id":"…"}}`. 이름 · 주소는 싣지 않는다 — 이름은 바뀌고(쓰인 곳이 따라가야 한다 · 7c-1 이 정한
> 것) 주소는 파생값이다(FS2).
>   · **DB** — `icon_shape_ok` 를 다시 정의해 넷째 종류를 받는다(두 자리 — 페이지 행의 `format.page_icon` · `database.icon` — 가 함께
>     넓어진다 · 페이지 아이콘 ⑤ 의 까닭). `custom_emoji` 는 `id` 키 하나만 가진 객체 · `id` 는 소문자 uuid · 바깥에도 다른 키 없음
>   · **명령** — 이 워크스페이스의 **살아 있는** 이모지여야 한다(없는 id · 다른 워크스페이스의 것 · 지운 것은 `invalid_icon`). 지운
>     이모지를 새로 달 수는 없지만 **이미 달린 아이콘은 그대로 둔다**(③ — id 로 가리킨다 · 지우기가 쓰인 곳을 찾아 고치지 않는다)
>   · **파일 참조를 올리지 않는다** — 이모지가 이미 그 파일을 쥔다(①). 아이콘이 이모지를 가리키는 수도 세지 않는다 — 지우기가 표시만이라
>     셀 까닭이 없다. 복제 · 영구 삭제의 참조 장부(페이지 아이콘 ⑤)도 이 종류에는 아무것도 하지 않는다
>   · **그리기** — 이미지 아이콘과 같은 `<img>` 이고 주소는 `GET /api/workspaces/{ws}/emoji/{id}/image`(세션 · 워크스페이스의 누구나 —
>     목록과 같다 · 지운 이모지는 404). 못 불러오면 이미지 아이콘과 같은 규칙으로 없을 때의 표시로 바꾼다 — 그래서 **지운 이모지의
>     아이콘은 기본 글리프로 보인다.** ③ 의 "이름만" 은 글자 속에 서는 자리(본문 인라인 · 반응 — 7c-3)의 표시다. 아이콘 자리는 이름을
>     글자로 그리지 않는다(줄의 글자는 페이지 이름이다 — 8c-1). 캐시는 `private, max-age=300` — 파일 경로의 `immutable` 을 쓰지 않는다
>     (이모지 id 가 가리키는 그림은 바뀌지 않지만 **지울 수 있다** — 지운 뒤 5분 안에 모두의 화면에서 내려간다)
>   · **공개 화면** — 페이지 아이콘의 공개 파일 경로(`/p/{token}/blocks/{pageId}/icon` · §3.3 끝 [보강] 공개 화면 ⑨)가 커스텀 이모지면
>     그 이모지(살아 있는 것)의 파일을 준다. 공개 쪽은 이모지 id 로 열지 않는다 — 블록 id 로 연다(⑨ 와 같은 까닭: 주소를 알아도 다른
>     이모지를 찍어 읽을 수 없고, 아이콘을 바꾸면 그 주소도 닫힌다). 지운 이모지의 아이콘은 **공개 읽기가 없는 것으로 내린다** — 앱은
>     클라이언트 부품이 깨진 그림을 기본 글리프로 바꾸지만 공개 화면은 서버가 그린 `<img>` 뿐이라 판정을 서버로 당긴다
>   · 읽는 이에게 말할 이름은 "커스텀 이모지"(머리의 `aria-label`) — 이름은 표를 읽어야 안다. 고르개(7c-2b)가 이름을 보인다
>
> ⑥ **[7c-2b] 화면 — 설정의 이모지 절 · 고르개의 커스텀 탭**
>   · **설정 → 워크스페이스 → 이모지** — 패널 하나(값 항목이 없다 · 게스트에게는 서지 않는다 — 게스트는 올리지 못하고, 쓰인 이모지를
>     그리는 데는 목록 라우트로 족하다). 목록(그림 · `:이름:` · 이름 순) · 올리기 · 이름 바꾸기 · 지우기. 바꾸기 · 지우기 단추는 바꿀 수
>     있는 것에만 선다(`canManage` — 판정은 명령이 다시 한다). 올릴 수 없으면(소유자만 설정) 올리기 대신 그렇다고 말한다. "소유자만"
>     토글은 보안 절에 그대로 둔다(정책은 정책끼리 — 13 *"Limit custom emoji creation"* 은 보안 설정이다)
>   · **올리기는 두 번의 요청이다**(파일 → 이모지). 이모지가 거부되면 올린 파일은 참조 0 으로 남아 GC 의 몫이 된다(이미지 블록을 지운
>     것과 같다). 그래서 화면은 **파일을 올리기 전에** 같은 규칙으로 먼저 거른다 — 이름의 모양 · 이미지 형식 · 1MB. 이름은 파일 이름에서
>     제안한다(확장자를 떼고 소문자로 · 받을 수 없는 글자는 하이픈 — 비면 `emoji`). 규칙은 순수 모듈 하나(`custom-emoji-rules.ts`)를
>     명령과 화면이 함께 쓴다
>   · 지우기는 한 번 더 묻는다 — 되돌릴 수 없고(같은 이름으로 다시 올려도 다른 이모지다) 쓰인 아이콘이 기본 글리프로 바뀐다
>   · **아이콘 고르개의 커스텀 탭** — 이미지 탭과 같은 조건(페이지 · 데이터베이스 아이콘. teamspace 아이콘은 글자 칸이라 없다). 열 때
>     목록을 읽는다(`GET /emoji` — 고르개가 열릴 때마다 · 다른 사람이 올린 것이 바로 보인다). 이름으로 찾는다(부분 일치 · 양 끝의 `:` 와
>     대소문자를 무시한다). 고르면 `{type:'custom_emoji', custom_emoji:{id}}` 를 저장한다. 비었으면 설정의 이모지 절로 가는 길을 보인다
>
> ⑦ **[7c-3a] 본문 인라인 — 저장 모양 · 이름 맵 · 편집기의 그리기**
>   · **모양은 멘션 런이다** — `{type:'mention', mention:{type:'custom_emoji', custom_emoji:{id}}, plain_text:''}`. 노션 API 의 rich text 가
>     커스텀 이모지를 멘션으로 주는 것과 같은 자리(`MentionType` 에 처음부터 `custom_emoji` 가 있었다)이고, 편집기에서는 사람 · 페이지
>     멘션과 같은 원자 노드다. **이름 · 주소를 싣지 않는다** — 사람 · 페이지 멘션과 같은 까닭(이름은 바뀐다 · ①)이고, `plain_text` 는
>     비운다(검색 색인에 들어가지 않는다 — 멘션과 같다). 받는 쪽(`validateRichText`)은 id 가 uuid 인지만 본다
>   · **그릴 이름은 맵에서** — 멘션 이름 맵(`loadMentionLabels`)에 `emoji` 가 더해진다: id → `{ name, deleted }`(이 워크스페이스의 것만 ·
>     **지운 것도 이름을 준다** — ③ 의 "이름만") · 이 워크스페이스에 없으면 null. 이모지 목록은 워크스페이스의 누구나 보므로(②) 권한
>     필터가 없다. 편집기가 모르는 id 를 받으면(다른 참여자가 넣었다) 같은 라우트로 다시 읽는다(`mention-labels?emoji=`)
>   · **그리기** — 살아 있으면 그림(`<img>` · 글자 한 칸 높이 · `alt`/`title` 은 `:이름:`) · **지웠으면 `:이름:` 글자**(흐리게 · "지운
>     이모지") · 이 워크스페이스에 없으면 "이모지" 자리 표시 · 그림을 못 불러오면 `:이름:` 글자로 바꾼다(깨진 그림을 그리지 않는다)
>   · 역인덱스(`link_edge`)는 쓰지 않는다 — 가리키는 것이 페이지 · 사람이 아니다. 이모지가 어디에 쓰였는지 모른다는 13 의 말 그대로다
>     (③ 의 지우기가 표시만인 까닭)
>
> ⑧ **[7c-3b] 본문의 `:` 자동완성**
>   · **트리거는 줄 시작 · 공백 뒤의 `:`** — `@` 메뉴(F-07-08)와 같은 규칙이다. 글자 뒤의 `:` 는 열지 않는다(`10:30` · `https://` ·
>     `이름:값` 을 방해하지 않는다). 붙여넣기로 들어온 `:` 도 열지 않는다(키 입력에만). 코드 블록 안에서는 열지 않는다
>   · **쿼리는 이름의 글자만** — 영문 · 숫자 · `_` · `-`(① 의 이름 규칙 · 대소문자는 찾기가 무시한다). 다른 글자(공백 · 한글 · 문장
>     부호)를 치면 닫는다 — `:` 뒤에 말을 이어 쓰는 글(`참고: 이것`)을 메뉴가 붙잡지 않게. 40자를 넘으면 닫는다
>   · **후보는 쿼리가 한 글자 이상이고 맞는 것이 있을 때만 보인다** — `@` 메뉴와 다르다(그쪽은 후보가 0건이어도 연다 — 서버에 물어 늦게
>     온다). 이모지 목록은 열 때 한 번 읽고(`GET /emoji`) 찾기는 그 자리에서 한다(`searchCustomEmoji` · 8개까지) — 0건이면 팝업이 없고
>     Enter 는 줄바꿈 그대로다
>   · **고르면** `:쿼리` 를 커스텀 이모지 멘션(⑦)으로 바꾼다 — 한 트랜잭션(되돌리기 한 번). 뒤에 공백을 붙이지 않는다(이모지는 글자처럼
>     붙여 쓴다 — 사람 · 페이지 멘션과 다르다). **닫는 `:` 를 쳐서 이름이 꼭 맞으면**(`:party:`) 고른 것과 같다 — 슬랙과 같은 손버릇
>   · 이름 맵에 고른 이모지를 먼저 넣는다(서버에 다시 묻지 않는다 — `@` 메뉴와 같다)
>
> ⑨ **[7c-3c] 공개 화면의 인라인 이모지**
>   · **공개 읽기가 이름을 싣는다** — 문서(본문 블록 · 페이지 제목)에 나오는 커스텀 이모지의 이름 맵(`emojiLabelsIn` — 지운 것도 이름).
>     게시한 내용에 쓰인 이모지의 이름은 그 내용의 일부다(사람 멘션의 이름을 싣는 것과 같다)
>   · **그림은 블록 id 로 연다** — `/p/{token}/blocks/{blockId}/emoji/{emojiId}`(§3.3 끝 [보강] 공개 화면 ⑨ 의 아이콘 · 이미지와 같은 까닭 —
>     이모지 id 로 열지 않는다). 주는 조건은 넷: 토큰이 열리고 · 그 블록이 든 페이지(블록이 페이지면 그 자신)가 이 토큰으로 열리고 · **그
>     블록의 제목 런에 그 이모지가 지금 있고** · 그 이모지가 살아 있다. 그래서 공개 주소를 알아도 다른 이모지를 찍어 읽을 수 없고, 본문에서
>     지우거나 이모지를 지우면 그 주소도 닫힌다. 캐시는 공개 파일과 같다(`private, max-age=60`)
>   · **그리기** — 블록을 아는 자리(문단 · 제목 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 · 페이지 제목)는 그림(alt `:이름:`), 블록을 모르는
>     자리(캡션 · 표 칸 · 데이터베이스 칸)와 지운 이모지는 `:이름:` 글자, 이 워크스페이스에 없으면 아무것도 그리지 않는다
>   · **내보내기는 다루지 않는다** — Markdown 내보내기는 멘션 런을 `plain_text`(빈 글)로 옮겨, 사람 · 페이지 멘션도 빠진다. 멘션을 이름으로
>     옮기는 일은 멘션 전체의 몫으로 남긴다
>
> ⑩ **[7c-3d-2 · 마이그레이션 0098] 코멘트 반응**
>   · **키는 `custom_emoji:{id}`**(소문자 uuid) — `reaction.emoji` 칸에 그대로 싣는다. 새 칸을 두지 않는다 — PK
>     `(target_kind, target_id, user_id, emoji)` 가 곧 2P-Set 이라 키 하나가 이모지 하나여야 한다(칸을 나누면 PK 가 둘 중 하나를 놓친다).
>     0018 의 CHECK(1~16자)을 넓힌다 — **1~16자이거나 이 모양**(`ck_reaction_emoji`). 아이콘의 가리키는 글자(`custom_emoji:{id}` ·
>     `pageIconKey`)와 같은 모양이다
>   · **명령** — 더하기는 이 워크스페이스의 **살아 있는** 이모지만(`invalid_emoji`). 빼기(이미 누른 것을 다시 누르기)는 지운 뒤에도
>     된다 — 명령이 먼저 지우고, 지운 것이 없을 때만 더하기를 판정한다
>   · **이모지를 지워도 반응 행은 남는다**(③ — 쓰인 곳을 찾아 고치지 않는다). 칩은 `:이름:` 글자다
>   · **이름은 목록 응답이 싣는다** — 코멘트 목록(`GET pages/{id}/discussions`)이 반응에 나온 커스텀 이모지의 이름 맵(`emoji` — 지운 것도
>     · 이 워크스페이스의 것만)을 함께 준다. 화면이 따로 묻지 않는다
>   · **화면** — 칩은 살아 있으면 그림(alt `:이름:`) · 지웠으면 `:이름:` 글자 · 모르면 "이모지". 고르개는 빠른 여덟 아래에 커스텀 줄 —
>     열 때 목록을 읽고(`GET /emoji`) 이름으로 찾는다(`searchCustomEmoji` · 24개까지)

**상태 전이 (type='page' 블록만)**

| From → To | 트리거 | 부수효과 |
|---|---|---|
| `live` → `trashed` | Delete / API `in_trash:true` / 소스 삭제 전파 | page 타입 자손 전체에 전파. 자손 `trash_root_id`=대상 id. `purge_after`=now+`trash_days`. 부모 Y.Doc 에서 참조 노드 제거 |
| `trashed` → `live` | Restore / API `in_trash:false` | `trash_root_id` 일치 자손만. 부모 Y.Doc 에 참조 노드 재삽입(order_key 위치, 불가 시 말미) |
| `trashed` → `purged` | GC(`purge_after` 경과) 또는 영구 삭제 | 누구도 접근 불가(30일 동안 지원 경로로만 복구 — 11 F-11-06). ~~`file.ref_count` 감소~~ → **내리지 않는다** [보강] 휴지통 자동 비우기 ③ |
| `purged` → 물리 삭제 | GC(`purged_at` + 30일) | `doc_update`/`doc_snapshot`/`page_version`/`search_document` 를 page_id 로 일괄 삭제 · 지운 행이 쥐던 `file.ref_count` 를 내린다(본문 이미지 · 아이콘 · 버전 S5 — [보강] 휴지통 자동 비우기 ③) · 다른 묶음의 자손이 남아 있으면 기다린다([보강] 물리 삭제) |

**[보강] 휴지통 자동 비우기** ⟨히스토리 · 활동 4b-1 · F-11-06 / 마이그레이션 0069 · 공용 스케줄러(§3.10 [보강])의 두 번째 소비자 `trash_purge`⟩

> 위 전이표의 GC 행(`trashed` → `purged`, `purge_after` 경과)을 하는 일이다. 지금까지는 수동 영구 삭제만 있었다.
>
> ① **단위는 삭제 루트다** — `purge_after` 가 지난 휴지통 묶음(`trash_root_id` 가 같은 페이지들 · 루트가 data source 면 그 소스까지)을
>    **한 트랜잭션에서** `purged` 로 바꾼다. 루트 행을 먼저 잠근다(`SKIP LOCKED`) — 되살리기 · 손으로 하는 영구 삭제도 루트를 잠그므로,
>    그쪽이 쥐고 있으면 이 판은 그 묶음을 건너뛴다(다음 판에 다시 본다 — 워커가 사람의 명령을 기다리지 않는다). 잠그지 않고 묶음을 한
>    문장으로 바꾸면 자손을 먼저 잡은 채 루트를 기다리게 되어 되살리기와 교착하고, 묶음을 나눠 바꾸면 "루트는 되살아났는데 자식은
>    `purged`"가 생긴다. 묶음 안의 시각은 같다(버리는 명령이 한 문장 · 한 트랜잭션의 `now()` 로 적는다).
> ② **수동 영구 삭제와 같은 쓰기** — `purged_at` = 실행기의 `now`(§3.10 [보강] 공용 스케줄러 ④). 검색 색인은 트리거가 내린다(0012).
>    따로 먼저 지운 자손 · 행은 제 루트를 가지므로 제 시각에 따로 비워진다(B3).
> ③ **`file.ref_count` 는 이 전이에서 내리지 않는다** — 초판 전이표는 `trashed` → `purged` 에서 내렸다. 물리 삭제 행으로 옮긴다.
>    근거: (a) 11 F-11-06 원문 — *"permanently deleted … retained for 30 days before they become inaccessible to all users"* — `purged`
>    는 30일 동안 지원 경로로 되살릴 수 있어야 하고, 그때 첨부도 살아 있어야 한다. 참조를 내리면 파일 GC(FS1 — `ref_count = 0` 을
>    쓸어간다)가 그 사이에 바이트를 지운다 (b) 참조는 **그것을 쥔 행이 사라질 때** 내린다 — 셀 때와 같은 규칙이다(본문 프로젝터는
>    이미지 블록 행이 생기고 사라질 때 · 아이콘은 그 칸이 바뀔 때 · 버전은 기록 · GC 때). `purged` 는 행을 지우지 않는다
>    (c) 수동 영구 삭제도 이미 내리지 않는다(`trash.ts` — "그동안 첨부 스토리지도 GC 하면 안 된다").
> ④ **누가** — 세션 없는 시스템 주체(§3.10 [보강] ⑤). 권한을 묻지 않는다 — 규칙은 "만료된 것만"이다. 한 판에 100 묶음 — 남았으면 곧
>    다시(1분), 다 했으면 한 시간 뒤.

**[보강] 물리 삭제** ⟨히스토리 · 활동 4b-2 · F-11-06 / 마이그레이션 0070 · 공용 스케줄러의 세 번째 소비자 `trash_hard_delete`⟩

> 위 전이표의 마지막 행(`purged` → 물리 삭제, `purged_at` + `PURGED_HARD_DELETE_DAYS`)을 하는 일이다.
>
> ① **단위는 묶음** — 자동 비우기와 같다. 루트를 먼저 `SKIP LOCKED` 로 잠그고 쥔 쪽이 있으면 건너뛴다. 묶음의 페이지가 **모두**
>    `purged` 이고 그 `purged_at` 이 30일 지났을 때만 지운다(하나라도 아니면 기다린다).
> ② **다른 묶음의 자손이 남아 있으면 기다린다** — 묶음의 페이지를 조상 경로(`ancestor_path`)에 품은 다른 묶음의 페이지(따로 먼저
>    버린 하위 페이지)가 있거나, 루트가 소스인데 그 소스 아래 다른 묶음의 행이 남아 있으면 이번 판은 건너뛴다. 먼저 지우면 (a) 남은
>    페이지의 권한 스코프(`perm_scope_id`)가 가리키는 ACL 이 사라져 **아무도 그 페이지를 휴지통에서 보지 못하고** (b) 소스를 지우면
>    `page` 확장이 CASCADE 로 사라져 남은 행이 돌아갈 자리를 잃는다. 같은 보관 기간이면 따로 먼저 버린 쪽이 먼저 만료되어 먼저
>    지워지므로 대개 기다리지 않는다(보관 기간을 줄였거나 손으로 영구 삭제했을 때 기다린다). 남은 쪽이 되살아나면 B4 가 최상위로
>    옮겨 조상 경로에서 빠진다. **기다리는 묶음은 후보에서 뺀다** — 한 판을 차지하면 뒤의 묶음이 영영 지워지지 않는다.
> ③ **지우는 것** — 묶음의 페이지(행 · 템플릿 포함), 각 페이지의 본문 블록(문서 범위 — 재귀는 페이지에서 멈춘다), 루트가 소스면 그
>    소스. FK 가 없는 것을 직접 지운다: `acl_entry`(node_id) · `doc_update` · `doc_snapshot` · `page_version`(바이트는 커밋 뒤) · 그
>    페이지의 스레드 · 코멘트에 단 `reaction`. 나머지는 CASCADE 가 지운다(`page` 확장 · 셀 · 관계 간선 · 파생값 · 검색 문서 · 출발
>    링크 간선 · 스레드와 코멘트 · 알림 · 즐겨찾기 · 최근 방문 · 구독 · 잠금 · 활동 · 소스면 속성 · 뷰 · 부착 · 레이아웃).
>    **남는 것** — 다른 페이지에서 이 페이지를 가리키던 멘션 · 링크(`link_edge.target_id` — purged 일 때처럼 "없는 페이지"로 보인다) ·
>    감사 기록(`audit_event`) · 올린 파일의 행(참조가 0 이 되면 파일 GC 의 몫 — FS1).
> ④ **참조를 내린다**(휴지통 자동 비우기 ③) — 지우는 본문 블록의 이미지(본문 프로젝터와 같은 셈 `countFileReferences`) · 지우는
>    페이지의 파일 아이콘 · 지우는 버전이 담은 이미지(S5 — 기록과 같은 셈 `versionFileReferences`). 삭제와 같은 트랜잭션 · 바닥은 0.
>    버전의 바이트는 트랜잭션 **바깥에서** 먼저 읽어 센다(버전 GC 와 같다 — `purged` 페이지의 버전은 더 생기지 않는다).
> ⑤ 시스템 주체 · 알림 · 실시간 신호 없음. 한 판 50 묶음 — 남았으면 곧 다시(1분), 다 했으면 한 시간 뒤.

**공개 API 투영 규칙 (Notion 계약 유지)**

| 내부 | API |
|---|---|
| `lifecycle='trashed'` | `in_trash: true` (`archived` 는 노출하지 않음) |
| `parent_type='block'` (부모가 page) | `{"type":"page_id", ...}` |
| `parent_type='block'` (부모가 일반 블록) | `{"type":"block_id", ...}` |
| `parent_type='data_source'` | `{"type":"data_source_id", ...}` |
| `parent_type='teamspace'` 또는 `'workspace'` | `{"type":"workspace","workspace":true}` |

**정본 상수**

| 상수 | 값 | 근거 |
|---|---|---|
| `TRASH_DAYS_DEFAULT` | 30 (범위 1~3650, Enterprise 만 변경) | help/custom-data-retention-settings |
| `PURGED_HARD_DELETE_DAYS` | 30 (사용자·API 미노출 GC 지연) | help/duplicate-delete-and-restore-content |
| `ORDER_KEY_MAX_LEN` | 32 | 클론 선택 |
| `MAX_TREE_DEPTH` | 100 (초과 시 명시적 에러) | `[확인필요]` §6-1 |

**[보강] 가져오기 — 마크다운 · 평문 파일** ⟨잔여 묶음 8m-1 / 마이그레이션 0049(엔타이틀먼트 줄만)⟩

> 09 F-09-12 *"Markdown / TXT — 1 파일 = 1 페이지. 헤딩·리스트·코드블록 변환 … 클론 시 현실적 대안: v1은 Markdown/ZIP 두 개만 … 권한 없음: 임포트
> 대상 부모에 편집 권한이 없으면 시작 자체를 막아야 한다"*.
>
> ① **새 표는 없다** — 가져온 것은 보통의 페이지 · 본문이다. 페이지는 `createPageIn`(하위 페이지를 만들 수 있어야 한다), 본문은 **본문 세션**
> (`openPageBody` — 서버 명령의 본문 쓰기 길 하나 · 복제와 같다)으로 쓴다. `import_job` 표는 비동기 · ZIP 의 부분 성공이 생길 때(8m-2) 판단한다.
> ② **파서는 렉서만 빌린다**(`marked` — MIT · 의존성 없음) — 토큰 나무를 우리 블록으로 옮긴다: 헤딩(4~6 은 3) · 문단 · 목록 셋(중첩은 자식) ·
> 코드(울타리의 언어 → 저장 이름 · 별칭 · 모르면 평문) · 인용 · 구분선 · 외부 이미지 · 우리 내보내기의 `<details>`(토글) · `<aside>`(콜아웃) —
> 왕복이 닫힌다. 첫 블록이 `# 제목` 이면 페이지 제목이다.
> ③ **크기는 요금제가 정한다** — `import.max_bytes`(Free 5 MiB · 유료 50 MiB · 파일마다). 한 번에 스물 · UTF-8 만.
> ④ **전부이거나 아무것도** — 한 트랜잭션. 파일 하나라도 거부되면 아무 페이지도 남지 않는다.
> ⑤ **옮기지 못한 것은 센다** — 표(행마다 문단으로 남긴다 — 내용은 잃지 않는다) · 블록이 될 수 없는 HTML · 로컬 · 글자 안의 이미지 · http ·
> https · mailto 가 아닌 링크(글자만) · 조각 상한을 넘은 꾸밈. 조용히 버리지 않는다. 주석과 링크 정의는 내용이 아니다.
>
> **ZIP(8m-2a)**
> ⑥ **ZIP 은 의존성 없이 메모리에서 읽는다**(`import/zip-read.ts` — 중앙 디렉터리 · 저장 · deflate · CRC). 파일 시스템에 풀지 않는다. ZIP64 ·
> 여러 조각은 받지 않는다. **폭탄을 막는다** — ZIP 자체는 요금제의 크기(`import.max_bytes`) 안, 선언된 풀린 크기의 합은 그 열 배(그리고 500 MiB)까지,
> 항목은 천까지, 풀 때 선언 크기를 넘는 출력은 멈춘다. 이름은 UTF-8 표시가 없으면 UTF-8 → CP949 순(Windows 의 "압축(ZIP) 폴더").
> ⑦ **폴더 계층이 페이지 나무다**(`import/zip-tree.ts`) — `X.md` 와 같은 자리의 폴더 `X` 는 그 페이지의 자식들(우리 내보내기 · 노션 내보내기가
> 같은 규칙). md 가 없는 폴더는 **폴더만의 페이지**(제목은 폴더 이름 · 계층이 평평해지지 않게). 이름은 대소문자 · NFC 를 무시하고 맞춘다(내보내기의
> `collisionKey` 와 같다). 제목은 `# 제목` → 파일 · 폴더 이름(노션의 32자 id 접미를 뗀다). 페이지는 오백까지(한 트랜잭션).
> ⑧ **ZIP 은 부분 성공이다** — 항목 하나의 문제(안전하지 않은 경로 · 암호 · 모르는 압축 · 깨짐 · 가져올 수 없는 형식 · 같은 이름 · UTF-8 아님)는
> 그것만 건너뛰고 이유와 함께 돌려준다(`skipped`). UTF-8 이 아닌 파일의 자리는 빈 페이지로 남긴다(그 아래 페이지들의 부모다). 놓을 곳 · 깊이의
> 거부는 전부를 되돌린다. 낱 파일 가져오기는 여전히 전부이거나 아무것도(④).
>
> **ZIP 안의 링크 · 이미지(8m-2b)**
> ⑨ **상대 주소가 되살아난다**(`import/zip-links.ts` · `markdownToDoc` 의 `ImportLinks`) — 주소는 그 md 의 폴더에서 출발한다(퍼센트 인코딩을 푼다 ·
> `..` 를 접고 맨 위 밖은 버린다). 다른 페이지의 `.md` · `.txt` 링크는 **페이지 멘션**, 한 줄짜리 링크 문단이 **직속 하위**를 가리키면 그 하위의
> **참조 블록**(우리 · 노션의 내보내기가 하위 페이지를 그렇게 쓴다 — 왕복이 닫힌다). 하위마다 참조는 정확히 하나 — 언급되지 않은 하위는 본문 끝에
> ZIP 의 순서로 선다. 경로 → 페이지 id 맵은 표가 아니다(한 트랜잭션 — 페이지의 id 를 먼저 정하고 파일마다 한 번 읽는다). 한 줄짜리 이미지가 ZIP
> 안의 파일을 가리키면 **올린 파일**(§3.10 `file` · 같은 트랜잭션 · 같은 파일은 하나 · `ref_count` 는 본문 투영이 올린다)의 이미지 블록 — 형식은
> **바이트의 머리로 가린다**(PNG · JPEG · GIF · WEBP · 확장자를 믿지 않는다) · 파일 하나의 상한(5 MiB). 쓰이지 않은 · 큰 · 이미지가 아닌 파일은
> 건너뛴 것(⑧)이다. 트랜잭션이 되돌려지면 저장소에 쓴 객체를 지운다.

---

### 3.5 데이터베이스 · 프로퍼티 · 셀 ⟨C-2/V-2 · C-3 · C-4/V-7 · C-5 · C-6 · C-15⟩

```sql
CREATE TABLE database (                       -- 컨테이너. block(type='database') 의 1:1 확장
  id            uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,   -- [X-2]
  title_rich    jsonb, icon jsonb, cover jsonb,  -- [보강] icon: 페이지 아이콘과 같은 모양 · 없으면 NULL · CHECK(0038) · 8c-3b
  is_inline     boolean NOT NULL DEFAULT true,
  is_full_width boolean NOT NULL DEFAULT false,
  -- is_locked 컬럼 없음 -> node_lock 테이블 [X-9]
  kind          text NULL,                    -- typed database: tasks|projects|skills
  dependency_shift_mode text CHECK (dependency_shift_mode IN ('overlap_only','maintain_gap','never')),
  avoid_weekends boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);

CREATE TABLE data_source (                    -- 스키마와 행 집합의 소유자 <C-5>
  id                    uuid PRIMARY KEY,
  owner_database_id     uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,   -- 소유(단일)
  parent_data_source_id uuid NULL REFERENCES data_source(id),   -- 외부 동기화 전용 <W2 / 15>
  name                  text NOT NULL,
  origin                origin_kind NOT NULL DEFAULT 'native',  -- <15 R3>
  schema_version        bigint NOT NULL DEFAULT 1,              -- stale 스키마 쓰기 차단
  change_seq            bigint NOT NULL DEFAULT 0,              -- [X-5] ds 채널 gap 감지 축
  unique_id_counter     bigint NOT NULL DEFAULT 0,              -- UPDATE...RETURNING 으로만 발급
  unique_id_prefix      text NULL,                              -- [보강] 대문자 영숫자 2~7자 · 카운터와 함께 data source 의 것(0050 · 아래 [보강] 고유 ID)
  -- [보강] 수명주기(0043 · 8e-3a) — 블록과 같은 세 값 · 같은 시각 열. X-3 은 블록의 축이고 data source 는 블록이 아니다(아래 [보강] ⑩)
  lifecycle             block_lifecycle NOT NULL DEFAULT 'live',
  trashed_at timestamptz NULL, trashed_by uuid NULL REFERENCES "user"(id),
  purge_after timestamptz NULL, purged_at timestamptz NULL,
  -- CHECK (블록의 ck_lifecycle_ts 와 같은 모양 · 휴지통이면 purge_after 도 있다)
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
-- [보강] 불변식 DSL1: 살아 있지 않은 data source 에는 살아 있는 행(`type='page' AND parent_type='data_source'`)이 없다 — 지연 제약 트리거(0043).

CREATE TABLE database_data_source (           -- 부착. 소유와 다른 축 <C-5>
  database_id    uuid NOT NULL REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  order_idx      text NOT NULL,
  PRIMARY KEY (database_id, data_source_id)
);
-- 불변식 DS1: 모든 data_source 는 (owner_database_id, id) 부착 행을 정확히 1개 갖는다.
-- 불변식 DS2: is_linked 는 컬럼이 아니라 파생값이다:
--            is_linked(row) := (row.database_id <> data_source.owner_database_id)
-- 불변식 DS3: 소유 행(database_id = owner_database_id) DELETE 금지.
--            linked 행 제거는 부착 해제(원본 무손상), 소유 행 제거는 data_source 삭제여야 한다.
-- [보강] DS1 의 "적어도 1개" · DS3 은 지연 제약 트리거가 커밋 때 본다(0042 · 8e-1) — 아래 [보강] 다중 data source ⑥.

CREATE TABLE property (                       -- <C-4> id 는 전역 유니크 text
  id             text PRIMARY KEY,            -- nanoid(21, base62). 이름 변경에 불변
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  type           property_type NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}',
  order_idx      text NOT NULL,               -- 스키마 기본 순서(뷰별 순서와 별개)
  origin         origin_kind NOT NULL DEFAULT 'native',   -- <15 R2> 축 1
  writable       text NOT NULL DEFAULT 'local'            -- <15 R2> 축 2 (origin 과 독립)
                 CHECK (writable IN ('readonly','write_back','local')),
  can_pin            boolean NOT NULL DEFAULT true,       -- <16 R4> 배치 능력
  can_place_in_panel boolean NOT NULL DEFAULT true,       -- <16 R4>
  deleted_at     timestamptz NULL,            -- soft delete(복원·undo)
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  -- [정정] 전체 UNIQUE → **부분 UNIQUE**. 근거는 이 블록 다음.
  -- UNIQUE (data_source_id, name)            -- <V-7> 확정. 대소문자 구분
);
CREATE UNIQUE INDEX ON property (data_source_id, name) WHERE deleted_at IS NULL;  -- [정정]
CREATE INDEX ON property (data_source_id) WHERE deleted_at IS NULL;
-- 불변식 P1: data_source 당 type='title' 인 살아있는 property 는 정확히 1개.
-- 불변식 P2: property.id 는 어떤 경로로도 변경되지 않는다(rename 은 name 만 바꾼다).
-- 불변식 P3: API 직렬화 계층만 title 프로퍼티에 별칭 "title" 을 수용/노출한다. 저장은 언제나 실제 id.
-- 불변식 P4: name 해석은 정확 일치(대소문자 구분) 1건. 0건이면 400. 대소문자 무시 폴백 없음.
-- 불변식 P5: origin='external' 과 writable 은 독립이다.
--            "제목은 못 고치는데 우선순위는 고칠 수 있다"가 표현되어야 한다.
```

**[정정] `UNIQUE (data_source_id, name)` → 살아있는 행에만 거는 부분 UNIQUE** ⟨W8-a / 마이그레이션 0013⟩

> 초판의 전체 UNIQUE 는 **이 표에 `deleted_at`(soft delete)이 있다는 사실과 충돌한다.**
> 그대로 두면 "상태" 프로퍼티를 지운 뒤 같은 이름으로 다시 만들 수 없다 — 지운 행이
> 이름을 **영구히** 점유한다. 실측으로 확인했다: 원안대로 전체 UNIQUE 를 걸면
> `deleted_at` 을 채운 뒤의 동명 INSERT 가 `duplicate key value violates unique
> constraint` 로 거부된다.
>
> 사용자가 즉시 부딪히는 버그이고, `deleted_at` 을 "soft delete(복원·undo)"로 둔
> 이 표의 주석과도 어긋난다. V-7 이 확정한 것은 *"동명 프로퍼티 금지 + 대소문자
> 구분 + 정확 일치 해석"* 이고, 그 판결의 근거는 *"data source 의 `properties` 가
> **name 키 객체**"* 다 — 그 객체에는 **지워진 프로퍼티가 애초에 들어가지 않는다.**
> 즉 부분 UNIQUE 가 V-7 을 어기는 것이 아니라 V-7 의 범위를 정확히 맞추는 것이다.
>
> 대소문자 구분은 그대로 유지한다(불변식 P4). **`select_option` 은 반대로 대소문자
> 무시 유니크**이고, 이것은 1차 출처가 둘을 따로 명시한 것이다 — 같아 보인다고
> 맞추면 둘 다 틀린다. 마이그레이션 0013 의 프로브가 두 규칙을 각각 확인한다.

**[추가] `property_type` · `option_color` ENUM 정의** ⟨W8-a / 마이그레이션 0013⟩

> 이 문서는 두 타입을 **쓰면서 정의하지 않았다.** 값 목록은 `03-database-core.md` 의
> 프로퍼티 전수표(24종, 2026-09-06 에 헬프센터와 API 문서를 2차 대조)와 그 아래
> *"옵션 색상 enum: default, gray, brown, orange, yellow, green, blue, purple, pink, red"*
> 에 있다. 마이그레이션 0013 이 그 목록을 그대로 옮겼다.
>
> **24종을 한 번에 넣었다.** MVP 가 쓰는 것은 6종뿐이지만, `ALTER TYPE … ADD VALUE`
> 로 추가한 값은 **같은 트랜잭션에서 쓸 수 없으므로** 나중에 넣으면 타입 추가와
> 사용이 마이그레이션 두 개로 갈라진다.
>
> `option_color`(10색)는 `format.block_color`(19색)와 **다른 집합**이다. 1차 출처가
> 둘을 따로 열거한다.
>
> 03 문서가 권한 `property.api_exposed boolean`(`button`·`verification` 이 API 에
> 없으므로)은 **두지 않았다** — 그 값은 `type` 의 함수이므로 컬럼으로 두면 두 곳이
> 어긋날 수 있다. 애플리케이션의 타입별 상수표에서 읽는다.

```sql
CREATE TABLE select_option (
  id uuid PRIMARY KEY,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name text NOT NULL, color option_color NOT NULL,
  group_id uuid NULL, order_idx text NOT NULL,
  UNIQUE (property_id, lower(name))           -- 1차 출처: 이름은 대소문자 무시 유니크
);

CREATE TABLE page (                           -- DB 행 전용 1:1 확장. 일반 페이지는 행이 없다 <C-3>
  id             uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,   -- [X-2] 확정
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,-- block.parent_id 의 파생 캐시
  is_template    boolean NOT NULL DEFAULT false,
  unique_seq     bigint NULL,                  -- [보강] ID 프로퍼티가 살아 있을 때 발급 · 템플릿은 NULL(U2 · 0050 · [보강] 고유 ID)
  origin         origin_kind NOT NULL DEFAULT 'native',   -- <15 R1> external -> native 승격 가능
  -- 파생 읽기 모델. 정본 아님. 애플리케이션 직접 쓰기 금지
  properties_cache jsonb NOT NULL DEFAULT '{}',           -- {"<property_id>": <typed value>}
  search_tsv     tsvector,
  cache_version  bigint NOT NULL DEFAULT 0
);
CREATE INDEX ON page (data_source_id, is_template);
CREATE INDEX ON page USING gin (search_tsv);
-- 불변식 R1: 모든 뷰/API 쿼리는 기본 조건으로 is_template=false 를 강제한다.
-- 불변식 R2: properties_cache / search_tsv 는 page_property_value 변경 트리거로만 갱신된다.
--            캐시가 깨지면 복구는 항상 EAV 로부터의 재생성이다. 캐시를 정본으로 승격하지 않는다.
-- 불변식 R3: page.id 가 참조하는 block 은 type='page' AND parent_type='data_source' 여야 한다.
-- 불변식 R4: page 테이블에는 order_idx / lifecycle / deleted_at 이 없다.
--            행 순서는 block.order_key, 삭제는 block.lifecycle 이다.
-- 불변식 R5: page 테이블에 레이아웃 관련 컬럼을 두지 않는다(16 R5, negative requirement).

CREATE TABLE page_property_value (            -- 셀 값 EAV 정본 <C-2/V-2>
  page_id     uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value       jsonb NOT NULL,                 -- 타입별 판별 유니온(정본)
  -- 정렬/필터/인덱싱용 사이드카. value 에서 파생, 같은 트랜잭션에서 동시 갱신
  num_value   numeric NULL, text_value text NULL,
  date_start  timestamptz NULL, date_end timestamptz NULL,
  bool_value  boolean NULL,
  filled_by   text NULL CHECK (filled_by IN ('user','ai','automation','template','import','external')),
  manually_overridden boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (page_id, property_id)
);
CREATE INDEX ON page_property_value (property_id, num_value)  WHERE num_value  IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, date_start) WHERE date_start IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, lower(text_value) text_pattern_ops)
                                                              WHERE text_value IS NOT NULL;
CREATE INDEX ON page_property_value (property_id, bool_value) WHERE bool_value IS NOT NULL;
-- 불변식 C1: 자동 메타 4종(created_time/created_by/last_edited_time/last_edited_by)과 unique_id 는
--            이 테이블에 행을 만들지 않는다 — block/page 에서 투영한다.
--            formula/rollup 도 만들지 않는다 — derived_value 소관.
-- 불변식 C2: relation 값은 이 테이블에 저장하지 않는다. relation_edge 가 유일한 정본.
-- 불변식 C3: [X-4] 셀 값은 CRDT 밖이다. 병합 단위는 (page_id, property_id) 행이며
--            쓰기는 서버 명령 경로(V-5 경로 2)로만 이루어진다.

CREATE TABLE relation_edge (                  -- relation 의 유일한 정본
  property_id  text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  from_page_id uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  to_page_id   uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx    text NOT NULL,                 -- relation 셀 내 표시 순서
  role         text NULL CHECK (role IN ('sub_item','dependency')),   -- [보강] 자식→부모 엣지에만 · 트리거가 매긴다(0051 · 아래 [보강] 하위 항목)
  owner        text NOT NULL DEFAULT 'user'   -- <15 R8> sync 가 만든 엣지를 사용자 엣지와 구분
               CHECK (owner IN ('user','sync')),
  PRIMARY KEY (property_id, from_page_id, to_page_id)
);
CREATE INDEX ON relation_edge (property_id, to_page_id);   -- rollup 무효화 전용
CREATE INDEX ON relation_edge (to_page_id);                -- 전 프로퍼티 역참조(백링크)
-- 불변식 E1: 양방향 relation 은 property.config.synced_property_id 로 짝을 맺고,
--            엣지 삽입/삭제는 두 프로퍼티에 대해 같은 트랜잭션에서 대칭 수행한다.
-- 불변식 E2: sub-item/dependency 용 parent_row_id 같은 비정규화 컬럼을 두지 않는다.
-- 불변식 E3: owner='sync' 인 엣지만 동기화가 삭제할 수 있다. 사용자 엣지는 건드리지 않는다. <15 R8>

CREATE TABLE property_dependency (
  dependent_property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  source_property_id    text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  via_relation_id       text NULL REFERENCES property(id) ON DELETE CASCADE,
  PRIMARY KEY (dependent_property_id, source_property_id)
);

CREATE TABLE derived_value (                  -- formula / rollup 값 캐시
  page_id uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  value jsonb, num_value numeric NULL, text_value text NULL, date_start timestamptz NULL,
  date_end timestamptz NULL, bool_value boolean NULL,   -- [보강] derived_value ① — 칸과 같은 다섯 축(0062)
  stale boolean NOT NULL DEFAULT true, computed_at timestamptz NULL,
  PRIMARY KEY (page_id, property_id)
);
CREATE INDEX ON derived_value (property_id) WHERE stale;
CREATE INDEX ON derived_value (property_id, num_value) WHERE NOT stale AND num_value IS NOT NULL;
-- 불변식 D1: formula/rollup 필터·정렬은 derived_value 의 사이드카 컬럼으로만 컴파일된다.
```

**[보강] `relation_edge` 의 규칙 — 캐시 투영 · 끝점 · 양방향 대칭의 집행** ⟨relation 5a조각 / 마이그레이션 0024⟩

초판은 표와 불변식 C2 · E1 을 적었지만 **그것을 무엇이 지키는지**는 적지 않았다. C-2 판결문(`_canon/database.md`)의
*"properties_cache 에만 렌더용 배열로 투영된다"* 도 이 문서에는 빠져 있었다. 셋을 보탠다.

- **캐시 투영(C2 · R2 의 보강).** `properties_cache` 는 EAV 와 **`relation_edge` 를 함께 읽어** 재생성한다 — R2 의
  "`page_property_value` 변경 트리거로만"은 "그리고 `relation_edge` 변경 트리거로"까지다. 두 트리거가 **같은 함수**를
  부른다(재생성 규칙이 하나다). relation 칸의 모양:

  ```json
  "<property_id>": {"type":"relation","relation":[{"id":"<to_page_id>"}, …],"count":<전체 개수>}
  ```

  배열은 `order_idx` 순 **앞 25개**(노션 API 가 relation 을 25개 + `has_more` 로 주는 크기), `count` 는 전체다. 03 F-03-10:
  *"한 셀에 수천 개 연결 → 상위 N개 + '+N개 더'."* ★ 캐시의 id 는 **걸러지지 않았다** — 볼 수 없는 행 · 휴지통에 간 행이
  섞여 있다. 권한은 사람마다 달라 캐시에 넣을 수 없고, 휴지통은 되돌릴 수 있어 엣지를 지우지 않는다(03: *"복원 시
  되살아나야 함"*). 제목을 붙이며 거르는 것은 읽는 쪽이다.
- **불변식 RE1(끝점).** 엣지는 `type='relation'` 프로퍼티의 것이고, `from_page` 는 그 프로퍼티의 data_source 의 행,
  `to_page` 는 `config.target_data_source_id` 의 행이다. FK 는 "행이다"까지만 본다 — 다른 표의 행을 가리키는 엣지는
  rollup 이 엉뚱한 스키마의 프로퍼티를 읽게 만든다. 다른 표를 봐야 해서 CHECK 이 아니라 트리거다.
- **E1 의 집행.** 03 F-03-10 은 *"엣지 1행 + 역방향 조회"* 를 권하며 *"2행 복제는 동시성에서 반드시 불일치를 만든다"* 고
  했다. **정본 E1(두 행 · 같은 트랜잭션)이 이긴다** — 어느 방향의 칸이든 `WHERE property_id = ? AND from_page_id = ?` 한
  모양으로 읽고, 방향마다 칩 순서를 따로 갖는다. 03 이 걱정한 불일치는 **지연 제약 트리거**(`DEFERRABLE INITIALLY
  DEFERRED`)가 커밋 시점에 막는다: 넣은 엣지 (P, a→b) 에 짝 S 가 있으면 (S, b→a) 가 있어야 하고, 지운 엣지는 P 와 S 가
  아직 있으면 거울상도 없어야 한다. 애플리케이션이 거울상을 빠뜨리면 **트랜잭션이 죽는다.** 물리 삭제로 CASCADE 된
  엣지는 검사하지 않는다(그 프로퍼티가 이미 없고, 페이지가 사라지면 양쪽 엣지가 함께 CASCADE 된다).
- `property.config`(relation): `{"target_data_source_id", "synced_property_id"?, "limit"?: "one"}`. **같은 표를 가리키는
  프로퍼티 하나가 양쪽으로 동작할 때는 자기 자신이 짝이다**(`synced_property_id` = 자기 id) — 03: *"자기참조는 프로퍼티
  1개로 양방향 동작이 기본."* 역방향 프로퍼티는 `limit` 을 물려받지 않는다.
- 거울상 엣지는 **시스템이 유지하는 투영**이다. 연결 명령은 대상 표의 `edit_content` 를 요구하지 않고(대상 행을 **볼 수
  있어야** 한다), 대상 행의 `block.version` · `last_edited_*` 를 올리지 않는다 — 그 행을 고친 사람이 없다.
- **[보강 10n-36] 내보내기(CSV · 행 Markdown)의 relation 칸** — 캐시가 아니라 **엣지를 읽는다**(캐시는 앞 25개 · 걸러지지 않은 id).
  스냅샷의 같은 읽기 트랜잭션에서, 내보내는 행들의 relation 프로퍼티 엣지를 칩 순서(`order_idx`)로 한 번에 읽고 표 화면과 같은 규칙으로
  가른다 — 볼 수 있으면 제목(비었으면 "제목 없음") · 살아 있지만 볼 수 없으면 **개수만** · 휴지통 · 템플릿 행은 빠진다. 글자는 제목을
  `, ` 로 잇고, 볼 수 없는 것이 있으면 뒤에 `(볼 수 없는 항목 N개)` — 조용히 빼면 연결이 없는 것과 구분되지 않는다(rollup 의 `hidden` 과
  같은 이유). 개수는 relation 칸이 이미 보여 주는 것이라 새는 것이 없다. 제목은 사람이 쓴 글자라 CSV 의 수식 막기 대상이다. 하위 항목 ·
  종속 관계의 짝도 relation 프로퍼티라 같이 나간다.
- **[보강 10n-38] 칸 비우기(표의 `Delete`)** — 연결 명령이 `clear` 를 받는다: **보이는 연결**(대상 표를 볼 수 있고 살아 있는 · 템플릿이
  아닌 행)을 모두 뺀다. 같은 트랜잭션에서 그 목록을 읽어 빼기의 길(`linkRowsIn` — 권한 · 잠금 · 거울상 · 버전)로 넘긴다. 볼 수 없는 표의
  연결과 휴지통의 연결은 **남는다** — 화면이 보여 준 것만 지운다(보지 못한 것을 지우면 되돌릴 수 없는 일을 모르고 한다 · 휴지통의 행을
  되살리면 칸에 돌아온다는 규칙도 지킨다). 그래서 "이 목록으로 바꿔라"(통째 덮기)를 받지 않는다는 규칙과 부딪치지 않는다 — 덮기가 아니라
  읽은 그 시점의 보이는 연결 빼기다. 더하기 · 빼기와 함께 보내면 거부한다. 비울 것이 없으면 아무것도 쓰지 않는다(버전 그대로).
- **[보강 10n-40] 편집기의 "더 보기"** — 칸의 칩은 캐시의 앞 25개뿐이고, 행 고르기 편집기가 지금 연결을 다시 읽는다(볼 수 있는 · 살아 있는
  것만 · 제목과 함께). 한 번에 50개씩 칩 순서의 커서(`(order_idx, id)` — keyset · 앞이 바뀌어도 밀리지 않는다)로 읽고, 더 있으면 "더 보기" 가
  다음 페이지를 붙인다(전에는 첫 페이지에서 멈춰 50개 뒤의 연결은 볼 수도 끊을 수도 없었다 — 03 F-03-10 *"한 셀에 수천 개 연결 → 상위 N개 +
  '+N개 더'"* 의 "더" 쪽). 붙일 때 이미 있는 행은 거른다 — 편집기를 연 사이 고른 행은 목록 끝에 먼저 붙고 다음 페이지가 다시 싣는다.
- **[보강 10n-41] 만들며 잇기(행 고르기의 "+ 새로 만들기")** — 03 F-03-10 *"셀에서 + 새 페이지"*. 찾은 글자를 제목으로 **대상 표에** 행을
  만들고 이 칸에 잇는다 — 행 만들기와 잇기를 **한 트랜잭션**에서(하위 항목 `+` 와 같은 모양). 둘로 나누면 잇기가 실패할 때 아무 데도
  이어지지 않은 행이 대상 표에 남는다. 권한은 둘 다 — 이 칸을 고칠 수 있고(잠금 · 읽기 전용 속성 포함) 대상 표에 만들 수 있어야 한다.
  어느 쪽이 거부하면 행도 연결도 남지 않는다. 대상 표를 볼 수 없으면 만들지 않는다(만든 사람도 그 행을 볼 수 없다). 제한 `one` 이면
  잇기의 규칙대로 있던 연결을 새 행으로 바꾼다 · 양방향이면 거울상도 선다. 제목은 공백을 접고 비면 거부한다. 라우트는 칸의 주소
  (`…/rows/{rowId}/relations/{propertyId}/create`)라 대상 표를 요청이 말하지 않는다(후보 찾기와 같다).
- **[보강 10n-42] "하나만" 제한 바꾸기** — `config.limit` 을 만든 뒤에 켜고 끈다(`PATCH …/data-sources/{id}/relations/{propertyId}`
  `{ limit: 'one' | 'none' }` · 열 머리 메뉴의 "하나만 연결"). **켜도 이미 여럿이 이어진 칸은 그대로다** — 03 F-03-10 *"기존 값 유지 +
  신규 입력만 제한"* · 그 뒤에 하나를 더하면 그것으로 바뀐다(잇기의 규칙). 끄면 더 고를 수 있다. 저장된 config 의 다른 키(대상 · 짝)는
  다시 쓰지 않고 `limit` 만 넣거나 뺀다 · 역방향 프로퍼티는 따로다(만들 때도 물려받지 않는다). 하위 항목 · 종속 관계의 짝은 받지 않는다
  (부모 하나 · 순환이 그 칸의 개수를 정한다 — `invalid_config`). 구조 고치기(`edit_structure`) · 스키마 잠금 · 판 올림은 다른 속성 명령과
  같고, 이미 그 값이면 쓰지 않는다. 설정을 통째로 덮어쓰는 길(`updateProperty` 의 config)은 여전히 relation 을 받지 않는다.
- **[보강 10n-44] relation 으로 거르기 — 비어 있음 · 비어 있지 않음** ⟨마이그레이션 0113⟩ — 04 F-04-09 의 relation 필터. 카탈로그
  (`filter_operator`)에 `relation` 의 두 연산자(값 없음)를 더한다. relation 의 값은 칸이 아니라 엣지라 사이드카가 없다 — 컴파일러가
  `relation_edge` 를 보는 따로 된 길로 만든다(`EXISTS` — 그 속성의 엣지 중 대상 행이 **살아 있고 템플릿이 아닌** 것). 그래서 칸이
  보여 주는 것(칩 · "볼 수 없는 연결 N개")과 같다 — 휴지통의 행만 이어진 칸은 비어 있고, 되살리면 다시 비어 있지 않다. 볼 수 없는
  행과의 연결도 "비어 있지 않음" 에 든다(개수는 칸이 이미 보여 준다 — 새는 것이 없다). 불변식 D1 은 수식 · 롤업의 것이라 걸리지
  않는다(고유 ID 가 행의 열을 보는 것과 같은 결). **정렬 키로는 받지 않는다** — 값이 집합이라 순서가 없다(저장 경로가 거부하고
  컴파일은 건너뛴다). 포함 · 포함하지 않음(값은 행 하나)은 필터 값의 행 고르개와 함께 뒤에 더한다 → [보강 10n-45].
- **[보강 10n-45] relation 으로 거르기 — 포함 · 포함하지 않음** ⟨마이그레이션 0114⟩ — 카탈로그에 `relation` 의 `contains` ·
  `does_not_contain`(값 하나 — **대상 표의 행 id**)을 더한다. 컴파일은 [보강 10n-44] 의 같은 `EXISTS` 에 `e.to_page_id = 값` 을
  더한 것이다 — 그 행이 휴지통에 있으면 칸이 그 연결을 보여 주지 않으므로 "포함" 도 아니다(되살리면 다시 맞는다). 포함하지 않음은
  `NOT EXISTS` 라 아무것도 이어지지 않은 칸도 맞는다(텍스트 · 사람의 부정과 같다). ① **값의 검사** — 저장 경로는 uuid 만 받는다.
  대상 표의 행인지는 묻지 않는다(다른 표의 행이면 맞는 칸이 없을 뿐이다 — 지운 옵션과 같은 태도). 읽기 경로는 uuid 가 아닌 값을
  만나도 뷰를 깨지 않는다 — 아무 행도 아닌 id 로 묶는다 ② **칩의 이름** — 값은 id 라 칩은 제목 맵(`loadRelationLabels`)으로
  그린다: 볼 수 있으면 제목 · 살아 있지만 볼 수 없으면 "볼 수 없는 행" · 휴지통이거나 없으면 "지워진 행"(규칙은 남는다 — F-03-17).
  볼 수 없는 행으로 거르는 것은 새는 것이 아니다 — 그 행의 id 와 "볼 수 없는 연결" 은 칸의 캐시가 이미 준다 ③ **값 고르개의 후보** —
  행이 없는 자리라 칸의 후보 라우트(행 · 이미 이어진 것을 뺀다)를 쓰지 않는다. 그 표의 relation 속성으로 묻는 새 읽기 —
  `GET …/data-sources/{id}/relations/{propertyId}/candidates?q=` — 표를 볼 수 있어야 하고, 대상 표를 못 보면 빈 목록이다(칸의 후보와
  같은 규칙 · R1 — 템플릿과 휴지통의 행은 없다) ④ **새 행 채우기** — [보강] 필터가 걸린 뷰에서 만든 행은 칸에 값을 적는 길이라
  relation 이 들지 않았다 → [보강 10n-47](그 [보강] 의 ⑧)이 연결하기로 잇는다.
- **[보강 R-1] 상대 날짜로 거르기**(04 F-04-09 · 03 F-03-17 의 전수표 *"past_week · past_month · past_year · this_week · next_week ·
  next_month · next_year"*) ⟨상대 날짜 필터 트랙 R-1 / 마이그레이션 0116⟩ — 0015 의 카탈로그가 "뺀 것" 으로 남긴 평가 시점 의존 연산자를
  들인다. 그때 뺀 까닭은 결과 캐시였다(VW1 — 캐시 키가 평가일로 쪼개진다). **결과 캐시는 아직 없다** — [보강] 사람 속성 ⑪ 의 "나" 와
  같은 태도로, 캐시를 둘 때 그 키에 평가일(또는 04 의 권고대로 편 날짜 경계)을 넣는다. 카탈로그에 날짜(`date` · 결과가 날짜인 수식도
  같은 행을 쓴다)의 일곱을 **값 없이** 더한다 — F-03-17 의 현실적 대안(*"today ± N일 로 단순화"*)은 API 의 일곱 그대로라 따로 두지
  않는다(`today` 연산자는 없다).
  - ① **범위** — 보는 사람의 오늘에서 펴고 **양 끝을 포함**한다(`relative-date.ts`): 지난 1주 · 1개월 · 1년 안 = [오늘 − 그만큼, 오늘] ·
    다음 1주 · 1개월 · 1년 안 = [오늘, 오늘 + 그만큼] · 이번 주 = 오늘이 든 주의 월요일 ~ 일요일(ISO — 그룹의 주 기본값 [보강 B-3] B-3b 와
    같다 · 필터에는 주의 시작 설정을 두지 않는다). 달 · 해를 더하고 빼서 그 달에 없는 날은 그 달의 끝으로 맞춘다(3월 31일 − 1개월 = 2월
    28일 · 2월 29일 − 1년 = 2월 28일). 비교는 다른 날짜 연산자와 **같은 하루 단위**(`date_trunc('day', 시작)` — 날짜 범위 값은 시작만
    본다 · 같음 · 이전 · 이후와 같다) — 같은 필터 안에서 "같음 3/18" 과 "지난 1주 안" 이 다른 날을 보지 않는다.
  - ② **오늘은 평가 컨텍스트의 것**(VW1 `{me, today, current_page}` 의 `today`) — 필터를 SQL 로 바꿀 때 `me` 와 함께 **반드시** 받는다
    (빠뜨리면 타입이 막는다). 세션이 있는 길(표 · 목록 · 갤러리 · 보드 · 캘린더 · 열 집계 · 그룹 · 고친 행이 아직 뷰에 서는가)은 **보는
    사람의 오늘** — 시간대 쿠키([보강 B-3] ① 의 `nc_tz` · 없거나 틀리면 UTC)로 센다. 상대 날짜 그룹과 같은 날이다. 세션이 없는 길은 보는
    사람이 없다 — 공개 화면은 **UTC 의 오늘**(쿠키를 읽으면 같은 게시 페이지가 보는 사람마다 달라진다 · "나" 가 아무도 아닌 것과 같은 결).
  - ③ **화면** — 필터 패널 · 칩은 카탈로그를 그대로 그린다(값 칸이 없는 연산자 · 이름 "지난 1주 안" …). 상대 날짜 규칙이 든 뷰는 서버의
    오늘이 이 기기의 오늘과 다르면(쿠키가 처음 · 시간대가 바뀜) 한 번 새로 받는다([보강 B-3] 의 상대 날짜 그룹과 같은 훅). 자정을 넘겨 열어
    둔 화면은 다음 읽기(새로고침 · 실시간 다시 읽기)에서 새 오늘로 걸러진다. **[R-1b] 그 오늘은 화면의 내용 키에 든다** — 표는 읽은 행을
    자기 상태로 들어 새로 받은 서버 렌더의 행을 그대로는 받지 않으므로, 오늘이 바뀌면 다시 선다(새로 받기만으로는 옛 행이 남던 흔들림 —
    전체 판이 잡았다).
  - ④ **자동화의 조건 — 저장한 사람의 시간대로** ⟨[A-1] 자동화 조건의 상대 날짜 트랙 / 마이그레이션 0118 — 처음(R-1)엔 받지 않았다⟩ —
    트리거를 판정하는 워커에는 보는 사람이 없다. 자동화를 저장하는 요청의 **시간대 쿠키**(① 의 `nc_tz` · 없거나 틀리면 UTC)를
    `automation.time_zone` 에 적고, 워커가 그 시간대의 오늘로 조건을 편다("나" 는 여전히 아무도 아니다). 트리거를 다시 저장하면 그 사람의
    것으로 바뀐다(조건을 마지막으로 정한 사람의 날 · 켜고 끄기 · 이름만 바꾸기는 그대로). 열이 없던 자동화 · 버튼은 UTC. 값은 IANA 이름
    (앱이 `Intl` 로 거른다) · DB 는 모양만(CHECK `ck_automation_time_zone`). 편집기의 고르개도 상대 날짜를 싣는다.
  - ⑤ **새 행 채우기** — 상대 날짜 규칙은 값을 채우지 않는다(범위 안의 어느 날을 고를지 정할 수 없다 — §3.6 [보강] 필터가 걸린 뷰에서
    만든 행은 값이 하나로 정해지는 규칙만 채운다). 고친 행이 그 범위 밖으로 나가면 "조건 밖" 안내가 선다(§3.6 [보강] 고친 카드가 뷰의
    조건 밖으로 나가면 — 판정도 보는 사람의 오늘로).

**[보강] 하위 항목(sub-item) — 같은 표의 relation 짝 · 엣지의 `role` · 부모 하나 · 순환 없음** ⟨DB 심화 2b-1조각 · F-03-18 / 마이그레이션 0051⟩

초판은 `relation_edge.role`(`sub_item` · `dependency`)과 불변식 E2(*"`parent_row_id` 같은 비정규화 컬럼을 두지 않는다"*)만 두고
**어느 엣지에 role 이 붙는지 · 누가 붙이는지**를 정하지 않았다. 03 F-03-18 의 데이터 모델(`property.relation_role` ·
`page.parent_row_id` · `page.ancestor_path`)은 이 문서가 이긴다 — 엣지가 정본이고 계층을 행에 복사하지 않는다.

- ① **하위 항목은 relation 의 특수화다**(03 *"별도 프로퍼티 타입이 아니라"*). 켜면 **같은 표를 가리키는 양방향 relation 짝**이
  생긴다 — "상위 항목"(`limit: 'one'`) · "하위 항목". 둘의 `property.config` 에 `"sub_items": "parent" | "children"` 를 단다.
  표마다 살아 있는 짝은 하나(불변식 SI1 · `ux_property_sub_items`) · 표시는 relation 에만 · 같은 표를 가리키는 relation 에만
  (`ck_property_sub_items`).
- ② **`role='sub_item'` 은 자식 → 부모 엣지(상위 항목 프로퍼티의 엣지)에만 붙는다.** 거울상(부모 → 자식)은 표시용 투영이라
  `NULL` 이다. **DB 가 매긴다** — 엣지를 넣거나 고칠 때 트리거가 프로퍼티의 표시에서 `role` 을 다시 정한다(애플리케이션이
  쓰는 값은 덮인다).
- ③ **부모는 하나다**(불변식 SI2 · `ux_relation_edge_one_parent` — `(property_id, from_page_id) WHERE role='sub_item'`). 하위
  항목 칸에 행을 더하면 그 행은 **옮겨 온다** — 있던 부모와의 엣지(와 그 거울상)를 같은 명령이 뺀다.
- ④ **순환은 없다**(불변식 SI3). 자기 자신 · 자기 자손을 부모로 둘 수 없다. 명령이 먼저 묻고(이유를 말한다), 지연 제약
  트리거(`tg_relation_edge_no_cycle`)가 커밋 때 다시 본다 — 두 사람이 동시에 서로를 부모로 두는 경쟁도 거기서 막힌다.
- ⑤ **끄면 일반 relation 으로 남는다**(03 권고 · 노션 실동작 `[확인필요]`) — 표시를 떼고 엣지의 `role` 을 지운다. 엣지 ·
  "하나만" 제한은 남는다. 짝의 한쪽을 따로 지울 수 없다(`managed_property`) — 끄기가 그 길이다.
- ⑥ **휴지통**: 부모가 휴지통에 가도 엣지는 남는다(relation 의 규칙 그대로 · 복원하면 되살아난다). 읽는 쪽이 살아 있지 않은
  부모를 없는 것으로 본다 — 자식은 최상위로 보인다(03 의 "승격"을 데이터를 바꾸지 않고 얻는다).
- 미룬 것: 있는 relation 짝을 하위 항목으로 쓰기(옮기기 전에 부모 여럿 · 순환을 검사해야 한다) · 깊이 상한(03 의 권고 10 —
  노션 문서에 없다. 화면이 지연 로딩한다) · 뷰의 `sub_item_display`(평평한 목록 — 23번 트랙) · ~~`sub_item_filter_scope`~~ 아래 [보강 P-1].

**[보강 P-1] 하위 항목의 표시 범위 — 필터를 거는 층 · 맞는 자손의 조상은 회색으로** ⟨23번 트랙 P-1 · F-04-22 · F-03-18 / 마이그레이션 0119⟩

초판의 DDL 은 `view.sub_item_filter_scope` 칸만 두었다(위 [보강] 하위 항목의 "미룬 것"). 노션 도움말(*Sub-items · Filter options*):
*"Parents only: Parents that match your filters will display, along with the number of sub-items they have"* · *"Parents and sub-items:
Parents and sub-items that match your filters will display"* · *"Sub-items only: Sub-items that match your filters will display"* · *"For
board, calendar, and gallery views, only the Parents only filter option is supported"*. 04 F-04-22 의 엣지 *"부모는 필터 탈락, 자식은 통과 —
클론은 부모를 비활성 회색 행으로 표시할 것"*.

- ① **저장** — `parents`(부모만) · `sub_items`(하위만) · NULL(부모와 하위 — 기본). 기본을 따로 적지 않는다 — 같은 뜻의 표기가 둘이면
  갈라진다(API 는 `both` 로 읽고 쓰되 NULL 로 저장한다). CHECK `ck_view_sub_item_filter_scope`(0119). **공유 설정이다** — 필터의 뜻을
  바꾸는 설정이라 같은 링크를 연 두 사람이 다른 행을 보면 안 된다(필터와 같이 `edit_structure` · 개인 필터 2h-1 처럼 사람마다 두지 않는다).
  하위 항목이 켜진 표 · 목록에서만 뜻이 있다 — 보드 · 갤러리 · 캘린더 · 그룹이 걸린 표(G-1)는 늘 부모만이라 칸을 보지 않는다.
- ② **필터가 걸리는 층** — 최상위는 트리의 최상위(살아 있는 부모가 없는 행 — 위 [보강] 하위 항목 ⑥). 부모만: 최상위 행에만(펼치면
  자식은 다 선다) · 하위만: 최상위가 아닌 행에만(최상위 행은 다 선다) · 부모와 하위: 모든 층. 뷰 검색어는 범위와 상관없이 모든 층에
  건다([보강] 뷰 검색 ⑧).
- ③ **맞는 자손이 있으면 조상이 회색으로 선다**(조상 강제 포함) — 행이 **맞는다** = 그 층에 걸리는 필터 ∧ 검색어. 맞지 않아도 아래에
  맞은 행이 있으면 맥락 행으로 선다(검색의 맥락 행과 같은 표시 · 같은 `treeMatch`).
  - **사슬은 읽을 수 있는 살아 있는 행으로 잇는다** — 필터에 맞지 않는 조상도 회색으로 선다. 볼 수 없는 부모 · 휴지통 부모에서는
    멈춘다. 뷰 검색 ⑧ 의 처음 규칙("권한 · 필터를 지난 행으로만")을 이것으로 바꾼다 — 필터와 검색이 한 규칙이 됐다.
  - **부모만은 예외다** — 최상위 행은 스스로 필터에 맞아야 선다(사슬에서도). 자식이 맞아도 끌어올리지 않는다 — "부모에만" 의 뜻.
  - **기본(부모와 하위)의 동작이 바뀐다** — 지금까지는 필터가 층마다 걸려 필터에 걸린 부모 밑의 맞는 자식이 보이지 않았다(HANDOFF
    §3.2-113 ② 가 미룬 "조상 강제 포함").
- ④ **화면** — 맥락 행은 회색(읽는 사람에게는 "조건에 맞지 않는 상위 항목")이고 처음 한 번 저절로 편다 — 아래를 보여 주려고 선
  행이다(사람이 접으면 그대로). 맞은 행은 접힌 채 둔다 — 검색 중에만 맞은 행도 편다(⑧ — 검색은 잠깐 찾는 것이고 필터는 늘 보는
  모양이다). 토글은 표시가 있는 행이면 아래에 맞은 행이 있을 때만, 표시가 없는 행(맞춤이 걸리지 않는 질의 — 부모만의 자식 등)이면
  자식이 있을 때. 범위를 바꾸면 표가 다시 선다(다시 마운트 기준).
  - **[P-2] 고르개** — 도구줄 "속성" 패널의 하위 항목 스위치 밑에 "필터 적용"(부모와 하위 항목 · 부모만 · 하위 항목만 — 노션의 셋 그대로)과
    그 범위에서 무엇이 보이는지 한 줄. 하위 항목이 켜진 표 · 목록에서 구조를 고칠 수 있는 사람에게만 선다(속성 패널이 그렇다) — 보드 ·
    갤러리 · 캘린더 · 그룹이 걸린 표에는 없다(늘 부모만). 고르면 곧바로 뷰에 저장한다(다른 뷰 설정과 같이 저장을 줄 세운다 — §3.3-330).
- ⑤ **결과 행은 범위의 층에서** — 열 집계는 범위가 필터를 거는 층의 맞은 행만 센다(부모와 하위: 모든 층 · 부모만: 최상위 · 하위만:
  최상위가 아닌 행). 맥락 행과 필터가 걸리지 않는 층의 행은 결과가 아니다. "조건 밖"(10n-16)은 "화면에 서는가" 를 묻는다 — 맥락 행도
  선다(같은 질의 · 같은 범위).
- ⑥ **API** — 뷰의 `subItemFilterScope`(`parents` · `both` · `sub_items` — 읽기는 늘 셋 중 하나) · `PATCH /views/{id}` 가 받는다(틀리면
  `invalid_layout`). 평평한 목록은 ⑦.
- ⑦ **[P-3] 평평한 목록 — 표시 범위가 "포함" 이 된다** ⟨23번 트랙 P-3 / 마이그레이션 0120⟩ — 노션 *"Flattened list: This will show all of
  your parent and sub-items in a flat list"* · *"sub-items won't be indented in the list to distinguish them from parent items"* · 범위 고르개의
  이름이 *Include* 가 된다. `view.sub_item_display`(0015 의 칸 · CHECK `ck_view_sub_item_display` 0120): `flattened` · NULL(토글로 중첩 — 기본 ·
  ① 과 같은 까닭으로 따로 적지 않는다 · API 는 `nested` · `flattened`). 하위 항목이 켜진 표 · 목록에서만 — 보드 · 갤러리 · 캘린더의 표시
  방식(*Card property · Flattened list*)은 뒤로(지금은 늘 부모만).
  - **트리가 없다** — 들여쓰기 · 토글 · 맥락 행 · 하위 항목 `+` 가 없다. 행 질의는 트리가 아닌 표와 같다(페이지 · 커서 · 수동 순서 — 정렬이
    없으면 행 끌기 손잡이도 선다 · 10n-60).
  - **포함** — 부모만: 최상위 행만 · 하위만: 최상위가 아닌 행만 · 부모와 하위: 모든 행. 필터 · 검색어는 들어온 행에 그대로 건다(층을 가리지
    않는다 — 들어온 행이 곧 결과다). 열 집계는 ⑤ 의 층 규칙 그대로(들어온 행 = 범위의 층) · "조건 밖" 판정도 같은 포함으로.
  - **화면** — 속성 패널의 하위 항목 스위치 밑에 "표시"(토글로 중첩 · 평평한 목록) · 평평한 목록이면 범위 고르개의 이름이 "포함" 이 되고
    밑의 한 줄도 들어오는 행을 말한다. 바꾸면 표가 다시 선다(다시 마운트 기준).

**[보강] 종속 관계(dependency) — 같은 표의 relation 짝 · `role='dependency'` · 순환 없음 · 날짜는 옮기지 않는다** ⟨DB 심화 2b-3조각 · F-03-18 / 마이그레이션 0052⟩

하위 항목(위 [보강])과 같은 모양이다 — 다른 것만 적는다.

- ① 켜면 같은 표의 양방향 relation 짝 — "선행 작업"(Blocked by — 이 행을 막는 행들) · "후행 작업"(Blocking — 이 행이 막는 행들).
  `config.dependencies: "blocked_by" | "blocking"`. 개수 제한이 없다(막는 행이 여럿일 수 있다). 짝은 표에 하나(DP1 ·
  `ux_property_dependencies`) · 표시는 같은 표를 가리키는 relation 에만(`ck_property_dependencies`) · 한 프로퍼티가 하위 항목과
  종속 관계를 함께 맡지 않는다.
- ② `role='dependency'` 는 **선행 작업 프로퍼티의 엣지**(막히는 행 → 막는 행)에만 붙는다 — 하위 항목과 같은 트리거가 매긴다.
- ③ **순환은 없다**(DP2 — 03 *"순환 종속 → 클론은 저장 시 거부"*). 막는 관계는 트리가 아니라 그래프라(막는 행이 여럿) 위로 걷는 길이
  여럿이다 — 방문한 행을 모으며 걷는다(UNION). 명령이 먼저 묻고 지연 제약 트리거(`tg_relation_edge_no_dependency_cycle`)가 커밋 때
  다시 본다.
- ④ **날짜는 옮기지 않는다** — `database.dependency_shift_mode` 의 `never` 만 쓴다(03 의 클론 대안 *"화살표로 표시만 하고 날짜는
  옮기지 않는 버전으로 시작"*). 자동 이동(겹칠 때만 · 간격 유지)은 타임라인 뷰와 함께 들인다.
- ⑤ 끄면 일반 relation 으로 남는다 · 짝의 한쪽을 따로 지울 수 없다 — 하위 항목과 같다.

**[보강] 프로퍼티 타입 바꾸기 — 같은 id · 한 트랜잭션 · 글을 거치는 변환 · 손실은 확인을 받는다** ⟨DB 심화 2c-1조각 · F-03-14 / 마이그레이션 0053⟩

초판은 타입 변환을 다루지 않았다(불변식 P2 *"id 는 바뀌지 않는다"* 와 0025 의 *"타입이 바뀌는 쪽은 보지 않는다"* 뿐). 03 F-03-14 의
권고(새 프로퍼티를 만들고 스왑 · `property_migration` 표 · 스냅숏 보관)는 v1 에 들이지 않는다 — 아래가 v1 이다.

- ① **id 는 그대로다**(P2) — 같은 프로퍼티의 `type` 을 바꾸고 그 칸을 **한 트랜잭션에서** 다시 쓴다. 03 의 "새 프로퍼티 + 스왑"은
  id 가 바뀌어 뷰 · rollup · 필터의 참조가 전부 끊긴다. 한 트랜잭션이라 "부분 변환" 상태가 없다.
- ② **바꿀 수 있는 쌍은 셀 타입 다섯 사이**(글 · 숫자 · 선택 · 체크박스 · 날짜 — 03 의 클론 대안 *"안전한 변환 쌍만 허용"*). 제목은
  바꿀 수도 바꿔 올 수도 없다(API 문서 명시). relation · rollup · 고유 ID 와 오가는 변환은 아직 없다. 상태는 ⑧(10n-24 — 여섯 타입 사이).
- ③ **변환은 글을 거친다**(03 *"텍스트 경유 허브 패턴"*) — 칸을 글로 읽고(선택은 옵션 이름 · 체크박스는 `Yes` 또는 빈 글 · 날짜는 ISO ·
  범위는 `시작 → 끝`) 새 타입으로 읽는다(숫자 · 날짜는 읽히는 것만 · 선택은 이름마다 옵션 — 같은 이름의 옵션이 있으면 그것 · 체크박스는
  `Yes` · `true` 면 체크). 옛 옵션은 지우지 않는다 — 선택으로 되돌리면 같은 이름이 같은 옵션(색 그대로)으로 돌아온다.
- ④ **손실 = 값이 있던 칸이 빈 칸이 되는 것.** 손실이 하나라도 있으면 **확인을 받는다**(명령이 `lossy_conversion` 과 개수로 거부하고,
  확인을 실어 다시 부르면 바꾼다) — 노션은 묻지 않고 바꾸고 되돌릴 수 없다(03). 되돌리기(스냅숏)는 아직 없다.
- ⑤ **그 속성의 필터 규칙은 지운다** — 값의 뜻이 바뀐다(선택 규칙의 값은 옵션 id 였다). 남기면 조용히 0건이거나 엉뚱한 행이 걸린다.
  예외는 선택 ↔ 상태 — 값이 같은 옵션 id 라 뜻이 바뀌지 않는다(⑧).
  정렬은 남긴다(새 타입으로 정렬된다). 보드의 그룹은 읽을 때 무시된다(묶을 수 없는 타입이면 — 기존 규칙). rollup 은 읽을 때 맞지 않는
  함수를 `show_original` 로 접는다(기존 규칙).
- ⑥ **불변식 CV1: 셀 봉투의 타입은 프로퍼티의 타입과 같다**(`tg_ppv_value_type`). 변환과 엇갈려 옛 타입으로 칸을 쓰는 요청을 DB 가 막는다.
- ⑦ 한 번에 바꿀 수 있는 칸은 1만 개까지(그 위는 백그라운드 잡 — 03 · 아직 없다).
- ⑧ **[보강 10n-24] 상태와 오가는 변환**(03 F-03-05 엣지 *"select → status 변환 — 기존 옵션이 어느 그룹으로 갈지 결정 필요 → 전부
  To-do 로"*) — 바꿀 수 있는 쌍에 상태가 든다. **상태로 갈 때**: 타입을 먼저 바꾸고(SG4 — 그룹은 status 에만 생긴다) 그룹 셋을 만든 뒤
  **그 속성의 옵션을 모두 할 일에** 넣는다(SG3 — status 옵션은 그룹이 있다). 글을 거쳐 새로 생긴 옵션도 할 일이다. 옵션이 하나도 없으면
  (빈 칸뿐인 글 · 숫자 …) 새 상태 속성처럼 기본 셋(시작 전 · 진행 중 · 완료)을 만든다. 기본 옵션은 **첫 옵션**(새 상태 속성 · 위 ④ 와 같은
  규칙) — 새 행의 초깃값일 뿐이라 있던 행의 값은 그대로다. **상태에서 갈 때**: 옵션의 그룹을 비우고 그룹 행을 지운다 · 기본 옵션도
  사라진다(config 를 비운다). 옵션은 지우지 않는다(③) — 그래서 선택 ↔ 상태는 **같은 옵션 id** 가 남고 칸은 봉투만 바뀐다(손실 없음).
  되돌아오면 그룹은 다시 모두 할 일이다 — 그룹을 기억하지 않는다(상태로 바꾼 뒤 그룹은 옵션 고치기 ⑧ 로 옮긴다). **필터**: 선택 ↔ 상태는
  두 타입에 다 있는 연산자의 규칙을 남기고 새 타입에 없는 것(그룹 단위 — 10n-23)만 지운다. 그 밖의 쌍은 ⑤ 그대로 모두 지운다.

**[보강] rollup v1 — 읽을 때 계산한다. `derived_value` · `property_dependency` 는 아직 만들지 않는다** ⟨rollup 5c-1조각 / 마이그레이션 없음⟩

위 DDL 의 `property_dependency` · `derived_value` 는 **정본으로 남는다** — 다만 v1 은 그 두 표를 만들지 않는다. 마스터 문서
§5.2-5: *"rollup 은 v1 에서 **on-read 계산**(1,000행까지 충분)"*, 03 F-03-11 의 현실적 대안도 같다. 읽는 쪽이 없는 표를
미리 만들면 맞는지 확인할 길이 없는 채로 동기화 코드만 는다(삭제 · 복원 · 설정 변경마다). 의존 그래프는 **config 에서
언제든 다시 만들 수 있다**(`INSERT … SELECT` 한 번) — 캐시를 들이는 조각이 표와 함께 채운다.

- `property.type = 'rollup'`(ENUM 에 이미 있다). `property.config`:

  ```json
  {"relation_property_id":"<이 표의 relation 프로퍼티>","target_property_id":"<그 relation 의 대상 표의 프로퍼티>","function":"sum"}
  ```

- **값은 어디에도 저장하지 않는다** — `page_property_value`(C1) 에도 `properties_cache` 에도 없다. 캐시에 넣을 수 없는
  이유는 relation 의 제목과 같다: **결과가 보는 사람마다 다르다**(아래 권한 규칙).
- **불변식 D1 의 귀결**: 필터 · 정렬은 `derived_value` 의 사이드카로만 컴파일되므로, 그 표가 없는 v1 에서 **rollup 은 거를
  수도 정렬할 수도 없다.** 읽을 때 계산한 값으로 정렬하면 페이지네이션(keyset 커서)이 성립하지 않는다.
- **대상 프로퍼티는 셀 타입이어야 한다**(relation · rollup 은 안 된다). 03: *"rollup 의 rollup 은 불가."* formula 가 없는
  동안은 이것만으로 참조 체인이 깊이 1 이고 순환이 없다. formula(F-03-12)가 들어오는 조각이 저장 시점 DFS 와 깊이 15
  제한을 함께 들여야 한다(rollup → formula → rollup 우회로가 그때 열린다).
- **권한 · 휴지통은 집계 *안*에서 거른다.** 볼 수 없는 연결 행과 휴지통의 행은 집계에서 **뺀다**(03 엣지 케이스 표 ·
  마스터 §7-6 ⑧). 볼 수 없어서 뺀 개수는 `hidden` 으로 함께 준다("N개 항목 접근 불가"). 값을 가린 채 집계에 넣으면
  `min` · `max` · `show_original` 이 원본을 역산하게 해 준다. 빼고 나면 집계는 **묻는 사람이 어차피 읽을 수 있는 값만의
  함수**라 새는 것이 없다 — `hidden` 은 relation 칸이 이미 보여 주는 개수다.
- relation 프로퍼티나 대상 프로퍼티가 지워지면(soft delete) rollup 은 **그대로 두고** 읽을 때 "설정이 끊겼다"고 답한다
  (`relation_missing` · `target_missing`). 복원하면 되살아난다 — 함께 지우면 복원이 rollup 을 되살리지 못한다.
- 한 칸의 연결이 **1,000개를 넘으면 계산하지 않고 그렇다고 답한다**(`too_many`). 앞 1,000개만 더한 합은 틀린 숫자이고,
  틀린 숫자는 빈칸보다 나쁘다. 이 상한이 `derived_value` 캐시를 들일 시점의 신호다.
- 함수는 12종(03 의 현실적 대안): `show_original` · `count` · `count_values`(모든 타입) / `sum` · `average` · `min` ·
  `max`(number) / `checked` · `percent_checked`(checkbox) / `earliest_date` · `latest_date`(date — 시작일만 본다) /
  `percent_complete`(status — **[보강 10n-29]** 03 F-03-05 *"'완료' 판정(`Complete` 그룹 소속 여부)은 진행률 계산의 기준"*).
  완료 비율 = 연결 중 셀의 옵션이 **지금** 완료 그룹에 든 것의 비율이다 — 그룹은 읽을 때 옵션에서 본다(옵션을 옮기면 따라온다). 상태가
  빈 연결도 분모에 든다("아직 완료가 아니다" — `percent_checked` 가 체크 안 된 칸을 세는 것과 같다) · 연결 0개면 없음(0% 가 아니다).
  읽을 수 없는 연결은 빠진다(다른 함수와 같다 — 비율이 새는 것이 없다).
  대상 타입에 맞지 않는 함수는 만들 때 거부하고, 읽을 때(타입이 나중에 바뀌었다면) `show_original` 로 접는다.
- **[보강 10n-31] 고치기** — 관계 · 대상 · 함수를 **만든 뒤에 바꾼다**(전에는 지우고 다시 만들어야 했다 — id 가 바뀌어 그것을 읽던 수식 · 뷰의
  열 설정이 끊겼다). 보낸 것만 바꾸고 나머지는 지금 값이다. 검사는 만들기와 **같은 함수 하나**(이 표의 살아 있는 relation · 대상 표를 볼 수
  있다 · 대상은 그 표의 살아 있는 셀 타입 · 함수는 그 타입이 고를 수 있는 것)다 — 관계만 바꾸고 대상을 그대로 두면 대상이 새 관계의 표에
  없어 `invalid_target` 이다. 이미 그 값이면 쓰지 않는다(스키마 판 그대로). `edit_structure` · 스키마 잠금. 화면 — 열 머리 메뉴의 "계산
  바꾸기"(대상 타입이 고를 수 있는 함수 · 지금 것이 눌려 있다). 관계 · 대상을 바꾸는 화면은 [보강 10n-39].
- **[보강 10n-39] 관계 · 대상 바꾸기 화면** — 열 머리 메뉴의 "관계 · 대상 바꾸기"(롤업에만 · **설정이 끊긴 롤업에도** 선다 — 지워진 관계 ·
  대상 대신 다른 것을 이어 되살리는 자리다). 편집기는 지금 설정으로 열리고 관계 → 속성 → 계산을 고른다. 고르는 규칙은 추가 폼과 **같은
  함수**(`resolveRollupSource`)다 — 목록에 없으면 첫째 · 대상은 모을 수 있는 셀 타입만(`isRollupTargetType` — 서버와 같은 술어 · 추가 폼이
  사람 속성을 대상으로 보이던 것이 함께 고쳐졌다) · 계산은 새 대상이 고를 수 있으면 그대로, 아니면 기본으로 접힌다. 관계는 이 표의 **보이는**
  관계형 열에서 고른다(추가 폼과 같다). 관계를 고를 때마다 그 대상 표의 속성을 읽는다(늦게 온 옛 답은 버린다). 바꾸면 고치기의 길(서버의
  같은 검사)로 보내고, 컬럼 설정은 서버 렌더로 · 값은 보이는 행 전부를 다시 묻는다(계산 바꾸기와 같다).
- **[보강 10n-32] 나머지 함수 11종 — 03 의 22종(API enum)이 모두 선다**(+ 완료 비율 = 23종). 위 "12종" 은 그 전의 목록이다.
  모든 타입 — `show_unique`(빈 값을 뺀 고유 값을 처음 나온 순서로 · 앞 25개 · 개수는 전체) · `unique`(빈 값을 뺀 고유 값의 수) · `empty`(빈
  연결의 수) · `not_empty`(값이 있는 연결의 수) · `percent_empty` · `percent_not_empty`(연결 0개면 없음). 고유는 **적힌 값**으로 가른다 — 글은
  평문 · 선택 · 상태는 옵션 id(이름이 같아도 다른 옵션은 다르다) · 날짜는 적힌 시작 · 끝 그대로(`2026-01-05` 와 `…T00:00:00Z` 는 다르게
  그려지므로 다르다) · 체크박스는 참 · 거짓. `count_values` 는 03 의 "값의 수" 다 — 칸 하나가 값 여럿을 담는 타입(다중 선택 · 아직 없다)이면
  하나씩 센다. 지금 대상이 될 수 있는 타입은 모두 칸당 값 하나라 `not_empty` 와 같은 수가 나온다(API 와 화면의 목록은 노션과 같이 둘 다 둔다).
  체크박스에는 빈 값이 없어 `empty` 는 늘 0 이다. number — `median`(가운데 · 짝수면 가운데 둘의 평균) · `range`(최댓값 − 최솟값) — 값이
  없으면 없음. checkbox — `unchecked` · `percent_unchecked`(연결 0개면 없음). date — `date_range`(가장 늦은 시작 − 가장 이른 시작 · **일**
  단위로 반올림 · 시작일만 본다 — `earliest_date` · `latest_date` 와 같은 축) — 날짜가 없으면 없음. 결과 모양에 `days` 가 는다(화면은 "N일").
- **[보강 10n-33] 카드의 배지 — 보드 · 갤러리에도 rollup 이 선다**(전에는 표 · List 만). 값은 표와 같은 길로 온다 — 첫 화면의 카드는
  서버 렌더가 함께 계산하고(보드는 열마다 첫 페이지 · 한 번에 물을 수 있는 500행까지) 그 뒤의 카드("더 보기" · 새 카드)는 화면이
  `POST …/rollup-values` 로 묻는다. 표 변경 신호로 서버 렌더를 다시 부르면 카드와 함께 **다시 계산된 값을 받아들인다**(카드만 새로 그리고
  rollup 은 옛 값이면 안 된다). 다른 배지와 같이 **그릴 것이 없으면 서지 않는다**(받지 못했다 · 없음 · 빈 목록 — `0` · `0%` 는 값이다).
  설정이 끊긴 rollup 은 카드에 세우지 않는다(표의 칸이 그렇다고 말한다). 값이 보는 사람마다 다르다는 것은 그대로다 — 카드도 묻는 사람의
  권한으로 계산한 값을 그린다.
- **[보강 10n-37] 내보내기(CSV · 행 Markdown)의 rollup 칸** — 값은 저장하지 않으므로 스냅샷이 **같은 읽기 트랜잭션** 안에서 표 화면과
  같은 함수로 계산한다(`computeRollupsIn` — `computeRollups` 에서 트랜잭션을 받는 안쪽을 꺼냈다 · 행 수 상한 500 은 화면 요청의 일이라
  안쪽에는 없다 · 칸 하나의 연결 상한 1,000 은 같다). **내보내는 사람의 권한으로** 계산한다 — 볼 수 없는 연결은 집계에서 빠지고 개수만
  남는다. 글자는 화면과 같은 모양 — 수 · 비율(`50%`) · 날짜(적힌 시작) · 날짜 범위(`N일`) · 원본 보기와 고유 값 보기는 대상 칸의 글자를
  `, ` 로(앞 25개 · 넘으면 `+N`) · 볼 수 없는 것이 있으면 뒤에 `(볼 수 없는 항목 N개)` · 연결이 너무 많으면 그렇다고 쓴다(틀린 합을 쓰지
  않는다). 없음은 빈 칸(0 과 가른다). 설정이 끊긴 rollup 은 빈 칸이다. 원본 보기 · 고유 값 보기의 글 · 선택 · 상태 값은 사람이 쓴
  글자라 수식 막기 대상이다.

**[보강] 수식 1단계 — 식은 `⟦id⟧` 자리로 · `property_dependency` 를 들인다 · 값은 읽을 때 계산한다** ⟨DB 심화 2i-1 · 2i-2조각 · F-03-12 / 마이그레이션 0060⟩

마스터 문서 §5.3 2번 트랙 *"formula 는 3단계 점진 도입"* 의 1단계(최소 언어 · 같은 행의 칸만). 위 DDL 의 `property_dependency` 를
**정본 그대로** 만든다(rollup v1 은 만들지 않았다 — 순환 · 깊이를 볼 읽는 쪽이 이제 생겼다). `derived_value` 는 아직이다.

- ① **`property.config = {expression, result_type}`**(`ck_property_formula_config` — 묶음을 `IS TRUE` 로 접는다). 03 F-03-12 의
  `{expression, compiled_ast, result_type, depends_on, ref_depth}` 에서 셋을 뺐다 — 나무(`compiled_ast`)는 읽을 때 식에서 다시
  만든다(싸다 · 언어가 바뀌어도 저장값을 고칠 일이 없다). `depends_on` 은 `property_dependency` 가 정본이다(두 곳에 두면 어긋난다).
  `ref_depth` 는 저장할 때 표 전체로 다시 센다(표에 수식이 몇 개 안 된다 — 캐시가 틀릴 길을 만들지 않는다).
- ② **식은 원문 그대로에 속성 자리만 `⟦id⟧`** — 사람이 쓴 `prop("이름")` 을 저장할 때 id 로 묶는다. 공백 · 주석 · 줄바꿈이 남고,
  이름을 바꿔도 식이 깨지지 않는다(P2 — id 는 바뀌지 않는다). 보여 줄 때 지금 이름으로 되돌린다(따옴표 · 역슬래시 탈출).
  `eval` · `Function` 은 쓰지 않는다(마스터 문서의 금지 — 나무를 걷는 계산기).
- ③ **`property_dependency` — 수식이 읽는 속성마다 한 줄.** 자기 자신을 가리키지 않는다(`ck_property_dependency_not_self`).
  relation 을 타지 않는 간선(`via_relation_id IS NULL`)은 **같은 표의 속성끼리**다(`tg_property_dependency_same_source` — 다른
  표를 봐야 해서 트리거). 1단계는 relation 을 타지 않으므로 모든 간선이 이 줄이다.
- ④ **순환은 거부 · 깊이는 15 까지**(03 *"저장 거부"* — 노션처럼 조용히 틀리지 않는다). 수식이 수식을 읽을 때마다 하나씩
  쌓인다(칸만 읽으면 1). **그래프를 바꾸는 세 명령이 같은 판정을 쓴다** — 만들기 · 식 고치기 · **지운 수식 되살리기**. 지운 수식은
  그래프에 없으므로(잎) 그동안 다른 수식이 그것을 거쳐 돌아오는 길을 만들 수 있다(B 를 지운 사이 A → C, C → B 는 원래 있었다 —
  B → A 인 B 를 되살리면 고리). 되살린 뒤의 그래프로 보고 고리 · 깊이 초과면 되살리지 않는다.
- ⑤ **읽을 수 있는 속성** — 제목 · 글 · 선택 · 상태(옵션 **이름** — 칸의 옵션 id 를 이름으로) → 글, 수 → 수, 체크박스 → 참거짓
  (빈 칸은 거짓), 날짜 → 날짜(칸과 같은 `{start, end?}` 를 **글자 그대로** 읽는다 — 캘린더와 같은 축), 수식 → 그 결과 타입.
  relation · rollup · 고유 ID · 사람 · 파일 · 목록은 다음 단계다(3단계 — relation 순회 · `via_relation_id` 를 쓰는 간선).
- ⑥ **값은 저장하지 않는다 — 읽을 때 계산한다**(rollup v1 과 같은 이유 · `page_property_value` 에도 캐시에도 없다 — C1). 행을 읽은
  뒤 그 행들로 한 번에 계산한다. **식은 읽을 때 지금 스키마로 다시 읽는다** — 저장된 결과 타입을 믿지 않는다. 읽던 속성이 지워졌거나
  타입이 바뀌어 읽히지 않으면 그 컬럼은 **이유를 든 채 빈 값**이다(03 *"참조하던 프로퍼티 삭제 → 수식이 에러 상태"*). 간선은 남아
  속성을 되살리면 돌아온다. 그것을 읽는 수식은 빈 값을 받는다(빈 값은 흐른다). `now()` · `today()` 는 계산하는 순간이다.
  **화면은 같은 함수로 그 행의 칸에서 계산한다**(2i-3a) — 같은 행만 읽으므로 화면이 이미 가진 칸에서 새로 알게 되는 것이 없다. 서버
  렌더가 표의 속성 전부 · 저장된 식 · 옵션 이름 · 지금을 계획으로 내려준다(지금을 박아 서버 렌더와 브라우저가 같은 값을 낸다).
  **[보강 10n-34] 카드의 배지** — 보드 · 갤러리의 카드도 같은 계획으로 그 카드의 칸에서 계산한다(계획은 뷰의 컬럼 **전부**로 — 카드에 보이지
  않는 속성을 읽는 수식도 계산된다). 다른 배지와 같은 규칙이다 — 빈 값(빈 글 · 없음)은 서지 않고, 참거짓은 참일 때만 `☑ 이름` 이다
  (체크박스 배지와 같다). 식이 읽히지 않는 수식은 카드에 세우지 않는다(표의 칸이 "수식 오류" 라고 말한다 — 좁은 카드에 고장 안내가
  쌓이면 값이 묻힌다 · rollup 의 끊긴 설정과 같다 — [보강 10n-33]). 카드를 옮겨 칸이 바뀌면(보드의 열) 그 칸으로 다시 계산된다.
  **[보강 10n-35] 내보내기** — CSV 와 행 Markdown 의 속성 줄에 수식 칸이 선다(전에는 글 타입으로 접혀 빈 칸이었다). 값은 스냅샷이
  **같은 읽기 트랜잭션** 안에서 같은 함수(`compileLiveFormulas` · `evaluateRowFormulas`)로 계산한다 — 그 표의 살아 있는 속성 전부 ·
  저장된 식 · 옵션 이름으로. `now()` 는 **내보낸 시각**(스냅샷의 `exportedAt`)이다. 글자는 결과 타입대로 — 수는 그대로 · 글은 그대로 ·
  참거짓은 체크박스와 같은 `Yes` / `No` · 날짜는 날짜 칸과 같은 모양(범위는 ` → `). 식이 읽히지 않거나 값이 없으면 빈 칸이다(거짓 `No` 와
  가른다). **글 결과에만 수식 주입 막기**를 건다 — 글 결과는 사용자가 쓴 글자를 잇는다(`concat`), 수 결과의 `-5` 를 막으면 숫자 열이
  글자 열이 된다(CSV 머리말과 같은 규칙). relation 칸은 [보강] `relation_edge` — [보강 10n-36], rollup 칸은 rollup v1 — [보강 10n-37].
- ⑦ **D1 의 귀결**(rollup 과 같다): `derived_value` 가 없으므로 **수식으로 거르거나 정렬할 수 없다.** 그 표를 들이는 조각이 함께
  연다 — 그때 `property_dependency` 의 역방향 인덱스(`ix_property_dependency_source`)가 무효화의 출발점이다.
- ⑧ 다른 길은 닫는다 — 일반 속성 추가 · config 덮어쓰기 · 셀 쓰기 · 타입 바꾸기는 수식을 만들거나 고칠 수 없다(식을 읽고 그래프를
  보는 길을 건너뛴다).
- ⑨ **지우거나 유형을 바꾸기 전에 그 속성을 바로 읽는 수식 · 롤업을 알린다**(2j-1 · F-03-13 — 03 F-03-14 *"사용자에게 알림"*). 막지는
  않는다(지우기는 되살릴 수 있다). 수식은 `property_dependency` 의 역방향으로, 롤업은 config 로 찾는다 — 이 표의 relation 을 타는
  것(같은 표) · 이 속성을 모으는 것(다른 표 — **0061 `ix_property_rollup_target`**, 대상 속성으로 찾는 부분 인덱스). 다른 표의 롤업은 그
  표를 볼 수 있을 때만 이름을, 아니면 개수만 준다 · 휴지통의 표는 세지 않는다.
- 미룬 것: 결과 타입이 바뀔 때 그것을 읽는 수식에 알리기(지금은 다음 읽기에서 이유를 든다) · rollup 의 간선(rollup 은 아직
  `property_dependency` 에 쓰지 않는다 — config 로 찾는다 · 1단계 수식이 rollup 을 읽지 못하므로 rollup → formula → rollup 우회로는 아직
  열리지 않았다).

**[보강] `derived_value` — 수식 값의 캐시 · 수식으로 거르기 · 정렬(D1)** ⟨DB 심화 2j-2조각 · F-03-13 / 마이그레이션 0062⟩

위 DDL 의 `derived_value` 를 들인다 — **수식만** 쓴다. 03 F-03-13 의 현실적 대안(완전 lazy)은 값을 보이는 데는 충분하지만 불변식 D1
(*"formula/rollup 필터·정렬은 derived_value 의 사이드카 컬럼으로만 컴파일된다"*) 때문에 거르기 · 정렬은 이 표가 있어야 한다.

- ① **사이드카는 칸과 같다** — `num_value` · `text_value` · `date_start` 에 **`date_end` · `bool_value` 를 더한다**(초판 DDL 에 없다).
  `page_property_value` 의 사이드카와 같은 다섯 축이어야 필터 컴파일러가 한 축 표(타입 → 컬럼)로 두 표를 본다. 값은 칸을 만드는 함수
  (`formulaCell` → `deriveSidecars`)로 채운다 — 수식이 낸 날짜 · 글이 칸의 날짜 · 글과 같은 기준으로 비교된다. `value` 는 수식 값 그대로.
- ② **rollup 은 넣지 않는다** — 결과가 보는 사람마다 다르다(볼 수 없는 행을 집계에서 뺀다 · [보강] rollup v1). 전역 캐시 한 벌이 맞지 않으므로
  rollup 은 계속 거르거나 정렬할 수 없다(권한 클래스별 N벌은 03 이 경고한 비용이다).
- ③ **무효화는 DB 가 한다**(트리거 — 쓰는 길이 많아 애플리케이션이 빠뜨리면 조용히 틀린 결과가 된다):
  칸이 바뀌면(`page_property_value` 의 INSERT · UPDATE · DELETE) **그 행**의 수식 값 전부 · 속성의 타입 · 설정 · 지움/되살림 · 영구 삭제가
  바뀌면 **그 표**의 수식 값 전부 · 선택 옵션의 이름 · 추가 · 삭제가 바뀌면 그 표의 수식 값 전부를 `stale` 로. 1단계 수식은 같은 행만 읽으므로
  행 단위 무효화가 정확하다(relation 을 타는 3단계가 오면 `relation_edge` 역방향이 더해진다 — 03 F-03-13 의 무효화 트리거 ②③).
- ④ **채우기는 lazy** — 거르거나 정렬하기 **직전에**(쓰기 트랜잭션 · 읽기는 READ ONLY 다) 그 표의 낡은 · 없는 행을 계산해 채운다. 계산은
  화면과 같은 함수(`compileLiveFormulas` · `evaluateRowFormulas`)다. 그동안 표를 `FOR SHARE` 로(스키마가 바뀌지 않게), 행을
  `FOR SHARE SKIP LOCKED` 로 잡는다 — 계산하는 사이 칸이 바뀌면 그 무효화를 잃는다(옛 값을 `stale = false` 로 덮는다). 지금 쓰이고 있는
  행은 건너뛴다 — 쓰기가 끝나면 트리거가 다시 `stale` 로 둔다(그 한 번의 질의는 옛 값으로 걸러질 수 있다 — 막 고치는 행이다).
- ⑤ **`now()` · `today()` 를 쓰는(다른 수식을 거쳐서라도) 수식**은 거를 때마다 표 전부를 다시 계산한다 — 캐시가 시간이 지나면 틀린다.
- ⑥ 템플릿 행 · 휴지통의 행은 채우지 않는다(목록 · 필터에 나오지 않는다 — R1).
- ⑦ 필터 · 정렬의 타입 — 수식은 **결과 타입의 칸 타입** 연산자를 쓴다(수 → 숫자 · 글 → 텍스트 · 참거짓 → 체크박스 · 날짜 → 날짜). 타입 맵은
  수식을 `formula:<결과 타입>` 으로 싣고 컴파일러가 `derived_value` 를 본다.
- 미룬 것: 값을 서버가 내줄 때도 이 캐시를 읽기(지금은 화면이 계산한다 — 2i-3a) · 큰 표의 `now()` 수식 거르기(매번 다시 쓴다) · rollup.

**[보강] 고유 ID(`unique_id`) — 번호는 행에, 접두사는 data source 에** ⟨DB 심화 2a-1조각 · F-03-09 / 마이그레이션 0050⟩

0013 이 자리(`data_source.unique_id_counter` · `unique_id_prefix` · `page.unique_seq` · `ux_page_unique_seq`)만 두고 **언제
번호를 주는지**를 정하지 않았다. 03 F-03-09 의 데이터 모델은 접두사를 `property.config` 에 두라고 했지만 이 문서가 이긴다 —
접두사는 `data_source.unique_id_prefix` 다(번호의 카운터가 data source 에 있고, 아래 ① 로 ID 프로퍼티는 하나뿐이다).

- ① **ID 프로퍼티는 data source 하나에 하나**(불변식 U1 · `ux_property_unique_id_one` — 살아 있는 것만). 번호의 주인은
  data source 이고 프로퍼티는 그것을 **보여 주는 칸**이다 — 둘을 두면 같은 번호를 두 칸에 그릴 뿐이다.
- ② **번호는 ID 프로퍼티가 살아 있을 때만 준다.** 행을 만드는 명령(`createRowIn` — 행을 만드는 유일한 길)이 같은 트랜잭션에서
  `UPDATE data_source SET unique_id_counter = unique_id_counter + 1 … RETURNING` 으로 받는다(원자적 카운터 · `MAX(seq)+1` 금지).
  ID 프로퍼티가 있는지는 **그 문장 안에서** 묻는다 — 행 삽입의 FK 검사가 data source 줄에 `FOR KEY SHARE` 를 잡고, ID
  프로퍼티를 더하는 명령은 같은 줄을 `FOR UPDATE` 로 잡으므로 둘 중 하나가 먼저 끝난 뒤에 다른 쪽이 본다(번호가 빠진 행이
  생기지 않는다).
- ③ **ID 프로퍼티를 더하면(또는 되살리면) 번호가 없는 행을 채운다** — 만든 순서(`block.created_at` · 같으면 행 순서)대로, **휴지통의 행도**
  (03: *"assigned to every page, including deleted pages"*), 카운터를 그 개수만큼 한 번에 올린다(배치 예약).
- ④ **템플릿은 번호를 받지 않는다**(불변식 U2 · `ck_page_template_no_unique_seq`) — 템플릿은 목록에 없는 행이다(R1). 템플릿으로
  만든 행은 보통 행이라 받는다.
- ⑤ **번호는 바뀌지 않고 다시 쓰이지 않는다.** 행이 휴지통에 가도 · 영구 삭제돼도 카운터는 내려가지 않는다(구멍이 남는다).
  ID 프로퍼티를 지워도 번호는 행(`page.unique_seq`)에 남는다 — 다시 더하면 **옛 번호가 그대로** 보이고 그 사이에 만든 행만
  새 번호를 받는다(03 의 클론 권고). 같은 줄이 복원에도 맞다: 지운 ID 프로퍼티를 되살리면 ③ 이 돈다.
- ⑥ **값은 셀이 아니다**(불변식 C1 그대로) — `page.unique_seq` 를 행의 읽기 모델에 투영한다(`uniqueSeq`). 표시는
  `접두사-번호`, 접두사가 없으면 번호만. 쓰는 길이 없다(읽기 전용).
- ⑦ **접두사는 영숫자 2~7자, 대문자로 저장한다**(`ck_data_source_unique_id_prefix` — 03 이 두 2차 출처로 교차 확인한 길이).
  대소문자를 가리지 않고 받아 대문자로 바꾼다. 비울 수 있다(NULL).
- ⑧ **필터 · 정렬은 `page.unique_seq` 에서 바로 한다** — 사이드카가 없는 첫 셀 밖 타입이다(rollup 과 달리 값이 행에 저장돼
  있으므로 D1 에 걸리지 않는다). 연산자는 숫자의 비교 여섯이고 비어 있음 · 비어 있지 않음은 없다(번호가 없는 행이 목록에 없다 —
  템플릿뿐이다).
- ⑨ **내보내기는 보이는 그대로다**(2a-2b) — 스냅숏이 행을 읽을 때 `page.unique_seq` 와 접두사로 노션 API 의 프로퍼티 값 모양(`{"type":"unique_id","unique_id":{"prefix","number"}}`)을 만들어 그 행의 칸 묶음에 끼우고, CSV · 행 Markdown 이 같은 함수로 `TASK-12` 를 쓴다. 저장 모양이 아니다(C1 그대로) — 살아 있는 ID 프로퍼티가 없으면 끼우지 않는다.
- 미룬 것: **워크스페이스 안에서 접두사 유일**(03 — 단축 주소 `TASK-123` 의 전제)과 단축 주소 라우팅은 함께 들인다(03 의 클론
  대안이 P2 로 미뤘다). 그 전에는 접두사가 겹쳐도 깨지는 것이 없다.

**[보강] `status_group` — `select_option.group_id` 가 가리키는 표** ⟨보드 4c-1조각 / 마이그레이션 0023⟩

초판은 `select_option.group_id uuid NULL` 자리만 두고 **그것이 가리킬 표를 정의하지 않았다.** 03 F-03-05 가 권고한
모양(*"`select_option.group_id` + `status_group` 테이블 · **kind 컬럼 필수**"*)을 그대로 옮긴다.

```sql
CREATE TYPE status_group_kind AS ENUM ('todo', 'in_progress', 'complete');

CREATE TABLE status_group (
  id          uuid PRIMARY KEY,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  kind        status_group_kind NOT NULL,
  UNIQUE (property_id, kind),                 -- SG1
  UNIQUE (property_id, id)                    -- 복합 FK 의 대상
);
ALTER TABLE select_option ADD FOREIGN KEY (property_id, group_id)
  REFERENCES status_group (property_id, id);  -- SG2
```

- **그룹의 이름 · 색은 컬럼이 아니다.** 그룹은 프로퍼티마다 정확히 셋이고 사용자가 더하거나 지우거나 이름을 바꿀 수
  없다(F-03-05: *"You can't change the three main categories"*). 이름 · 색은 `kind` 의 함수라 애플리케이션 상수에서
  읽는다 — `property.api_exposed` 를 두지 않은 것과 같은 이유(컬럼으로 두면 두 곳이 어긋난다). "완료인가"는
  `kind = 'complete'` 로 묻는다 — 진행률 · 자동화가 그룹 **이름**에 기대지 않는다.
- **불변식 SG1** 그룹은 (프로퍼티, kind) 에 하나다. **SG2** 옵션의 그룹은 **같은 프로퍼티의** 그룹이다 — 단일 FK
  (`group_id → status_group.id`)는 남의 프로퍼티의 그룹을 가리키는 것을 못 막는다. 복합 FK 로 막는다(`MATCH SIMPLE` 이라
  `group_id` 가 NULL 인 select 옵션은 검사를 건너뛴다). **SG3** `status` 프로퍼티의 옵션은 `group_id NOT NULL`, 그 밖의
  옵션은 `group_id IS NULL`. **SG4** 그룹은 `status` 프로퍼티에만 생긴다. SG3 · SG4 는 `property.type` 을 봐야 해서
  CHECK 으로 쓸 수 없다 — 트리거로 지킨다(R2 와 같은 방식).
  **[보강 10n-25 · 마이그레이션 0111]** 옵션 · 그룹 행의 트리거는 **속성의 타입 바꾸기를 보지 않는다** — 타입을 status 로 바꿔도 있던
  옵션은 다시 검사되지 않는다(상태 변환 10n-24 의 반사실에서 그룹 없는 status 옵션이 조용히 남았다). `property` 의 `UPDATE OF type`
  에 **지연 제약 트리거**(`tg_property_status_shape` · `DEFERRABLE INITIALLY DEFERRED`)를 건다 — 커밋 때 그 속성이 status 면 그룹 없는
  옵션이 없는지, 아니면 그룹을 가진 옵션 · 그룹 행이 없는지 본다. 지연인 까닭: 타입을 **먼저** 바꿔야 그룹을 만들고(SG4) 옵션에 그룹을
  줄 수 있어(SG3) 그 UPDATE 의 순간에는 늘 어긋나 있다 — 같은 트랜잭션의 정리가 끝난 뒤에 본다(E1 의 `tg_relation_edge_mirror` 와 같다).
- **status 는 "그룹이 강제되는 select" 다**(F-03-05 의 현실적 대안). 셀 값의 봉투만 다르고
  (`{"type":"status","status":{"id":…}}`) 사이드카(`text_value` = 옵션 id) · 필터 연산자 넷(+ 그룹 단위 둘 — 10n-23) · 보드의 그룹 키가 select 와
  같다. **옵션 순서는 그룹 순서가 먼저다**(`todo → in_progress → complete`, 그 안에서 `order_idx`) — ENUM 의 선언
  순서가 곧 그 순서다. 나중에 "진행 중" 그룹에 더한 옵션이 `완료` 뒤에 서면 보드의 열이 흐름을 거스른다.
- **기본 옵션은 `property.config.default_option_id` 다 — status 에만 있다**(F-03-05: *"노션에서 유일하게 기본 옵션을
  갖는 프로퍼티"* · F-03-21 의 유일한 예외). **새 행의 초깃값일 뿐이다.** 03 은 *"`default_option_id IS NOT NULL` 이면
  `value NOT NULL` 을 강제"* 까지 적었으나(2차 출처) **채택하지 않았다**: status 컬럼을 나중에 더한 표의 기존 행은 값이
  없어 그 불변식이 처음부터 성립하지 않고, 성립시키려면 스키마 잠금 안에서 행 수만큼 셀을 쓰며 모든 행의 `version` 을
  올려야 한다. 반만 지키는 불변식은 두지 않는다. 호출자가 그 셀을 **보냈으면 그것이 이긴다 — 빈 값이어도**(보드의
  "값 없음" 열에서 만든 카드가 그 열에 남는다).
- ~~옵션을 다른 그룹으로 옮기기~~(10n-20 — 아래 [보강] 옵션 고치기 · 지우기 ⑧) · ~~그룹 단위 필터("To-do 전체")~~(10n-23 — 아래) · 보드의 그룹(범주) 단위 열은 아직 없다.
- **[보강 10n-22] 화면에서 새 옵션의 그룹을 고른다**(03 F-03-05 시나리오 3 *"각 그룹 아래 `+ 상태 추가` 로 세부 상태 생성"*) — 셀
  고르개에 없는 이름을 치면 "만들기" 줄이 **그룹마다 하나씩**(할 일 · 진행 중 · 완료 — 그룹 순서) 선다. 첫 줄이 할 일이라 Enter 만
  누르면 전과 같다(그룹을 말하지 않은 API 와 같은 기본). ↑↓ 로 다른 그룹의 줄을 고른다. 서버는 이미 `group` 을 받았다(4c-1) — 새
  옵션은 그 그룹의 끝에 선다. 같은 이름이 있으면(대소문자 무시) 만들기 줄이 없다 — 수렴하는 옵션의 그룹을 바꾸지 않는다(그건 ⑧).
  그룹 머리마다 `+` 를 두지 않았다 — 이름은 이미 찾기 칸에 있고, 줄로 세우면 키보드로 닿는다.
- **[보강 10n-23] 그룹 단위 필터**(03 F-03-05 · 0023 머리말 *"그룹 단위 필터("To-do 전체")"* · 마이그레이션 0110) — 카탈로그에 둘:
  `group_is`(그룹이 같음) · `group_is_not`(그룹이 같지 않음). 값은 **그룹**(`todo` · `in_progress` · `complete`)이다 — 옵션 id 집합으로
  펴서 저장하지 않는다. 술어는 읽을 때 셀의 옵션이 지금 그 그룹에 드는지 본다 — 옵션을 옮기거나(⑧) 그 그룹에 새 옵션을 만들면
  필터가 따라온다(펴서 저장하면 저장한 날의 옵션에 묶인다). `group_is_not` 은 `does_not_equal` 처럼 `NOT EXISTS` — 빈 셀도 "그
  그룹이 아니다". 쓰기 경로는 값이 그룹인지 본다(`validateFilter`) · 읽기 경로는 모르는 값을 0행으로 읽는다(`kind::text` 비교 —
  ENUM 캐스트의 예외로 뷰가 통째로 열리지 않는 일이 없다). 새 행 채우기는 하지 않는다(그 그룹의 옵션이 여럿 — [보강] 필터가 걸린
  뷰에서 만든 행 ②). DB automation 의 트리거 조건도 같은 연산자를 받는다(같은 컴파일러 — "완료 그룹에 들면"). 화면 — 값 칸은
  그룹 셋 · 연산자를 바꿀 때 값의 종류(옵션 ↔ 그룹)가 바뀌면 값을 비운다 · 칩은 그룹 이름(`진행 · 그룹이 같음 · 완료`).

**[보강] 옵션 고치기 · 지우기 — 이름 · 색 · 지우면 그 옵션의 셀을 비운다** ⟨§7 정리 10n-6 · F-03-04 · F-03-05 / 마이그레이션 없음⟩

초판은 옵션을 더하는 길(셀 고르개의 "`XXX` 생성")만 두었다. 03 F-03-04 시나리오 4 *"옵션 `···` → 이름 변경 / 색상 변경 / 삭제"* 를 연다.

- ① **이름 · 색 바꾸기** — 더하기와 같은 문(`edit_structure` · 스키마 잠금 · `schema_version` 을 올린다). 셀은 옵션 id 를 가리키므로
  모든 칸 · 필터 · 보드의 열이 따라온다. 이름은 같은 속성 안에서 대소문자 무시 유니크 — 겹치면 **거부한다**(`duplicate_name`).
  더하기는 같은 이름에 수렴하지만(동시 생성), 바꾸기는 한 옵션을 다른 옵션의 이름으로 만드는 것이라 둘이 하나가 될 수 없다.
  바뀐 것이 없으면(같은 이름 · 같은 색) 버전을 올리지 않는다. 색은 팔레트(`option_color`) 안.
- ② **지우기는 옵션 행을 지우고, 같은 트랜잭션에서 그 옵션을 가리키는 셀을 비운다**(03 *"옵션 삭제 시 그 옵션을 쓰던 셀은 빈 값이
  된다"*). 03 의 *"옵션도 soft delete"*(실행 취소용)는 **받지 않는다** — 되돌리기 화면이 없는 동안 셀에 남긴 id 는 화면(빈 칸)과
  사이드카(`text_value` = 그 id)가 어긋나, 필터 · "비어 있음" · 정렬 · 뷰 검색 · 집계가 화면과 다른 행을 본다. 대신 **지우기 전에
  그 옵션을 쓰는 행 수를 보여 주고 한 번 더 묻는다.** 비우는 것은 그 속성의 모든 셀이다 — 템플릿 · 휴지통의 행도(되살린 행이
  지운 id 를 들고 돌아오지 않게). 행의 판(`block.version`)은 올리지 않는다 — 스키마 조작이고, 다른 화면은 옵션 · 캐시 트리거의
  표 변경 신호(0063)로 다시 읽는다.
- ③ **셀 쓰기와의 경주** — 셀 쓰기의 옵션 확인([보강] 옵션 칸의 쓰기 확인 · `optionIssuesIn`)이 그 옵션 행을 `FOR SHARE` 로 쥔다.
  지우기는 옵션 행을 먼저 지우므로(배타 잠금) 진행 중인 쓰기가 끝나기를 기다리고, 그 뒤의 셀 비우기 문이 그 쓰기까지 본다.
  지운 뒤에 온 쓰기는 확인에서 거부된다. 지우기는 속성 · 옵션 행을 따로 배타로 잡지 않는다(스키마 조작끼리는 data_source 잠금이 줄을
  세운다) — 속성 행을 잡으면 셀 쓰기의 INSERT 가 외래 키로 거는 `FOR KEY SHARE` 와 엇갈려 교착한다(쓰기가 옵션 확인과 넣기 사이에 있을 때).
- ④ **status 의 기본 옵션을 지우면 남은 첫 옵션으로 옮긴다**(그룹 순서 · `order_idx` — 처음 만들 때 첫 옵션을 거는 것과 같은 규칙).
  남은 옵션이 없으면 null. 지운 id 를 가리킨 채 두면 새 행 만들기가 옵션 확인에 걸린다.
- ⑤ **보드** — 그 옵션의 열이 사라지고 카드는 "값 없음" 열로 간다(그룹 키가 이미 지운 옵션을 `''` 로 접는다). 그 열의 수동
  순서(`row_position.group_key` = 옵션 id)는 지운다.
- ⑥ **그 옵션을 가리키던 저장된 것** — 뷰 필터는 남고 결과는 0건이다(03 *"필터가 '삭제된 옵션' 상태가 되어 결과 0건"* · 칩은
  "지워진 옵션"). 자동화 · 버튼의 값 쓰기는 실행 때 옵션 확인에 거부되어 실패로 남는다. 폼의 조건은 맞는 응답이 없다.
- ⑦ **화면** — 셀 고르개의 옵션 줄마다 `···` → 이름 · 색 · 지우기(지우기는 행 수를 말하고 한 번 더 묻는다). `edit_structure`
  가 없으면 `···` 가 없다(고르기만 한다). 옵션 순서 바꾸기 · ~~다른 그룹으로 옮기기~~는 아직 없다(그룹 옮기기는 ⑧).
- ⑧ **[보강 10n-20] status 옵션의 그룹 바꾸기**(03 F-03-05 시나리오 4 *"옵션을 다른 그룹으로 옮긴다"*) — 고치기와 같은 문(`edit_structure` ·
  스키마 잠금 · `schema_version`). status 옵션만 — select 옵션에 그룹을 주면 `invalid_group`(SG3). 옮긴 옵션은 **새 그룹의 맨 뒤**에 선다 —
  순서 키(`order_idx`)를 그 속성의 맨 뒤로 옮긴다(목록 · 보드의 열은 그룹 → 순서 키로 읽는다 · 화면의 `insertOption` 이 새 옵션을 두는
  자리와 같다). 셀 · 필터는 옵션 id 라 그대로다. 그룹이 비어도 된다(지우기와 같다 — 그룹마다 옵션이 하나 이상이라는 규칙은 두지
  않았다). 기본 옵션이어도 옮긴다(기본은 그룹을 묻지 않는다). 이미 그 그룹이면 쓰지 않는다. 화면 — 옵션 고치기 판의 "그룹" 셋(할 일 ·
  진행 중 · 완료 — status 칸에만). 끌어 옮기기는 두지 않았다.
- ⑨ **[보강 10n-21] status 의 기본 옵션을 화면에서 바꾸기**(03 F-03-05 *"노션에서 유일하게 기본 옵션을 갖는 프로퍼티"*) — 명령은
  이미 있던 `updateProperty` 다. 라우트는 `config` 를 통째로 받지 않고 **좁은 키 `defaultOptionId` 하나**를 받는다 — `updateProperty` 는
  status 밖의 MVP 타입 config 를 검사하지 않으므로 config 를 그대로 열면 아무 JSON 이나 쓰는 길이 된다. `defaultOptionId` 는 status
  에만(다른 타입 · `config` 와 함께 보내면 `invalid_config`) · 그 속성의 옵션 id 또는 null(`isValidStatusConfig`). null 은 API 의 몫이고
  화면은 비우지 않는다. 뷰의 status 열이 `defaultOptionId` 를 싣는다(config 를 통째로 싣지 않는다 — 화면이 읽는 것은 이것 하나).
  화면 — 고르개의 status 옵션 줄에 "기본" 표 · 고치기 판의 "새 행의 기본값으로" 단추(이미 기본이면 눌린 채 꺼진다). 기본 옵션을
  지우면 서버가 옮긴 기본(④)을 응답에서 받아 표를 옮긴다. 이미 있는 행의 값은 바뀌지 않는다(기본은 새 행의 초깃값일 뿐 — 위 절).

**[보강] 데이터베이스 아이콘(`database.icon`)** ⟨잔여 묶음 8c-3b · F-02-05 / 마이그레이션 0038⟩

> 초판의 `database` 는 `title_rich` · `icon` · `cover` 를 갖는다 — 노션 API 의 database 객체는 `icon` 을 page 객체와 같은 모양으로 준다.
> 0013 이 이 칸을 만들었지만 아무도 읽고 쓰지 않았다. 8c-1 이 페이지 아이콘을 블록의 `format.page_icon` 에 두면서(§3.4 [보강] 페이지
> 아이콘 ①) 데이터베이스의 자리를 다시 물어야 했다. 02 F-02-05 는 데이터베이스를 따로 적지 않았다 — F-04-14 는 풀페이지 데이터베이스가
> *"페이지 아이콘·커버·제목을 그대로 사용한다"* 고 적었다.
>
> ① **자리는 이 칸이다** — 데이터베이스 블록(`type='database'`)의 `format.page_icon` 이 아니다. 0037 의 CHECK 이 그 키를 **페이지 행만**
> 갖게 했고, 정본이 이미 데이터베이스의 모습(`title_rich` · `icon` · `cover`)을 이 표에 두었다. 두 곳에 쓰는 이름(`block.properties.title` ·
> `title_rich` — `renameDatabase`)과 달리 **한 곳**이다 — 블록 트리를 읽는 쪽(사이드바 트리 · 멘션의 이름 맵)은 데이터베이스 행이면 이
> 칸을 같은 쿼리에서 조인해 읽는다(N+1 없음). 없으면 **SQL NULL** 이다(컬럼이므로 — 페이지는 키가 없다).
> ② 값의 모양은 페이지 아이콘과 **같다** — 노션 API icon 객체, 지금은 `{"type":"emoji","emoji":"📚"}` 하나 · 이모지 한 글자
> (`isSingleEmoji` · 받기는 `parsePageIconInput`). DB 는 0037 과 같은 값을 CHECK 으로 막는다(0038 — 객체 · `type='emoji'` · 1~16 코드포인트 ·
> 공백 없음 · 다른 키 없음 · JSON `null` 도 거부한다 — 없음은 SQL NULL 하나다). 이미지(8c-4)는 두 CHECK 을 함께 넓혔다(0039 — 판정 함수
> `icon_shape_ok` 하나 · §3.4 [보강] 페이지 아이콘 ⑤) — 올린 파일 아이콘의 참조 수도 페이지와 같은 명령의 규칙으로 센다.
> ③ **바꾸는 사람은 이름을 바꾸는 사람이다** — `edit_structure` 이고 데이터베이스가 잠기면 막는다(7f-2 — 잠금이 막는 구조에 이름이 있다).
> 아이콘은 이름 옆에 서는 표의 모습이고 모두가 보는 사이드바 · teamspace 화면에 선다 — 행 · 셀을 고치는 사람(`edit_content`)이 바꾸는
> 것이 아니다. 페이지 아이콘이 `edit_content` 인 것도 그 페이지의 이름이 그렇기 때문이다 — 둘 다 각자의 이름을 따른다. 같으면 쓰지 않고,
> 바뀌면 블록의 `last_edited_*` · `version` 을 올린다(이름과 같다). ⚠ `edit_content` 와 `edit_structure` 의 구분은 **오늘 관찰되지 않는다**
> — `resolveCaps` 가 대상 종류를 `'page'` 로 고정해 데이터베이스 노드에 `edit_content` 레벨을 줄 수 없다(템플릿의 권한과 같은 부채).
> ④ 서는 자리 — 데이터베이스 머리(고르개 · 경로) · 사이드바 · teamspace 화면 · 템플릿 화면의 경로 · 관계형의 대상 고르개(`<option>` 은
> 글자만 담는다 — 이름 앞의 글자로) · 데이터베이스를 가리키는 멘션(이름 맵의 아이콘 — 볼 수 있을 때만). 아이콘이 없는 데이터베이스의
> 줄(사이드바 · teamspace 화면)은 **표 글리프**다 — 페이지의 문서 글리프와 같은 규칙으로 그림(SVG)이라 줄의 글자가 이름 그대로다(전에는
> 글자 `▦` 였다).

**[보강] 다중 data source — 데이터베이스 하나에 소스 여럿** ⟨잔여 묶음 8e-1 · F-04-23 / 마이그레이션 0042⟩

> 초판은 `database` 1 : N `data_source` 를 처음부터 두었다(C-5 · 04 F-04-23 *"FK 방향 결정은 MVP 시점에 반드시 내려야 한다"*). 속성 · 행 ·
> 템플릿이 data source 에 매달려 있으므로 남은 것은 **만드는 길**과, 그 길이 열리면 깨질 수 있는 주석 불변식을 표로 올리는 일이었다.
> 노션: *"A database can now act as a container for multiple data sources, each of which contains a unique set of pages and defines its own
> set of properties"* · 뷰는 그중 하나를 본다.
>
> ① **소스마다인 것과 데이터베이스에 하나인 것.** 소스마다 — 속성(스키마 · P1) · 행 · 템플릿 · 행의 레이아웃(§3.6 `page_layout`). 데이터베이스에
> 하나 — 권한(규칙 A4 — data source 에 ACL 이 없다) · 잠금 · 이름 · 아이콘 · 자리(사이드바 · 옮기기). 그래서 소스를 고치는 모든 명령이
> **주인 데이터베이스**의 capability 를 묻는다.
> ② **더하기는 한 벌이다** — `data_source` + 소유 부착 행(부착 순서의 끝) + 제목 속성(P1) + 표 뷰 하나(탭의 끝). 노션: *"When you create a
> data source, a new view will automatically be created and attached to it."* 뷰가 없는 소스는 어느 탭에서도 열 수 없다. 데이터베이스를 만들
> 때와 같은 함수다(`insertOwnedDataSource`). 묻는 것은 `edit_structure` 이고 잠긴 데이터베이스는 막는다(뷰 · 속성과 같은 줄) — 데이터베이스
> 블록 행을 먼저 잠그고 끝 키를 읽는다(두 사람이 동시에 더해도 같은 키가 나오지 않는다).
> ③ **이름 — 하나일 때는 데이터베이스 이름이 곧 그 이름이다.** 소스가 하나뿐이면 화면은 소스 이름을 따로 보여 주지 않는다. 그래서
> `data_source.name` 은 만들 때의 이름(비었으면 "표")에 머문다. **둘째를 더하는 순간** 첫째가 처음으로 화면에 나오므로 그때 데이터베이스의
> 지금 이름을 받는다(비었으면 그대로) — 이름 바꾸기를 매번 양쪽에 맞추는 대신 보이기 시작하는 한 순간에 맞춘다. 셋째부터는 건드리지 않는다
> (이미 보이는 이름이다). [정정 8e-3a] "둘째"는 **처음으로** 둘째가 생기는 때다 — 부착 행(휴지통의 소스까지)이 하나인 데이터베이스. 살아 있는
> 소스만 세면 둘 중 하나를 휴지통에 넣은 뒤 더할 때 이미 보였던(고쳤을 수 있는) 첫째의 이름을 덮는다. 이름 없이 더하면 "새 데이터 소스"다(`ck_data_source_name` — 비울 수 없다). 노션의 *"Databases get a default name
> that is a simple concatenation of all their data sources"* 는 따르지 않는다 — 우리 데이터베이스는 처음부터 제 이름(`block.properties.title`)을
> 갖는다. 이름 바꾸기는 주인의 `edit_structure` · 잠금이고, 붙인 곳에서 바꿔도 원본의 이름이 바뀐다(F-04-23 *"원본 data source 의 제목 …
> 변경은 연결된 모든 곳에 전파"*).
> ④ **뷰는 자기 데이터베이스에 붙은 소스만 본다** — `view (database_id, data_source_id)` → `database_data_source` 복합 FK(0042 · ON DELETE
> CASCADE — 부착이 풀리면 그 위의 뷰도 사라진다 · F-04-23 *"그 소스를 보던 뷰도 함께 제거"*). `database_id` 가 NULL 이면 FK 가 보지 않으므로
> DB 뷰는 데이터베이스를 가져야 한다(CHECK). 뷰를 만들 때 소스를 고르고(붙은 것이 아니면 `not_found` — 남의 표의 소스가 있는지 알리지
> 않는다), 생략하면 부착 순서의 첫째다. 필터 · 정렬 · 그룹 · 기본 템플릿은 **그 뷰의 소스** 스키마로 검사한다(전에는 데이터베이스의 첫
> 소스를 골랐다).
> ⑤ **소스의 마지막 뷰는 지울 수 없다**(데이터베이스의 마지막 뷰 → 소스의 마지막 뷰). 데이터베이스의 마지막 뷰도 그 소스의 마지막 뷰라 함께
> 막힌다. 노션은 이때 *"Delete the view and the data source"* 를 묻는다 — [8e-3b] 화면이 그 물음으로 이 거부를 대신한다: 소스의 마지막
> 뷰를 지우려 하면 "뷰와 소스를 함께 휴지통으로"를 묻고 소스를 휴지통에 넣는다(⑩ — 뷰는 숨겨지고 되살리면 돌아온다). 노션의 "뷰만 지우기"
> (주인 없는 소스)는 두지 않는다 — 뷰가 없는 소스는 어느 탭에서도 열 수 없다. 데이터베이스의 마지막 뷰에는 지우기가 서지 않는다.
> ⑥ **DS1 · DS3 의 집행 — 커밋 때 묻는다.** 0013 은 DS3 을 트리거로 막지 않았다 — BEFORE DELETE 트리거는 그 삭제가 data source 삭제의
> CASCADE 인지 직접 DELETE 인지 가를 수 없다. 0042 는 **지연 제약 트리거**로 커밋 때 같은 질문을 한다: "이 data source 가 아직 있고 그 주인도
> 그대로인데 소유 부착 행이 없는가". CASCADE 로 사라진 소스는 그때 이미 없으므로 가를 필요가 없다. DS1 의 "적어도 1개"(만든 트랜잭션이 끝날
> 때 부착 행이 있다) · 주인 바꾸기(새 주인의 부착 행)가 같은 질문이라 두 표의 트리거가 한 함수를 부른다.
> ⑦ **소스마다 하나씩 나오는 곳.** relation 의 대상 목록은 항목이 소스 하나다(소유한 것만 — 붙인 것은 원본 쪽에서 한 번) · 데이터베이스가
> 소스를 여럿 가지면 소스 이름으로 가른다. 내보내기는 소유한 소스마다 표 한 벌이다 — 하나면 전과 같이 `이름.csv` + `이름/`, 여럿이면
> `이름/` 안에 `소스.csv` + `소스/`(이름 규칙은 페이지와 같다). 템플릿 화면은 템플릿 자신의 소스(`page.data_source_id`)의 첫 뷰로 그린다.
> ⑧ **아직 아닌 것** — 노션의 "뷰만 지우기"(주인 없는 소스) ·
> ~~다른 데이터베이스의 소스 붙이기(linked · F-04-13)~~ **2l-1 에서 들였다(아래 ⑪)** · 소스를 다른 데이터베이스로 옮기기 · 소스의 아이콘 · ~~`ds:{data_source_id}` 실시간 채널~~ **0단계(2k · X-5 [보강])**.
> ⑪ **연결된 소스(2l-1 · F-04-13)** — 붙이기는 **부착 행 하나 + 그 소스를 보는 뷰 하나**다(새 표 없음 — DS2 의 `is_linked` 가 그대로 그 뜻이다).
> 붙이려면 이 데이터베이스의 `edit_structure` 와 **원본을 볼 수 있어야** 한다(아니면 없는 것과 같은 답). 권한은 둘로 갈린다 — 행 · 스키마는
> **원본**의 것(행 · 셀 · 속성의 게이트가 `owner_database_id` 로 묻는다 · 링크로 오르지 않는다), 뷰는 **붙인 데이터베이스**의 것(뷰 게이트가
> `view.database_id` 로 묻는다 — 04 *"Can edit content 도 링크드 데이터베이스 위에서는 자기 뷰를 만든다"*). 떼면 부착 행과 그 위의 뷰가
> 사라진다(원본 무손상 · DS3) — 소유한 소스는 떼지 않는다(휴지통이 그 길) · 마지막 살아 있는 소스도. 원본을 볼 수 없는 사람에게는 붙은
> 소스의 **이름도** 주지 않는다(`readable: false`). 원본 쪽 휴지통은 소스 단위다(데이터베이스 블록에는 수명이 없다 — X-3).
> ⑫ **붙인 뷰를 여는 길(2l-2)** — ⑪ 의 "뷰는 붙인 데이터베이스의 것"은 **고치는 권한**의 말이다. 뷰가 돌려주는 컬럼(속성 이름 · 옵션 · 수식) ·
> 카드 · 행은 원본의 내용이므로, **뷰를 여는 모든 길**(뷰 읽기 · 보드 · 캘린더 · 개인 필터 · 뷰 고치기 · 그 소스로 뷰 만들기)이 그릇에 더해
> **원본도 볼 수 있어야** 한다(못 보면 없는 것과 같은 답). 고치는 길도 막는 까닭은 고친 뷰를 컬럼째 돌려주기 때문이다 — 원본을 못 보게 된
> 사람이 그 탭을 치우는 길은 떼기다(뷰 게이트를 지나지 않는다). 보드에서 카드를 옮길 때 이 뷰 안의 자리(`row_position`)는 그릇의
> `edit_content`, 셀 값은 원본의 `edit_content` 다.
> ⑨ **화면(8e-2)** — 소스 이름은 소스가 **둘 이상일 때만** 보인다: 뷰 탭 줄 위에 지금 뷰의 소스 이름(노션 *"you'll see the data source's name
> above the horizontal bar of views"*) · 표의 이름(양방향 관계형의 반대쪽 이름 기본값 · 접근성 이름)도 소스의 것이다. 관리하는 창은 고칠
> 수 있는 사람에게만 서고, 소스가 하나면 이름 칸 없이 데이터베이스 이름을 보인다(③ — 둘째를 더할 때 덮일 이름이다). 더하면 새 소스의 뷰로
> 옮긴다. "뷰 추가"는 소스가 둘 이상이면 볼 소스를 묻고, 처음 값은 지금 뷰의 소스다.
> ⑩ **휴지통(8e-3a · 0043)** — 노션: *"For native sources, select ••• to Move to Trash"*. data source 는 블록이 아니지만 블록과 **같은 세 상태**
> (`block_lifecycle` · 같은 시각 열 · 같은 모양의 CHECK)를 갖는다 — X-3 은 블록의 수명주기 축을 `type='page'` 로 좁힌 판결이라 부딪히지 않는다.
> 행은 블록의 휴지통을 그대로 쓴다: 소스를 휴지통에 넣는 명령이 그 소스의 살아 있는 행 · 템플릿과 그 하위 페이지를 **소스 id 를 삭제 루트로**
> (`trash_root_id = data_source.id`) 함께 넣는다. 그래서 행의 모든 읽기 경로(검색 · 관계형 칩 · 최근 방문 · 행 주소 · 멘션)가 이미 하는 거르기로
> 함께 사라지고, 되살리면 그 루트의 것만 돌아온다(B3 — 먼저 따로 지운 행은 제 루트로 남는다). 영구 삭제도 같은 묶음이다(2단계 보존 —
> 물리 삭제는 하지 않는다). 규칙: ⓐ **마지막 살아 있는 소스는 휴지통에 넣지 않는다**(F-04-23 *"마지막 data source 는 제거 불가로 두는 편이
> 단순하다"*) ⓑ 휴지통의 소스는 모든 문(목록 · 이름 · 뷰 열기 · 뷰 만들기 · 행 · 속성 · 템플릿 · 관계형 대상 · 내보내기)에서 **없는 것**이다 —
> 주인 문에 `ds.lifecycle = 'live'` ⓒ 소스를 보는 뷰는 지우지 않고 숨긴다(되살리면 탭이 돌아온다) ⓓ 권한은 더하기와 같다 — 주인의
> `edit_structure` · 잠금 ⓔ 휴지통 목록에 소스 한 줄(이름 · 주인 데이터베이스 이름 · 함께 간 수)로 서고, 볼 수 있는 데이터베이스의 것만이다
> ⓕ **불변식 DSL1** — 살아 있지 않은 소스에는 살아 있는 행이 없다. 행의 읽기 경로는 행의 lifecycle 만 보므로 이것이 깨지면 휴지통의 소스에서
> 행이 새어 나온다(목록에서 행 하나만 되살리는 길이 그 구멍이다 — 명령이 `source_trashed` 로 먼저 답한다). 지연 제약 트리거가 커밋 때 두
> 방향(살아 있는 행이 생기거나 옮겨질 때 · 소스가 살아 있지 않게 될 때)을 본다.

**DB 상수**

```ts
const MAX_FILTER_DEPTH       = 3;       // C-15. 루트 객체를 layer 1 로 센다. layer 4 쓰기는 400
const MAX_FILTER_GROUP_ITEMS = 100;
const MAX_QUERY_PAGINATION   = 10_000;
const PROPERTY_ID_LENGTH     = 21;      // nanoid base62
const MAX_PROPERTIES_PER_DS  = 500;     // [확인필요] 스코프 = data_source 당
```
필터 깊이 검증은 **쓰기 경로에만** 건다. 읽기 경로에 걸면 나중에 상한을 낮출 때 기존 뷰가 통째로 열리지 않는다.

**[보강] 사람 속성(`people`) — 값은 사람 id 의 집합 · 이 워크스페이스의 사람만** ⟨게시 · 공유 6g-1 · F-03-07 / 마이그레이션 0090 — 필터 연산자 카탈로그 · 10n-3 — ⑫⟩

> `property_type` ENUM(0013)에 `people` 이 있지만 값의 모양 · 검증 · 필터를 정하지 않았다. 6번 트랙의 검증(F-03-23) · 사람 규칙(F-06-10 —
> [보강] 행 단위 접근 규칙 ③)이 이것을 기다린다.
>
> ① **값** — `{ type: 'people', people: [{ id }] }`(노션 API 의 `people: [User]` 에서 id 만). 순서 있는 집합 — 같은 사람은 한 번 · 최대
> 50명. **EAV 그대로**(C-2 — `page_property_value` 한 행). 03 이 권고한 조인 표(`page_person`)는 두지 않는다 — relation 과 달리 거울상이 없고,
> 역조회("내가 담당인 항목")는 값의 포함 연산으로 묻는다. 칸을 통째로 바꾸는 쓰기는 칸 단위 마지막 쓰기다(C3). **더하기 · 빼기
> 쓰기는 지금 값에 합친다**(⑫ — 03 *"add/remove 오퍼레이션 단위로 병합"*).
>
> ② **쓰기 검증** — 모양(배열 · uuid · 중복 없음 · 50명)은 값 검증이, **이 워크스페이스의 사람인가**는 쓰는 트랜잭션이 본다(활동 중인
> 멤버 · 게스트 — 떠난 사람 · 다른 워크스페이스의 사람 · 없는 id 는 `invalid_value`). 보는 것은 **새로 드는 사람만**이다(⑫ⓒ). 이미 저장된 값의 사람이 나중에 떠나도 값은 남는다
> (03 *"값은 유지되되 비활성 사용자로 표시"*) — 화면이 "떠난 사용자" 로 그린다.
>
> ③ **사이드카** — `text_value` 에 사람 id 를 공백으로 이어 넣는다(정렬하지 않는다 — 비었는지 · 몇 칸이 찼는지를 다른 타입과 같은 축으로
> 세기 위해). 비면 NULL.
>
> ④ **필터** — `contains` · `does_not_contain`(값은 사람 id 하나) · `is_empty` · `is_not_empty`. 포함은 값의 jsonb 포함 연산으로 묻는다.
> "나(me)" 는 필터 평가 컨텍스트(VW1 — `{me, today, current_page}`)와 함께 — 뒤로. ⟨6g-2c — ⑪⟩
>
> ⑤ **받지 않는 것(v1)** — 정렬 · 보드의 그룹 기준 · 수식의 `prop()` · 롤업의 대상 · 타입 바꾸기(사람 ↔ 다른 타입) · 자동화의 값 쓰기 ·
> 템플릿의 "만든 사람" 류 값 슬롯. 각자 거부하거나 고르개에 세우지 않는다. 열 집계는 세기(전체 · 빈 · 찬 · 비율)만.
>
> ⑥ **이름은 칸에 없다** — 값은 id 만이고 이름은 사람의 표에서 읽는다(바꾸면 모든 칸이 따라간다). 그 행을 볼 수 있는 사람은 칸의 이름도
> 본다(게스트 포함 — 게스트에게 멤버 목록을 주지 않는 것(7d-2)과 다르다: 칸에 넣은 사람만이다). 떠난 사람은 "떠난 사용자".
>
> ⑦ **내보내기** — CSV 는 이름을 `, ` 로 잇는다 · 스냅샷(JSON)은 값 그대로(id).
>
> ⑧ **화면** · **사람 규칙** · **담당 알림**(F-11-08 — `person_property_assigned`)은 다음 조각들이다. ⟨6g-2 · 6g-3 · 6h 에서 섰다 —
> ⑨ ⑩ · [보강] 행 단위 접근 규칙 ③ ⑨ · §3.8 [보강] 담당 알림⟩
>
> ⑨ **[6g-2a] 칸 · 고르개** — 칸은 이름 칩(떠난 사람은 "떠난 사용자" · 흐리게) · 고르는 순간마다 저장한다(초안 없음 — 관계형 편집기와
> 같다) · 이미 든 사람을 고르면 뺀다. 고르개의 후보는 이 워크스페이스의 **활동 중인** 사람(이름 · 메일로 · 30명) — **게스트에게는 후보가
> 없다**(7d-2 — 멤버 목록을 받을 수 없는 사람). 게스트는 칸에 든 사람을 빼기만 한다. 이름은 id 를 주면 활동 중인 사람만 돌려준다
> (`GET /people?ids=` — `@` 멘션의 이름 지도와 같은 태도 · 단 떠난 사람은 주지 않는다). 첫 화면의 이름은 서버가 함께 주고, 그 뒤에 온
> 행의 것은 화면이 묻는다. 표 · 목록 · 행 화면 · 보드 · 갤러리의 카드가 같은 칩이다. 필터 값의 고르개는 6g-2b.
>
> ⑩ **[6g-2b] 필터 값 고르개** — 뷰 필터 · 개인 필터의 사람 규칙(④의 포함 · 포함하지 않음)은 값을 **이름으로 고른다** — 칸의 고르개와
> 같은 후보(활동 중인 사람 · 게스트에게는 없다)를 한 사람만 고르는 모양으로 쓴다(고르면 닫힌다 · 고른 사람을 다시 고르면 값이 빈다 —
> 빈 값의 규칙은 저장 트리에서 빠진다). 값은 여전히 id 하나다. 필터 칩 · 패널의 값은 이름으로 그린다 — 이름 지도는 필터에 든 id 를 물어
> 받고(`GET /people?ids=`), 없으면 "떠난 사용자"(떠난 사람의 규칙은 남고 그 사람이 든 행만 맞는다 · F-03-17 의 지운 옵션과 같은 태도).
> "나(me)" 는 여전히 뒤로(④). ⟨6g-2c 에서 섰다 — ⑪⟩
>
> ⑪ **[6g-2c] "나(me)"** — 포함 · 포함하지 않음의 값에 사람 id 대신 **컨텍스트 노드** `{ "$context": "me" }` 를 둘 수 있다(16 R3 의 모양 —
> 뒤에 `current_page` 가 같은 자리에 선다 · VW1). 뷰는 하나인데 보는 사람마다 다른 행이다("내 담당"). **필터를 SQL 로 바꿀 때 묶는다** —
> 컴파일러는 평가 컨텍스트(`{ me }`)를 **반드시** 받는다(빠뜨리면 타입이 막는다): 세션이 있는 길(표 · 보드 · 캘린더 · 열 집계)은 그 세션의
> 사람, 세션이 없는 길(공개 화면 — 익명)은 **아무도 아니다**(포함은 0행 · 포함하지 않음은 모든 행). 저장 검증은 사람 값으로 uuid 또는
> 이 노드만 받는다. 화면은 고르개 맨 위의 "나" 로 고르고, 칩 · 값 칸은 "나" 라고 말한다. 자동화의 조건은 사람을 받지 않는다(⑤) —
> 이 노드도 없다. 결과 캐시는 아직 없다(VW1 의 캐시 키는 캐시를 둘 때).
>
> ⑫ **[10n-3] 더하기 · 빼기 · 검사는 새로 드는 사람만** — ⓐ 셀 쓰기는 칸을 통째로 바꾸는 값과 함께 **사람 칸의 더하기 · 빼기**
> (`peopleChanges: [{ propertyId, add, remove }]`)를 받는다. 행을 잠근 채(셀 쓰기의 `FOR UPDATE`) **지금 값에** 적용한다 — 빼고, 없던
> 사람만 뒤에 더한다(순서는 그대로 · 이미 든 사람을 더하거나 없는 사람을 빼면 바뀌지 않는다). 두 사람이 같은 칸에 동시에 서로 다른
> 사람을 더해도 둘 다 남는다 — ①의 칸 단위 마지막 쓰기는 통째 쓰기에만 남는다. 결과가 지금 값과 같으면 쓰지 않는다(행의 판이 오르지
> 않는다). 상한(50명)은 적용한 결과로 본다. 같은 사람을 더하면서 빼거나, 같은 칸을 통째 값과 연산으로 함께 보내면 거부한다.
> ⓑ **칸의 고르개는 더하기 · 빼기로 보낸다** — 고를 때마다 한 사람이다. 답은 합친 행이라 그사이 다른 사람이 더한 사람이 보인다.
> 통째 쓰기는 API · 템플릿의 길로 그대로 받는다.
> ⓒ **이 워크스페이스의 사람인가(②)는 새로 드는 사람만 본다** — 칸에 이미 든 사람은 떠났어도 다시 묻지 않는다. 그러지 않으면 떠난
> 사람이 든 칸은 그 사람을 빼는 것 말고는 아무도 고치지 못한다(다른 사람을 더해도 떠난 사람 때문에 거부됐다). 새 행(만들기 · 폼의
> 응답)의 사람은 모두 새로 드는 사람이다.
> ⓓ **템플릿으로 만들 때 떠난 사람은 뺀다** — 새 행에서는 새로 드는 사람이라 ⓒ에 걸려, 그 템플릿으로는 영영 행을 만들지 못했다(지운
> 옵션의 값을 무시하는 것과 같은 까닭). 템플릿 자신의 칸에는 남는다(②).

---

### 3.6 뷰 · 레이아웃 ⟨C-6 · U-1 · 16⟩

```sql
CREATE TABLE view (
  id uuid PRIMARY KEY,
  owner_kind text NOT NULL DEFAULT 'database_view'                      -- <16 R2>
    CHECK (owner_kind IN ('database_view','layout_tab','dashboard_widget')),
  database_id    uuid NULL REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid NULL REFERENCES data_source(id) ON DELETE CASCADE,-- 대시보드 위젯이면 NULL
  -- [보강] FOREIGN KEY (database_id, data_source_id) REFERENCES database_data_source ON DELETE CASCADE —
  --        뷰는 자기 데이터베이스에 붙은 소스만 본다 · CHECK (owner_kind <> 'database_view' OR database_id IS NOT NULL)
  --        (0042 · 8e-1 — §3.5 [보강] 다중 data source ④)
  name text, type text NOT NULL,           -- table|board|list|calendar|timeline|gallery|chart|form|map|dashboard
  order_idx text NOT NULL,                 -- 뷰 탭 순서
  filter jsonb,                            -- FilterNode 트리. MAX_FILTER_DEPTH=3 <C-15>
  sorts jsonb, quick_filters jsonb, group_by jsonb, sub_group_by jsonb,
  configuration jsonb NOT NULL,            -- type 별 discriminated union
  frozen_upto_property_id text NULL REFERENCES property(id),  -- <C-6부속> 경계 포인터. 열별 boolean 아님
  load_limit int DEFAULT 50,
  open_pages_in text DEFAULT 'side_peek'
    CHECK (open_pages_in IN ('side_peek','center_peek','full_page')),   -- L2 층. 레이아웃에 두지 않는다
  dashboard_view_id uuid NULL REFERENCES view(id),
  dashboard_layout jsonb,
  sub_item_display text, sub_item_filter_scope text,
  owner_user_id uuid NULL,                 -- NULL = 공유 뷰, 값 있으면 개인 뷰
  default_template_page_id uuid NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
-- 불변식 VW1: filter AST 의 평가 컨텍스트는 {me, today, current_page} 3종. <16 R3>
--             결과 캐시 키 = (view_id, actor_id, 평가일, current_page_id)
-- 불변식 VW2: owner_kind='layout_tab' 인 뷰는 DB 뷰 탭 목록에 노출되지 않는다.
-- 불변식 VW3: 탭 뷰라고 별도 저장 경로를 만들지 않는다. view_property / row_position 을 동일하게 쓴다.

CREATE TABLE view_property (               -- <C-6> 행 단위 테이블. JSON 배열 금지
  view_id uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  visible boolean NOT NULL DEFAULT false,
  order_idx text NOT NULL, width int NULL, wrap boolean NOT NULL DEFAULT false,
  date_format text NULL, time_format text NULL, status_show_as text NULL,
  card_property_width_mode text NULL, calculation text NULL,   -- [보강] 함수 이름 · CHECK(0054 · 0055 `is_calculation_name`) · 아래 [보강] 열 집계
  PRIMARY KEY (view_id, property_id)
);
CREATE INDEX ON view_property (view_id, order_idx);
-- 불변식 V1: 순서 변경은 반드시 단일 행 UPDATE. 배열이면 "A는 폭, B는 순서"가 전체 LWW 로 충돌한다.
-- 불변식 V2: frozen boolean 컬럼은 이 테이블에 존재하지 않는다(view.frozen_upto_property_id).

CREATE TABLE row_position (
  view_id uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  group_key text NOT NULL DEFAULT '',
  row_id uuid NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  order_idx text NOT NULL,
  PRIMARY KEY (view_id, group_key, row_id)
);
CREATE INDEX ON row_position (view_id, group_key, order_idx);
-- 뷰별 수동 순서(row_position.order_idx)와 트리 순서(block.order_key)는 별개 축이며
-- 서로를 대체하지 않는다. <C-3 경계선언>
```

**[보강] 열 집계(`view_property.calculation`) — 함수 이름 · 타입별 허용 · 필터를 지난 행 전부** ⟨DB 심화 2d-1조각 · F-04-16 / 마이그레이션 0054⟩

초판은 `calculation text NULL` 자리만 두었다.

- ① 값은 함수 이름 하나다 — 모든 타입: `count_all` · `count_values` · `count_empty` · `count_unique` · `percent_empty` · `percent_not_empty` /
  숫자: `sum` · `average` · `median` · `min` · `max` · `range` / 날짜: `earliest_date` · `latest_date` · `date_range` / 체크박스(빈 값이
  없다 — 세기 계열 대신): `count_all` · `checked` · `unchecked` · `percent_checked` · `percent_unchecked` / 상태: 모든 타입의 것 +
  `percent_complete`(**[보강 10n-30 · 마이그레이션 0112]** 완료 비율 — 행 중 셀의 옵션이 지금 완료 그룹에 든 것의 비율 · 빈 상태도 분모 ·
  rollup 의 완료 비율(10n-29)과 같은 뜻 · 완료 그룹의 옵션 id 를 질의에 묶어 상태 열에만 센다). 목록 밖의 이름은 CHECK 이
  막는다(`ck_view_property_calculation`). 타입에 맞는지는 고를 때 명령이 보고, 읽을 때 맞지 않으면(타입을 바꾼 뒤) **무시한다**(rollup 의
  접기와 같은 태도 — 저장값은 남긴다).
- ② 대상은 **필터를 지난 행 전부**다 — 페이지에 들어오지 않은 행도(04 *"반드시 서버측 계산"*). 템플릿 · 휴지통은 뺀다(R1). 하위 항목이 켜진
  표의 트리는 보지 않는다(자식 행도 센다 — 표의 행이다).
- ③ 0 과 빈 값을 가른다 — 세기 · 합은 0, 평균 · 중앙값 · 최소 · 최대 · 날짜는 빈 값(`—`), 비율은 행이 0개면 빈 값.
- ④ 행 응답의 **첫 페이지**에 함께 싣는다(04 *"행 쿼리 응답에 aggregates 를 함께 담아 1회 왕복"*). 캐시는 아직 없다.
- ⑤ **그룹 머리의 계산** ⟨2d-3조각 / 마이그레이션 0055⟩ — `view.group_by.calculation = { property_id, function }`(04 *"그룹 헤더 집계는
  `view.group_by.calculation`"*). 없으면 카드 수(노션 보드의 기본). 보드 하나에 하나 — 모든 그룹이 같은 계산이다. 대상은 **그 그룹의
  카드와 같은 행**(필터 · 템플릿 · 휴지통 · 하위 항목의 "부모만")이고 카운트와 **같은 `GROUP BY` 한 질의**에 통계를 얹는다. 숨긴 그룹도
  계산한다(04 *"필터는 반영, 그룹 숨김은 미반영"*). 행이 없는 그룹은 빈 통계(합 0 · 평균 빈 값). 모양과 함수 이름은 CHECK
  (`ck_view_group_by_calculation`)이 막고, 함수 이름의 목록은 함수 하나(`is_calculation_name`)로 모아 ①의 CHECK 도 그것을 본다.
  프로퍼티가 살아 있는지 · 타입에 맞는지는 ①과 같다(고를 때 거부 · 읽을 때 무시).
- 미룬 것: relation · rollup · 고유 ID 열의 집계 · 집계 캐시. 표의 그룹은 아래 [보강 G-1] 표 · 목록의 그룹.

**[보강] 페이지 열기 모드 — 사이드 피크는 데이터베이스 화면의 표시 상태다** ⟨게시 · 공유 8n-1조각 · F-02-20 · F-04-21 / 마이그레이션 없음⟩

> 02 F-02-20 *"페이지를 전체 화면 외에 우측 패널(side peek)이나 중앙 모달(center peek)로 열어, 원래 보던 화면의 맥락을 유지한 채 내용을
> 확인 · 편집"* · *"기본값은 데이터베이스 뷰 단위 설정"* · *"라우팅 구조를 처음부터 잡아야 나중에 갈아엎지 않는다"*. 칸은 초판부터 있다
> (`view.open_pages_in` — `side_peek` 기본 · 0015). 이것이 그 칸을 읽는다.
>
> ① **피크는 데이터베이스 화면의 쿼리(`?peek={행}`)다 — 가로채기 경로를 쓰지 않는다.** Next 의 intercepting route 는 데이터베이스 화면에서
> **어떤** `/w/{ws}/{page}` 로 옮겨 가도 가로챈다(사이드바의 다른 페이지 · 피크 안의 링크까지) — 피크로 열 것과 옮겨 갈 것을 경로가 가르지
> 못한다. 쿼리는 그 화면의 행 링크만 쓴다. 뒤 화면(뷰 · 스크롤 · 표의 상태)은 그대로 남고, 피크를 열고 닫는 것은 기록에 쌓인다(뒤로 가기가
> 피크를 닫는다 — 02 엣지의 "결정 필요" 를 이쪽으로). 새로 고침 · 주소 공유는 피크가 열린 채다(02 의 *"[추정] full page"* 와 다르다 — 피크는
> 쿼리라 주소에 남는다 · 표시 상태이지 자원이 아닌 것은 같다)
>
> ② **피크 안은 행 화면 그대로다** — 행 화면의 몸을 서버 컴포넌트 하나(`PageContent` — 머리 단추 · 아이콘 · 제목 셀 · 속성 묶음 · 백링크 ·
> 본문 · 하위 페이지)로 떼어 행 화면과 피크가 함께 쓴다. 다른 것은 틀(`frame`)뿐 — 페이지는 화면 전체 · 피크는 패널. 볼 수 없거나 없는
> 행은 페이지면 404 · 접근 요청 화면 그대로, **피크면 패널 안에서** 그렇다고 말한다(02 엣지 *"권한 없는 페이지를 peek 으로 열기 — 패널
> 안에서 접근 거부"*). 피크를 바꿔 열면 패널을 쌓지 않고 바꾼다(본문 편집기는 행마다 새로 선다)
>
> ③ **행 링크가 뷰의 열기 방식을 따른다** — 표의 "열기" · 보드 카드의 "열기" · 갤러리 카드의 제목 · 캘린더의 항목. `full_page` 면 행 화면으로
> 옮겨 가고, 그 밖이면 지금 화면의 주소(`?v` · `?q` · `?m` 을 지닌 채)에 `peek` 을 더한다. 페이지 본문에 박힌 데이터베이스 블록의 행 링크는
> 이 조각이 다루지 않는다(행 화면으로 간다)
>
> ④ **패널** — 머리에 "전체 페이지로 열기"(행 화면으로) · "닫기"(`peek` 을 뺀 주소로). `Esc` 는 글을 쓰는 칸(입력 · 본문 편집기 · 메뉴) 밖에서만
> 닫는다(편집기 안의 `Esc` 는 편집기의 것이다). 가운데 피크(`center_peek`)는 같은 패널을 가운데 상자로 그린다. 뷰 메뉴의 "열기 방식" 고르개는
> 8n-2
>
> ⑤ **명령** — 뷰를 고치는 명령이 `openPagesIn`(`side_peek` · `center_peek` · `full_page` — 정본 CHECK 과 같다)을 받는다. 구조를 고치는
> 사람(뷰를 고치는 것과 같은 문). 뷰 읽기가 싣는다
>
> ⑥ **[8n-2] 고르개** — 뷰 도구막대의 "열기"(구조를 고치는 사람에게만 · 행을 그리는 뷰에만 — 폼은 없다) · 셋 중 하나를 고르면 곧바로
> 저장되고 화면이 다시 읽어 행 링크가 바뀐다. 좁은 화면은 사이드 피크 패널이 화면 폭을 다 쓴다(따로 전체 페이지로 바꾸지 않는다 — 닫기 ·
> 전체 페이지로 열기가 늘 있다)
>
> ⑦ **[8n-3a] 이전 · 다음 행** — 피크 머리에 "이전 행" · "다음 행"(02 *"데이터베이스 peek 에서 다음/이전 행으로 이동"*). 순서는 **이 화면이
> 그린 행의 순서** — 서버가 이 뷰에 읽은 첫 페이지(필터 · 정렬 · 검색이 걸린 그대로 · 보드는 그룹 차례대로 · 캘린더는 그 달의 행). 이웃의 주소는
> 행 링크와 같은 규칙(`rowOpenHref` — 피크를 바꿔 연다 · 쌓지 않는다). **끝에서 돌아 감지 않는다**(첫 행의 "이전" · 끝 행의 "다음" 은 서지
> 않는다). 피크의 행이 그 순서에 없으면(필터 · 검색에 빠졌다 · "더 보기" 뒤의 행 · 펼친 하위 항목) 둘 다 서지 않는다 — 화면이 보여 준 적 없는
> 순서를 지어내지 않는다. 단축키는 두지 않는다(02 `[확인필요]` · 편집기의 `Mod+Shift+↑↓` 는 블록 옮기기다)

**[보강] 캘린더 — 날짜 속성으로 놓는다** ⟨DB 심화 2g-1조각 · F-04-06 / 마이그레이션 0058⟩

- ① `view.type = 'calendar'`(CHECK 은 그대로 · 명령이 받는다). 레이아웃은 `view.configuration.calendar = { date_property_id, view_range }`
  — 갤러리와 같은 규칙(한 키 · 두 키를 늘 함께 · 바뀐 키만 `configuration || patch` 로 덮는다 · CHECK `ck_view_calendar_layout` · `IS TRUE`).
  `view_range` = month · week(주 보기 ⑨ · C-5). 주의 시작 · 주말은 ⑦(C-3 · 0117).
- ② **날짜 속성은 필수다** — 만들거나 캘린더로 바꿀 때 저장된 것이 살아 있으면 그대로, 아니면 **첫 날짜 속성**(스키마 순서), 없으면 거부
  (`date_required` — 보드의 `group_required` 와 같은 태도). 지워지면 읽기가 null 을 준다(저장값은 남아 복원하면 돌아온다 · 04 의 "다른
  날짜 속성으로 자동 폴백"은 하지 않는다 — 그룹 속성과 같은 이유 §3.6 [보강] `view.group_by`).
- ③ 행은 **보이는 기간**(날짜 글자 `from` ~ `to` · 62일 이하)에 걸친 것만 — 사이드카로 `date_start ≤ to+1일 AND coalesce(date_end,
  date_start) ≥ from−1일`(양끝을 하루씩 넓힌다 — 시각이 있는 값은 시간대에 따라 UTC 날짜가 어긋난다) · 날짜순 · 상한 1000(`truncated`) ·
  커서 없음. 조건은 표와 같다(필터 · 뷰 검색 · 템플릿 · 휴지통) · 하위 항목은 **부모만**. **날짜 없는 행은 개수만** 준다(`undated`).
- ④ 칸에 놓는 날은 **칸 값의 날짜 글자**(`start` · `end` 의 앞 열 자 — 사람이 고른 그 날)다. 서버가 넓혀 준 행을 화면이 이것으로 다시 가른다.
- ⑤ **[C-1] 하루에 넘치는 카드** ⟨캘린더의 나머지 트랙 C-1 / 마이그레이션 없음⟩ — 한 주에 막대 줄이 넘치면 그 날짜 칸의 "+N"(그날 그려지지
  않은 수)은 **단추**다. 누르면 그날에 걸친 카드 **전부**(막대로 보이는 것도 · 여러 날에 걸친 것도 — ④ 의 날짜 글자로 가른다)의 목록을
  연다. 차례는 서버가 준 날짜순(막대 배치의 차례와 같다). 항목은 행을 연다(막대의 링크와 같은 곳 — 사이드 피크가 켜졌으면 피크). 목록은
  몸으로 내보낸 층이다(보드의 "옮기기" 메뉴와 같은 규칙 — 열면 첫 항목에 포커스 · Esc 는 단추로 · 바깥을 누르거나 포커스가 나가면 닫는다).
  목록에서 끌어 날짜를 옮기지는 않는다(막대로 — §7). 새로 읽지 않는다 — 화면에 있는 그 달의 행으로 센다.
- ⑥ **[C-2] 날짜 없는 행** ⟨캘린더의 나머지 트랙 C-2 / 마이그레이션 없음⟩ — 머리의 "날짜 없음 N개"(③ 의 `undated`)는 **단추**다. 누르면 그
  행들의 목록을 연다 — 새 읽기 `GET …/views/{id}/calendar/undated?q=&cursor=` 가 **행 질의에 날짜 칸의 "비어 있음" 규칙을 AND 로 붙여**
  준다(수와 같은 조건 — 필터 · 뷰 검색 · 권한 · 템플릿 · 휴지통 · 하위 항목은 부모만 · 보는 사람의 오늘). 차례는 표와 같다(정렬 · 없으면 그
  뷰의 수동 순서) · 50개씩 커서로("더 보기"). 열 때마다 처음부터 읽는다(그사이 날짜가 생긴 행이 남지 않게). 항목은 그 행을 연다(⑤ 와
  같은 층 규칙). 목록에서 달력으로 끌어 날짜를 주는 것은 뒤로(§7).
- ⑦ **[C-3] 주의 시작 요일 · 주말 숨기기** ⟨캘린더의 나머지 트랙 C-3 / 마이그레이션 0117⟩ — 04 의 `show_weekends` 와 주의 시작을
  `configuration.calendar` 에 키로 둔다: `week_start` = `sunday`(없으면 · 지금까지의 격자) · `monday`(그룹의 주 시작 [보강 B-3] B-3b 와
  같은 두 값) · `show_weekends` = `true`(없으면) · `false`. **기본값이면 싣지 않는다** — 저장 명령이 지금 값 위에 바꿀 키를 얹고 기본값은
  빼고 쓴다(① 의 "바뀐 키만"). CHECK `ck_view_calendar_layout` 을 같은 이름으로 다시 건다(키가 있으면 그 값이어야 한다 — null 도 거부).
  - 격자는 그 요일부터 6주다(서버가 읽는 기간 ③ 과 화면의 격자가 같은 함수 `monthGrid`). 머리의 요일 이름도 그 차례.
  - 주말을 숨기면 토 · 일 칸을 그리지 않는다(다섯 칸) — 막대는 **그리는 날의 차례**로 칸을 센다: 금요일 ~ 월요일 일정은 금 · 월 두 칸에
    이어 그린다 · 숨긴 주말에만 걸친 일정은 그 주에 그리지 않는다("+N" 에도 들지 않는다). 날짜 값은 그대로다(보기의 설정일 뿐).
  - 보기의 설정이라 `edit_structure` 다(날짜 속성 고르기와 같은 패널).
- ⑧ **[C-4] 가장자리로 기간 바꾸기** ⟨캘린더의 나머지 트랙 C-4 / 마이그레이션 없음⟩ — 04 F-04-06 *"date range 드래그"* · *"카드 드래그 ·
  리사이즈는 셀 값 변경이므로 허용"*. 막대의 **첫 조각의 왼쪽 끝 · 마지막 조각의 오른쪽 끝**에 손잡이(주를 넘어 이어진 쪽에는 없다).
  끌어 놓은 날짜 칸이 새 시작 · 끝이다 — **날짜 글자만** 바꾸고 시각 · 시간대는 그대로(옮기기 2g-3 과 같은 기준). 끝이 없던 값의 끝을
  늘이면 시작의 시각을 빌린다. 시작을 끝 뒤로 · 끝을 시작 앞으로 끌면 그 날에서 멈춘다(뒤집지 않는다). **시작과 끝이 같은 날이 되면 끝을
  지운다**(하루짜리 값 — 노션이 범위를 접는 것과 같다). 셀 쓰기 하나(`updateCell` · 뷰를 실어 "조건 밖" 판정) · 화면이 먼저 바꾸고
  거부되면 되돌린다 · `edit_content`. 4px 넘게 움직여야 끌기다(그 전에 놓으면 아무 일도 없다 · 막대의 링크를 열지 않는다).
- ⑨ **[C-5] 주 보기** ⟨캘린더의 나머지 트랙 C-5 / 마이그레이션 없음⟩ — `view_range = 'week'`(2g-1 부터 저장은 받았다)이면 **한 주**를
  그린다. 보이는 주는 주소의 `w`(`YYYY-MM-DD` — 그 날이 든 주 · 주의 시작 요일 ⑦ 부터)다 · 없거나 틀리면 **보는 사람의 오늘**이 든 주
  (시간대 쿠키 — R-1 의 오늘). 달 보기의 `m` 과 따로다(둘 다 주소에 있어도 보기 단위가 고른다). 서버가 읽는 기간은 그 7일(③ 의 같은
  질의 · `weekGrid`). 화면: 제목은 "2026년 3월 15일 – 21일"(달 · 해를 넘으면 그것도 쓴다) · 이전 · 다음은 7일씩 · "오늘"은 오늘이 든
  주 · 한 줄이라 막대를 **여덟 줄**까지(달 보기는 셋 — 넘치면 같은 "+N" ⑤) · 그 달 밖의 날을 흐리게 하지 않는다. 주말 숨기기 · 날짜
  없음 · 끌기 · 가장자리는 달 보기와 같다. "달력" 패널의 "보기 단위"(달 · 주)가 고른다(`edit_structure`).
- ⑩ **[D-1] 날짜 없는 행을 달력으로** ⟨날짜 없는 행을 달력으로 트랙 D-1 / 마이그레이션 · 서버 변경 없음⟩ — 04 F-04-06 *"No date 항목을
  캘린더로 드래그"*. ⑥ 의 "날짜 없음" 목록의 항목을 **4px 넘게 끌면** 끌기다(그 전에 놓으면 지금처럼 행을 연다) — 달력의 날짜 칸에 놓으면
  그 날이 날짜 값이다(`{ start: 그 날 }` — 시각 없이). 끄는 동안 놓일 칸을 표시한다(막대 끌기 2g-3 과 같은 표시 · 같은 칸 재기). 셀 쓰기
  하나(뷰를 실어 "조건 밖" 판정 — 필터에 걸리는 날이면 그 안내) · 놓으면 목록을 닫고 서버 렌더를 다시 부른다(머리의 수와 그 달의 막대가
  같은 판정으로 다시 선다). 달력 밖에 놓으면 아무 일도 없다. `edit_content` — 고칠 수 없으면 끌리지 않는다(누르면 연다).

**[보강] 갤러리 — 카드 그리드부터** ⟨DB 심화 2f-1조각 · F-04-05 / 마이그레이션 없음⟩

- ① `view.type = 'gallery'` — `ck_view_type`(0022)이 이미 받는 이름이라 스키마는 그대로다. 명령이 받는 뷰 타입(`MVP_VIEW_TYPES`)에 더했다.
  그룹이 필요 없다.
- ② 행은 표와 같은 질의다(필터 · 정렬 · 뷰 검색 · 커서). 하위 항목이 켜진 표면 **부모(최상위 행)만** — 03 F-03-18 *"보드/캘린더/갤러리
  뷰는 Parents only"*. 펴는 길(`?parent=`)이 없다.
- ③ 카드 = 미리보기(④) + 제목(행 페이지의 아이콘) + 값이 있는 보이는 속성의 배지(보드 카드와 같은 규칙).
- ④ **레이아웃은 `view.configuration.gallery = { cover, cover_size, cover_aspect }`** ⟨2f-2조각 / 마이그레이션 0057⟩ — `configuration`
  의 첫 손님이다. 한 키 아래에 두고(다른 종류의 키와 섞이지 않게) 세 키를 늘 함께 쓴다 · 명령은 잠근 행의 지금 값 위에 **바꿀 키만** 얹어
  `jsonb_set` 으로 그 한 키만 쓴다(04 *"JSON 전체 교체 금지"*). `cover` = `page_content`(본문의 첫 이미지 — 기본) · `none`. 페이지 커버
  (F-02-06) · 파일 속성은 생기면 더한다. `cover_size` = small · medium · large(카드 폭) · `cover_aspect` = cover(잘라 채움) · contain.
  모양은 CHECK(`ck_view_gallery_layout` — 묶음 전체를 `IS TRUE`).
- ⑤ **본문의 첫 이미지** = 행 페이지 본문을 **깊이 우선 차례**로 걸어 처음 오는 `image` ⟨갤러리의 나머지 트랙 Y-1 — 처음엔 최상위만⟩ — 토글 ·
  컬럼 · 콜아웃 · 목록 · 인용 안도 본다(화면에서 위에서 아래로 보이는 차례 — 부모 다음에 그 자식들, 그다음 형제). **하위 페이지 · 데이터베이스
  안으로는 내려가지 않는다**(그 페이지의 본문이다 — 스코프도 다를 수 있다) · 깊이 열까지 · 순서는 `block.order_key`(X-1
  파생) · 그 블록이 비어 있으면 미리보기 없음(뒤의 이미지를 찾지 않는다) · 값은 저장하지 않는 **화면 주소**(우리 파일은 내용 경로 —
  FS2 · 외부는 그 URL). 행 질의와 함께 서버가 준다(첫 페이지 · "더 보기").

**[보강] 뷰 검색 — 저장하지 않는 술어 하나** ⟨DB 심화 2e-1조각 · F-04-27 / 마이그레이션 0056⟩

초판은 뷰 검색을 다루지 않았다(04 F-04-27 이 *"테이블 추가 없음 — 검색어는 요청 파라미터이자 클라이언트 상태"* 라고 했다).

- ① **스키마가 없다.** 검색어는 요청(`?q=`)이 들고 오고 `view` 에 쓰지 않는다. 필터와 **AND** 로 붙는 술어 하나다 — 행 질의 · 열 집계 ·
  보드(카드 · 개수 · 머리 값 · 다음 페이지)가 같은 술어를 끼워 같은 행을 본다.
- ② **찾는 칸은 명시적 목록이다** — 제목 · 글(사이드카 `text_value`) · 선택 · 상태(사이드카는 옵션 id 라 `select_option.name` 으로).
  날짜 · 체크박스 · rollup · 본문은 찾지 않는다(숫자 · 고유 ID 는 ⑤ — V-1 · relation 은 ⑥ — V-2). 살아 있는 프로퍼티의 칸만. 대소문자 무시 · 부분 일치 ·
  `%` · `_` · `\` 는 글자 그대로(필터의 글 비교와 같은 `escapeLike`).
- ③ **인덱스** — `ix_ppv_text_bigm`(`lower(text_value)` 의 pg_bigm GIN · 부분 `text_value IS NOT NULL`). 0013 의 `ix_ppv_text` 는
  `text_pattern_ops` 라 접두사만 받는다. pg_trgm 이 아니라 pg_bigm 인 것은 한국어 2-gram 때문이다(0012). 질의는
  `p.id IN (SELECT page_id … LIKE …)` 모양이라 인덱스가 쓰인다(상관 `EXISTS` 면 행마다 칸을 찾는다).
- ④ 하위 항목이 켜진 표 · 목록은 검색 중에도 **트리다** — 맞지 않는 조상은 회색 맥락 행으로 함께 선다(⑧ · H-1 이 바꿨다 — 처음엔 맞는
  행을 평평하게 줬다). 보드는 그룹(열)을 남기고 카드만 좁힌다.
- ⑤ **[V-1] 고유 ID · 숫자로 찾기** ⟨뷰 검색의 나머지 트랙 V-1 / 마이그레이션 없음⟩ — 검색어가 **모양으로** 고르는 두 갈래를 ② 의 글 찾기와
  **OR** 로 더한다(글로도 맞으면 맞는다):
  - 고유 ID — 검색어가 `접두사-번호`(접두사는 영숫자 2 ~ 7자 · 대소문자 무시 — 저장은 대문자 0050)면 그 번호 · 그 접두사의 행, `번호`만이면
    그 번호의 행(접두사는 묻지 않는다). 그 표에 고유 ID 속성이 살아 있을 때만. 행 자신의 열(`page.unique_seq`)을 보는 조건이라 칸 찾기의
    `p.id IN (…)` 에 넣지 않고 그 옆에 OR 로 둔다(인덱스 길을 해치지 않는다 · 필터의 고유 ID 와 같은 자리).
  - 숫자 — 검색어가 수(`-` · 소수점 허용 · 지수 표기는 아니다)면 숫자 칸 중 **그 값과 같은** 칸(부분 일치가 아니다 — `4` 가 `42` 를
    찾지 않는다). 사이드카의 `num_value`. 수식의 결과는 아직 아니다(캐시 `derived_value` — 뒤로).
  날짜는 여전히 찾지 않는다(쓰는 모양이 여럿이라 — §7).
- ⑥ **[V-2] relation 의 제목으로 찾기** ⟨뷰 검색의 나머지 트랙 V-2 / 마이그레이션 없음⟩ — relation 칸이 칩으로 보여 주는 **대상 행의 제목**도
  ② 의 글 찾기처럼 찾는다(부분 · 대소문자 무시 · 같은 `p.id IN (…)` 의 한 갈래). 대상은 칸이 보여 주는 것과 같다 — 살아 있고 템플릿이 아닌
  행(relation 필터 [보강 10n-44] 와 같은 결) · 그리고 **보는 사람이 읽을 수 있는 행만**(`readableScopes` — 칩이 "볼 수 없는 행"으로 그리는
  행의 제목으로 찾으면 그 제목이 새는 것과 같다). **하위 항목 · 종속 관계의 짝은 찾지 않는다**(`config` 의 `sub_items` · `dependencies` —
  트리 · 화살표로 보이는 칸이고, 검색은 트리를 평평하게 펴므로 부모가 자식의 제목으로 끌려 나오면 뜻밖이다 · 2e-1 의 절이 잡았다). 제목은 대상 표의 제목 사이드카(`page_property_value` · bigm 인덱스 0056)로 본다.
  읽을 범위는 질의마다 한 번 묻는다(검색어가 있을 때만 — 행 질의 · 열 집계 · 보드 · 캘린더가 같은 범위로 같은 행을 본다).
- ⑦ **[V-3] 맞은 글자 강조** ⟨뷰 검색의 나머지 트랙 V-3 / 마이그레이션 · 서버 변경 없음⟩ — 검색 중인 화면에서 **제목 · 글 칸**의 글 중 검색어와
  맞은 부분을 강조한다(대소문자 무시 · 겹치지 않게 왼쪽부터 · 서버의 부분 일치 ② 와 같은 뜻). 표 · 목록의 칸 · 보드 · 갤러리 · 캘린더의
  카드 제목. 선택 · 상태의 옵션 칩 · relation 칩 · 고유 ID · 숫자는 강조하지 않는다(맞은 까닭이 그 칸이어도 — 칩의 모양을 지킨다). 행
  페이지 · 공개 화면은 검색이 없어 강조도 없다. 강조는 화면의 글자만 감싼다(`<mark>`) — 값 · 편집 칸은 그대로다.
- ⑧ **[H-1] 검색 중 하위 항목 트리 — 맞지 않는 조상은 회색으로** ⟨22번 트랙 H-1 / 마이그레이션 없음⟩ — ④ 의 처음 규칙(평평하게)을
  바꾼다. 04 F-04-27 · F-04-22 의 중첩 엣지 *"자식을 보여주려면 부모를 비활성 회색 행으로라도 렌더해야 트리가 유지된다"*. 하위 항목이
  켜진 표 · 목록은 검색 중에도 트리로 읽는다:
  - **층마다 같은 질의 길**(최상위 · 그 행의 자식 — §3.2-113 ①)에 **맞은 행과 맞은 자손을 가진 행**이 선다. 맞지 않고 자손만 맞은
    행이 맥락 행이다. 행마다 `treeMatch`(스스로 맞았는가 · 아래에 맞은 행이 있는가 — 처음 이름은 `searchHit` · P-1 이 필터와 함께 쓰며
    바꿨다)를 단다.
  - ~~조상의 사슬은 권한 · 필터를 지난 살아 있는 행으로만 잇는다~~ **[P-1] 사슬은 읽을 수 있는 살아 있는 행으로 잇는다** — 필터에
    맞지 않는 조상도 회색으로 선다([보강 P-1] 하위 항목의 표시 범위 ③ — 필터의 조상 강제 포함이 들어와 필터와 검색이 한 규칙이 됐다).
    볼 수 없는 부모 밑의 자식은 여전히 보일 자리가 없다(그 부모의 제목을 회색으로라도 내주면 새는 것이다). 휴지통 부모에서
    멈춘다(그 자식이 최상위 — 하위 항목 ⑥).
  - **화면** — 맥락 행은 **회색**(열기 · 고치기는 그대로 — 결과가 아니라 자리라는 표시 · 읽는 사람에게는 "조건에 맞지 않는 상위
    항목" 이라고 말한다 — 처음엔 "검색어와" · P-1 이 필터에도 쓰며 바꿨다). 아래에 맞은 행이 있는 행은 **처음 한 번 저절로 편다**(펴지 않으면 회색 행만 보이고 맞은 행이 숨는다 · 사람이
    접으면 그대로 둔다). 토글은 아래에 맞은 행이 있을 때만(자식이 있어도 맞은 것이 없으면 펼 것이 없다). 검색 중엔 하위 항목 `+` 를
    세우지 않는다(만든 행은 대개 검색어에 맞지 않아 곧 사라진다).
  - **결과는 맞은 행이다** — 열 집계는 맞은 행만 센다(맥락 행은 결과가 아니다). "조건 밖"(10n-16 · [보강] 고친 카드가 뷰의 조건 밖으로)의
    판정은 트리와 같은 규칙 — 맞은 자손을 가진 행은 고쳐도 이 뷰에 선다.
  - 부모만 그리는 뷰(보드 · 갤러리 · 캘린더)와 그룹이 걸린 표(G-1 — 부모만 평평하게)는 그대로다 — 맞는 자식만 있는 부모는 서지 않는다.

**[보강] select · status 로 정렬 — 옵션의 순서** ⟨§7 정리 10n-46 · F-04-10 / 마이그레이션 없음⟩

04 F-04-10 의 정렬은 select 를 *옵션 정의 순서*로 한다. 사이드카(`text_value`)는 옵션 id 라 그것으로 정렬하면 아무 규칙 없는
순서다 — 그래서 지금까지 화면이 select · status 를 정렬 고르기에서 뺐다(서버는 받되 id 로 정렬했다). 정렬 키를 옵션의 순서로 바꾼다.

- ① **select** — 그 칸의 옵션(`select_option`)의 `order_idx`. 이진 순서(`COLLATE "C"` — fractional index)다. 지운 옵션을
  가리키는 값과 빈 칸은 맨 뒤다(NULLS LAST — 다른 타입의 빈 칸과 같다).
- ② **status** — 범주가 먼저(할 일 → 진행 중 → 완료 · `status_group.kind`), 그 안에서 옵션의 순서. 노션이 옵션을 범주별로
  묶어 보여 주는 순서와 같다. 범주를 옮긴 옵션([보강] 옵션 고치기 · 지우기의 그룹 바꾸기)은 새 범주의 자리로 간다.
- ③ **정렬 키는 값 하나다** — keyset 커서가 키마다 `IS NOT DISTINCT FROM` · `>` 로 잇기 때문이다. status 는 범주의 순번
  한 글자와 `order_idx` 를 이은 글자로 만든다 — 이진 순서에서 (범주, 옵션 순서)와 같다. 커서 값도 그 글자다.
- ④ **값을 다시 쓰지 않는다** — 읽을 때 옵션과 잇는다. 옵션의 순서 · 범주가 바뀌면 정렬된 뷰의 순서도 곧바로 따라간다.
- 수식의 결과 타입에는 select 가 없다(해당 없음). 보드의 열 순서는 정렬과 따로다(옵션 순서 그대로 — `group_order` 는 없다).

**[보강] 필터가 걸린 뷰에서 만든 행 — 필터가 정하는 값을 채운다** ⟨§7 정리 10n-10 · F-04-09 · F-03-17 / 마이그레이션 없음⟩

초판은 이것을 다루지 않았다. 04 는 *"링크드 뷰에서 행 추가 — 링크드 뷰의 필터 조건을 기본값으로 채울지 결정 필요 `[확인필요]`"* 로 남겼다.
그래서 필터가 걸린 뷰에서 만든 행이 새로고침 뒤 사라져 보였다(HANDOFF §7). 노션은 그 필터를 만족하는 값을 채운다 — 공식 도움말에는
없고 사용자 보고와 수식 필터의 예외(수식은 값을 채울 수 없어 새 행이 뷰에 남지 않는다)로 확인된다. 연산자마다의 규칙은 확인되지 않아
여기서 정한다. 행 추가를 뷰의 주소(`POST …/views/{id}/rows`)로 받는 까닭이 이것이었다.

- ① **조건이 값 하나를 정할 때만 채운다.** 채우는 것:
  - 제목 · 글 `equals` — 그 글자(대소문자는 필터가 무시하므로 적힌 그대로)
  - 숫자 `equals` — 그 수(유한한 수일 때만)
  - 선택 · 상태 `equals` — 그 옵션
  - 체크박스 `equals` — 그 값 · `does_not_equal false` — 체크(값이 둘뿐이라 하나로 정해진다)
  - 날짜 `equals` — 그날(날짜만 — 필터가 하루 단위로 비교한다)
  - 사람 `contains` — 그 사람(`{ "$context": "me" }` 는 만드는 사람). 같은 칸에 `contains` 가 여럿이면 모두를 넣는다
  - 상태 `is_empty` — **빈 값**을 적는다. 안 적으면 상태의 기본 옵션(`default_option_id`)이 들어가 새 행이 조건 밖이 된다
- ② **채우지 않는 것** — 범위(`greater_than` · `before` …) · 부분 일치(`contains` · `starts_with` …) · 부정(`does_not_equal` ·
  `does_not_contain` — 체크박스의 위 한 경우 말고) · `is_not_empty` · 수식 · 고유 ID(값을 적을 수 없다) · 다른 칸의 `is_empty`(새 행은
  이미 비었다). 만족하는 값이 여럿이거나 없으므로 고르지 않는다 — 그 조건이 걸린 뷰에서는 새 행이 조건 밖일 수 있다(노션도 수식에서 그렇다).
- ③ **AND 로 닿는 조건만 본다.** 맨 위의 조건 · AND 묶음 안 · 자식이 하나뿐인 OR 묶음 안(AND 와 같다). 자식이 둘 이상인 OR 묶음은 통째로
  건너뛴다 — 어느 쪽을 채울지 정할 수 없다. 같은 칸에 서로 다른 값을 정하는 조건이 둘이면(만족할 수 없는 필터) 그 칸은 채우지 않는다.
- ④ **어느 필터인가** — 만드는 사람이 보는 필터(`effectiveFilter` — 개인 필터가 있으면 그것 · 6c). 목표가 "만든 사람의 화면에서 사라지지
  않는다" 이기 때문이다. 연결된 데이터베이스의 뷰(2l)도 같다 — 행은 원본 소스에 생기고 그 뷰의 필터로 채운다. 검색어(`?q=` — 위 [보강])는
  채우지 않는다(저장하지 않는 임시 조건이고 부분 일치다).
- ⑤ **누가 이기나** — 요청이 준 칸(보드 열의 `+` 가 주는 그룹 값 · 캘린더 칸의 날짜 · 폼은 이 길이 아니다) **>** 필터가 정한 값 **>**
  템플릿의 값 **>** 기본값(상태의 기본 옵션). 템플릿보다 필터가 이기는 까닭도 ④ 다 — 필터가 정하지 않는 칸에서는 템플릿이 그대로 이긴다.
- ⑥ **채운 값이 맞지 않으면 버린다 — 행 추가를 실패시키지 않는다.** 지워진 · 읽기 전용 · 알 수 없는 속성, 그 속성에 없는 옵션(옵션을
  지워도 필터는 남을 수 있다 — 위 [보강] 옵션 지우기), 떠난 사람(사람 속성 ②)은 그 칸만 빠진다. 템플릿의 값을 거르는 것과 같은 거르개
  (`withoutMissingOptions` · `withoutLeftPeople`)다. 사용자가 고르지 않은 값 때문에 "추가" 가 거부되면 원인을 알 수 없다.
- ⑦ 채운 칸은 사람이 쓴 칸이다(`filled_by = 'user'` — 만드는 사람이 그 뷰에서 만든 것이다) · 사람 칸에 든 사람에게는 담당 알림이 간다
  (§3.8 [보강] 담당 알림 — 새로 든 사람이므로). 하위 항목(`parent` · 2b-2b)도 같은 뷰에서 만들면 같이 채운다.
- ⑧ **[보강 10n-47] relation `contains` — 그 행에 잇는다.** relation 의 값은 칸이 아니라 엣지라 위의 칸 채우기(①)에 들지 않는다.
  행을 넣은 **같은 트랜잭션에서** 연결하기(`linkRowsIn`)로 잇는다 — 연결하기의 규칙이 그대로다: 행 내용 고치기(`edit_content`) ·
  대상 행이 살아 있고 템플릿이 아니며 대상 표를 볼 수 있다 · "하나만" 제한 · 양방향의 거울상 · 하위 항목 · 종속 관계의 순환. 같은 칸에
  `contains` 가 여럿이면 모두를 잇는다(사람과 같다). 규칙에 걸리면 **그 칸만 빠진다**(⑥ — savepoint 로 그 잇기만 되돌린다): 만들기만
  있는 사람(`create_child` — 폼처럼 내용은 못 고친다) · 휴지통이거나 없는 행 · 하나만 제한에 둘 이상. 채우지 않는 것은 ② 와 같다 —
  `does_not_contain` · `is_empty`(새 행은 이미 비었다) · `is_not_empty`(정할 수 없다). 요청이 준 칸이 이기는 것(⑤)은 해당이 없다 —
  행 추가는 relation 값을 받지 않는다. **템플릿으로 만드는 길은 아직 잇지 않는다** — 템플릿의 엣지를 옮기는 길과 우선순위(⑤)를 함께
  정해야 한다(HANDOFF §7).

**[보강] `view.group_by` 의 모양과 `row_position.group_key` 의 뜻** ⟨보드 4a조각 / 마이그레이션 0022⟩

초판은 `group_by jsonb` 와 `group_key text DEFAULT ''` 만 적고 안을 비워 두었다. 구현이 정한 것:

- `group_by = { property_id, hidden?: text[], hide_empty?: boolean, calculation?: { property_id, function } }` — `sorts` 와 같은
  snake_case. `calculation` 은 그룹 머리의 계산이다(위 [보강] 열 집계 ⑤ · 2d-3). `sub_group_by` 는 같은 모양이 될 것이나 아직 쓰지 않는다.
- **그룹 순서는 옵션 순서(`select_option.order_idx`, 스키마 전역)다.** 뷰별 `group_order` 배열을 두지 않는다 — 04 F-04-11 의
  동시편집 엣지가 권한 트레이드오프(배열 LWW 를 없애는 대신 뷰별 그룹 순서를 포기). 숨김은 `hidden` 배열(LWW · 죽은 키는 읽기가
  무시한다 — 매 조회마다 정리하지 않는다).
- **`group_key` 의 뜻**: select = 옵션 id · checkbox = `'true'` / `'false'` · 값 없음 = `''`(DEFAULT). 지워진 옵션을 가리키는 셀도
  `''` 로 접는다 — SQL 의 키 식 하나가 카운트 · 행 · 커서에 같이 쓰인다. 묶을 수 있는 타입은 지금 select · checkbox 둘이고,
  F-04-11 의 나머지 버킷 규칙(multi_select 중복 등장 · date 단위 · number 구간)은 그 타입이 들어올 때 같은 자리에 더한다.
- **자리 없는 행이 정상이다.** 열의 순서는 자리 있는 행(`order_idx`) → 자리 없는 행(트리 순서 `block.order_key`). 행을 만들 때
  뷰 수만큼 자리를 미리 만들지 않는다. 정렬(`view.sorts`)이 살아 있으면 `row_position` 을 읽지도 쓰지도 않는다 — 드롭은 셀 값만
  바꾼다.
- **죽은 참조**: 그룹 프로퍼티가 지워져도 `group_by` 저장값은 두고 읽기가 null 로 준다(복원하면 숨김 설정까지 돌아온다).
  04 F-04-11 의 "다음 후보로 자동 재바인딩 · 후보가 없으면 status 생성"은 하지 않는다 — 조용히 다른 프로퍼티로 묶인 보드는
  사용자가 설명할 수 없다. 보드를 **만들거나 보드로 바꿀 때**만 첫 select 를 고르고, 고를 것이 없으면 거부한다(`group_required`).
- **[보강 10n-27] status 의 범주(그룹) 단위 열**(03 F-03-05 *"보드 뷰에서 status 로 그룹핑하면 그룹(범주) 단위 또는 옵션 단위
  컬럼을 만들 수 있다"*) — `group_by.status_by = 'group'`(없으면 옵션 단위 · status 에만 — 다른 타입에 주면 거부). 열은 `''` · 할 일 ·
  진행 중 · 완료(그룹 순서 · 옵션이 없는 범주도 열이다) · `group_key` 는 그룹 kind(`todo` …). 키 식이 셀의 옵션을 그 옵션의 그룹으로
  읽는다(옵션 id ↔ kind 표를 질의에 묶는다 — 카운트 · 행 · 커서 · 자리가 한 식이다). 범주 열에 놓거나 그 열의 `+` 로 만든 카드가 받는
  옵션: **기본 옵션이 그 범주면 그것, 아니면 그 범주의 첫 옵션**(옵션 순서 — 서버가 그룹마다 `fillOptionId` 로 싣는다). 범주에 옵션이
  없으면 놓을 수 없다(`invalid_value` · 화면은 그 열에 `+` 를 그리지 않는다). 이미 그 범주의 옵션이면 셀을 건드리지 않는다(옵션 단위와
  같은 규칙 — 같은 범주 안의 다른 옵션으로 바꾸지 않는다). 단위를 바꾸면 키 공간이 달라 `row_position` · `hidden` 의 옛 키는 읽기가
  무시한다(지우지 않는다 — 되돌리면 돌아온다 · 화면의 그룹 패널은 단위를 바꿀 때 숨김 목록을 버린다 — 그룹 기준을 바꿀 때와 같다).
- **[보강 B-1] 날짜로 묶기**(04 F-04-11 *"date — `date_granularity` = relative/day/week/month/year"*) ⟨그룹 버킷 트랙 B-1 / 마이그레이션
  없음⟩ — 묶을 수 있는 타입에 날짜를 더한다. `group_by.date_unit` = `day` · `week` · `month` · `year`(없으면 `month` — F-04-11 엣지
  *"5년치 day 단위 → 버킷 폭발 → 기본 month"* · 날짜가 아닌 속성에 주면 거부). 상대 단위(오늘 · 지난 7일 …)는 "오늘"이 보는 사람의 것이라
  따로 둔다(§7).
  - ① **키는 버킷의 첫 날**(`YYYY-MM-DD`) — 값에 **적힌 달력 날짜**(`start` 글자의 앞 열 자)로 센다. 시간대로 옮기지 않는다: 10월 31일
    23시 30분(서울)이라고 적은 행은 10월이다(사이드카의 UTC 시각으로 세면 시각이 붙은 값이 하루 밀린다). 기간이면 시작 날의 버킷.
    값 없음은 `''`. **주는 월요일에 시작한다**(ISO · `date_trunc('week')` — 시작 요일 고르기는 §7).
  - ② **그룹 목록은 데이터에서 나온다** — 옵션이 없으니 필터 · 검색 · 권한을 지난 행이 든 버킷들(날짜 오름차순) · 값 없음이 맨 앞(옵션
    그룹과 같은 자리). 행이 없는 버킷은 목록에 없다 — 빈 그룹 숨기기는 값 없음 그룹에만 닿는다. 놓거나 읽을 그룹 키는 목록에 없어도
    그 단위의 버킷 키면 받는다(빈 달에도 놓을 수 있다 · 아니면 `invalid_value`).
  - ③ **옮기면 단위만큼 민다** — 다른 버킷에 놓은 행의 날짜는 버킷 차이만큼(일 · 주는 날수 · 월 · 년은 달수) 간다. 시각 · 시간대 · 끝
    날짜를 지킨다(끝도 같은 만큼 — 기간이 그대로). 그 날이 없는 달이면 그 달의 끝 날로(1월 31일 → 2월 28일). 값이 없던 행을 버킷에
    놓으면 그 버킷의 첫 날(날짜만), 값 없음 그룹에 놓으면 비운다. 덩이 · 열의 "새로 만들기"도 그 버킷의 첫 날을 채운다.
  - ④ 단위를 바꾸면 키 공간이 달라 `row_position` · `hidden` 의 옛 키는 읽기가 무시한다(범주 단위와 같다 — 그룹 패널은 단위를 바꿀 때
    숨김 목록을 버린다). 버킷 규칙은 `date-group.ts` 하나다 — 서버의 키 식 · 이동과 화면의 이름(2026년 10월 · 2026년 10월 26일 주) · 새 행
    채우기가 같이 쓴다.
- **[보강 B-2] 숫자 구간으로 묶기**(04 F-04-11 *"number — 값 그대로 또는 `number_bucket{size}` 구간화"*) ⟨그룹 버킷 트랙 B-2 / 마이그레이션
  없음⟩ — 묶을 수 있는 타입에 숫자를 더한다. `group_by.number_size` = 구간의 크기(0 보다 크고 소수 여섯 자리까지 · 없으면 10 · 숫자가
  아닌 속성에 주면 거부). 값 그대로 묶기는 두지 않는다 — 크기 1 의 구간과 다르지 않고, 소수 값이면 그룹이 값마다 생긴다.
  - ① **키는 구간의 아래 끝** — `floor(v / size) * size` 를 `numeric` 으로 정확히 셈하고 글자는 `trim_scale` 의 것(`20` · `-10` · `0.5`
    — JS 의 `String(Number(k))` 와 같은 모양). 구간은 `[아래 끝, 아래 끝 + size)`. 값 없음은 `''`.
  - ② **그룹 목록은 데이터에서**([보강 B-1] ② 그대로) — 행이 든 구간들 · **숫자 오름차순**(글자 순이면 `-10 · 100 · 20`) · 값 없음이
    맨 앞. 놓을 키는 그 크기의 구간 키(정규 글자 · 크기의 배수)면 받는다.
  - ③ **옮기면 구간 차이만큼 더한다** — 23 을 `20` 구간에서 `50` 구간으로 옮기면 53(구간 안의 자리를 지킨다 · 날짜의 "단위만큼 민다"와
    같다). 소수 오차가 없게 십진 자리로 셈한다. 값이 없던 행은 구간의 아래 끝 · 값 없음 그룹은 비운다 · "새로 만들기"는 아래 끝.
  - ④ 머리의 이름은 `20 ~ 30`. 크기를 바꾸면 키 공간이 달라 옛 키는 읽기가 무시한다([보강 B-1] ④ 와 같다). 규칙은 `number-group.ts` 하나.
- **[보강 B-2b] 글자로 묶기**(04 F-04-11 *"text — `exact`(값 그대로) 또는 `alphabet_prefix`(첫 글자)"*) ⟨그룹 버킷 트랙 B-2b / 마이그레이션
  없음⟩ — 묶을 수 있는 타입에 **글(`rich_text`)** 을 더한다. **제목은 묶지 않는다** — 덩이 사이로 옮기면 그 그룹의 값이 되는데, 제목이면
  페이지 이름이 바뀐다. `group_by.text_by` = `exact`(글 그대로 · 없으면 이것) · `first`(첫 글자) — 글 속성에만(아니면 거부).
  - ① **글 그대로** — 키는 서식을 뺀 글(사이드카 `text_value`) · 빈 글은 `''`. 그룹 목록은 데이터에서([보강 B-1] ②) · 한국어 순서. 다른
    덩이로 옮기면 **그 글이 된다**(서식은 남지 않는다 — 키는 순수 글자다) · 새로 만들면 그 글 · 값 없음 그룹은 비운다. 놓을 키는 아무
    글이나 받는다(그 글이 된다).
  - ② **첫 글자** — 키는 첫 글자(앞 공백은 건너뛴다)의 머리: 한글은 **초성**(된소리는 예사소리로 — ㄲ → ㄱ · 휴대폰 주소록처럼) · 로마자는
    대문자 · 그 밖(숫자 · 기호 · 다른 문자 · 자음 낱자)은 `#`. 순서는 ㄱ ~ ㅎ · A ~ Z · `#` · 값 없음이 맨 앞. 첫 글자만 정할 수는 없어 **다른
    덩이로 옮기거나 그 덩이에 새로 만들 수 없다**(`invalid_value` — 옵션이 없는 범주 열과 같은 규칙 · 화면은 그 덩이에 끌어 놓지 못하고
    `+` 를 그리지 않는다) · 덩이 안의 차례는 바꾼다. 서버의 키 식(SQL)과 화면이 같은 규칙(`text-group.ts`)을 쓴다 — 초성 표 하나.
  - ③ 보드도 **받을 수 없는 열에는 끌어 놓지 못한다** — 첫 글자 열 · 옵션이 없는 범주 열(10n-27). 전에는 놓으면 서버가 거부했다.
- **[보강 B-3] 상대 날짜로 묶기**(04 F-04-11 *"date — relative"*) ⟨그룹 버킷 트랙 B-3 / 마이그레이션 없음⟩ — `group_by.date_unit` 에
  `relative` 를 더한다(날짜 속성에만 · [보강 B-1] 과 같은 자리).
  - ① **보는 사람의 오늘** — 버킷은 오늘에서 며칠 떨어졌나다. 오늘은 **보는 사람의 시간대**의 날짜다 — 브라우저가 자기 IANA 시간대를
    쿠키(`nc_tz`)로 알리고(워크스페이스 화면에 들어올 때마다 — 쓰기만 한다) 서버 렌더 · 그룹 라우트가 그것으로 오늘을 셈한다(쿠키가
    없거나 틀리면 UTC). 상대 날짜 그룹을 그린 화면만 서버의 오늘이 이 기기의 오늘과 다르면 한 번 새로 받는다(쿠키가 처음이거나 시간대가
    바뀌었다 — 모든 화면에서 새로 받으면 곧바로 이어진 이동이 그 요청을 끊는다). 접근성 설정처럼 기기의 것이다(계정 설정이 아니다 — 출장지에서는 그곳의 오늘). 그룹 결과가
    그 오늘을 싣는다 — 화면은 "새로 만들기"의 날짜를 그것으로 채워 서버와 하루가 어긋나지 않는다.
  - ② **버킷** — 그 전(30일보다 앞) · 지난 30일(8 ~ 30일 전) · 지난 7일(2 ~ 7일 전) · 어제 · 오늘 · 내일 · 앞으로 7일 · 앞으로 30일 · 그 뒤.
    겹치지 않는다. 키는 그 이름(`today` …)이다 — 오늘이 바뀌면 같은 행의 키가 바뀌므로 날짜를 키로 삼지 않는다. 그룹 순서는 날짜 순 ·
    값 없음이 맨 앞. 날짜는 [보강 B-1] ① 처럼 값에 **적힌 달력 날짜**로 센다.
  - ③ **옮기기** — 어제 · 오늘 · 내일로 옮기면 **그 날이 된다**(시각 · 끝 날짜는 같은 날수만큼 — 단위 "일"의 밀기). 범위 덩이(지난
    7일 …)로는 옮길 수 없다 — 어느 날인지 정할 수 없다(`invalid_value` · 화면은 끌어 놓지 못하고 `+` 를 그리지 않는다 — [보강 B-2b] ③
    과 같은 판정). 값 없음 그룹은 비운다. 덩이 안의 자리(`row_position`)는 키에 매이므로 날이 지나 키가 바뀐 행은 새 덩이의 끝에 선다.
  - **[B-3b] 주의 시작 요일** — `group_by.week_start` = `monday`(없으면 이것 · ISO) · `sunday`. 날짜 속성 · 단위 "주"에서만 뜻이 있다(다른
    단위에 주어도 받아 두되 읽지 않는다 · 날짜가 아닌 속성이면 거부). 키는 그 주의 첫 날(일요일 시작이면 일요일)이고, 옮기면 주 수만큼 민다
    (날수 — 시작 요일과 무관). 시작 요일을 바꾸면 키 공간이 달라 옛 키는 읽기가 무시한다([보강 B-1] ④ 와 같다).
- **[보강 B-4] 보드의 하위 그룹(가로줄)**(04 F-04-11 *"board면 `Sub-group` 추가로 2차 축 구성"*) ⟨그룹 버킷 트랙 B-4 / 마이그레이션 없음 —
  `view.sub_group_by` 는 0015 부터 있다⟩
  - ① **모양은 `group_by` 와 같다**(`property_id` · `hidden` · `hide_empty` · `status_by` · `date_unit` · `week_start` · `number_size` · `text_by`) —
    머리의 계산(`calculation`)은 열의 것만이라 받아도 버린다. **보드에서만**(다른 뷰에 주면 `invalid_group` · 보드를 다른 뷰로 바꾸면 저장값은
    두고 읽지 않는다 — 되돌리면 돌아온다). **그룹 기준과 같은 속성은 거부**(한 축이 된다). `null` 은 없앤다. 버킷 규칙은 열과 같다(날짜 ·
    숫자 · 글 · 범주 단위 — `GroupAxis` 하나를 두 축이 쓴다).
  - ② **칸 = (열, 가로줄)** — 읽기는 두 단계 그대로다: 칸마다 카운트(가로줄의 행 수 · 열의 행 수는 그 합) → 보이는 칸마다 첫 페이지
    (`load_limit`). 칸마다 커서 — 그룹 행 읽기가 가로줄 키(`sub`)를 받는다. 가로줄 순서 · 숨김 · 빈 가로줄 숨기기는 열과 같은 규칙
    (`sub_group_by.hidden` · `hide_empty`). 머리의 계산은 열마다(가로줄을 가로질러) 그대로다.
  - ③ **칸 안의 자리** — `row_position.group_key` = 열 키 + `chr(31)` + 가로줄 키(제어 문자 — 어떤 그룹 키에도 들지 않는다). 하위 그룹을
    풀면 열 키만의 자리로 돌아간다(옛 칸의 자리는 남는다 — 다시 걸면 돌아온다 · 평평한 표의 `'*'` 와 같은 태도).
  - ④ **옮기기는 두 축을 한 트랜잭션으로** — 다른 칸에 놓으면 열의 값과 가로줄의 값을 함께 쓴다(각 축의 규칙 그대로 — 날짜 · 숫자는 민다 ·
    첫 글자 · 상대 날짜의 범위 · 옵션 없는 범주는 거부). 가로줄 키를 주지 않으면 그 행의 지금 가로줄에 남는다. "덩이 안 차례만"(`within`)은
    칸 안이다.
  - ⑤ **[B-4b] 화면 — 가로줄마다 보드 하나** — 가로줄(머리: 펼침 · 이름 · 행 수)마다 열의 칸을 그린다. 가로줄 안은 보드 그대로다(열
    머리 · 칸마다 "더 보기" — 그 칸의 커서 · 칸의 `+` 는 두 값(열 · 가로줄)을 채운다 · 가로줄 안에서 열 사이로 끌면 열의 값만 바뀐다).
    가로줄 접기는 보는 사람의 이 기기에([보강 G-1] ⑥ 과 같은 자리 · 열의 접기와 따로). 칸 머리는 그 칸의 행 수다(머리의 계산은 열을
    가로지르므로 가로줄 안에 두지 않는다). 숨긴 열은 가로줄마다 그리지 않는다 — 숨긴 열 · 숨긴 가로줄의 수는 보드 아래 한 번 말한다.
    구독은 가로줄들이 하나를 나눠 쓴다([보강 G-3] ③).
  - ⑦ **[B-4d] 가로줄 사이로 끌기** — 카드를 다른 가로줄에 놓으면 두 값(놓은 열 · 그 가로줄)이 한 번에 바뀐다(④). 덩이들이 서로를 찾는 자리
    ([보강 G-1] ⑧ · `group-lanes.ts`)를 보드도 쓴다 — 놓을 자리를 세는 법과 표시는 받는 가로줄이 맡고(그 가로줄의 열 · 카드로 — 보드의
    `resolveDrop`), 끄는 가로줄은 포인터만 넘긴다. 받을 수 없는 가로줄(옵션 없는 범주 · 첫 글자 · 상대 날짜의 범위) · 접힌 가로줄(보이지 않는 칸)과
    받을 수 없는 열에는 놓지 못한다.
    끄는 가로줄에서 먼저 빼고 서버의 답(새 값의 카드)을 받는 가로줄에 넣는다 · 거절되면 서버 렌더를 다시 부른다. 정렬된 보드면 받은
    가로줄이 그 칸을 다시 읽는다(정렬이 자리를 정한다 — 가로줄 안의 끌기와 같다).
  - ⑧ **[B-4e] 카드의 "옮기기" 메뉴에 가로줄** — 끌기의 대안([보강 10m-2] · WCAG 2.5.7)도 두 축을 고른다. 가로줄 모드의 카드 메뉴는
    다른 열 아래에 "다른 가로줄로"를 더 둔다 — 그 카드가 선 **같은 열**의 맨 뒤(정렬된 보드는 정렬이 자리를 정한다). 고를 수 있는 가로줄은
    끌기와 같다(⑦ — 채울 값이 있고 접히지 않은 다른 가로줄 · 그 열을 받을 수 있을 때). 위에서 아래 순서다. 옮기면 포커스는 새 가로줄의 그
    카드의 "옮기기" 단추로 간다(이어서 옮길 수 있게). 목록은 열 때 센다(그때의 접힘 · 열을 읽는다).
  - ⑥ **[B-4c] 그룹 패널의 "하위 그룹"** — 보드의 그룹 패널 아래 칸: 속성(없음 · 그룹 기준이 아닌 묶을 수 있는 속성) · 그 속성의 버킷 고르개(묶는
    단위 · 날짜의 단위 · 주의 시작 · 글의 방식 · 숫자의 구간 — 열의 것과 **같은 고르개**를 쓴다) · 빈 가로줄 숨기기 · 가로줄마다 보이기. 속성 ·
    버킷을 바꾸면 키 공간이 달라 숨김 목록은 버린다(열과 같다). 구조를 고치는 사람만(그룹과 같은 문).
- **[보강 S-1] 그룹의 순서 — 오름 · 내림**(04 F-04-11 *"그룹 순서: `sort='manual'` 이면 `group_order` 배열, 아니면 값 기준
  asc/desc"*) ⟨그룹 순서 트랙 S-1 / 마이그레이션 없음⟩ — `group_by.sort` = `ascending`(없으면 이것 · 저장하지 않는다) · `descending`.
  **데이터에서 나온 그룹(날짜 — 상대 날짜 포함 · 숫자 · 글)에만** 준다 — 선택 · 상태 · 체크박스에 주면 거부한다. 그 순서는 옵션 순서다
  (스키마 전역 · 위의 판결 *"뷰별 `group_order` 배열을 두지 않는다"* 는 그대로 — `manual` 도 없다).
  - ① 내림은 그 축의 오름 차례를 뒤집는다 — 날짜는 버킷의 첫 날 · 상대 날짜는 그 전 → 나중 · 숫자는 수의 차례 · 글은 한국어 차례(첫 글자면
    ㄱ ~ ㅎ · A ~ Z · #). **값 없음 그룹은 어느 쪽이든 맨 앞**이다(노션 보드의 "No X" 열 — 왼쪽 끝 · 가로줄이면 맨 위).
  - ② 가로줄(`sub_group_by` · [보강 B-4])도 같은 모양 · 같은 규칙이다.
  - ③ 키 공간이 그대로라 순서를 바꿔도 숨김 · 칸의 자리(`row_position`)는 남는다. 단위 · 방식 · 구간을 바꿔도 순서는 남는다(방향은 키
    공간과 상관없다 — 화면의 고르개가 싣는다).
  - ④ **타입을 바꾼 뒤** — 저장값은 지우지 않지만 순서는 오름으로 읽고, 뷰를 읽을 때(`ViewDetail.groupBy`) **그 타입의 버킷 키만** 보인다
    (단위 · 주의 시작 · 방식 · 구간 · 묶는 단위 · 순서 — B-1 부터의 키도 함께). 화면이 지금 설정에 얹어 저장해도 검사에 걸리지 않고, 그
    저장이 낡은 키를 정리한다(그 전에 다시 그 타입으로 바꾸면 돌아온다).
- `view.type` 의 주석 10종을 CHECK(`ck_view_type`)으로 승격했다(0022).

**[보강 G-1] 표 · 목록의 그룹** ⟨그룹 트랙 G-1 · 04 F-04-04 · F-04-11 / 마이그레이션 없음 · 서버 변경 없음⟩

- ① **표 · 목록도 `view.group_by` 로 묶는다** — 보드와 같은 모양 · 같은 버킷(select · status — 범주 단위 포함 · checkbox) · 같은 읽기(`queryGroups` —
  그룹마다 첫 페이지(`load_limit`) · 개수 · 숨김 · 빈 그룹 숨기기 · 머리의 계산). 보드와 다른 것: **그룹이 없어도 된다**(`group_by = null` —
  평평한 표). 도구줄의 "그룹"에서 고르고 없앤다(보드는 없앨 수 없다 — `group_required`).
- ② **화면은 그룹마다 한 덩이** — 머리(그룹 이름 — 옵션 칩 · 체크 · "값 없음" · 개수 또는 머리의 계산) 아래에 그 그룹의 표(머리 행 · 칸 ·
  그 그룹만의 "더 보기" — 그룹 행 라우트의 그룹별 커서 F-04-15 · "새로 만들기"). 그룹 순서는 보드의 열 순서(옵션 순서)다. 숨긴 그룹은 그리지
  않고 그 수만 말한다(되살리기는 도구줄의 그룹 패널).
- ③ **그룹의 "새로 만들기"는 그 그룹의 값을 채운다** — 보드 열의 `+` 와 같은 값(`prefillCells` · 범주 열은 `fillOptionId` — 채울 옵션이 없는
  범주에는 만들 수 없다 · 값 없음은 비운다). 템플릿으로 만들어도 이 값이 템플릿의 값을 덮는다(F-08-03).
- ④ **셀을 고쳐 다른 그룹의 값이 된 행은 고친 그 덩이에 남는다**(표의 "조건 밖" 규칙 — 손 밑에서 사라지지 않는다). 다시 읽으면 제 그룹으로
  간다. 표 변경 신호의 구독은 **덩이들이 하나를 나눠 쓴다** — 덩이마다 구독하면 그룹 수만큼 연결이 열려(브라우저의 서버당 동시 연결 상한)
  다른 요청을 막는다. 신호가 오면 덩이마다 제 그룹을 다시 읽고, 화면이 머리(개수 · 그룹 목록)를 다시 그린다.
- ⑤ **그룹 모드에서 아직 하지 않는 것**(다음 조각): 하위 항목 트리 · 하위 그룹(`sub_group_by`).
- ⑥ **[G-2a] 덩이 접기 — 보는 사람의 이 기기에** — 머리의 펼침 단추(`aria-expanded`)로 그 덩이의 표를 접는다(머리 · 개수는 남는다). 접은 그룹 키는
  뷰마다 `localStorage` 에 둔다(사이드바의 펼침과 같은 자리) — 보기 설정이 아니다: 한 사람이 접었다고 같은 보기를 보는 사람의 덩이가 접히지
  않는다. 서버가 그린 첫 화면은 다 펼쳐져 있고, 읽는 쪽이 하이드레이션 뒤에 접는다. 접어도 표는 살아 있다(불러온 행 · 실시간 다시 읽기 그대로).
- ⑦ **[G-2b] 덩이 안의 행 끌기 — 보드 열의 자리 그대로** — 손잡이 · `Alt+↑/↓` 로 덩이 안의 차례를 바꾼다(정렬이 없을 때만 — 평평한 표와
  같다). 자리는 보드의 열 안 자리(`row_position(view, group_key)`)이고 명령도 보드의 이동(`moveRow`)이다 — 같은 그룹이라 셀은 쓰지 않는다.
  화면은 **덩이 안 차례만**(`within`)이라고 말한다: 그 행이 그사이 다른 그룹 값이 됐으면(④ — 고친 덩이에 남은 행) 보드의 규칙으론 값이
  이 덩이 것으로 되돌아가므로, 서버가 셀을 쓰지 않고 거부한다(`not_found` — 화면이 낡았다 · 다시 읽는다). 화면도 "조건 밖" 표시가 붙은
  행에는 손잡이를 그리지 않고, 놓을 자리 · 키의 한 칸에서 그 행을 건너뛴다. **그룹의 자리와 평평한 표의 자리(`'*'`)는 따로다** — 이동이 옛
  그룹의 자리를 지울 때 `'*'` 는 지우지 않는다(지우던 것을 고쳤다 — 그룹을 풀면 평평한 표의 차례가 돌아온다 · [보강 10n-59] 의 "양쪽 순서가
  남는다" 가 보드의 이동에서도 참이 됐다).
- ⑧ **[G-2c] 덩이 사이의 행 끌기 — 놓은 덩이의 값이 된다** — 손잡이로 행을 다른 덩이에 놓으면 그 그룹의 값이 되고 그 덩이의 그 자리에 선다
  (보드 카드를 다른 열에 놓는 것과 같다 — `moveRow` 를 `within` 없이: 셀 값 + 자리를 한 트랜잭션으로). 놓을 자리는 그 덩이의 행들 사이다 —
  가운데가 포인터보다 아래인 첫 행의 앞 · 없으면 맨 뒤(더 볼 행이 남았으면 맨 뒤에는 놓지 않는다) · "조건 밖" 행은 세지 않는다. 채울 값이 없는
  범주(10n-27)에는 놓지 못한다(줄도 서지 않는다). 옮긴 행이 뷰의 조건 밖이 되면(`inView` 거짓 — 10n-15) 받은 덩이에 "조건 밖"으로 남는다.
  키로 덩이를 건너는 길은 두지 않는다(칸에서 값을 고치면 된다). 덩이마다 표가 따로라 그룹 화면이 덩이들이 서로를 찾는 자리를 하나 둔다
  (`group-lanes.ts`) — 끄는 표가 포인터 아래의 다른 덩이에 줄을 그리게 하고, 놓으면 그 덩이에서 먼저 빼고 서버의 답(새 값의 행)을 받는
  덩이에 넘긴다. 거절되면 두 덩이가 다시 읽는다.
- ⑨ **[G-2d] 덩이마다 열 집계 줄 — 그 그룹의 행 전부로** — 표 모양의 덩이 아래에 집계 줄이 서고 값은 **그 그룹의 행 전부**의 것이다(덩이에
  불러온 행이 아니다 — 머리의 개수와 같은 행: 권한 · 필터 · 뷰 검색어 · 하위 항목의 "부모만"). 뷰 전체의 값을 덩이 아래에 두면 그 그룹의 값으로
  읽히므로 G-1 에서는 줄을 그리지 않았다. 계산 함수는 열의 것 하나다(뷰 설정 — 덩이마다 따로 고르지 않는다 · 한 덩이에서 고르면 모든 덩이가
  그 함수로 다시 선다). 질의는 열 · 그룹 수와 무관하게 하나 — 행과 그룹 키를 한 번 고르고 그룹마다 · 열마다 칸을 모은다(`statsJsonSql` ·
  행이 없는 그룹은 빈 통계). 첫 화면은 서버 렌더가 모든 그룹의 값을 한 번에 · 덩이의 다시 읽기는 그룹 행 라우트의 첫 페이지가 그 그룹의 값을
  싣는다(평평한 표의 행 라우트와 같은 모양 — 표 뷰만 · 보드는 싣지 않는다).

**[보강 G-3] 갤러리의 그룹** ⟨그룹 트랙 G-3a · 04 F-04-05 · F-04-04 / 마이그레이션 없음⟩

- ① **갤러리도 `view.group_by` 로 묶는다** — 표 · 목록의 그룹([보강 G-1])과 같은 버킷 · 같은 읽기(`queryGroups`) · 그룹이 없어도 된다(도구줄의
  "그룹"에서 고르고 없앤다). 화면은 그룹마다 한 덩이 — 머리(접기 · 이름 · 개수 또는 머리의 계산 — [보강 G-1] ② · ⑥ 그대로) 아래에 그 그룹의
  카드 격자 · 그 그룹만의 "더 보기"(그룹별 커서) · "새로 만들기"는 그 그룹의 값을 채운다(채울 값이 없는 범주에는 세우지 않는다).
- ② **카드 미리보기는 덩이마다** — 첫 화면은 서버 렌더가 모든 그룹의 첫 페이지 카드의 것을 한 번에, "더 보기"는 그룹 행 라우트가 그
  페이지의 것을 싣는다(갤러리 · 본문의 첫 이미지일 때만 — 평평한 갤러리의 행 라우트와 같은 모양).
- ③ **표 변경 구독은 덩이들이 하나를 나눠 쓴다**([보강 G-1] ④ 와 같은 까닭) — 신호가 오면 서버 렌더를 다시 부르고 덩이마다 제 그룹의 첫
  페이지를 받아들인다(평평한 갤러리의 받아들이기 그대로 — 그 덩이가 고치는 중이면 끝난 뒤에).
- ④ **카드 끌기는 덩이 안의 차례다**(정렬이 없을 때만) — 보드 열의 자리 · 보드의 이동에 `within`([보강 G-1] ⑦ 과 같다).
- ⑤ **[G-3b] 덩이 사이의 카드 끌기 — 놓은 덩이의 값이 된다** — 손잡이로 카드를 다른 덩이에 놓으면 그 그룹의 값이 되고 읽는 차례로 포인터
  뒤의 첫 카드 앞에 선다(없으면 맨 뒤 · 더 볼 카드가 남았으면 맨 뒤에는 놓지 않는다). 명령 · 덩이들이 서로를 찾는 자리는 표의 것([보강 G-1]
  ⑧) 그대로이고, 놓을 자리를 세는 법과 그 표시는 **받는 덩이가 맡는다** — 표는 세로 줄 · 갤러리는 격자의 세로 막대(빈 덩이는 격자의 머리에).
  뷰의 조건 밖이 되면 받은 덩이가 안내한다(10n-16 과 같은 말).

**[보강 10n-59] 묶지 않는 뷰(표 · 목록 · 갤러리)의 수동 순서 — `group_key = '*'`** ⟨§7 정리 10n-59 · F-04-01 *"행 드래그 재정렬"* / 마이그레이션 없음⟩

- **키는 `'*'`** — 어떤 버킷 키도 될 수 없는 글자다(옵션 id 는 uuid · checkbox `'true'`/`'false'` · status 범주 kind · 값 없음 `''`). 그래서
  보드의 "값 없음" 열(`''`)과 섞이지 않고, 뷰의 종류를 표 ↔ 보드로 바꿔도 **양쪽 순서가 남는다**(지우지 않는다 — 되돌리면 돌아온다).
  `DEFAULT ''` 를 그대로 쓰면 보드의 값 없음 열에 자리가 있던 행들이 표로 바꾼 순간 맨 위로 떠오른다.
- **읽기** — 살아 있는 정렬(이 사람이 실제로 보는 것 — 개인 정렬 포함 · 지워진 속성의 키는 빼고)이 없을 때만. 자리 있는 행(`order_idx`)
  → 자리 없는 행(트리 순서 `block.order_key`) — 보드의 열과 같은 규칙이다. 하위 항목 트리도 같은 순서를 쓴다(형제 사이의 차례는 전체
  순서의 부분이라 따로 두지 않는다). 커서는 그 키를 정렬 키 하나로 싣는다. 공개 화면의 데이터베이스(게시)도 같은 순서다.
- **명령** — "이 행을 `before` 앞에"(null 이면 맨 뒤). 표 · 목록 · 갤러리 뷰에서만(아니면 `invalid_value`). **살아 있는 정렬이 있으면
  거부한다**(`sorted` — 보드는 정렬된 열에서 셀만 바꾸고 자리를 무시하지만 여기에는 셀이 없어 할 일이 없다 · 화면은 그때 끌기를 그리지
  않는다). 권한은 뷰 그릇의 `edit_content`(보드의 자리와 같다 — 이 뷰 안의 자리다). 옮기는 행과 `before` 는 그 소스의 살아 있는 행이어야
  한다(아니면 `not_found`). **뷰의 행을 잠근 뒤** 자리를 계산한다 — 두 사람이 같은 뷰에서 동시에 옮겨도 자리 없는 행의 자리를 겹쳐
  주지 않는다. 자리 없는 행에는 `before` 까지(맨 뒤면 전부) 트리 순서대로 먼저 자리를 준다(보드와 같은 규칙 · 필터는 보지 않는다 — 자리는
  뷰의 것이다) · 한 문장으로 넣는다.

**[보강] 옮긴 카드가 보드의 조건 밖으로 나가면 — 서버가 말하고 화면이 안내한다** ⟨§7 정리 10n-15 · F-04-03 · F-04-24 / 마이그레이션 없음⟩

> 04 F-04-03 엣지 *"필터에 걸리는 값으로 드래그 — 드롭 직후 카드가 뷰에서 사라짐 → 토스트 안내 권장"* · F-04-24 *"편집으로 행이 필터 밖으로
> 나감 — 목록에서 제거. 단 그 편집을 한 당사자에게는 즉시 제거하지 않고 토스트로 안내(자기 편집으로 화면에서 사라지면 버그로 인식된다)"*.
> 서버는 옮긴 행을 돌려주지만 그 행이 보드의 조건을 아직 지나는지 말하지 않았다 — 카드는 남았다가 다음 읽기에서 말없이 사라졌다.
>
> ① **이동의 답이 "아직 이 보드에 서는가"(`inView`)를 싣는다** — 옮긴 뒤 같은 트랜잭션에서, 보드가 카드를 고르는 술어 그대로(권한 · 그
> 사람이 실제로 보는 필터(개인 필터가 있으면 그것 — 2h-1) · 하위 항목 · 화면이 보낸 뷰 검색어(2e-1)) 그 행을 다시 묻는다. 판정을 화면에서
> 다시 하지 않는다 — 필터 연산자의 뜻은 서버의 컴파일러 하나에 있다. 검색어는 이 판정에만 쓰인다(이동 자체 · 자리 계산과는 상관없다).
> ② **화면은 그 까닭을 말한다**: *"옮긴 카드가 이 보기의 조건(필터 · 검색)에 맞지 않아 보기에서 빠졌습니다"* — 카드는 곧 빠진다. 화면이
> 지우지 않아도 표 변경 알림의 다시 읽기(2k-2 — 자기 이동에도 온다 · 이 PC 에서 0.5초 안)와 정렬된 보드의 열 다시 읽기가 서버의 답으로
> 바꾼다. 그래서 F-04-03(*"드롭 직후 사라짐 → 토스트"*)을 따른다 — F-04-24 의 *"당사자에게는 즉시 지우지 않는다"* 는 다시 읽기가 그 카드를
> 남기는 예외가 있어야 선다. **[정정 10n-16]** 표 · 목록은 행을 직접 다시 읽어 이 화면이 고친 행(`touched`)을 남기고 "조건 밖" 을 단다(2k-2 —
> HANDOFF §3.2-135 ⑤). 보드 · 갤러리 · 캘린더는 서버 렌더를 다시 부르므로(§3.2-136 ③) 남기려면 서버 렌더의 결과에 화면의 기억을 섞어야
> 한다 — 그것이 아직이라 빠진다(HANDOFF §7). 처음 적은 *"화면의 진실이 둘이 된다"* 는 표가 이미 택한 설계와 맞지 않는 근거였다. 자기
> 편집으로 **말없이** 사라지는 것이 막을 일이었다. "옮기기" 메뉴(10m-2)도 같은 길이다.
> ③ 수식 · rollup 으로 거는 필터는 옮긴 순간 저장된 파생 값으로 판정한다 — 파생 값은 읽을 때 새로 계산되므로(`refreshDerivedForView`)
> 안내가 틀릴 수 있다. 다음 읽기가 정한다.
> ④ 표의 셀 편집 · 캘린더의 날짜 끌기는 아직이다(같은 엣지 — HANDOFF §7). **[정정 10n-16]** 표는 이미 남기고 "조건 밖" 을 단다(2k-2) —
> 캘린더 · 갤러리 · 보드의 셀 쓰기는 아래 [보강] 이 했다.

**[보강] 고친 카드가 뷰의 조건 밖으로 나가면 — 셀 쓰기도 판정을 싣는다** ⟨§7 정리 10n-16 · F-04-24 · F-04-03 / 마이그레이션 없음⟩

> 보드 · 갤러리 · 캘린더에서 카드의 제목을 고치거나 캘린더에서 날짜를 끌면 그 카드가 뷰의 조건(필터 · 검색) 밖이 될 수 있다 — 위 [보강] 과
> 같은 장면이 셀 쓰기에서 난다. 표 · 목록은 고친 행을 남기고 "조건 밖" 을 단다(2k-2).
>
> ① **셀 쓰기(`PATCH /rows/{id}`)가 뷰를 받을 수 있다**(`view: { id, search }` — 선택). 받으면 쓰기 뒤에 "아직 이 뷰에 서는가"(`inView`)를
> 싣는다. 판정은 행 질의(`queryRows`)를 그 행 하나로 좁혀 부른다 — 그 사람이 실제로 보는 필터(개인 필터) · 권한 · 검색어. 수식 · rollup 의
> 파생 값도 그 질의가 먼저 채운다(위 [보강] ③ 의 보드보다 정확하다). 하위 항목의 트리 자리는 보지 않는다 — 자식은 부모 밑에 서므로 "최상위인가"
> 를 물으면 틀린다. 조건에 맞는가만 묻는다. 그 행의 data source 의 뷰가 아니거나 볼 수 없는 뷰면 싣지 않는다.
> ② **쓰기와 판정은 따로다** — 쓰기는 이미 커밋했다. 판정이 실패해도 쓰기는 성공이다(답에 `inView` 가 없을 뿐).
> ③ **화면** — 보드 · 갤러리의 제목 편집, 캘린더의 제목 편집 · 날짜 끌기가 뷰를 실어 보낸다. 거짓이면 *"고친 카드가 이 보기의 조건(필터 ·
> 검색)에 맞지 않아 보기에서 빠졌습니다"*(끌기는 *"옮긴 카드가 …"* — 위 [보강] 과 같은 말). 카드는 다시 읽기가 곧 뺀다(위 [보강] ②). 표는
> 보내지 않는다 — 이미 남기고 표시한다.

**[보강] 뷰 탭 순서 바꾸기** ⟨§7 정리 10n-18 · F-04-01 / 마이그레이션 없음⟩

> 04 F-04-01 UI *"탭 드래그 재정렬"*. 초판은 `view.order_idx`(탭 순서 — `COLLATE "C"` 분수 인덱스 · 0015)만 두었고 바꾸는 명령이 없었다.
>
> ① **옮기기는 "이 뷰를 저 뷰 앞에"**(`before` — null 이면 맨 뒤). 그 데이터베이스의 탭(`owner_kind='database_view'` — 폼 포함) 사이의 키를
> 새로 낸다(`orderKeyBetween`). `before` 가 다른 데이터베이스의 뷰 · 없는 뷰 · 자기 자신이면 거부한다(`invalid_value`). 이미 그 자리면 쓰지 않는다.
> ② **권한은 `edit_structure`** — 탭 순서는 모두가 보는 표의 모양이다(뷰 만들기 · 종류 바꾸기와 같다). 데이터베이스가 잠기면 막는다. 사람마다의
> 탭 순서는 두지 않는다(개인 뷰가 아직 없다 — HANDOFF §7).
> ③ **동시에 옮기면** — 그 데이터베이스의 행(`database`)을 잠근 뒤 **다음 문장**에서 이웃을 읽는다(READ COMMITTED 는 문장마다 새 스냅샷이라 앞선
> 옮기기를 모두 본다). 여럿이 같은 자리로 옮겨도 키가 겹치지 않는다. 뷰 행을 `FOR UPDATE` 로 잠그는 것으로는 모자랐다 — 기다린 뒤 값은
> 새것이 오지만 정렬은 옛 값으로 이미 끝나 같은 이웃을 보았다(실측 — 탭 여덟을 한꺼번에). 새 탭의 맨 뒤 키(`createView`)도 같은 잠금을 건다.
> ④ **화면은 끌기의 대안부터** — 뷰 메뉴의 "왼쪽으로 · 오른쪽으로"(키보드로 닿는다 · WCAG 2.5.7 — 10m-2 의 카드 "옮기기" 와 같은 태도).
> 탭 끌기는 다음이다(HANDOFF §7). 옮긴 뒤 화면은 서버 렌더를 다시 부른다 — 탭 목록은 서버가 순서대로 읽는다.
> ⑤ **[보강 10n-19] 탭 끌기** — 탭을 잡고 4px 넘게 움직이면 끌기다(그 전에 놓으면 탭을 여는 클릭 그대로). 놓은 자리는 **포인터가 넘은 탭의
> 가운데**로 정한다 — 끌고 있는 탭을 뺀 나머지에서 가운데가 포인터보다 오른쪽인 첫 탭의 앞(없으면 맨 뒤). 제자리면 보내지 않는다. 끄는
> 동안 놓일 자리에 세로 줄을 그린다. 끌기를 마친 놓기는 탭을 열지 않는다. 명령은 ① 그대로(`before`) — 화면의 판단(놓을 자리)은 DOM 없는
> 함수 하나(`tab-drag.ts`)에 둔다. 볼 수만 있는 사람에게는 끌기가 없다(메뉴와 같다).

```sql
CREATE TABLE view_user_override (
  view_id uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, filter jsonb, sorts jsonb,
  PRIMARY KEY (view_id, user_id)
);
-- [보강] 개인 필터 · 정렬 ⟨DB 심화 2h-1조각 · F-04-17 / 마이그레이션 0059⟩
--   ① 개인 것은 공유 것을 **대체**한다(AND 가 아니다 — 04 권고). 행을 고르는 모든 길(행 질의 · 열 집계 · 보드 · 캘린더)이 "실제로 쓰는" 필터 ·
--      정렬(`ViewDetail.effectiveFilter` · `effectiveSorts`)을 쓴다. `view.filter` · `view.sorts` 는 늘 공유 것이다.
--   ② NULL = "덮어쓰지 않았다"(공유 것) · 빈 묶음(`{op:'and', children: []}`) · `[]` = "나는 아무것도 걸지 않는다". 두 칸 다 NULL 인 행은
--      CHECK 이 막는다(ck_view_user_override_some) · 모양 CHECK(ck_view_user_override_shape) · user_id 는 "user" 를 가리킨다(cascade).
--   ③ 거는 데는 **볼 수 있으면 된다**(읽기 권한도) · 모두에게 저장(`publish`)은 `edit_structure` — 덮어쓴 쪽만 옮기고 개인 것은 지운다 ·
--      편집자가 공유 필터 · 정렬을 바꾸면 자기 개인 것의 그 쪽을 지운다(자기가 고친 공유 것을 자기만 못 보는 일이 없게).
--   ④ 익명(공개 링크)의 개인 필터 · 실시간 브로드캐스트의 "뷰 × 사용자" 단위는 아직이다(§7).

-- L1 레이아웃. data_source 당 최대 1행 — 없으면 기본 레이아웃 <U-1 = 16 비준> [정정 8f-2 — "정확히 1행" → lazy · 아래 [보강]]
CREATE TABLE page_layout (
  data_source_id uuid PRIMARY KEY REFERENCES data_source(id) ON DELETE CASCADE,
  structure text NOT NULL DEFAULT 'simple' CHECK (structure IN ('simple','tabbed')),
  backlinks_mode text NOT NULL DEFAULT 'hover' CHECK (backlinks_mode IN ('always','hover','off')),
  inline_comment_mode text NOT NULL DEFAULT 'default' CHECK (inline_comment_mode IN ('default','minimal')),
  show_discussions boolean NOT NULL DEFAULT true,
  show_property_icons boolean NOT NULL DEFAULT true,
  full_width boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL, updated_by uuid REFERENCES "user"(id),
  version bigint NOT NULL DEFAULT 1        -- 낙관적 잠금. 레이아웃은 CRDT 대상이 아니다 <16 R10>
);

CREATE TABLE layout_tab (
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('content','linked_view')),
  name text, icon jsonb,
  view_id uuid NULL REFERENCES view(id) ON DELETE CASCADE,
  relation_property_id text NULL REFERENCES property(id) ON DELETE SET NULL,  -- text [X-12]
  order_idx text NOT NULL,
  CHECK ((kind='content' AND view_id IS NULL) OR (kind='linked_view' AND view_id IS NOT NULL))
);
CREATE UNIQUE INDEX layout_tab_one_content ON layout_tab (data_source_id) WHERE kind='content';
-- 불변식 T1: page_layout 이 있으면 kind='content' 행은 정확히 1개 [정정 8f-2 — "data_source 당" → 머리가 있을 때]
-- 불변식 T2: structure='simple' 이어도 content 탭 행은 유지한다(구조 전환 시 배치 보존)

CREATE TABLE layout_module (               -- page_layout_slot 대체. 그 테이블은 존재하지 않는다
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  tab_id uuid NOT NULL REFERENCES layout_tab(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('heading','property_group','property','backlinks','section')),
  area text NOT NULL CHECK (area IN ('heading','main','panel')),
  parent_module_id uuid NULL REFERENCES layout_module(id) ON DELETE CASCADE,
  property_id text NULL REFERENCES property(id) ON DELETE CASCADE,            -- text [X-12]
  label text, visible boolean NOT NULL DEFAULT true,
  order_idx text NULL,                     -- [정정 8f-2] NULL = 자기 순서가 없다 — 그룹 안에서 스키마 순서(property.order_idx)
  CHECK ((kind='property') = (property_id IS NOT NULL)),
  CHECK (kind = 'property' OR order_idx IS NOT NULL),                               -- [보강 8f-2]
  CHECK (kind <> 'heading' OR area = 'heading'),                                    -- [보강 8f-2] M1 의 절반
  FOREIGN KEY (tab_id, data_source_id) REFERENCES layout_tab (id, data_source_id) ON DELETE CASCADE,     -- [보강 8f-2]
  FOREIGN KEY (property_id, data_source_id) REFERENCES property (id, data_source_id) ON DELETE CASCADE,  -- [보강 8f-2]
  FOREIGN KEY (parent_module_id, tab_id) REFERENCES layout_module (id, tab_id) ON DELETE CASCADE        -- [보강 8f-2]
);
CREATE UNIQUE INDEX layout_module_one_heading ON layout_module (tab_id) WHERE kind='heading';  -- [보강 8f-2] M1
CREATE UNIQUE INDEX layout_module_one_group ON layout_module (tab_id) WHERE kind='property_group';
CREATE UNIQUE INDEX layout_module_prop_once ON layout_module (tab_id, property_id)
  WHERE property_id IS NOT NULL;
-- 불변식 M1: kind='heading' 은 tab 당 1개, area='heading' 고정, 삭제 불가
-- 불변식 M2: kind='property_group' 은 tab 당 정확히 1개, 삭제 불가(이동만)
-- 불변식 M3: area='heading' AND kind='property' 행은 data_source 당 최대 15개
-- 불변식 M4: area='panel' 배치는 property.can_place_in_panel=true 인 것만
-- 불변식 M5: pinned 컬럼을 두지 않는다. "pin 되었다" = area='heading' 과 동치다
-- 불변식 M6: property_group 은 프로퍼티를 열거하지 않는다. "모듈로 승격되지 않은 나머지"의
--            잔여 컨테이너이며 렌더 시 계산된다. 복사해 두면 신규 프로퍼티가 안 보인다
```

**[보강] 행의 레이아웃 — lazy 한 머리 · 속성 묶음의 순서와 숨김** ⟨잔여 묶음 8f-2 / 마이그레이션 0044⟩

> 초판은 `page_layout` 을 *"data_source 당 정확히 1행"* 으로 적었고, 16 F-16-12 는 *"레코드가 없으면 기본 레이아웃으로 렌더한다. DB 생성 시 굳이
> 레코드를 만들지 않는 lazy 생성이 마이그레이션에 유리"* 라고 적었다. 둘이 부딪힌다. **lazy 가 이긴다.**
>
> ① **data_source 당 최대 1행 — 없으면 기본 레이아웃이다**(모두 보임 · 스키마 순서 · version 0). 근거 셋: (a) 16 F-16-03 의 *"모듈 행은 기본
> 동작에서의 이탈만 기록한다(sparse)"* 와 같은 말이다 — 머리 자체가 기본에서 벗어난 첫 이탈과 함께 생긴다 (b) 이미 있는 소스에 되채우기가
> 필요 없다 (c) 소스를 만드는 길(`createDatabase` · `addDataSource` — 앞으로의 복제 · 임포트)이 레이아웃을 몰라도 된다. "정확히 1행" 을
> 지키려면 그 길마다 네 표에 한 벌씩 써야 하고, 하나라도 빠뜨리면 읽는 쪽이 어차피 "없음"을 다뤄야 한다.
> ② **처음 벗어날 때 한 벌을 함께 만든다** — `page_layout` + content 탭 + heading(area `heading`) + property_group(area `main`). 그래서 T1 · M1 ·
> M2 의 "정확히 1개"는 *"머리가 있으면"* 으로 읽는다. "1개 이하"는 부분 UNIQUE 가(M1 은 이번에 승격 — 인덱스와 area CHECK), "적어도 1개"는
> 만드는 함수 하나가 지킨다. 머리 · content 탭 · heading · 그룹을 지우는 길은 없다(소스가 영구 삭제될 때의 CASCADE 뿐이다).
> ③ **속성 묶음 안의 순서는 `property.order_idx`(스키마 순서)다** — 16 F-16-03 의 클론 대안 *"정렬은 `property.order_idx` 를 그대로 재사용하고
> 레이아웃 전용 순서를 따로 두지 않는다"*. 그래서 `layout_module.order_idx` 는 **property 행에서 NULL 일 수 있다**(자기 순서가 없다 = 스키마
> 순서를 따른다). 다른 종류의 모듈은 자기 순서가 있어야 한다(CHECK). 섹션 · 승격(F-16-04) · heading 고정(F-16-02)이 들어오면 그 자리의 property
> 행이 자기 순서를 갖는다. 순서를 바꾸는 것은 스키마를 고치는 것이라 `schema_version` 도 오른다(뷰의 컬럼 순서 `view_property.order_idx` 는
> 따로다 — C-6).
> ④ **숨김은 그룹을 부모로 진 property 행 하나다** — `kind='property'` · `parent_module_id = 그룹` · `area` 는 그룹의 것 · `visible=false` ·
> `order_idx` NULL. 다시 보이면 **행을 지운다** — 기본(보임)으로 돌아간 것은 행이 없다. M6 그대로다: 그룹은 속성을 열거하지 않으므로 행이
> 없는 속성(새로 만든 속성 포함)은 그룹에 보인다. 숨김은 표시 규칙이다(16 R12) — 값 · 검색 · 필터 · API 는 그대로이고, 행 페이지도 "숨긴 속성
> N개"로 펼쳐 채울 수 있다. soft delete 된 속성의 행은 남는다 — 되살리면 숨김도 돌아온다(`view_property` 와 같다).
> ⑤ **저장은 전체 교체 한 번이다**(16 F-16-01 · F-16-12 — 편집 모드의 초안 → "모든 행에 적용"). `version` 이 낙관적 잠금이고 머리가 없으면
> 0 이다. 다르면 거부한다(부분 병합 없음). 바뀐 것이 없으면 아무것도 쓰지 않는다(version 도 그대로). 묻는 것은 주인 데이터베이스의
> `edit_structure` 이고 잠긴 데이터베이스는 막는다(16 R8 — 속성 · 뷰와 같은 구조의 문) · 소스가 살아 있어야 한다. 본문 편집은 version 을
> 올리지 않는다(F-16-07).
> ⑥ **같은 소스 · 같은 탭** — 복합 FK 셋: 모듈의 탭 · 모듈의 속성이 모듈과 같은 소스이고, 부모 모듈이 같은 탭이다. 초판은 `data_source_id` 를
> 모듈 · 탭에 따로 적어 두고 그 둘이 맞는지를 말하지 않았다 — 어긋나면 한 소스의 레이아웃에 남의 속성이 서거나 지워지지 않고 남는다.
> ⑦ **템플릿 화면은 숨김을 따르지 않는다** — 기본값을 채우는 화면이다(6c-3 · F-08-02). 순서는 같은 스키마 순서라 저절로 따른다.

**[보강] 제목 아래 고정 — heading 의 property 행** ⟨항목 레이아웃 3a-1 / 마이그레이션 0064⟩

> 16 F-16-02 *"You can pin up to 15 properties"* · M5 *"pinned 컬럼을 두지 않는다 — area='heading' 과 동치"*.
>
> ① **고정 = content 탭의 property 행 · area `heading` · 부모는 heading 모듈 · 자기 순서(`order_idx`) · 보임.** heading 안의 순서는 스키마
> 순서가 아니다(16 *"Heading 안에서 좌우 드래그로 순서를 바꾼다"*) — ③ 의 "property 행이 자기 순서를 갖는" 첫 자리다. 풀면 **행을 지운다**
> (속성 묶음으로 돌아간 것은 기본이라 행이 없다 — ④ 와 같은 sparse). "숨긴 고정" · "순서 없는 고정"은 CHECK 가 막는다
> (`ck_layout_module_pinned`).
> ② **M3(소스마다 15개)를 트리거로 올린다.** 16 은 *"부분 인덱스로 개수 제약은 표현 불가 → 애플리케이션 검증"* 이라 했지만 트리거로는
> 표현된다(`tg_layout_module_pin_limit` — 문장 끝에 센다). 적용 함수가 소스 행을 잠그고 먼저 세어 `too_many_pinned` 로 답하고, 트리거는
> 마지막 그물이다.
> ③ **숨김과 고정은 한 속성의 두 자리다** — 한 탭에 한 번(`layout_module_prop_once`)이라 겹치지 않는다. 숨기면서 고정하면 거부한다 ·
> 고정을 주지 않고 숨기면 그 고정이 풀린다 · 숨긴 속성을 고정하면 숨김이 풀린다. 제목은 고정하지 않는다(행 페이지의 제목 칸이다).
> ④ **속성을 지우면(soft delete) 고정이 풀린다**(트리거 `tg_property_unpin_on_delete`) — 되살려도 속성 묶음으로 돌아온다. 숨김은 지워도
> 남는 것(④)과 다른 까닭은 **자리 상한**이다 — 지운 속성이 15자리 중 하나를 차지하면 보이지 않는 속성 때문에 고정이 막힌다.
> ⑤ **적용은 전체 교체 그대로다**(⑤) — 고정 목록을 주지 않으면 그대로다(앞 화면과의 호환). 주면 고정 행을 통째로 다시 쓰고 version 이
> 오른다. 모든 속성 타입을 고정할 수 있다 — 16 의 `can_pin` 은 두지 않는다(고정은 표시 위치일 뿐 값 편집기는 같다 · R12).

**[보강] 페이지 설정 — 머리의 다섯 칸** ⟨항목 레이아웃 3b-1 / 마이그레이션 없음⟩

> 16 F-16-09 *"표시 정책 1개 enum"* · F-16-10 *"4개 모두 표시 정책이며 권한 · 데이터에 영향이 없다"* · R5(scope 축).
>
> ① **다섯 칸(`backlinks_mode` · `inline_comment_mode` · `show_discussions` · `show_property_icons` · `full_width`)은 머리의 것이다** — 데이터베이스의
> 모든 행에 같다. 머리가 없으면 **칸의 기본값**(hover · default · 보임 · 보임 · 좁게)으로 읽는다 — lazy 머리(8f-2 ①)와 같은 규칙이고, 설정만
> 바꿔도 기본에서 벗어난 것이라 머리가 생긴다.
> ② **적용은 같은 PUT 이고 준 칸만 바꾼다**(부분) — 숨김 · 고정 · 순서와 한 번에 갈 수 있고, 설정을 주지 않으면 그대로다. 바뀐 것이 없으면
> 쓰지 않는다 · 바뀌면 version 이 오른다(낙관적 잠금은 레이아웃 전체의 것 하나). 화면과 서버는 같은 타입 · 기본값 · 검사를 본다
> (`page-settings.ts` — 기본값을 바꾸려면 0044 의 칸 기본값과 함께).
> ③ **R5 — 행 페이지는 레이아웃 값만 쓴다.** 일반 페이지가 페이지마다 갖는 값(`block.format.page_full_width` 등)은 행에서 무시한다. 행 ↔
> 일반 페이지 이동의 물질화(16 F-16-10)는 그 이동 길이 생길 때 정한다.
> ④ 0044 가 건 CHECK 넷(`ck_page_layout_backlinks` · `_inline_comment` · `_structure` · `_version`)은 이 조각에서 처음 거부를 확인했다(verify-schema [46]).

**[보강] 본문 모듈 · 상세 패널 — property 행의 넷째 · 다섯째 자리** ⟨항목 레이아웃 3c-1 / 마이그레이션 0065⟩

> 16 F-16-04 *"승격 = 모듈 행 생성, 강등 = 모듈 행 삭제(잔여 계산으로 자동 복귀)"* · F-16-05 *"패널은 별도 엔티티가 아니라 area enum 의 한 값"* · M4.
>
> ① **property 행의 자리는 넷이다** — 숨김(그룹 아래 · 보이지 않음 · 순서 없음) · 고정(heading 아래) · **본문 모듈**(부모 없음 · area `main` ·
> 보임 · 자기 순서) · **패널**(부모 없음 · area `panel` · 보임 · 자기 순서). 행의 모양이 자리를 말한다 — 섞인 모양(보이는데 순서 없는 모듈 ·
> 부모 없는 숨김 · 그룹 아래의 보이는 행)은 CHECK 가 막는다(`ck_layout_module_place`). 내리면 행을 지운다(속성 묶음으로 — M6).
> ② **본문 영역은 한 줄이다** — 속성 묶음(그룹 모듈)과 올린 속성들이 같은 `order_idx` 로 위아래를 다툰다(16 클론 대안 *"세로 스택만"*).
> 적용 · 읽기는 이 줄을 id 목록으로 주고받고, 속성 묶음은 표지 `property_group` 이다(속성 id 와 겹치지 않는다). 줄에 속성 묶음이 꼭
> 하나 있어야 한다. 패널은 속성 모듈만의 줄이다(속성 묶음을 패널로 보내기는 아직 — §7).
> ③ **M4 는 칸이 아니라 유형이 정한다** — 정본이 적은 `property.can_place_in_panel` 을 두지 않는다. 속성마다 같은 값을 들고 다니다 유형과
> 어긋날 수 있다. 관계형은 패널에 못 놓는다(트리거 `tg_layout_module_panel_type` · 같은 목록이 `layout-modules.ts`) · 속성이 관계형이 되면
> 패널에서 내린다(트리거 · 16 *"자동으로 본문으로 축출"* — 지금은 유형 바꾸기가 관계형으로 가지 않아 지키는 그물이다).
> ④ **한 속성은 한 자리다** — 적용이 받은 목록(숨김 · 고정 · 본문 · 패널)끼리 겹치면 거부하고, 받지 않은 목록은 지금 것에서 다른 목록이
> 가져간 속성을 뺀다. 쓰기는 지우기를 모두 넣기보다 먼저 하고, 바뀐 영역만 다시 쓴다.
> ⑤ 지운 속성의 본문 · 패널 모듈은 남는다 — 되살리면 돌아온다(숨김과 같다 · 고정만 자리 상한 때문에 풀린다). 다시 쓰기는 지금 보이는
> 모듈만 지운다.
> ⑥ 0065 는 개발 DB 에 남아 있던 뜻 없는 행(그룹 아래의 보이는 행 — 8f-2 의 반사실이 남긴 것)을 지우고 CHECK 를 건다 — 보임은 기본이라
> 지워도 화면이 같다.

**[보강] 레이아웃의 직전 버전 — 한 단계 되돌리기 · F-16-12** ⟨항목 레이아웃 3e-1 / 마이그레이션 0066⟩

> 16 F-16-12 *"클론 권고: 직전 버전 1개를 `page_layout_history` 에 남겨 `실행 취소` 를 1스텝 제공한다(비용 대비 안전 이득이 크다)"* ·
> *"[클론 자체 결정]"*. 초판의 표 목록에 없던 표를 더한다 — 레이아웃 변경은 전 구성원의 화면을 바꾸므로 한 번의 실수를 되돌릴 길이 있어야 한다.
>
> ```sql
> CREATE TABLE page_layout_history (
>   data_source_id uuid PRIMARY KEY REFERENCES data_source(id) ON DELETE CASCADE,   -- 소스마다 한 단계
>   after_version  bigint NOT NULL CHECK (after_version >= 1),  -- 이 스냅샷을 남긴 적용의 결과 버전
>   snapshot       jsonb  NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),  -- 적용 전의 레이아웃(순서 · 자리 · 설정)
>   changed_by     uuid NULL REFERENCES "user"(id),
>   changed_at     timestamptz NOT NULL DEFAULT now()
> );
> ```
>
> ① **한 단계뿐이다** — 소스마다 한 행(PK). 바뀐 적용이 적용 **전**의 레이아웃을 덮어쓴다(바뀐 것이 없는 적용은 남기지 않는다).
> ② **되돌리기는 그 스냅샷을 새 적용으로 쓴다** — version 이 오른다(되감지 않는다 · 낙관적 잠금은 그대로). 되돌린 뒤에는 기록을 지운다 —
> 되돌리기는 되돌리지 않는다. 지금 버전이 `after_version` 이 아니면(그 뒤에 다른 적용이 있었으면) 거부한다.
> ③ 스냅샷은 적용 입력과 같은 모양이다(스키마 순서 · 숨김 · 고정 · 본문 줄 · 패널 · 설정) — 그사이 지워진 속성은 건너뛰고, 새로 생긴 속성은
> 제자리 · 속성 묶음이다(적용의 규칙 그대로).
> ④ 페이지 버전 기록(`page_version`)에 넣지 않는다 — 레이아웃은 페이지에 속하지 않는다(16). 감사 로그는 그 표가 생길 때(거버넌스 트랙).

**[보강] 폼 — 데이터베이스의 뷰 · 질문은 속성 · 응답은 행** ⟨인접 제품 7a-1 · F-13-01 · F-13-02 · F-17-10 / 마이그레이션 0094⟩

> 13 F-13-01 *"폼은 독립 엔티티가 아니라 데이터베이스의 뷰다 · 질문 1개 = 프로퍼티 1개 · 응답 = DB 행 그 자체"* · F-13-02 *"공개(web)는 강제
> 익명"* · 17 F-17-10 *"인증 없이 데이터를 생성할 수 있는 유일한 경로"*. `view.type` 의 CHECK 은 초판부터 `form` 을 받는다 — 그 뷰의 칸과
> 질문 · 공개 제출이 없었다.

```sql
CREATE TABLE form_view (                        -- [보강 7a-1] 폼 뷰의 설정 — 뷰마다 하나(view.type = 'form' 인 뷰만)
  view_id uuid PRIMARY KEY REFERENCES view(id) ON DELETE CASCADE,
  title text NULL, description text NULL,       -- 비면 데이터베이스 이름 · 설명 없음
  submit_label text NULL,                       -- 비면 "제출"
  confirmation_title text NULL, confirmation_body text NULL,   -- 제출 뒤 화면 — 비면 "제출했습니다"
  access text NOT NULL DEFAULT 'closed' CHECK (access IN ('closed','public')),  -- 'workspace'(로그인 멤버)는 뒤로
  token text NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),  -- 공개 주소의 자격(웹 게시와 같은 모양) · 처음 열 때 만든다
  updated_by uuid NULL REFERENCES "user"(id), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (access <> 'public' OR token IS NOT NULL)
);

CREATE TABLE form_question (                    -- [보강 7a-1] 질문 = 그 데이터베이스의 속성 하나(13 — 동기화)
  view_id uuid NOT NULL REFERENCES form_view(view_id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  order_key text COLLATE "C" NOT NULL,          -- 질문의 순서(분수 인덱싱 — 뷰의 열과 같다)
  label text NULL,                              -- 비면 속성 이름(속성 이름을 바꾸면 따라간다)
  help_text text NULL,
  required boolean NOT NULL DEFAULT false,
  PRIMARY KEY (view_id, property_id)
);
```

> ① **폼은 뷰다** — 데이터베이스(그 data source)의 뷰 탭 하나. 폼을 지워도 응답(행)은 남는다(13). 폼 뷰는 행을 그리지 않는다 — 표 ·
> 보드처럼 행을 읽는 길(행 질의 · 집계)에 서지 않는다. 설정은 `form_view` 한 행(뷰를 만들 때 함께 · 뷰가 지워지면 함께).
>
> ② **질문 = 속성** — 질문 하나는 그 data source 의 살아 있는 속성 하나다(같은 속성을 두 번 묻지 않는다 — PK). 질문의 제목은 비우면 속성
> 이름을 따른다. **받는 타입(v1)** — 제목 · 글 · 숫자 · 선택 · 체크박스 · 날짜(값이 그 칸에 바로 들어가는 것 · 다중 선택 · 이메일 · URL ·
> 전화는 그 칸 타입이 생길 때 함께). 상태(팀의 일의 흐름 — 익명 제출자가 정할 것이 아니다) · 사람 · 관계형(제출자에게 이 워크스페이스의
> 사람 · 다른 표의 행 목록이 열린다 — 17 F-17-10) · 파일(익명 업로드 — 스캐너와 함께) · 계산 열(수식 · 롤업 · 버튼 · 고유 ID · 만든 · 고친
> 시각과 사람)은 받지 않는다(`unsupported_type`). 속성을 지우면(휴지통) 그 질문은
> 폼에서 빠진다 — 되살리면 돌아온다(질문 행은 남는다).
>
> ③ **누가 고치는가** — 데이터베이스의 구조를 고치는 사람(`edit_structure` — 뷰를 만들고 고치는 것과 같다). **공개로 여는 것**
> (`access = 'public'`)은 그 데이터베이스의 `manage_perm`(13 *"폼 공유에는 연결 DB 의 Full access 필요"* — 웹 게시와 같은 문) · 워크스페이스
> 정책(`allow_publish_sites_and_forms`)이 허용할 때만. 닫으면(`closed`) 공개 주소가 곧바로 닫힌다(토큰은 남는다 — 다시 열면 같은 주소 ·
> 웹 게시 ⑤ 와 같다).
>
> ④ **공개 제출(7a-2)은 세션이 없다** — 제출자는 주체가 아니다(17 *"제출자는 principal 이 아니다"*). `SessionContext` 를 만들지 않는다(A9 의
> 발급자 둘 — 셋째를 만들지 않는다). 쓰기의 자격은 **그 폼**이다: 토큰 → 공개 · 정책 · 데이터베이스와 data source 가 살아 있다 → 그 폼의
> 질문만 받는다. 만든 행은 `created_by NULL`(0006 이 이 경로를 위해 비워 두었다) · 활동의 행위자도 NULL. 응답은 **강제 익명**(F-13-02).
> 남용 방어(17 F-17-10 계층 1~4)와 메타 사이드카(`form_submission_meta` — 행의 속성에 넣지 않는다)는 ⑥.
>
> ⑤ **뒤로** — 워크스페이스 멤버만의 폼(→ ⑨ · 7b-1) · 제출 뒤 응답자 권한(→ ⑫ · 7b-4) · 이메일 사본 · 조건부 로직(F-13-03 · 유료 → ⑬ · 7b-5) · 응답 상한 · 마감 시각(→ ⑩ · 7b-2) · 중복 제출
> 막기(→ ⑪ · 7b-3) · 커버 · 아이콘 · "Notion 으로 제작" 배지.
>
> ⑥ **[7a-2a] 공개 제출 — 세션 없는 쓰기 · 방어 계층 · 메타 사이드카** ⟨마이그레이션 0095⟩
>
> ```sql
> CREATE TABLE form_submission_meta (           -- [보강 7a-2a] 17 F-17-10 — 남용 메타는 행의 속성이 아니라 여기(뷰 · 내보내기로 새지 않는다)
>   page_id uuid PRIMARY KEY REFERENCES page(id) ON DELETE CASCADE,   -- 그 응답(행)
>   view_id uuid NULL REFERENCES view(id) ON DELETE SET NULL,         -- 받은 폼 — 폼을 지워도 응답 · 메타는 남는다(①)
>   submitter_hash text NOT NULL,                 -- AUTH_SECRET 키의 HMAC(IP · UA) — 원문은 어디에도 남지 않는다(신고와 같다)
>   dwell_ms int NOT NULL CHECK (dwell_ms >= 0),  -- 화면을 받고 제출하기까지
>   created_at timestamptz NOT NULL DEFAULT now()
> );
> ```
>
> ⓐ **순서**(한 곳 — `submitFormResponse`) — 같은 출처(`Origin` 이 있으면 이 서버 — 신고와 같은 목록 · 10n-78) → 허니팟(사람에게 보이지 않는 칸이 차 있으면 **받은 척하고**
> 남기지 않는다) → 공개 판정(폼 토큰 · `access = 'public'` · 정책 · 데이터베이스 · 소스가 살아 있다 — 폼을 찾아야 제출 토큰을 그 폼으로
> 검사한다) → **제출 토큰**(화면이 줄 때 만든 서명 — DB 에 쓰지 않는다 · 그 폼에 묶인다 · 2시간) → **최소 작성 시간**(토큰을 받고 3초 안의
> 제출은 거부 — 다시 내라고 말한다 · 사람이 잃지 않게 받은 척하지 않는다) → **레이트리밋**(제출자 지문 × 폼: 10분 10건 · 폼 전체: 1시간
> 500건 — 신고와 같은 고정 윈도우 · Valkey 가 죽으면 열고 로그를 남긴다) → 값 검증(그 폼의 **질문만** 받는다 — 다른 칸은 버린다 · 필수 ·
> 타입마다 모양 · 선택은 그 속성의 옵션 id) → 제출 토큰을 **한 번만**(Valkey `SET NX` — 값이 맞을 때만 쓴다: 고쳐 다시 내는 사람이 같은
> 화면의 토큰으로 낸다) → 한 트랜잭션에서 다시 공개인지 · 행 · 칸 · 메타.
>
> ⓑ **세션 없는 행 넣기** — 행을 만드는 문(`createRowIn`)의 넣기 몸체를 함께 쓴다(`insertRowIn` — 순서 키 · 경로 · 스코프 · 고유 ID ·
> 칸 · 제목 투영이 한 곳). 다른 것은 셋: 권한을 묻지 않는다(자격은 폼이다) · `created_by` · `last_edited_by` · 활동의 행위자가 NULL ·
> 템플릿이 아니다. 자동화의 "행이 생겼다" 는 받는다(사람이 낸 응답이다 · 출처 `user`).
>
> ⓒ **실패는 이유를 가린다** — 열 수 없는 폼은 404(없는 것과 같다 · 닫힌 폼 · 정책 · 휴지통 모두). 값이 틀리면 질문마다 까닭(`issues`)을
> 돌려준다 — 화면이 그 칸에 말한다.
>
> ⑦ **[7a-2b] 공개 화면** — `/f/{폼 토큰}` 은 서버가 그린다(세션을 읽지 않는다 · 색인하지 않는다 · referrer 는 `same-origin` —
> `no-referrer` 면 브라우저가 같은 출처의 POST 에도 `Origin: null` 을 보내 출처 검사가 막는다 · 신고 화면과 같다). 열 수 없으면 404.
> **화면을 줄 때마다 새 제출 토큰**을 싣는다(⑥ ⓐ — DB 에 쓰지 않는다). 머리(폼 제목 · 설명) · 질문마다 칸 — 제목은 한 줄 · 글은 여러 줄 ·
> 숫자 · 선택은 하나 고르기(옵션 이름) · 체크박스 · 날짜 · 필수 표시 · 도움말 · **허니팟 칸**(화면 밖 · 탭으로 닿지 않는다 · 자동 완성
> 끔) · 제출 문구의 단추. 실패는 값이 틀리면 **그 질문 아래에** 까닭을, 나머지는 한 줄로(너무 빠름 — 다시 내기 · 토큰이 오래됨 ·
> 틀림 — 새로 고침 · 너무 잦음 · 닫힘) — **입력은 잃지 않는다**. 받으면 같은 자리에 확인 화면(확인 제목 · 본문 · "다른 응답 제출" — 새
> 화면이라 새 토큰).
>
> ⑧ **[7a-3] 편집 화면** — 데이터베이스의 뷰 탭 "폼"(뷰 추가 메뉴의 "폼 만들기" — 소유한 소스에만 · 붙인 소스면 막는다). 폼 탭을 열면 표 ·
> 도구막대 대신 **편집 화면**: 머리(폼 제목 · 설명 — 칸을 떠날 때 저장) · 질문 목록(순서대로 — 위 · 아래로 옮기기 · 제목 · 도움말 · 필수 ·
> 빼기 · 바뀔 때마다 목록 통째로 저장 — ② 의 명령) · 질문 더하기(더할 수 있는 속성 — 받는 타입만) · 제출 문구 · 확인 화면(제목 · 본문) ·
> **공유**(공개 · 닫기 — 바꿀 수 있는 사람에게만 · 공개면 주소 · 복사 · 열기 · 정책이 막으면 그렇다고). 보기만 하는 사람에게는 같은 화면이
> 읽기로 선다. 폼 뷰는 다른 종류로 바꾸는 메뉴가 없다(①).
>
> ⑨ **[7b-1 · 마이그레이션 0099] 워크스페이스 멤버만의 폼** — 13 F-13-02 의 접근 셋째(`Anyone at {workspace} with link` *"로그인 멤버만
> 열람, Respondent 에 실제 계정 기록"*)를 연다. `access` 가 셋이 된다(`closed` · `public` · `workspace` — `ck_form_view_access`), 주소는
> 공개와 같은 `/f/{토큰}` 하나다(닫지 않으면 토큰이 있다 — `ck_form_view_open_token`).
>   · **누가 여는가** — 공개와 같은 문(데이터베이스의 `manage_perm` — 폼을 나누는 일이다). 워크스페이스 정책(`allow_publish_sites_and_forms`)은
>     묻지 않는다 — 밖으로 내보내는 것이 아니다. 감사 로그는 `form_open_workspace`
>   · **누가 내는가** — 그 워크스페이스의 **멤버**(게스트는 아니다 — 13 *"로그인 멤버"* · 게스트는 받은 페이지 밖을 모른다). 제출자의
>     자격은 로그인 세션이다(`resolveSessionContext` — A9 의 발급자 그대로 · 셋째를 만들지 않는다). 그 사람이 그 데이터베이스를 볼 수
>     있는지는 묻지 않는다 — 쓰기의 자격은 공개처럼 **그 폼**이다(폼 링크를 받은 멤버면 낸다)
>   · **응답자를 남긴다** — 행의 만든 사람 · 활동의 행위자가 그 사람이다(공개는 NULL — 강제 익명 ④). 방어 계층(⑥ — 출처 · 허니팟 ·
>     제출 토큰 · 3초 · 레이트리밋 · 한 번만)은 그대로 지난다(레이트리밋의 제출자는 그 사람이다)
>   · **화면** — 로그인하지 않았으면 폼을 보이지 않고 로그인으로 가는 길만(제목도 싣지 않는다 — 워크스페이스 안의 이름이다) · 로그인했지만
>     그 워크스페이스의 멤버가 아니면 404(공개와 같다 — 이유를 말하지 않는다) · 멤버면 폼 + "응답자: 이름"
>
> ⑩ **[7b-2 · 마이그레이션 0100] 응답 상한 · 마감 시각** — 17 F-17-10 계층 7(*"초과 시 폼 자동 닫힘"* · 노션은 수동 마감만). `form_view`
> 에 두 칸: `max_responses int NULL`(1~100,000 · 비면 없다) · `closes_at timestamptz NULL`(비면 없다).
>   · **세는 것** — 이 폼으로 받은 응답 중 **살아 있는 행**(`form_submission_meta.view_id` · 행이 휴지통이면 세지 않는다 — 지운 응답은
>     자리를 돌려준다). 공개 · 워크스페이스 멤버만이 같이 센다(둘 다 메타를 남긴다)
>   · **닫힘은 판정이다 — 칸을 바꾸지 않는다** — 상한에 닿거나 마감 시각이 지나면 `access` 는 그대로인 채 받지 않는다. 상한을 올리거나
>     시각을 미루면 다시 받는다(스스로 `closed` 로 바꾸면 왜 닫혔는지가 사라지고, 다시 열 때 사람이 둘을 함께 고쳐야 한다)
>   · **제출** — 공개 판정 바로 뒤에 마감을 본다(닫힌 폼은 토큰 · 값 검사 전에 그렇다고 말한다 — `form_closed` · 410). 넣는 트랜잭션에서
>     폼 행을 잠그고(`FOR UPDATE` — 동시 제출이 상한을 넘지 않게) 다시 센다
>   · **화면** — 닫힌 폼은 404 가 아니라 "응답을 마감했습니다"(제목은 보인다 — 그 폼을 볼 수 있는 사람에게만 · 워크스페이스 폼의 로그인 ·
>     거부는 ⑨ 그대로). 편집 화면의 "응답 받기": 상한 · 마감 시각 · 지금 받은 수 · 닫혔으면 그 까닭
>   · **누가 고치는가** — 설정의 글 칸과 같은 `edit_structure`(공유의 문 `manage_perm` 이 아니다 — 여는 것이 아니라 받는 양이다)
>
> ⑪ **[7b-3 · 마이그레이션 0101] 한 사람당 한 번** — 17 F-17-10 계층 6(*"중복 제출 차단: 폼 옵션. 키 = 인증 사용자 id / 응답 내 이메일
> 필드 / 브라우저 fingerprint 중 선택"* · *"기본 off"* · 노션은 문서화된 기능이 없다 — 13). `form_view` 에 한 칸:
> `one_per_respondent boolean NOT NULL DEFAULT false`(기존 폼은 꺼진 채 — 바뀌는 것이 없다).
>   · **열쇠는 로그인한 응답자 하나** — 워크스페이스 멤버만의 폼(⑨)에서만 막는다. 웹 공개 폼은 응답자를 모른다(강제 익명 ④). **브라우저
>     지문은 쓰지 않는다**(17 의 오탐 비용 "높음" — 공용 기기 · 같은 NAT 의 다른 사람을 막고, 지우면 뚫린다). 응답 안의 이메일은 이메일
>     칸 타입이 생길 때(②). 칸은 공유와 따로 둔다 — 웹 공개 폼에 켜 두어도 막지 않고, 워크스페이스 멤버만으로 바꾸면 그때부터 막는다
>     (편집 화면이 그렇다고 말한다)
>   · **이미 냈다** — 이 폼으로 받은 **살아 있는 응답** 가운데 그 사람이 만든 행이 있다(`form_submission_meta.view_id` · `block.created_by`).
>     ⑩ 과 같은 셈이다 — 휴지통의 응답은 세지 않는다(응답을 지우면 그 사람이 다시 낸다). 켜기 전에 낸 응답도 센다. 판정이지 칸이 아니다
>   · **제출** — 마감(⑩) 다음에 본다(`already_submitted` · 409 — 토큰 · 값 검사 전에). 넣는 트랜잭션에서 폼 행을 잠근 채(⑩ 의
>     `FOR UPDATE`) 다시 본다 — 같은 사람이 두 탭에서 동시에 내도 하나만 들어간다
>   · **화면** — 이미 낸 멤버에게는 폼 대신 제목과 "이미 응답했습니다"(닫힌 폼이면 ⑩ 의 "마감했습니다" 가 먼저) · 받은 뒤의 확인 화면에
>     "다른 응답 제출" 이 없다. 편집 화면의 "응답 받기" 에 켜고 끄는 칸(웹 공개 폼이면 막지 않는다고 함께 말한다)
>   · **누가 고치는가** — ⑩ 과 같은 `edit_structure`(받는 규칙이다)
>   · 응답을 고치는 것(17 *"재제출 허용 폼"* — 응답자의 사후 권한)과는 별개다 — 막는 것은 새 행뿐이다
>
> ⑫ **[7b-4 · 마이그레이션 0102] 제출 뒤 응답자 권한** — 13 F-13-02 *"제출된 행(page) 단위로 응답자에게 권한 부여 · 로그인 응답자에게만
> 의미"* · 06 F-06-17 `Access to submission`(*"제출 시 `acl_entry(node_id=새 row, principal=제출자, level=submitter_access)` 를 자동
> 생성 · 익명 제출은 건너뛴다"*). `form_view` 에 한 칸: `respondent_access text NULL`(`view` · `comment` · `edit` —
> `ck_form_view_respondent_access` · 비면 주지 않는다 — A1 에 `none` 레벨은 없다). 기존 폼은 비어 있다(바뀌는 것이 없다).
>   · **주는 것은 진짜 ACL 행이다** — 넣는 트랜잭션에서 그 응답 행에 `('user', 응답자, 레벨)` 한 줄(`granted_by` NULL — 사람이 아니라
>     폼의 설정이 준다). 행은 그 순간 스코프 경계가 된다(첫 ACL — 상속은 그대로 · 합집합). 데이터베이스를 못 보는 멤버도 자기 응답
>     하나를 그 레벨로 연다 — 다른 응답 · 표는 열리지 않는다. 규칙(`page_access_rule` "만든 사람")으로 합성하지 않는다 — 규칙은 그 표의
>     모든 행에 걸리고(폼으로 받지 않은 행도), 이것은 **그 폼으로 받은 그 행** 하나다
>   · **받는 사람은 멤버 응답자뿐** — 워크스페이스 멤버만의 폼(⑨)에서만 준다. 웹 공개 응답은 익명이라 줄 사람이 없다(06 *"사후 접근
>     부여 자체가 불가능"*). 칸은 공유와 따로 둔다(⑪ 과 같다 — 웹 공개 폼에 남아 있어도 주지 않는다 · 편집 화면이 그렇다고 말한다)
>   · **레벨은 셋** — 읽기 · 댓글 · 편집. **전체 권한은 주지 않는다**(06 엣지 *"응답자가 Full access 를 받고 다른 사람을 초대 — 권한
>     확산 경로 · 클론 기본값은 Can view 이하 권장"* — 응답자가 그 행을 다시 나눠 준다). 데이터베이스 전용 레벨(내용 편집 · 만들기)은
>     행이 받지 않는다([보강] 데이터베이스의 레벨 ③)
>   · **제출 때 한 번 준다** — 칸을 나중에 바꿔도 이미 준 권한은 그대로다(그 행의 공유에서 거둔다). 권한을 낮추지 않는다(이미 더 넓은
>     직접 부여가 있으면 쓰지 않는다 — 대기 초대의 수락과 같은 길 · `directGrantCovers`). 응답자가 워크스페이스를 떠나면 다른 부여와
>     함께 지워진다
>   · **누가 고치는가** — 데이터베이스의 `manage_perm`(공개 · 닫기와 같은 문 — 접근을 나눠 주는 일이다 · 구조를 고치는 사람이 아니다).
>     바꾸면 감사 로그(`page.publish_changed` · `form_respondent_access`). 제출마다의 부여는 감사 로그에 남기지 않는다 — 그 근거(칸)가
>     남는다(규칙의 합성과 같은 까닭)
>   · **화면** — 확인 화면에 "내 응답 보기"(부여를 받았을 때만 — 그 행의 주소 `/w/{워크스페이스}/{행}` · 제출 응답이 싣는다). 편집 화면의
>     공유 절에 "응답자에게 줄 권한"(없음 · 읽기 · 댓글 · 편집 — 바꿀 수 있는 사람에게만 · 고르면 무엇을 주는지 · 웹 공개면 주지 않는다고)
>
> ⑬ **[7b-5a · 마이그레이션 0104] 조건부 보이기** — 13 F-13-03(*"이전 질문의 답에 따라 다음 질문을 보여주거나 건너뛴다"* · *"Business /
> Enterprise 플랜 전용"* · 클론 대안 *"show/hide 두 액션만 — jump_to 를 빼면 사이클 문제가 사라진다"*). `form_question` 에 세 칸:
> `show_if_property_id text NULL` · `show_if_operator text NULL` · `show_if_option_id uuid NULL` — 셋이 함께 비거나(조건 없음) 함께
> 선다(`ck_form_question_show_if` — 자기 자신은 근거가 아니다 · 옵션은 같다 · 같지 않다 에만 있다).
>   · **조건은 "보이기" 하나** — 질문마다 하나, 근거 질문의 답이 조건에 맞을 때만 보인다(숨기기는 반대 연산자로 — `not_equals` ·
>     `is_empty`). 이동(jump_to)은 두지 않는다
>   · **근거는 그 폼에서 앞에 선 질문** — 순서대로 평가하므로 순환이 생길 수 없다. 숨은 질문의 답은 없는 것으로 친다(그 뒤의 조건도
>     그렇게 본다)
>   · **연산자는 근거의 타입이 정한다** — 선택: `equals` · `not_equals`(옵션 id — 이름을 바꿔도 깨지지 않는다 · 13) · `is_empty` ·
>     `is_not_empty` / 체크박스: `is_checked` · `is_not_checked` / 제목 · 글 · 숫자 · 날짜: `is_empty` · `is_not_empty`
>   · **판정은 순수 모듈 하나**(`form-logic.ts` — 질문의 타입 목록도 여기로 옮긴다)를 서버와 브라우저가 함께 쓴다. **제출은 서버가 다시
>     평가한다**(13 *"서버가 재평가하지 않으면 숨겨진 질문에 값을 주입할 수 있다"*) — 숨은 질문의 답은 버리고 필수 검사도 하지 않는다
>     (*"숨겨진 필수 질문은 검증에서 제외 — 아니면 제출 불가 데드락"*)
>   · **끊어진 조건은 무시한다 — 질문이 보인다** — 근거 질문이 폼에서 빠졌거나 그 속성이 휴지통이거나 옵션이 지워졌거나 **근거의 타입이
>     바뀌어 연산자가 맞지 않으면**(7b-5b — `showWhenFits`) 조건이 없는 것과 같다(질문을 잃지 않는다). FK 를 걸지 않는다(옵션 · 속성이 지워지면 세 칸이 함께 비어야 하는데 FK 는 한 칸만 비운다).
>     명령은 저장할 때 끊어진 조건을 받지 않는다(`invalid_input`)
>   · **요금제** — 엔타이틀먼트 `form.logic`(boolean · Business · Enterprise). **조건을 더하거나 바꾸는 것만 막는다**(`plan_required`) —
>     지우기는 언제나 되고, 이미 있는 조건은 요금제를 내려도 그대로 적용된다(private teamspace 의 "내려도 있는 것은 그대로" 와 같다)
>   · **누가 고치는가** — 질문과 같은 `edit_structure`(질문 목록의 한 칸이다 — `setFormQuestions` 가 함께 받는다). 화면(편집 화면의
>     조건 · 공개 화면이 답에 따라 질문을 보이고 숨긴다)은 7b-5b
>   · **[7b-5b] 화면** — 편집 화면의 질문마다 "보이기 조건" 한 줄: 근거(앞에 선 질문만 · "항상 보인다" 가 없음) · 연산자(근거의 타입의 것 —
>     옵션이 없는 선택이면 같다 · 같지 않다 를 빼고) · 옵션(같다 · 같지 않다 — 그 근거의 옵션). 편집 읽기가 선택 질문의 옵션을 싣는다.
>     요금제가 막으면 조건이 없는 질문에는 "요금제 필요" 한 줄 · 있는 조건은 보이되 지우기만. 끊어진 조건은 그렇다고 말하고 지우기만.
>     편집 화면은 질문 목록을 통째로 보내므로 보내기 전에 끊어진 조건을 모두 지운다(근거가 앞에 없다 · 맞지 않는다 — 서버는 끊어진 조건을
>     받지 않는다). 공개 화면은 같은 판정으로 숨은 질문을 그리지 않고 숨은 질문의 답은 보내지 않는다(서버도 버린다 — 두 번)

---

### 3.7 동기화 · 버전 ⟨C-11/V-3 · C-12 · V-5 · U-2 · U-9 · X-1 · X-5⟩

```sql
-- 동기화 단위 = 권한 단위 = 채널 단위 = CRDT 문서 단위 = 페이지. 넷을 일치시킨다.
CREATE TABLE doc_update (                      -- append-only. 페이지 본문의 정본
  page_id    uuid NOT NULL,                    -- = Y.Doc 1개 (block.id where type='page')
  seq        bigint NOT NULL,                  -- page_id 내 단조 증가. CRDT 로그 위치
  payload    bytea NOT NULL,                   -- Yjs update 바이너리. 문자열 저장 시 손상
  actor_id   uuid NULL,                        -- NULL = 시스템/봇
  origin     text NOT NULL,                    -- 'editor'|'api'|'automation'|'restore'|'import'|'external_sync'
  created_at timestamptz NOT NULL,
  PRIMARY KEY (page_id, seq)
) PARTITION BY HASH (page_id);
-- 불변식 S1: 이 로그에는 삭제 op 가 없다. 페이지 삭제는 block.lifecycle 전이 + 부모 Y.Doc 의
--            참조 노드 제거로 표현되고, 로그 자체는 purge 시점에 page_id 파티션 단위로
--            물리 삭제된다. [X-3]
-- 불변식 S2: doc_update.seq 는 CRDT 재동기(state_vector delta)용 gap 감지 축이다.
--            페이지 변경 카운터가 아니다. 그것은 block.version 이다. [X-6]

CREATE TABLE doc_snapshot (                    -- 현재 상태. compaction 잡이 갱신
  page_id      uuid PRIMARY KEY,
  state        bytea NOT NULL,                 -- 머지된 CRDT state
  state_vector bytea NOT NULL,                 -- 클라이언트 delta 계산용
  merged_seq   bigint NOT NULL,                -- 여기까지의 doc_update 가 반영됨
  projected_seq bigint NOT NULL DEFAULT 0,     -- [X-1] block 프로젝터가 반영한 마지막 seq
  updated_at   timestamptz NOT NULL
);
-- 불변식 S3: projected_seq < merged_seq 인 구간은 block 테이블이 낡았다는 뜻이다.
--            검색/API/사이드바는 이 지연을 감수하고, 에디터는 Y.Doc 을 직접 본다. [X-1]
--            [추가 ⟨CRDT 5d · 마이그레이션 0017⟩] 기준은 merged_seq 가 아니라 **이 페이지 로그의 마지막 seq** 다.
--            merged_seq 는 압축 지점이라 그 뒤에 밀린 update 를 가리지 못하고, 투영이 압축보다 자주 돌아
--            projected_seq > merged_seq 가 보통이다. §6.2-21 의 지연도 (마지막 seq − projected_seq) 로 잰다.

CREATE TABLE page_version (                    -- 사용자 노출 버전 <C-12>
  id uuid PRIMARY KEY, page_id uuid NOT NULL,
  state_ref    text NOT NULL,                  -- blob 스토리지 키. 행에 bytea 를 박지 않는다
  state_vector bytea NOT NULL, byte_size int NOT NULL,
  editor_ids   uuid[] NOT NULL,                -- 구간 내 doc_update.actor_id DISTINCT
  reason text NOT NULL
    CHECK (reason IN ('interval','idle','pre_restore','restore','manual','external_sync')),  -- <15 R14> · [보강 8d-3] restore
  restored_from uuid NULL,                      -- [보강 8d-3] restore 버전에만 — CHECK ((reason='restore') = (restored_from IS NOT NULL))
  through_seq  bigint NOT NULL,                -- [보강 8d-1] 이 버전이 담은 마지막 doc_update.seq · UNIQUE (page_id, through_seq)
  created_at timestamptz NOT NULL,             -- [보강 8d-1] 담은 내용의 시각(마지막 update 의 created_at)
  expires_at timestamptz NOT NULL              -- 생성 시점 플랜으로 고정. 조회 시 재계산 금지
);
CREATE INDEX ON page_version (page_id, created_at DESC);   -- 목록 조회는 state_ref 를 SELECT 하지 않는다
CREATE INDEX ON page_version (expires_at);                 -- GC 스캔
-- 불변식 S4: 복원은 비파괴적이다. (1) reason='pre_restore' 버전 생성
--            (2) 대상 state 를 origin='restore' 인 doc_update 로 append
--            (3) 새 버전에 restored_from 기록
-- 불변식 S5: file.ref_count 는 page_version 참조를 포함한다. 아니면 옛 버전 복원 시 첨부가 깨진다.
-- 불변식 S6: reason='external_sync' 버전은 GC 를 더 공격적으로 적용한다(히스토리 노이즈 방지).

CREATE TABLE device_offline_manifest (         -- 오프라인 권한 회수 축
  device_id uuid NOT NULL, page_id uuid NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  revoked_at timestamptz NULL,                 -- 세팅 시 재접속 디바이스가 로컬 사본 즉시 폐기
  PRIMARY KEY (device_id, page_id)
);
-- page_channel / subscription(device_id,page_id) 테이블은 존재하지 않는다.
-- 실시간 구독은 연결 수명과 같아야 하므로 영속 테이블이면 안 된다. <C-11>
```

**[보강] 버전 기록 — 언제 · 무엇을 · 누가 보는가(`page_version`)** ⟨잔여 묶음 8d-1 · F-11-01 / 마이그레이션 0040⟩

> 초판은 표만 두었다(0007). 11 F-11-01 의 규칙은 *"활발히 편집하는 동안 10분마다 1개, 그리고 마지막 편집 후 2분 뒤에 1개"* ·
> *"스냅샷 단위 = 페이지 1개(자식 페이지 제외)"* · *"편집이 없으면 스냅샷도 생기지 않는다"* · *"`Can edit` 이상만 접근"* 이다.
>
> ① **`through_seq bigint NOT NULL` 을 더한다** — 이 버전이 담은 마지막 `doc_update.seq`. 초판의 `editor_ids` 는 *"구간 내
> `doc_update.actor_id` DISTINCT"* 인데 구간의 끝을 적는 칸이 없었다 — 시각(`created_at`)으로 자르면 같은 시각의 update 를 가르지 못하고
> 로그의 차례(seq)와 어긋날 수 있다. seq 는 로그의 위치라 구간이 정확하다(S2 의 재동기 축과 같은 값을 읽기만 한다). **한 위치에 버전은
> 하나**다(`UNIQUE (page_id, through_seq)`) — 같은 상태를 두 번 남기지 않는다(F-11-01 엣지 케이스 *"클라이언트별 중복 생성 금지"*).
> ② **언제 — 타이머가 아니라 그 페이지를 쓰는 순간에 판정한다.** 쓰기는 모두 본문 세션(그 페이지의 스냅샷 행을 잠근다)을 지나므로
>    세션을 여는 순간 — 이번 변경을 적용하기 **전에** — 아직 버전이 담지 않은 편집이 있는지 보고, 있으면 지금 상태를 남긴다:
>    · **쉼(`idle`)** — 마지막 update 에서 2분이 지났다(그 편집 세션이 끝났다)
>    · **주기(`interval`)** — 버전이 담지 않은 첫 update 에서 10분이 지났다(쉬지 않고 고치는 중)
>    기록 목록을 열 때도 같은 판정을 한다 — 마지막 편집 뒤에 아무도 쓰지 않아도 끝난 세션이 목록에 선다. 타이머를 두지 않는 까닭: 쓰기가
>    두 프로세스(협업 서버 · 앱)에서 오고, 판정을 그 페이지의 잠금 안에 두면 버전이 둘 생길 수 없으며(①), 시각을 DB 의 `now()` 하나로
>    잰다. 대가 — 쉼 버전은 2분이 지난 **뒤의 첫 쓰기 · 목록 열기**에 만들어진다(내용은 마지막 편집 때의 것이다).
> ③ **무엇을** — 그 순간의 Y.Doc 전체(`encodeStateAsUpdate` · F-11-01 클론 대안 *"그 시점 state 의 full encode 를 별도 blob"*)를
>    파일 저장소에 둔다(`state_ref` — `versions/{workspace}/{page}/{version}.yjs`). `created_at` 은 **그 내용의 시각** — 담은 마지막
>    update 의 `created_at` 이다(만든 시각이 아니다). `editor_ids` 는 앞 버전의 `through_seq` 뒤부터 이 버전의 `through_seq` 까지의
>    `actor_id`(시스템 · 옮기기는 빠진다).
>    · **옮기기(seq 1 · `import`)만 있는 상태는 버전이 아니다** — 새 페이지는 빈 본문으로 옮겨지므로 그대로면 빈 버전이 선다. 다만
>      **옮긴 내용이 비어 있지 않으면 첫 쓰기 때 그것을 남긴다**(Phase 0 의 행에서 옮긴 페이지 — 처음 고친 사람이 다 지워도 되돌릴 수
>      있게). 이유값은 `idle` 이다(쉬던 상태다)
>    · **S5** — 버전이 담은 이미지 블록의 파일만큼 `file.ref_count` 를 올린다. 지금은 버전을 지우는 GC 가 없어 내리지 않는다
> ④ **보관 기간** — `expires_at` 은 만들 때 그 워크스페이스의 요금제로 정해 고정한다(초판의 주석). Free 7일 · Plus 30일 · Business 90일 ·
>    Enterprise 무제한(`'infinity'`) — F-11-01 *"플랜 차이는 보관 기간뿐"*. 엔타이틀먼트 표(PE1)가 아직 없어 그 값은 한 함수에 둔다
>    (파일 크기 상한과 같은 처지 — 8k). 지난 버전은 목록에 서지 않고, 열면 `expired`(410)다. ~~지우는 GC 는 아직 없다~~ **지우는 GC 는
>    공용 스케줄러의 첫 일이다(§3.10 [보강] 공용 스케줄러 · 4a-1) — 가장 최근 버전 · 복원이 가리키는 버전은 남긴다 · S5 참조를 내린다.**
> ⑤ **누가 보는가** — 그 페이지를 고칠 수 있는 사람(`edit_content`)이다(F-11-01 *"`Can edit` 이상"*). 볼 수만 있으면 `forbidden`(403),
>    볼 수 없으면 `not_found`(404). 잠긴 페이지도 기록은 본다(읽기다 — 복원이 잠금을 묻는다). 미리보기의 하위 페이지 · 멘션의 이름과
>    아이콘은 **지금의 권한으로 거른 맵**으로 준다(본문과 같은 규칙 — 옛 버전이 지금 볼 수 없는 페이지를 가리킬 수 있다).

**[보강] 복원 — 앞으로 쓰는 되돌리기** ⟨잔여 묶음 8d-3 · F-11-02 / 마이그레이션 0041⟩

> 초판은 불변식 S4(*"복원은 비파괴적이다 — (1) pre_restore 버전 (2) 대상 state 를 origin='restore' 인 doc_update 로 append (3) 새 버전에
> restored_from"*)만 적었다. 11 F-11-02 는 *"`page_version.reason` 에 'pre_restore', 'restore' 값 필요"* 라고 적었지만 초판의 CHECK 에는
> `restore` 가 없다.
>
> ① **순서 — 한 트랜잭션.** 그 페이지 행을 잠그고(본문 저장과 같은 잠금) 본문 세션을 `origin='restore'` 로 연다 — 여는 순간의 버전
>    판정(쉼 · 주기 — [보강] 버전 기록 ②)이 먼저 돈다. 대상 버전의 본문(③ 으로 고친 것)으로 갈아 끼워 **바뀐 것이 없으면 아무것도 쓰지
>    않는다**(새 버전도 없다 — F-11-02 *"복원 대상이 현재와 동일 → no-op"*). 바뀌면 ⓐ 지금 상태를 담은 버전이 없을 때만 `pre_restore` 로
>    남기고(방금 쉼 버전이 담았으면 그것이 되돌리기 전의 상태다 — 한 위치에 하나) ⓑ 갈아 끼운 본문을 쌓고 투영한다(행위자는 되돌린
>    사람 · `last_edited_*` 도 그 사람) ⓒ 그 상태를 `reason='restore'` · `restored_from` = 대상 버전으로 남긴다.
> ② **`reason` 에 `restore` 를 더한다**(0041). `restored_from` 은 `restore` 버전에만 있다 — `CHECK ((reason = 'restore') = (restored_from IS NOT
>    NULL))`. 목록은 출처를 **한 단계만** 말한다(F-11-02 *"v7 에서 복원됨 — 체인을 끝까지 따라가는 UI 를 만들지 말 것"*).
> ③ **하위 페이지는 복원 대상이 아니다**(F-11-02 *"복원 후에도 자식 페이지는 현재 상태 그대로"*) — 대상 버전의 하위 페이지 참조 중
>    **지금 이 본문의 살아 있는 자식이 아닌 것은 뺀다**(휴지통 · 다른 곳으로 옮긴 페이지를 되살리거나 끌어오지 않는다 — 투영도 그런
>    참조를 두지 않는다 · §3.2-24), **지금의 자식인데 그 버전에 없는 참조는 본문 끝에 붙인다**(복원이 자식을 휴지통으로 보내지 않는다 —
>    본문 저장처럼 "빠진 자식"으로 거부하지도 않는다).
> ④ **제목은 되돌리지 않는다** — 버전에 없다(제목은 행의 속성이다 · [보강] 버전 기록 · HANDOFF §7).
> ⑤ **멘션 알림을 보내지 않는다** — 옛 내용을 되살린 것이지 새로 부른 것이 아니다. 멘션 역인덱스(`link_edge` · 백링크)는 본문을 따라
>    바뀐다(L1 — 행의 투영).
> ⑥ **누가** — `edit_content`. 잠긴 페이지는 `locked`(F-11-02 *"잠금 해제 전 복원 차단"*) · 볼 수만 있으면 `forbidden` · 볼 수 없으면
>    `not_found` · 보관 기간이 지난 버전은 `expired`(410) · 바이트가 없는 버전은 `not_found`(빈 본문으로 되돌리지 않는다).
> ⑦ **되돌리기 취소**는 따로 두지 않는다 — 되돌리기 전의 상태가 버전으로 남으므로 그것을 골라 다시 되돌린다(F-11-02 *"복원 자체를
>    되돌릴 수 있다"*). 버전이 담은 이미지의 파일은 버전의 참조라(S5) 되살린 이미지가 깨지지 않는다.

**런타임 구독 레지스트리 (영속 아님 — Redis / 프로세스 메모리)**

```
doc:{page_id}          -> SET<connection_id>        -- Yjs update 전용 <C-11>
ds:{data_source_id}    -> SET<connection_id>        -- 행/셀/스키마/뷰 변경 [X-5]
layout:{data_source_id}-> SET<connection_id>        -- 레이아웃 브로드캐스트 <16 R13>
conn:{connection_id}   -> { user_id, workspace_id, device_id, session_id,
                            subscribed_docs SET<uuid>, last_seq_by_doc MAP,
                            subscribed_ds SET<uuid>,  last_change_seq_by_ds MAP }
presence:{page_id}     -> HASH, TTL 30s             -- 또는 Yjs awareness

-- 와이어 봉투 2종. 한 채널에 두 종류를 섞지 않는다.
doc 채널:    { doc_id, seq, kind: 'update'|'awareness', payload: bytes, origin: client_id }
ds  채널:    { ds_id, change_seq, kind: 'row_upsert'|'row_removed'|'schema_changed'|'view_changed',
               payload: <적용 가능한 값(post-image)> }
```

- 구독 시점 권한검사 + **권한 회수 시 서버 강제 unsubscribe**. push 모델의 권한 경계는 채널 join 과 update 수신 두 지점이다.
- **[추가] 프로세스 사이 전파 ⟨CRDT 5c · 마이그레이션 0016⟩** — 레지스트리를 가진 협업 서버가 다른 프로세스(API 명령 · 권한 변경)의 커밋을 아는 통로는 **쓰는 트랜잭션의 트리거가 보내는 Postgres NOTIFY** 다. 채널 `collab_doc`(`{page_id}:{seq}`) · `collab_access`(`ws:{workspace_id}` · `user:{user_id}`). 표를 만들지 않는다(구독은 여전히 연결 수명). 신호는 커밋된 것만 · 커밋 순서대로 오고, 받는 쪽은 권한 신호를 처리한 뒤에야 뒤따르는 `doc_update` 를 퍼뜨린다 — 회수 뒤에 커밋된 update 는 회수된 연결에 가지 않는다. 듣는 연결이 끊긴 사이의 신호는 사라지므로 다시 붙으면 전부 다시 판정 · 동기화한다. 권한 신호는 워크스페이스 단위라 정밀 무효화(서브트리)가 아니다.
- **[보강] 의존보다 먼저 가는 update — 클라이언트는 자기 SyncStep2 를 보내기 전에는 update 를 보내지 않는다 ⟨플랫폼 잔여 10n-13 · F-05-04 · F-05-01 / 마이그레이션 없음⟩**
  ① **같은 연결 안에서도 update 가 자기 의존보다 먼저 갔다** — provider(Hocuspocus 4.7.0)가 ⓐ 연결을 다시 시도할 때 아직 보내지 못한 큐를
  비우고(`createWebSocketConnection`) ⓑ 소켓이 열린 뒤 서버의 첫 메시지가 오기 전까지는 새 update 를 곧바로 보내 큐에 남은 옛 update 를
  앞지른다. 서버는 의존이 없는 update 를 `missing_dependencies` 로 닫고 참여자는 문서를 버렸다 — **느린 연결에서 페이지를 열자마자 친
  편집이 사라지고** "서버가 받지 못한 편집" 경고가 섰다(HANDOFF §7 · 지연 400ms 에서 판의 절반 가까이). 진단: 거부된 update 는 그
  클라이언트의 clock 2 · 서버에 없는 것은 같은 클라이언트의 clock 0~1(비워지거나 앞질린 것 — 그 연결의 SyncStep2 에야 실린다).
  ② **규칙은 클라이언트에 둔다** — 한 연결에서 클라이언트는 **자기 SyncStep2(서버의 SyncStep1 에 대한 답)를 보내기 전에는 update 를
  보내지 않는다.** 그때까지의 편집은 문서에 있으므로 SyncStep2 가 모두 싣는다(서버의 state vector 에 없는 것 전부). SyncStep2 를 보낸 뒤에는
  첫 메시지를 이미 받았으므로 provider 의 큐가 비어 있고, update 는 생긴 차례대로 곧바로 간다. 연결이 끊기면 다시 "보내기 전" 이다.
  확인 요청은 그대로 `synced` 뒤에만(그 응답보다 먼저 가지 않는다 — 6c).
  ③ **서버는 그대로 엄격하다** — 의존이 없는 update 는 닫는다(그런 update 는 이제 깨진 것뿐이다). 서버가 같은 연결 안에서 의존을 기다리게
  하는 길을 먼저 시도했다 — **틀렸다:** ⓐ 한 update 는 한 트랜잭션이라(예: 빈 줄을 지우고 표를 넣는다) 서버가 아는 항목의 지우기만 먼저
  합쳐지고 넣기는 보류되자, 그 반쪽 문서를 수선(`empty_container_lifted`)이 고쳐 나중에 합쳐진 표가 걷힌 자리에 들어가 보이지 않았다
  (클라이언트는 그 수선을 받아 표를 잃었다) ⓑ Hocuspocus 는 보류된 update 도 메모리 문서에 적용해 그 지우기를 퍼뜨린다 — "메모리 문서는
  로그의 부분집합" 이 깨진다. update 를 통째로 들고 기다려도 ⓑ 는 남는다. 순서를 지키는 쪽(클라이언트)에서 막는다.
- `seq` / `change_seq` gap 감지 → 클라이언트가 `state_vector`(doc) 또는 `last_change_seq`(ds)를 보내고 서버가 **delta 만** 회신. full refetch 가 아니다.
- ds 채널 페이로드는 반드시 **적용 가능한 값**이어야 한다. "재조회하라"는 신호를 실으면 C-11 이 폐기한 pull 모델이 되살아난다. **[보강] 0단계는 유예한다 — 아래 X-5 [보강] "X-5 의 단계"(2k-1).**

**presence (U-9)** — DB 에 저장하지 않는다.

```
awareness.localState = {
  user:            { user_id, name, avatar_url, color },
  cursor:          { block_id, anchor: RelativePosition, head: RelativePosition } | null,
  block_selection: uuid[],
  mode:            'view' | 'edit' | 'suggest',
  ts:              epoch_ms
}
-- 불변식 S7: cursor != null 과 block_selection.length > 0 은 동시 성립 불가(클라이언트 강제)
-- 좌표는 반드시 CRDT relative position. 절대 offset 은 원격 편집 후 어긋난다.
-- offline 판정 30s [확인: Yjs 공식], 재브로드캐스트 10s [추정]
```

**쓰기 경로 2개 (V-5)**

| 경로 | 원자성 단위 | 불변식 |
|---|---|---|
| ① 실시간 편집 (에디터 → Yjs update) | `doc_update` 1행 append | update 바이너리는 쪼개지지 않는다. 트랜잭션 개념 자체가 없다. 롤백도 없다(Yjs 로컬 상태가 이미 진실) |
| ② 서버 명령 (REST API / 자동화 / 템플릿 / 제안 벌크 수락 / 버전 복원 / 셀 쓰기 / 외부 sync) | 명령 1건 | 서버가 Y.Doc 로드 → `Y.transact` 안에서 전부 적용 → update 1개 append. **부분 적용 없음.** 셀 쓰기는 같은 DB 트랜잭션에서 EAV 갱신 |

"부분 적용은 설계상 존재하지 않는다"는 **② 경로 한정 불변식**이다. 시스템 전역 불변식으로 쓰지 않는다.

**제안 편집 (U-2)** — 본문의 진실은 Y.Doc 안의 ProseMirror mark 3종(`suggestion_insert` / `suggestion_delete` / `suggestion_format`, 각각 `{sid, author_id}`). 아래 테이블은 사이드바·알림·권한 판정을 위한 **메타데이터 인덱스**다.

```sql
CREATE TABLE suggestion (
  id uuid PRIMARY KEY,                         -- = mark 의 sid
  page_id uuid NOT NULL, author_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('insert','delete','format')),
  preview text, anchor_hint jsonb,             -- RelativePosition. 카드->본문 점프 보조 좌표일 뿐
  state text NOT NULL CHECK (state IN ('open','accepted','rejected','stale')),
  thread_id uuid NULL, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX ON suggestion (page_id) WHERE state='open';
CREATE INDEX ON suggestion (author_id, created_at DESC);
CREATE INDEX ON suggestion (thread_id);
-- 불변식 S8: stale 판정은 앵커 소실이 아니라 "sid 마크가 문서에서 사라졌는가"다.
-- 불변식 S9: 수락/거절/벌크는 Y.transact 1회. 커밋 actor 는 **수락자**다(제안자가 아니다).
-- 불변식 S10: 대상은 텍스트 계열 5종. 구조 변경 제안(블록 삭제·이동)은 스코프 아웃.
```

---

### 3.8 활동 · 구독 · 알림 ⟨C-13⟩

```sql
CREATE TABLE activity_event (                  -- 알림·피드·웹훅의 단일 소스
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,                       -- 알림 라우팅의 기준 축
  block_id uuid NULL, actor_id uuid NULL,      -- <17> 익명/시스템 허용
  type text NOT NULL,                          -- 'block.updated'|'property.updated'|'comment.created'
                                               -- |'user.mentioned'|'page.created'|'page.moved'|'page.trashed'
                                               -- |'suggestion.created'|'suggestion.accepted'
                                               -- |'access.requested'|'access.granted' [보강 7e-1]
                                               -- |'reminder.fired' [보강 4c-2]|'person.assigned' [보강 6h]|...
  payload jsonb NOT NULL, created_at timestamptz NOT NULL
) PARTITION BY RANGE (created_at);             -- <17> (workspace_id, occurred_at) 파티션 요구
CREATE INDEX ON activity_event (page_id, created_at DESC);

CREATE TABLE subscription (                    -- 페이지 팔로우. 결제 구독이 아니다 [X-10]
  id uuid PRIMARY KEY, user_id uuid NOT NULL, page_id uuid NOT NULL,
  page_kind text NOT NULL CHECK (page_kind IN ('page','db_item')),   -- level CHECK 의 판별자
  level text NOT NULL,
  source text NOT NULL CHECK (source IN ('explicit','auto_created','auto_edited')),
  inherit boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, page_id),
  CHECK (
    (page_kind='page'    AND level IN ('all_comments','replies_and_mentions','none')) OR
    (page_kind='db_item' AND level IN ('all_updates','important_updates','replies_and_mentions','none'))
  )
);
-- 불변식 N1: 명시적 'none' 은 암묵 구독을 덮어쓴다. 아니면 "뮤트했는데 편집하면 다시 켜지는" 버그가 생긴다.

CREATE TABLE notification (
  id uuid PRIMARY KEY, recipient_id uuid NOT NULL, workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  event_ids uuid[] NOT NULL,                   -- 묶인 activity_event 들
  kind text NOT NULL,                          -- 'mention'|'comment'|'comment_reply'|'page_update'
                                               -- |'invite'|'reminder'|'person_property_assigned'|'suggestion'
                                               -- |'access_requested'|'access_granted' [보강 7e-1]
  group_key text NOT NULL,                     -- 조회 시점 병합 키
  read_at timestamptz NULL, archived_at timestamptz NULL,   -- 반드시 별도 컬럼(인박스 필터 4종)
  created_at timestamptz NOT NULL
);
CREATE INDEX ON notification (recipient_id, archived_at, read_at, created_at DESC);
CREATE INDEX ON notification (recipient_id, group_key, created_at DESC);
-- 불변식 N2: UNIQUE(group_key) WHERE read_at IS NULL 제약은 존재하지 않는다.
--            저장은 개별, 병합은 조회 시점. 이유 (a) 스레드 일부만 읽음 표현
--            (b) 배달 시점 권한 재검사가 이벤트별로 필요 (c) 인기 페이지 팬아웃의 단일 행 락 회피
-- 불변식 N3: payload 를 복제하지 않는다. activity_event 를 event_ids[] 로 참조한다.
-- 불변식 N4: 외부 origin 변경은 기본적으로 알림을 만들지 않는다(webhook 폭주 = 인박스 폭주). <15 R13>

CREATE TABLE notification_delivery (
  id uuid PRIMARY KEY, notification_id uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','desktop_push','mobile_push','email','slack')),
  target_email_id uuid NULL REFERENCES user_email(id),   -- <14 R-9> channel='email' 일 때 is_primary
  state text NOT NULL CHECK (state IN ('pending','suppressed','sent','failed')),
  scheduled_at timestamptz NOT NULL,           -- 디바운스 만료 시각
  sent_at timestamptz NULL,
  suppress_reason text NULL                    -- 'user_active'|'read_before_send'|'channel_disabled'
);
CREATE INDEX ON notification_delivery (state, scheduled_at);

CREATE TABLE user_notification_pref (
  user_id uuid PRIMARY KEY REFERENCES "user"(id),
  desktop_push boolean NOT NULL DEFAULT true,  mobile_push boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true,         slack boolean NOT NULL DEFAULT false,
  always_send_email boolean NOT NULL DEFAULT false
);
-- 'inbox' 컬럼은 두지 않는다. 인박스는 채널이 아니라 알림의 기본 저장소이며 끌 수 없다.

CREATE TABLE reminder (
  id uuid PRIMARY KEY, block_id uuid NOT NULL, page_id uuid NOT NULL,
  property_id text NULL REFERENCES property(id),          -- text [X-12]
  target_at timestamptz NOT NULL, timezone text NOT NULL, -- IANA
  lead_minutes int NOT NULL DEFAULT 0, recipient_ids uuid[] NOT NULL,
  fired_at timestamptz NULL, created_by uuid
);
CREATE INDEX ON reminder (target_at) WHERE fired_at IS NULL;
```

**[보강] 리마인더 — 날짜 속성 먼저 · 시각은 셀과 함께 움직인다** ⟨히스토리 · 활동 4c-1 · F-11-10 / 마이그레이션 0072⟩

> 11 F-11-10 은 두 길을 적었다 — 본문의 `@remind` 칩과 데이터베이스 날짜 속성의 "Remind". 본문의 날짜 멘션은 계약(`MentionType 'date'`)에
> 자리만 있고 편집기에 없다. **날짜 속성이 먼저다**(4c-1 서버 · 4c-2 발화 · 4c-3 화면). 본문 칩은 날짜 멘션이 생길 때 같은 표를 쓴다.
>
> ① **표에 더한 것** — `workspace_id`(범위 · 정리) · `fire_at`(= `target_at` − `lead_minutes` 분 — 워커가 찾는 칸. 리드가 있으면 `target_at` 의
>    색인으로는 찾을 수 없다). 불변식은 CHECK 로: 리드 0 ~ 10080분(일주일) · 받는 사람 하나 이상 · `fire_at` 은 그 식 그대로. FK — `page_id` ·
>    `block_id` 는 블록(CASCADE — 물리 삭제가 함께 지운다), `property_id` 는 속성(CASCADE), `created_by` 는 사용자. 날짜 속성의 리마인더는
>    **칸마다 하나**(`(page_id, property_id)` 부분 UNIQUE) — 노션에서도 리마인더는 날짜 값의 일부다. 행의 리마인더는 `block_id = page_id` 다.
>    색인은 초판의 `target_at` 대신 `fire_at`(발화 전인 것만).
> ② **시각은 SQL 함수 하나**(`reminder_target_at(start, 값의 타임존, 리마인더의 타임존)`) — 날짜만이면 **그날 09:00**(F-11-10 *"기본 시각을
>    반드시 정의한다 — 00:00 이면 새벽 알림"*)을 타임존으로, 오프셋이 있는 시각은 그대로, 오프셋이 없는 시각은 타임존으로 읽는다. 타임존은 값의
>    `time_zone` 이 먼저, 없으면 리마인더를 건 사람의 것(브라우저가 보낸 IANA 이름 — 서버가 `pg_timezone_names` 로 확인한다). 모르는 이름이면
>    리마인더의 것으로 물러난다.
> ③ **셀과 함께 움직인다 — 트리거** — 셀을 쓰는 길은 여럿이다(셀 고치기 · 카드 옮기기 · 행 만들기 · 템플릿 · 가져오기 · 뒤의 자동화). 명령마다
>    부르면 하나를 빠뜨린다. `page_property_value` 의 쓰기 · 지우기 뒤에 그 칸의 리마인더를 맞춘다: 값이 비거나 날짜가 아니면 리마인더를
>    지우고, 시각이 바뀌었으면 다시 계산한다 — 미래로 옮기면 다시 건다(`fired_at` = NULL), 지난 시각으로 옮기면 "지남"으로 둔다(울리지 않는다).
> ④ **지난 시각에 걸면 울리지 않는다** — "지남"(`fired_at` 을 건 시각으로)으로 둔다. 화면은 빨갛게 보인다(F-11-10 *"즉시 발화하지 않고 '이미
>    지남' 상태로만 표시하는 편이 안전"*).
> ⑤ **누가** — 리마인더를 걸고 푸는 것은 그 칸을 고칠 수 있는 사람(`edit_content` · 행 잠금이면 막힌다 — 날짜 값의 일부다). 받는 사람은 **건
>    사람**이다(날짜 속성의 리마인더). 다른 사람이 다시 걸면 그 사람으로 바뀐다(마지막 쓰기가 이긴다 — 셀과 같다).
> ⑥ **리드** — 날짜만이면 그날 · 하루 · 이틀 · 일주일 전(모두 09:00), 시각이 있으면 그 시각 · 5 · 10 · 15 · 30분 · 1 · 2시간 · 하루 전. 반복은
>    없다(노션에도 없다).
> ⑦ 발화(4c-2)는 공용 스케줄러의 소비자 — `fire_at` 이 지난 것을 1분마다 조건부 선점(`UPDATE … WHERE fired_at IS NULL`)으로 한 번만, 그때의
>    권한으로 거르고, 페이지가 살아 있지 않으면 울리지 않는다.
> ⑧ **[보강 4c-2] 울리기** ⟨마이그레이션 0073 · 일의 종류 `reminder_fire`⟩ — ⓐ **한 번만**: 선점이 `fired_at` 을 실행기의 시각으로 적는다 —
>    두 워커가 같은 것을 집어도 하나만 이긴다(F-11-10 *"중복 발화 — 조건부 선점으로 at-most-once"*). 선점한 뒤 울리지 못하면(아래) 그대로
>    "지남"이다 — 되살려도 지난 것은 울리지 않는다(F-11-10 *"복원 시 이미 지난 것은 발화하지 않음"*) ⓑ **울리지 않는 것**: 페이지가 살아 있지
>    않다(휴지통 · purged) · 날짜 속성이 지워졌거나 날짜가 아니다 · 받는 사람 중 이 워크스페이스의 멤버가 하나도 없다(F-11-10 *"수신자 중
>    워크스페이스를 떠난 사람만 제외"*) ⓒ **페이지를 볼 수 있는가는 인박스가 읽을 때** 본다(배달 파이프라인 ② — 울리는 시점에는 받는 사람의
>    세션이 없다 · A9) ⓓ 활동 이벤트 `reminder.fired`(payload 는 `reminder_id` · `property_id` — id 만) · 행위자는 건 사람 · 알림 종류
>    `reminder` · 묶음 열쇠 `reminder:{id}` ⓔ 한 판 200 — 늘 1분 뒤에 다시(리마인더는 분 단위다).
> ⑨ **[보강 4c-3] 화면** — ⓐ **종은 날짜 칸에** 선다. 리마인더는 날짜 값의 일부이므로 그 칸을 보는 사람 **모두에게** 보인다(알림은 건
>    사람에게만 간다). 지난 것(울렸거나 "지남")은 빨갛게 ⓑ 리마인더는 행의 읽기에 싣지 않고 **보이는 행들의 것을 따로 읽는다**
>    (`GET …/data-sources/{id}/reminders?rows=` — 그 표를 볼 수 있는 사람 · 한 번에 200행) — 행을 읽는 길이 여럿이라 하나씩 고치면 하나를
>    빠뜨린다. 행의 판(`version`)이 바뀌면 다시 읽는다(날짜를 옮기면 트리거가 시각을 바꾼다) ⓒ 리드는 칸의 값 모양에 맞는 목록만 보인다 —
>    표의 날짜 칸은 날짜만이므로 그날 · 하루 · 이틀 · 일주일 전(오전 9시). 타임존은 그 브라우저의 것 ⓓ 인박스의 리마인더 줄은 울린 날짜
>    속성의 지금 이름을 말한다(속성이 없어졌으면 "리마인더"만) ⓔ **[10n-76] 카드의 날짜에도 종** — 보드 · 갤러리 카드의 날짜 배지 옆에 선다.
>    **보이기만 한다** — 걸고 푸는 것은 표 · 행 페이지의 칸에서(카드는 좁고, 누르면 카드가 열린다). 같은 읽기(ⓑ)를 쓰고, 서버가 화면을 다시
>    그릴 때마다(표 변경 신호 — ⑩) 다시 읽는다. **[10n-77] 캘린더의 막대에도** — 그 보기의 날짜 속성의 리마인더가 막대의 제목 뒤에 선다.
>    주를 넘어 잘린 막대는 **시작하는 조각에만**(이어지는 조각마다 서면 한 리마인더가 여럿으로 보인다).
> ⑩ **[보강 10n-17] 걸기 · 풀기 · 울림을 다른 화면에 알린다** — 리마인더는 행의 칸(EAV)이 아니라 따로 사는 표라, 걸고 풀어도 표 변경
>    신호(`db_rows` — 0063)가 나가지 않았다(같은 행을 보는 다른 사람의 칸에 종이 서는 것은 새로 열 때였다). ⓐ **신호** — 리마인더 행이 생기고
>    바뀌고 지워지면(걸기 · 다시 걸기 · 풀기 · 울림의 `fired_at` · 셀을 따라 맞춘 시각) 그 행의 표로 `db_rows` 를 보낸다(트리거 — 0109). 본문
>    칩의 리마인더(속성 없음)는 표가 없어 보내지 않는다 ⓑ **화면은 다시 읽기마다 리마인더도 다시 읽는다**(⑨ ⓑ 의 "행의 판이 바뀌면" 에 더해)
>    — **행의 판은 올리지 않는다**: 올리면 그 행의 다른 칸을 `expectedVersion` 으로 쓰던 사람이 충돌을 맞는다. 리마인더는 날짜 값의 일부지만
>    판은 칸의 판이다 ⓒ 행 페이지(레코드 모양)는 구독하지 않으므로 새로 열 때다(표 변경 알림과 같다).

**[보강] 알림 · 활동 데이터 수명** ⟨히스토리 · 활동 4d-1 · F-11-18 / 마이그레이션 0074 · 공용 스케줄러의 다섯 번째 소비자 `data_retention`⟩

> 11 F-11-18 *"Notion 은 activity_event · notification 의 보관 기간을 공개하지 않는다 — 클론이 반드시 스스로 내려야 하는 설계 결정"* ·
> *"정책 미설정 → 코드 상수 기본값. NULL 을 '무제한'으로 해석하지 말 것 — 정책 누락이 곧 무한 적재"*.
>
> ① **기간은 코드 상수다**(관리자 화면 없음 — Notion 에도 없다 · 권장 기본값 그대로): 읽었거나 보관한 알림은 그 뒤 **180일** · 안 읽은
>    알림은 **지우지 않는다**(사라지면 데이터 손실로 보인다) — 단 사람마다(워크스페이스마다) **1,000개**를 넘으면 오래된 것부터 · 활동
>    이벤트는 **90일** — 단 **남은 알림이 가리키는 이벤트는 남긴다**(인박스가 그 payload 를 읽는다 · N3) · 최근 방문은 사람마다
>    (워크스페이스마다) 최근 **200개**.
> ② **알림이 먼저, 이벤트가 나중** — 이벤트가 남은 알림의 것인지는 남은 알림 전체의 `event_ids` 로 본다(시각의 짝에 기대지 않는다 — 실행기의
>    시각과 DB 의 시각이 다를 수 있다).
> ③ **파티션** — 활동 이벤트의 올해 · 다음 해 파티션을 미리 만든다(`ensure_activity_partition(year)` — 마이그레이션이 정의한 함수 · 앱이
>    DDL 을 쓰지 않는다). DEFAULT 에 그 해의 행이 이미 있으면 만들지 않는다(만들 수 없다 — 그 해는 DEFAULT 에 남는다). 오래된 파티션을
>    통째로 떨구지 않는다 — 이벤트가 남은 알림에 묶여 있어 행 단위로 지운다.
> ④ **지우지 않는 것** — 감사 기록(`audit_event` — 보존 자체가 목적 · F-11-12). 조회 기록(`page_view`)과 그 옵트아웃은 조회 분석(F-11-04)이
>    생길 때.
> ⑤ 시스템 주체 · 한 판에 종류마다 5,000행 — 하나라도 꽉 찼으면 1분 뒤, 아니면 한 시간 뒤.

**[보강] 활동 기록 — 무엇을 어디서 남기고 어떻게 접나** ⟨히스토리 · 활동 4d-2 · F-11-04 / 마이그레이션 없음⟩

> 11 F-11-04 의 Updates(페이지 활동 피드)는 `activity_event` 를 시간순으로 보인다. 지금까지는 코멘트 · 멘션 · 접근 요청 · 리마인더만
> 이벤트를 남겼다 — 편집 · 만들기 · 옮기기 · 휴지통이 없어 피드가 비었다. 클론 대안 *"Analytics(조회수)는 드롭하고 Updates 탭만"*.
>
> ① **남기는 곳 — 그 쓰기와 같은 트랜잭션에서**: `page.created`(페이지 · 하위 페이지 · 행 만들기 — 페이지 · 행을 만드는 안쪽 함수 하나씩)
>    · `page.moved`(옮기기 — payload `from` · `to` 부모 id) · `page.trashed`(버리기 — **묶음의 루트에만**, 함께 들어간 자손에는 남기지 않는다
>    · 휴지통 명령과 참여자가 참조를 지운 길이 함께 쓰는 행 쓰기 한 곳 · 행 휴지통) · `block.updated`(**참여자의 본문 update** — 사람이 친
>    편집. 명령이 본문을 고친 것(하위 페이지 만들기 · 옮기기 · 되돌리기 · 가져오기)은 그 명령의 이벤트가 말하므로 남기지 않는다) ·
>    `property.updated`(셀 쓰기). **페이지 제목 바꾸기**(`renamePage` — 본문 update 밖의 명령이지만 사람이 친 글이다)도 `block.updated`
>    (페이지 블록 자신의 제목 · 같은 접기). 행의 제목은 셀이므로 `property.updated`. 아이콘 · 커버는 남기지 않는다(글이 아니다).
> ② **접는다** — `block.updated` · `property.updated` 는 같은 사람 · 같은 페이지 · 같은 종류의 이벤트가 **5분** 안에 있으면 새로 남기지
>    않는다(11 F-11-04 *"동일 actor 의 연속 편집은 시간 윈도우(예: 5분)로 합쳐 1건"*). 타자 하나마다 행이 생기면 피드도 표도 못 쓴다.
>    접기는 저장할 때 한다(조회 때 접으면 저장이 폭주한다).
> ③ **payload 는 id 만**(이 표의 규칙) — 무엇을 고쳤는지의 글은 싣지 않는다. 행위자는 세션의 사람이다.
> ④ **알림을 만들지 않는다** — 구독 레벨 `all_updates`(db_item)의 `page_update` 알림은 이 이벤트 위에 뒤에 선다.
> ⑤ 보관은 [보강] 데이터 수명 ① 의 90일을 그대로 따른다.

**[보강] Updates 패널 — 페이지의 활동을 읽는 길** ⟨히스토리 · 활동 4d-3 · F-11-04 화면 / 마이그레이션 없음⟩

> 11 F-11-04 의 Updates 탭이다. Analytics(조회수)는 두지 않는다 — 클론 대안 *"Analytics 를 전부 드롭하고 Updates 탭만"*(조회 수집 ·
> 롤업 · 옵트아웃이 함께 온다).
>
> ① **읽을 수 있는 사람 = 그 페이지를 볼 수 있는 사람**(11 *"Updates 탭도 페이지 읽기 권한자만"*). 살아 있는 페이지만 — 페이지 화면
>    (`getPage`)과 같은 문이다. 볼 수 없으면 없는 페이지와 같다(404).
> ② **보이는 종류는 허용 목록** — `page.created` · `page.moved` · `page.trashed` · `block.updated` · `property.updated` · `comment.created`.
>    빼는 것: `user.mentioned`(누가 멘션됐는지는 받은 사람의 것이고 편집은 `block.updated` 가 이미 말한다) · `access.*`(요청한 사람과
>    결정은 관리자의 것) · `reminder.fired` · `person.assigned`(한 사람의 것 — 셀 편집은 `property.updated` 가 말한다). `suggestion.*` 은 제안 편집(U-2)이 생길 때 목록에 더한다. 새 종류는 목록에
>    넣기 전까지 보이지 않는다 — 빠지는 쪽이 새는 쪽보다 낫다.
> ③ **최신순 · 커서** — `(created_at, id)` 내림차순 · 한 번에 30개 · 커서는 마지막 항목의 시각(마이크로초)과 id 를 불투명하게 싼 것
>    (`encodeCursor` — OFFSET 이 아니다). 색인은 `ix_activity_event_page`.
> ④ **행위자의 이름은 지금의 이름** — payload 에 이름을 싣지 않는다(이 표의 규칙). 11 의 *"이벤트에 이름 비정규화 저장"* 은 따르지
>    않는다 — 사용자 행은 지우지 않으므로(14 R-3) 지금 이름을 읽을 수 있다. 탈퇴(`deleted_at`)면 "삭제된 사용자", 행위자가 없으면
>    "시스템". 이 페이지를 고친 사람은 그 페이지에 이미 나오는 사람이므로 게스트에게도 이름을 준다(7d-2 `onlyPeople` 과 같은 범위).
> ⑤ **옮기기의 목적지** — 새 부모가 읽는 사람이 **볼 수 있는 살아 있는 페이지**면 그 제목, 아니면 목적지를 말하지 않는다("옮겼습니다"
>    만). 볼 수 없는 페이지의 제목이 피드로 새지 않게. 옛 부모는 보이지 않는다.
> ⑥ **하위 페이지의 활동은 넣지 않는다**(11 *"기본 미포함"*). "하위 포함" 토글은 두지 않았다 — 필요해지면 방문 집합 · 깊이 상한과 함께.
> ⑦ 열 때 읽는다 — 실시간으로 따라오지 않는다(다시 열면 다시 읽는다). 항목을 눌러 그 블록으로 가는 것은 두지 않는다(11 `[확인필요]`).

**[보강] 페이지 웹훅 — 활동을 바깥으로** ⟨히스토리 · 활동 4e · F-11-19 / 마이그레이션 0075~⟩

> 11 F-11-11b(= F-11-19 — 마스터 ※3)는 페이지의 편집 · 코멘트를 Slack 채널로 보낸다. 마스터 문서 비고 20 이 판단을 끝냈다 — **Slack 전용
> 커넥터(OAuth · 토큰 갱신 · 채널 고르기) 대신 임의 URL 로 JSON 을 POST 하는 웹훅 하나.** Slack 은 incoming webhook URL 을 그대로 붙인다
> (OAuth 생략). 같은 발송기(①)를 자동화의 `send_webhook`(08 F-08-13)이 쓴다.
>
> ```sql
> CREATE TABLE page_webhook (
>   id            uuid PRIMARY KEY,
>   workspace_id  uuid NOT NULL REFERENCES workspace(id),
>   page_id       uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
>   url_sealed    bytea NOT NULL,    -- 봉인한 URL(③) — incoming webhook URL 은 그 자체가 비밀이다
>   url_hint      text NOT NULL,     -- 화면 표시 — 호스트와 끝 4자만(`hooks.slack.com/…a1b2`)
>   created_by    uuid NOT NULL REFERENCES "user"(id),
>   created_at    timestamptz NOT NULL DEFAULT now(),
>   paused_at     timestamptz NULL,  -- 멈춤(⑦) — 실패가 이어졌거나 사람이 멈췄다
>   pause_reason  text NULL CHECK (pause_reason IN ('failures','manual')),
>   CHECK ((paused_at IS NULL) = (pause_reason IS NULL))
> );
> ```
>
> ① **바깥 요청은 한 길로**(`net/outbound.ts`) — https 만 · 기본 포트(443)만 · URL 에 사용자 정보(`user:pass@`) 금지 · 리다이렉트를 따라가지
>    않는다(3xx 는 실패) · 10초 · 응답 본문은 64KB 까지만 읽고 버린다. **이름을 풀어 나온 주소가 하나라도 막힌 대역이면 보내지 않는다**
>    (사설 · 루프백 · 링크 로컬(메타데이터 `169.254.169.254`) · CGNAT · 문서용 · 벤치마크 · 멀티캐스트 · 예약 · IPv6 의 ULA · 링크 로컬 ·
>    사이트 로컬 · IPv4 매핑 · NAT64 · 6to4 · Teredo · 문서용). 연결은 **검사한 그 주소로** 한다(`lookup` 고정) — 검사와 연결 사이에 이름이
>    바뀌는 DNS rebinding 을 막는다. 검사를 비켜 가는 호스트는 환경변수 `OUTBOUND_ALLOW_HOSTS`(`host:port` 목록 · 그 호스트는 http 도 허용)뿐이다
>    — e2e 의 받는 서버용이고 운영에는 두지 않는다.
> ② **저장할 때도 본다** — 모양만(https · 사용자 정보 없음 · 기본 포트 · 호스트가 막힌 대역의 주소 글자가 아님 · `localhost` 류가 아님 ·
>    2,048자 이하). 이름 풀이는 보낼 때 한다 — 그 사이에 바뀔 수 있다.
> ③ **URL 은 봉인한다** — 2단계 인증의 비밀값과 같은 방식(`AUTH_SECRET` 에서 HKDF-SHA256 · info `notion-clone/webhook-url/v1` · AES-256-GCM).
>    화면에는 힌트만 주고 원문을 다시 보여주지 않는다(바꾸려면 지우고 다시 건다). `external_connection.credential_ref`(시크릿 스토어)는
>    아직 없다 — 앱 키 봉인으로 대신한다(§3.2 `mfa_method` 와 같은 판단).
> ④ **누가 거나** — 그 페이지의 **전체 권한**(`manage_perm`). 페이지 글이 바깥으로 나가는 길이라 공유와 같은 무게다(11 *"비공개 페이지 →
>    공개 채널 — 정보 유출 위험"*). 목록 · 지우기 · 멈추기 · 다시 켜기도 같은 권한이다. 데이터베이스 행에는 걸지 않는다(행의 공유는
>    데이터베이스가 정한다 — 행 페이지에 공유 단추가 없는 것과 같다). 잠긴 페이지에도 건다(본문을 고치지 않는다). 페이지마다
>    **5개**까지(08 *"automation 당 최대 5개"* 와 같은 수). 요금제 게이트는 두지 않는다.
> ⑤ **무엇을 보내나**(4e-2) — 4d-3 의 허용 목록과 같은 종류. **그 페이지와 그 아래 페이지**의 활동이다(11 *"하위 페이지 포함이 명시"*). 아래에
>    웹훅이 걸린 페이지가 있으면 그 아래의 활동은 **가장 가까운 페이지의 웹훅만** 받는다(11 *"중첩 — 가장 가까운 연결 하나만"*).
> ⑥ **모아서 보낸다**(4e-2) — 웹훅마다 첫 이벤트부터 5분을 모아 한 번(11 *"시간 윈도우(5분) 집계 후 1건"*). 본문은 `text`(Slack 이 그리는
>    한 줄 — 페이지 제목 · 누가 · 무엇을 몇 번 · 링크)와 `notion_clone`(판 · 배달 id(멱등 키 — 08 *"`run_id` 를 반드시"*) · 페이지 id · 이벤트의
>    id · 종류 · 행위자 id · 시각). 사람이 쓴 글(본문 · 코멘트)은 싣지 않는다 — payload 는 id 만이라는 이 표의 규칙과 같은 까닭이다.
> ⑦ **실패하면**(4e-2) — 짧게 다시 해 보고(1 · 2 · 4분) 그래도 실패면 웹훅을 **멈춘다**(`failures`) — 끝없는 재시도는 상대 서버를 두드리는
>    것이다(08 F-08-13 *"짧은 재시도 3회 후 정지"*). 사람이 다시 켠다. 멈춘 동안의 활동은 보내지 않는다(쌓았다가 몰아 보내지 않는다).
> ⑧ 페이지가 휴지통에 가면 보내지 않고 웹훅은 남는다(되살리면 다시) · 페이지 행이 지워지면 함께 지워진다(FK CASCADE · 11 *"삭제된 참조"*).
> ⑨ 화면(4e-3)은 Updates 패널 안이다 — 노션은 그 패널의 "Connect Slack channel" 토글이다.
> ⑩ **[10n-70] 워크스페이스의 웹훅 스위치**(08 F-08-13 *"Enterprise 소유자는 Settings > Connections 에서 전면 비활성화 가능"*) — 설정
>    `workspace.allow_webhooks`(`setting_value` 의 한 줄 · 행이 없으면 켜짐 · 고치는 사람은 소유자 · 설정 → 보안). 거짓이면 이 워크스페이스에서
>    바깥으로 나가는 웹훅이 **모두** 선다 — 페이지 웹훅과 자동화 · 버튼의 `send_webhook`(DB automation ⑫). **새로 걸 수 없고**(걸기 ·
>    `send_webhook` 이 든 액션 저장 → `webhooks_disabled`) **걸린 것도 보내지 않는다** — 쌓지 않고(묶음 · 배달을 만드는 문장이 같은 자리에서
>    거른다) 이미 쌓인 것은 보낼 때 버린다(`dropped` · `webhooks_disabled`). 다시 켜도 꺼진 동안의 활동을 몰아 보내지 않는다(⑦ 의 멈춤과 같은
>    규칙). 걸린 웹훅 · 액션 정의는 그대로 남고 멈추기 · 지우기는 꺼져 있어도 된다. 요금제 게이트는 두지 않는다 — 끄는 것은 안전 장치라
>    모든 요금제의 소유자에게 준다(노션은 Enterprise 만 · 켜는 쪽의 게이트는 `automation.webhook` 이 따로 한다). 판정은 읽을 때마다 DB 에
>    묻는다(캐시 없음 — 끈 순간부터 막혀야 한다).
>
> **보내기 — 4e-2 에서 정한 것** ⟨마이그레이션 0076⟩
>
> ```sql
> CREATE TABLE webhook_delivery (
>   id            uuid PRIMARY KEY,              -- 받는 쪽의 멱등 키(⑥)
>   webhook_id    uuid NOT NULL REFERENCES page_webhook(id) ON DELETE CASCADE,
>   event_ids     uuid[] NOT NULL,               -- 모은 이벤트(시간순)
>   window_end    timestamptz NOT NULL,          -- 첫 이벤트 + 5분 — 이때 보낸다
>   status        text NOT NULL CHECK (status IN ('collecting','pending','sent','failed','dropped')),
>   attempts      int NOT NULL DEFAULT 0,
>   next_attempt_at timestamptz NULL,            -- pending 일 때만 — 보낼 시각(첫 시도 · 다시)
>   locked_until  timestamptz NULL,              -- 보내는 중(임대) — 워커가 죽으면 지나서 다시 가져간다
>   last_status   int NULL, last_error text NULL,
>   finished_at   timestamptz NULL,              -- sent · failed · dropped 일 때만
>   created_at    timestamptz NOT NULL DEFAULT now()
> );
> CREATE UNIQUE INDEX ux_webhook_delivery_collecting ON webhook_delivery (webhook_id) WHERE status = 'collecting';
> ```
>
> ⓐ **이벤트를 남길 때 같은 트랜잭션에서 고른다**(`recordActivity`) — 그 이벤트의 페이지와 **권한 범위(`perm_scope_id`)가 같은** 자기 · 조상
>    페이지 중 웹훅이 걸린 **가장 가까운** 페이지의 켜진 웹훅마다, 모으는 묶음(웹훅마다 하나 — 부분 UNIQUE)에 이벤트를 더한다. 묶음이
>    없으면 만들고 그때 `window_end` = 지금 + 5분. 나중에 로그를 거꾸로 훑지 않는다 — 커밋 순서와 시각이 어긋나면 훑는 쪽이 이벤트를 건너뛴다.
> ⓑ **권한 범위가 같은 것만**(⑤를 좁힌다) — 같은 `perm_scope_id` 의 페이지는 정의상 권한이 같다(§3.3). 아래 페이지 중 권한을 따로 정한
>    페이지(상속을 끊었거나 따로 공유한 것)와 그 아래의 활동은 위의 웹훅으로 가지 않는다 — 그 페이지를 볼 수 없는 사람이 건 웹훅으로 그 활동이
>    새지 않게. 거기에도 보내려면 그 페이지에 따로 건다.
> ⓒ **보내기는 공용 스케줄러의 일**(`webhook_deliver` — 1분마다) — 때가 된 묶음(`collecting` 이고 `window_end` 가 지났거나 · `pending` 이고
>    `next_attempt_at` 이 지났다)을 `FOR UPDATE SKIP LOCKED` 로 잡아 **`pending` 으로 바꾸고** 임대를 걸어 커밋한 뒤 **트랜잭션 밖에서** 보낸다
>    (바깥 요청이 행 잠금을 쥐지 않게). 잡는 순간 `collecting` 을 떠나므로 보내는 동안 생긴 이벤트는 새 묶음으로 간다 — 이미 만든 본문에 끼어
>    보내지 않은 채 `sent` 가 되는 일이 없다. 결과는 다시 트랜잭션으로 적는다. 워커가 보내다 죽으면 임대가 지나 다시 보낸다 — **적어도 한 번**이고, 받는 쪽은 배달 id 로
>    겹친 것을 거른다.
> ⓓ **보내기 직전에 다시 본다** — 걸린 페이지가 살아 있지 않거나(휴지통 — ⑧) 웹훅이 멈췄으면 보내지 않고 `dropped`. 묶음의 이벤트 중 이미
>    지워진 것(보관 기간)은 빼고, 남은 것이 없으면 `dropped`.
> ⓔ **실패** — 1 · 2 · 4분 뒤 다시(`pending`), 네 번째도 실패면 `failed` 로 끝내고 웹훅을 멈춘다(`failures` — ⑦). 멈춘 웹훅은 새 이벤트를
>    받지 않는다(ⓐ 가 켜진 웹훅만 고른다).
> ⓕ **본문** — `text` 는 걸린 페이지의 제목(링크) · 행위자 이름 · 종류별 수(예: *"‘회의록’ — 홍길동 · 김철수: 편집 3 · 코멘트 1"*). 아래 페이지가
>    섞였으면 그 수를 말한다. `notion_clone` 은 `{ version: 1, delivery_id, page: { id, url }, events: [{ id, type, page_id, actor_id, at }],
>    event_count }` — 이벤트는 앞의 100개만 싣고 전체 수를 `event_count` 로. 링크는 `NEXT_PUBLIC_APP_URL` 로 만든다.
> ⓖ **끝난 묶음은 7일 뒤 지운다**(`data_retention` — [보강] 데이터 수명의 규칙 *"쌓이기만 하는 표에는 보관 규칙"*).
>
> **화면 — 4e-3 에서 정한 것** ⟨마이그레이션 0077 — 색인 하나⟩
>
> ⓗ **Updates 패널 아래의 "웹훅" 칸** — 패널을 열 때 활동과 함께 목록을 읽고, 서버가 거절하면(전체 권한이 없다 · 행이다 — 403 · 400)
>    칸을 그리지 않는다. 화면이 권한을 판정하지 않는다(코멘트 · 공유 패널과 같은 규칙).
> ⓘ **걸기 전에 한 줄로 알린다**(11 *"비공개 페이지 → 공개 채널 — 연결 시 경고 필수"*) — *"이 페이지와 아래 페이지(권한이 같은 곳)의 활동이
>    — 제목 · 사람 이름 · 무엇을 했는지 — 이 주소로 나갑니다."* 거절은 까닭마다 말한다(https 만 · 안쪽 주소 · 사용자 정보 · 포트 · 5개).
> ⓙ **한 줄 = 힌트 · 건 사람 · 상태 · 마지막 배달** — 상태는 켜짐 / 멈춤(직접) / 멈춤(실패가 이어져). 마지막 배달은 끝난 묶음 중 가장 최근 것의
>    상태(보냄 · 실패 · 보내지 않음)와 시각 · HTTP 코드(7일 안 — ⓖ). 원문 URL 은 어디에도 없다. 목록 API 가 `lastDelivery` 를 함께 준다 —
>    색인 `ix_webhook_delivery_webhook (webhook_id, finished_at DESC)`(웹훅을 지울 때의 FK 연쇄도 이 색인을 탄다).
> ⓚ **멈추기 · 다시 켜기 · 지우기** — 지우기는 한 번 더 묻는다(되돌릴 수 없다 — 다시 걸려면 URL 을 다시 넣는다).

**[정정] `activity_event` 의 PK 는 `(id, created_at)` 이다** ⟨코멘트 3조각 / 마이그레이션 0020⟩

> 초판은 `id uuid PRIMARY KEY` 와 `PARTITION BY RANGE (created_at)` 을 함께 적었다.
> **PostgreSQL 에서 그 둘은 같이 설 수 없다.** 실측:
> `unique constraint on partitioned table must include all partitioning columns` (SQLSTATE 0A000).
> 파티션 키를 PK 에 넣는다 — `doc_update` 가 `(page_id, seq)` 인 것과 같은 이유다.
>
> 파티션을 미리 만드는 잡이 아직 없으므로 `DEFAULT` 파티션을 둔다. 없으면 범위를
> 벗어나는 시각이 오는 순간 **쓰기가 통째로 실패한다.**

**[보강] 인앱 인박스에서 3단 필터의 ②는 "읽을 때"다** ⟨코멘트 3조각⟩

> 아래 파이프라인이 ②(권한 재검사)를 팬아웃이 아니라 **배달 시점**에 두라고 한 이유는
> *"이벤트와 배달 사이에 권한이 회수될 수 있고, 알림 본문이 곧 콘텐츠 유출 경로"* 여서다.
> 채널(푸시 · 이메일)이 있을 때는 배달이 별도 시점이지만, **인앱 인박스에는 그 시점이
> 없다** — 알림이 곧 저장이고, 사용자가 보는 순간이 배달이다.
>
> 그래서 ②를 **인박스 조회 쿼리 안**에 둔다 — `perm_scope_id = ANY(readableScopes)`
> (검색 · 사이드바와 같은 규칙, §3.3-32). 권한이 회수되면 이미 만들어진 알림도 사라진다.
> 팬아웃은 **대상자만 고른다**(구독 + 직접 트리거). 그 시점에는 받는 사람의 세션이 없어
> `effective()` 를 부를 수도 없다 — 불변식 A9 가 요구하는 입력이 `user_id` 가 아니다.
>
> ③(활성 뷰어 억제)은 presence(F-05-03)가 없어 **아직 없다.** 순서는 그대로 지킨다 —
> presence 가 생기면 ② 다음에 들어간다.

**[보강] 접근 요청의 알림 — `access_requested` · `access_granted`** ⟨Teamspace · 게스트 · 그룹 7e-1 / 마이그레이션 0033⟩

> 06 F-06-15 의 데이터 모델 함의(*"`notification(type='access_requested'|'access_granted', …)`"*)를 받아 `notification.kind` 에 둘,
> 그것이 가리키는 `activity_event.type` 에 둘(`access.requested` · `access.granted`)을 더했다. payload 는 요청 id 만 담는다.
>
> ① 요청은 §3.3 [보강] 접근 요청 ⑤ 의 관리자들에게 간다 — 대상자 산출(파이프라인 ①)의 "직접 트리거"다. 구독(`subscription`)과
> 무관하다(뮤트한 페이지의 요청도 간다 — 요청은 페이지의 변경이 아니라 그 사람에게 온 일이다). 묶음 열쇠는 `access_request:{page}`
> — 한 페이지에 온 요청 여럿이 한 줄로 접힌다.
>
> ② 허락은 요청한 사람에게 `access_granted:{page}` 로 간다. **무시는 알림이 없다**(§3.3 [보강] 접근 요청 ③).
>
> ③ 인박스의 ②(권한 재검사)는 그대로다 — 페이지를 볼 수 있어야 보인다. 허락 알림은 허락된 뒤라 보이고, 관리자의 알림은 공유할
> 수 있는 사람이라 보인다(공유 권한을 잃어도 볼 수 있으면 남는다 — 처리하려 하면 게이트가 거부한다). 줄에 서는 요청한 사람의
> 이름 · 요청의 지금 상태는 **지금 행**에서 읽는다(N3). 이름은 받는 사람이 멤버 목록을 받을 수 있는 역할일 때만(§3.3 게스트 ⑦).

**배달 파이프라인 (3단 필터, 순서 고정)**
`activity_event` → ① 대상자 산출(`subscription.level` + 직접 트리거) → ② **배달 시점 권한 재검사** → ③ presence 조회로 활성 뷰어 억제 → `notification_delivery` 스케줄.
②를 팬아웃 시점이 아니라 배달 시점에 두는 이유: 이벤트와 배달 사이에 권한이 회수될 수 있고, 알림 본문(멘션 스니펫)이 곧 콘텐츠 유출 경로다.


**[보강] 감사 로그 — 보안 이벤트 11종 · 쌓기만 한다 · 365일** ⟨게시 · 공유 6d-1 · F-11-12 / 마이그레이션 0087⟩

> 11 F-11-12 클론 대안 *"이벤트 타입 100종 대신 보안 관련 10종만(로그인, 권한 변경, 멤버 초대/제거, 페이지 공유 설정 변경, 영구 삭제,
> 내보내기) 정의하고 `audit_event` 한 테이블"* 과 17 의 소급 불가 축(`scope`) · 설정 변경 칸(`setting_key` · `value_before/after`)을
> 함께 들인다. 정본은 `audit_event` 를 이름만 두었다(V-8 이 17 로 이관) — 여기서 칸을 정한다.
>
> ```sql
> CREATE TABLE audit_event (
>   id uuid PRIMARY KEY,
>   scope text NOT NULL CHECK (scope IN ('account','workspace','teamspace','organization')),   -- 17: 1일차 축(소급 불가)
>   workspace_id uuid NULL REFERENCES workspace(id),
>   event_type text NOT NULL CHECK (event_type IN (
>     'account.login','account.security_changed',
>     'workspace.member_invited','workspace.member_joined','workspace.member_removed','workspace.member_role_changed',
>     'workspace.setting_changed','workspace.exported',
>     'page.permission_changed','page.publish_changed','page.permanently_deleted')),
>   actor_user_id uuid NULL,                  -- FK 없음 — 사람이 지워져도 남는다(11 *"actor 계정 삭제 → 이벤트는 유지"*)
>   actor_name text NULL, actor_email text NULL,   -- 그때의 이름 · 메일(비정규화 — 11 *"표시용 이름/이메일은 이벤트에 비정규화 저장"*)
>   target_type text NULL CHECK (target_type IN ('page','user','invite','setting','workspace')),
>   target_id text NULL,                      -- uuid 또는 설정 키
>   ip inet NULL,                             -- 그 세션이 열린 곳(있을 때)
>   metadata jsonb NOT NULL DEFAULT '{}',     -- 무엇이 어떻게 — 내용(제목 · 본문 · 코멘트)은 싣지 않는다
>   setting_key text NULL, value_before jsonb NULL, value_after jsonb NULL,
>   occurred_at timestamptz NOT NULL DEFAULT now(),
>   CHECK ((scope = 'account') = (workspace_id IS NULL)),
>   CHECK ((event_type = 'workspace.setting_changed') = (setting_key IS NOT NULL))
> );
> -- 고치기를 트리거가 막는다 · 지우기는 365일이 지난 행만(보관 기간 — 11 *"보관: 최대 365일"*)
> ```
>
> ① **11종** — `account.login`(로그인 성공) · `account.security_changed`(비밀번호 · 2단계 인증의 설정 · 해제 · 백업 코드) ·
> `workspace.member_invited`(이메일 초대 · 게스트 초대) · `workspace.member_joined`(초대 수락) · `workspace.member_removed`(게스트 빼기) ·
> `workspace.member_role_changed`(게스트 → 멤버) · `workspace.setting_changed`(설정 레지스트리의 모든 칸 — 그때의 값과 바뀐 값) ·
> `workspace.exported`(내보내기) · `page.permission_changed`(주기 · 회수 · 상속 끊기 · 잇기) · `page.publish_changed`(게시 · 해제 · 검색
> 노출 · 주소 바꾸기) · `page.permanently_deleted`(사람이 휴지통에서 영구 삭제 — GC 의 일괄 삭제는 넣지 않는다: 사람의 행위가 아니다).
> 구성원의 제거 · 역할 변경은 지금 게스트 경로뿐이다.
>
> ② **명령과 같은 트랜잭션에서 쌓는다** — 명령이 되돌려지면 기록도 없다(거부된 명령은 기록되지 않는다). 내보내기처럼 읽기만 하는
> 명령은 성공한 뒤 따로 쌓는다.
>
> ③ **내용을 싣지 않는다** — 11 *"페이지 본문/코멘트 원문을 절대 metadata 에 넣지 않는다"*. 페이지는 id 로만, 설정은 키와 값으로(설정
> 값은 내용이 아니다), 초대는 받는 메일 주소(누구를 들였는가가 감사의 목적이다).
>
> ④ **보관은 365일** — 데이터 수명 잡(§3.8 [보강] 데이터 수명 · `data_retention`)이 지난 행을 지운다. 그 밖의 지우기 · 고치기는 DB 가
> 거부한다. 블록 · 사람이 파기돼도 감사 행은 남는다(FK 가 없다).
>
> ⑤ **누가 보는가** — 워크스페이스 범위는 그 워크스페이스의 owner(요금제 게이트는 화면과 함께 — 6d-2). 계정 범위는 그 사람 자신.
> 조회하는 함수는 세션을 받는다(일반 판정 — 운영자 경로가 아니다).
>
> ⑥ **[6d-2] 화면 · 요금제 · CSV** — 설정 → 워크스페이스 → **감사 로그**(owner 의 절). 읽기는 **Enterprise 만**(엔타이틀먼트 `audit.log` ·
> 11 *"Settings → Audit log 진입(Enterprise 플랜만)"*) — 다른 요금제는 그렇다고만 말한다(`plan_required` — 권한 거부와 코드가 다르다).
> **쌓는 것은 요금제와 무관하다** — 올리면 지난 365일이 보인다(보안 기록은 요금제를 바꾼 순간부터가 아니라 그 전부터 필요하다). 최근
> 것부터 50줄 · 종류로 거르기 · 앞으로 넘기기. **CSV** 는 지금 고른 종류로, 화면과 같은 문구로(`audit-labels.ts`) · 모든 칸에 수식 막기
> (이름 · 메일 · 설정 값은 남이 쓴 글자다) · 빈 결과도 머리 줄만 있는 파일(11 *"빈 CSV 도 생성해 내보내기 실패와 구분"*) · 한 번에
> 10,000줄(넘으면 머리 `x-audit-truncated`). 감사 로그를 읽은 것 자체를 쌓지는 않는다(§7).

**[보강] 담당 알림 — 사람 칸에 새로 든 사람에게** ⟨게시 · 공유 6h · F-11-08 / 마이그레이션 0092⟩

> 11 F-11-08 *"데이터베이스 Person property 에 내가 추가됨 → 추가된 사용자 · 개별 사용자가 이 알림을 끌 수 없다"*. 알림 종류
> `person_property_assigned` 는 초판(0020)에 있고, 이것을 만드는 길이 없었다([보강] 사람 속성 ⑧).
>
> ① **누가 받는가** — 사람 칸을 쓰는 두 문(`createRowIn` · `updateCellsIn` — [보강] 사람 속성 ②)에서 **새로 든 사람**(쓴 뒤의 집합 −
> 쓰기 전의 집합). 쓴 사람 자신 · 이미 들어 있던 사람 · 뺀 사람은 받지 않는다. 템플릿 행(R1 — 항목이 아니다)은 만들지 않는다 — 템플릿으로
> 만든 행에 든 사람은 받는다(그 행이 생긴 순간 든 것이다). 칸 비우기는 알림이 없다.
>
> ② **활동 · 알림** — 활동 이벤트 `person.assigned`(payload 는 `property_id` 하나 — 받는 사람은 알림 행이 안다 · N3). 셀 편집 자체는
> `property.updated` 가 이미 남기므로 이 종류는 Updates 패널 · 페이지 웹훅의 허용 목록에 넣지 않는다(알림의 근거일 뿐이다). 알림은 받는
> 사람마다 한 행(N2) · `group_key` 는 `assign:{행}:{속성}` — 같은 칸에 다시 들면 조회 때 접힌다.
>
> ③ **끌 수 없다** — 페이지 구독의 뮤트(`none`)를 따르지 않는다(11 *"개별 사용자가 이 알림을 끌 수 없다"* · 접근 요청의 알림 ①과 같다 —
> 그 사람에게 온 일이다). 속성 단위 스위치(11 의 `person_property_setting.notify_on_assign`)는 뒤로 — 지금은 늘 켜져 있다.
>
> ④ **배달 시점 권한** — 인박스가 읽을 때 그 행을 볼 수 있는지 본다([보강] 인앱 인박스 ②) — 스코프 또는 행 단위 접근 규칙(그 절 ⑤ 의
> 예외 — 인박스는 규칙이 연 행도 본다). 칸에 들었어도 그 행을 못 보면 보이지 않고, 볼 수 있게 되면(사람 규칙 — 같은 절 ③ 이 그 사람에게
> 행을 열면 곧바로) 보인다. 11 *"수신자에게 페이지 권한 없음 →
> 알림 생성 차단"* 의 우리 쪽 답이다 — 만들 때는 받는 사람의 세션이 없어 판정할 수 없다.
>
> ⑤ **인박스 줄** — *"'담당'에 회원님을 추가했습니다."* — 속성의 **지금** 이름(리마인더 ⑨ ⓓ 와 같다 — 복제하지 않는다). 속성이
> 없어졌으면 *"사람 속성에 회원님을 추가했습니다."*. 종류 이름은 "담당".
>
> ⑥ N4 — 사람 칸은 사람만 쓴다(자동화 · 버튼은 사람 칸을 쓰지 못한다 — [보강] 사람 속성 ⑤). 그 문을 열면 이 절의 ① 을 함께 정한다.

---

### 3.9 코멘트 · 검색 ⟨U-6 · X-8⟩

```sql
CREATE TABLE discussion (                      -- 코멘트는 CRDT 에 넣지 않는다(관계형)
  id uuid PRIMARY KEY,
  parent_block_id uuid NOT NULL,               -- 페이지 코멘트면 page block, 인라인이면 대상 block
                                               -- [보강] FK 를 걸지 않는다(본문 블록 행은 Y.Doc 의 투영이다)
  page_id uuid NOT NULL REFERENCES block(id),  -- [보강] 권한 · 알림 라우팅의 축. 아래 참조
  workspace_id uuid NOT NULL,
  anchor jsonb NULL,                           -- RelativePosition 범위 + quoted_text 폴백
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid NULL, resolved_at timestamptz NULL,
  created_by uuid NOT NULL,                    -- [보강] 수정·삭제 권한의 근거(아래)
  created_at timestamptz NOT NULL
);
CREATE INDEX ON discussion (parent_block_id, resolved, created_at);
CREATE INDEX ON discussion (page_id, resolved, created_at);   -- [보강] 페이지의 스레드 목록
-- comments uuid[] 컬럼은 두지 않는다. 순서는 comment.created_at 이 준다(C-10 의 배열 폐기 원칙 승계).

CREATE TABLE comment (
  id uuid PRIMARY KEY,
  discussion_id uuid NOT NULL REFERENCES discussion(id) ON DELETE CASCADE,
  created_by uuid NOT NULL, rich_text jsonb NOT NULL,
  created_at timestamptz NOT NULL, last_edited_at timestamptz NULL,
  deleted_at timestamptz NULL
);
CREATE INDEX ON comment (discussion_id, created_at);

CREATE TABLE reaction (
  target_kind text NOT NULL CHECK (target_kind IN ('comment','discussion')),
  target_id uuid NOT NULL, user_id uuid NOT NULL, emoji text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (target_kind, target_id, user_id, emoji)
);

CREATE TABLE search_document (                 -- 검색 인덱스 정본. 09/12 의 search_index 는 없다
  doc_id uuid PRIMARY KEY,                     -- = block.id (색인 단위는 block)
  workspace_id uuid NOT NULL,                  -- 샤드 라우팅 키(구 routing/space_id) [X-8]
  region_id text NOT NULL REFERENCES region(id),                        -- <17 F-17-06> 소급 불가
  page_id uuid NOT NULL, parent_id uuid NULL, type text NOT NULL,
  ancestor_ids uuid[] NOT NULL, ancestor_titles text[],
  title_text text, body_text text, lang text,
  perm_scope_id uuid NOT NULL,                 -- ★ principals[] 폐기. 유일한 권한 축 [X-8]
  is_public boolean NOT NULL DEFAULT false,
  origin origin_kind NOT NULL DEFAULT 'native',                         -- <15 R12>
  created_by uuid, created_at timestamptz,
  last_edited_by uuid, last_edited_at timestamptz,
  content_status text, in_trash boolean NOT NULL DEFAULT false,
  version bigint NOT NULL                      -- = block.version (external version) [X-6]
);
CREATE INDEX ON search_document (workspace_id, perm_scope_id);
-- [정정] 아래 한 줄은 PostgreSQL 에서 실행되지 않는다. 대체 형태는 이 블록 다음 참조.
-- CREATE INDEX ON search_document USING gin (to_tsvector(lang, coalesce(title_text,'') || ' ' || coalesce(body_text,'')));
tsv tsvector GENERATED ALWAYS AS (                   -- [정정] 컬럼으로 바뀐다
  setweight(to_tsvector('simple', coalesce(left(title_text, 10000), '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(left(body_text, 100000), '')), 'B')) STORED;
CREATE INDEX ON search_document USING gin (tsv);
CREATE INDEX ON search_document USING gin (title_text gin_bigm_ops);  -- [정정] CJK 축
CREATE INDEX ON search_document USING gin (body_text  gin_bigm_ops);
```

**[보강] `discussion` 의 축 — `page_id` · `created_by` 추가, `parent_block_id` 에 FK 없음** ⟨코멘트 1조각 / 마이그레이션 0018⟩

> 초판의 `discussion` 은 `workspace_id` 와 `parent_block_id` 만 갖는다. 그 둘로는
> **코멘트를 볼 수 있는지 물을 수 없다.** 이 문서가 정한 권한의 축은 페이지이고
> (§3.3 A9 · `effective()`), 알림 라우팅의 축도 페이지다(§3.8 `activity_event.page_id`
> — *"알림 라우팅의 기준 축"*).
>
> `parent_block_id` 로 페이지를 거슬러 갈 수 없다. 본문 블록의 행은 **Y.Doc 의
> 투영**이기 때문이다(판결 X-1):
>
> 1. 투영은 늦다. 참여자가 방금 친 블록의 행은 아직 없을 수 있다(투영 디바운스 창).
> 2. 투영은 지운다. 다른 참여자가 그 블록을 지우면 행이 사라진다(프로젝터의 hard delete).
>
> 그래서 ① `page_id`(페이지 블록 FK)를 추가하고 ② `parent_block_id` 에는 **FK 를 걸지
> 않는다.** FK 를 걸면 셋 중 하나가 된다 — 남이 문단을 지울 때 스레드가 조용히
> 사라지거나(CASCADE), 코멘트가 달린 문단을 아무도 못 지우거나(RESTRICT), 아직
> 투영되지 않은 블록에 코멘트를 못 달거나(삽입 검사). 05 F-05-07 의 엣지 케이스는
> 첫째를 명시적으로 부정한다: *"앵커 텍스트가 전부 삭제됨 → 스레드는 생존.
> '원본 없음(orphaned)' 표시 후 페이지 코멘트로 강등."*
>
> **대상 블록이 있는지는 행이 아니라 Y.Doc 에 묻는다.** 본문의 정본이 Y.Doc 이므로
> 그것이 유일하게 맞는 질문이다. 고아 판정도 읽을 때 같은 곳에 묻는다.
>
> `created_by` 는 초판에 없다. `comment.created_by` 는 있는데 스레드에는 없어서,
> "이 스레드를 누가 열었는가"를 첫 코멘트로 유추하게 된다 — 그 코멘트는 지워질 수
> 있다(아래 D3). 수정·삭제 권한의 근거이므로 행에 적는다.
>
> 승격한 불변식 셋(마이그레이션 0018, `verify-schema.mjs` 가 거부를 확인한다):
> **D1** `resolved`·`resolved_by`·`resolved_at` 은 함께 움직인다. **D2** 살아 있는
> 코멘트는 비어 있지 않다(05 F-05-08: *"빈 코멘트 제출 → 거부"*). **D3** 지운 코멘트는
> `rich_text` 를 비운다 — 행은 남겨 *"삭제된 코멘트"* 자리를 지키되 내용은 남기지
> 않는다. 읽기에서 거르는 것만으로는 부족하다(익스포트 · 색인 · 알림 본문이 같은
> 표를 읽는다).

**[보강] 반응 화면** ⟨인접 제품 7c-3d-1 · F-05-08 / 마이그레이션 없음⟩

> 반응의 명령(`toggleReaction` — PK 가 곧 2P-Set · 같은 이모지를 다시 누르면 없앤다)은 코멘트 1조각부터 있었으나 화면이 없었다.
>
> ① **코멘트마다 칩** — 이모지 · 누른 사람 수 · 내가 눌렀는가(`aria-pressed`) · 누른 사람의 이름(`title` — 나는 "나", 먼저 누른 순). 칩을
> 누르면 그 이모지를 토글한다. 지운 코멘트에는 칩도 단추도 없다(명령이 거부한다 — D3 의 뒷면).
> ② **고르개는 빠른 여덟** — 👍 ❤️ 😄 🎉 😮 😢 👀 ✅. 노션의 반응 고르개도 자주 쓰는 것을 먼저 보인다. 전체 이모지 · 커스텀 이모지는
> 다음 조각이었고, 커스텀 이모지는 그 아래 줄로 들어왔다(7c-3d-2 · §3.4 [보강] 커스텀 이모지 ⑩). 전체 유니코드 이모지 찾기는 아직 없다.
> ③ **누가** — 코멘트를 쓸 수 있는 사람(`comment` — 명령의 판정)만 누른다. 볼 수만 있는 사람에게도 칩은 보이되 누를 수 없다(판정은
> 서버가 준 `canComment` 하나로 — 패널의 규칙).
> ④ 스레드 자체의 반응(`target_kind='discussion'`)은 화면에 세우지 않는다 — 노션의 반응은 코멘트에 붙는다. 명령 · 읽기는 그대로 둔다.

**[정정] GIN 인덱스 식 → 고정 regconfig 의 GENERATED 컬럼 + pg_bigm 2축** ⟨W7 / 마이그레이션 0012⟩

> 초판의 `USING gin (to_tsvector(lang, …))` 는 **PostgreSQL 16 에서 생성 자체가
> 거부된다.** 구현 시점(W7)에 실측하고 여기를 먼저 고쳤다. 이유 셋:
>
> 1. **`to_tsvector(text, text)` 가 존재하지 않는다.** 2인자 형태는
>    `to_tsvector(regconfig, text)` 뿐이다 → `function to_tsvector(text, text) does not exist`.
> 2. **`lang::regconfig` 로 캐스팅해도 막힌다.** regconfig 를 런타임에 고르는 호출은
>    STABLE 이고 인덱스 식은 IMMUTABLE 을 요구한다 →
>    `functions in index expression must be marked IMMUTABLE`.
>    즉 **"문서마다 다른 analyzer" 를 인덱스 식으로 표현하는 것이 Postgres 에서 불가능하다.**
>    F-07-06 의 per-language analyzer 는 Elasticsearch 의 기능이고, v0 물리 구현이
>    Postgres 인 이상 그대로 이식되지 않는다.
> 3. **한국어 text search config 가 없다.** `pg_ts_config` 에 28개가 있고 CJK 는 0개다.
>    `simple` 은 공백 분리 + 소문자화뿐이라 조사가 붙은 어절이 다른 토큰이 된다. 실측:
>    `to_tsvector('simple','검색이 빠르다') @@ websearch_to_tsquery('simple','검색')` → **false**.
>    같은 입력에 `LIKE likequery('검색')` → **true**.
>
> 그래서 **축이 둘이다**: 라틴 쿼리는 `tsv`(랭킹·구문 검색·불리언이 `ts_rank_cd` ·
> `websearch_to_tsquery` 로 공짜), CJK 쿼리는 `gin_bigm_ops`. 분기는 **쿼리 쪽**
> 스크립트로 한다. `lang` 컬럼은 남기고 값도 채우지만(F-07-06 의 "언어 감지 결과")
> 인덱스 식에는 쓰지 않는다.
>
> `left()` 가 붙은 이유는 **tsvector 의 1MB 한도**다. 본문 상한이 1MB 인데(F-12-16)
> 그 크기를 `to_tsvector` 에 넣으면 던지고, GENERATED 컬럼이면 그 예외가 **저장을
> 통째로 거부한다.** 상한은 전부 고유한 한글 토큰으로 실측해 정했다:
> 10만 자 → 한도의 42.9%, 20만 자 → 85.8%, 26만 자 → **112.5%(던진다)**.
> `body_text` **자체는 자르지 않는다** — pg_bigm 축에는 한도가 없으므로 한국어
> 검색은 본문 전체를 본다.

**[범위] Phase 0 의 행은 `type='page'` 블록뿐이다** ⟨W7 / 마이그레이션 0012⟩

> 색인 단위가 block 이라는 위 정의(`doc_id = block.id`)와 스키마는 그대로 두되,
> Phase 0 에서 **행을 만드는 블록은 페이지뿐이다.** `title_text` = 페이지 제목,
> `body_text` = 그 페이지 문서 범위의 본문 전체. 마이그레이션 0012 가 이것을
> `CHECK (type = 'page' AND page_id = doc_id)` 로 승격했으므로, **블록 단위 색인으로
> 확장할 때는 그 CHECK 을 떼는 마이그레이션이 변경의 일부가 된다** — 조용히 의미가
> 달라지지 않게 하려는 것이다. 근거 셋:
>
> · Phase 0 의 저장 단위가 페이지다(§5.1 페이지 단위 LWW). 색인도 같은 단위면 갱신이
>   저장과 같은 트랜잭션의 **1행 upsert** 로 끝난다. 블록 단위면 페이지 저장마다 N행을
>   지우고 다시 넣는다.
> · F-07-02 가 요구한 `setweight(title,'A') || setweight(body,'B')` 가 한 행 안에서
>   성립한다. 본문 블록 행에는 제목이 없어 가중치 분리가 안 된다.
> · F-07-02 의 "동일 페이지의 여러 블록 매칭 → 페이지 단위 접기(dedup 필수)"가
>   **애초에 필요 없어진다.** 1페이지 = 1행이다.
>
> 쓰기자도 나뉘었다 — 텍스트(`title_text`·`body_text`·`lang`)는 앱이 쓰고, 메타
> (`perm_scope_id`·`in_trash`·`ancestor_ids`·`version`·감사)는 `block` 의 트리거가
> 따라간다. 그것이 F-07-06 이 요구한 *"본문 재색인 없이 메타만 partial update 하는
> 경로"* 다. **권한 축을 앱이 복사하게 두면 갱신 누락이 권한 누출이 된다** — 실패
> 방향을 고를 수 있을 때 "검색 결과가 낡는다" 쪽을 골랐다.

**검색 쿼리 형태 (권한이 필터 절 안에 있어야 페이지네이션이 깨지지 않는다)**

```sql
scopes = scopes:{user_id}:{acl_epoch}          -- 캐시 미스 시 재계산
SELECT ... FROM search_document
WHERE workspace_id = :ws AND perm_scope_id = ANY(:scopes)
  AND NOT in_trash AND <query terms>
ORDER BY score LIMIT 25;
```

- **v0 물리 구현은 Postgres**(실테이블 + tsvector + GIN). ES/Meilisearch + CDC 는 v2. 스키마는 그대로 이식된다.
- 인덱싱 트리거는 `doc_update` outbox + `page_property_value` outbox 둘 다다. [X-6]
- 임베딩(`vector_span`)은 **별개 파이프라인**(AI 클러스터 소유). 같은 테이블에 섞지 않는다.
- `visible=false` 프로퍼티도 색인에서 제외하지 않는다 — 표시 규칙이지 접근 제어가 아니다. <16 R12>

**[보강] 쿼리 문법 — 두 축이 같은 뜻으로 읽는다** ⟨잔여 묶음 8l-1 / 마이그레이션 없음⟩

> 07 F-07-02 *"따옴표 구문 검색 — 공식 지원 확인됨 … 쿼리 파서에 phrase 연산자가 필수다 … 불리언 `OR` / `-`(제외) — 비용이 0"*.
>
> ① **문법은 하나다** — 공백으로 나뉜 말은 모두 있어야 한다(AND · 순서 · 거리는 묻지 않는다) · `"…"` 는 구절(붙어서 · 닫지 않으면 끝까지) ·
> `OR`(대문자)는 바로 앞뒤의 말을 대안으로 · `-말` · `-"구절"` 은 제외. 연산자만 남은 조각은 버린다. 소문자 `or` 는 말이다.
> ② **라틴 축은 `websearch_to_tsquery` 가 그대로 안다. CJK 축(pg_bigm · LIKE)은 파서(`search/query.ts`)가 푼 절마다 LIKE 를 건다** — 찾는
> 말은 맨 컬럼에(bigm GIN 이 쓰인다), 제외는 `coalesce` 로 NULL 을 다룬다(본문이 없는 문서가 제외 때문에 사라지지 않게). W7 은 CJK 쿼리
> 전체를 부분 문자열 하나로 찾았다 — 떨어진 두 말을 찾지 못했다.
> ③ **찾는 말이 하나도 없는 쿼리**(제외만 · 연산자만)는 질의하지 않는다(`query_too_short` — 빈 상태와 같다).
> ④ **제목이 걸렸다 = 모든 절이 제목에 있다**(정렬의 1차 축 · W7). 스니펫은 쿼리의 첫 말 주변이다(쿼리 전체로 찾으면 여러 말의 쿼리는 늘
> 본문 앞부분으로 떨어졌다).
> ⑤ 화면의 강조도 같은 파서다 — 구절은 구절째, 제외의 말은 칠하지 않는다.

**[보강] 랭킹 · 정렬 — 가장 잘 맞는 순의 단계 · 정렬 다섯** ⟨잔여 묶음 8l-2 / 마이그레이션 없음⟩

> 07 F-07-02 *"정렬 옵션(공식 명시, verbatim): `Best Matches`(기본), `Last Edited: Newest First`, … `Created: Oldest First` … Best Matches
> (default, with recently edited pages ranked higher) … 클론 대안: 개인화는 최근 30일 내 본인이 방문한 페이지에 고정 보너스 점수"*.
>
> ① **정렬은 다섯이다** — 가장 잘 맞는 순(기본) · 편집 최신 · 편집 오래된 · 만든 때 최신 · 만든 때 오래된. 모르는 값은 기본(400 을 내지 않는다).
> ② **가장 잘 맞는 순은 사전식 단계다** — 제목이 쿼리와 **정확히** 같다(대안 · 제외가 없는 쿼리의 말을 공백으로 이은 것과 · 대소문자 무시) >
> 모든 절이 제목에 > 본문만 → 같은 단계 안에서 **내가 30일 안에 연 페이지** → 최근 편집. `ts_rank` 류의 점수는 쓰지 않는다(W7 의 이유 그대로
> — CJK 축에 대응물이 없어 두 축이 다른 규칙이 된다). 방문은 단계를 넘지 않는다(본문만 걸린 페이지가 방문했다고 제목이 걸린 페이지를
> 앞서지 않는다) · 남의 방문은 세지 않는다.
> ③ 나머지 넷은 시각만 본다 — 단계를 보지 않는다. 만든 때가 없으면 편집 시각, 둘 다 없으면 바닥값.
> ④ **커서는 정렬마다 키의 모양이 다르다** — 키 앞에 정렬 이름을 붙여 보내고, 다른 정렬의 커서가 오면 처음부터 읽는다. 오름차순은 비교 방향이
> 뒤집힌다(keyset 그대로).

**[추가] 내비게이션 상태 — 최근 방문 · 즐겨찾기 ⟨07 F-07-04 · F-07-16⟩**

> 이 두 표는 이 문서의 초판에 없었다. 07 문서가 `recent_visit(user_id, block_id, space_id,
> last_visited_at, visit_count)` 를 "데이터 모델 함의"로 제시하는데 정본에 자리가 없어서,
> 구현 시점(W6-a)에 여기에 추가한다. 즐겨찾기는 07 F-07-16 이 "사용자별 개인 목록"이라고만
> 적었고 스키마 제안이 없어 같은 모양으로 정한다.

```sql
CREATE TABLE recent_visit (
  user_id uuid NOT NULL, workspace_id uuid NOT NULL,
  block_id uuid NOT NULL,                      -- type='page' 인 블록
  last_visited_at timestamptz NOT NULL, visit_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, block_id)
);
CREATE INDEX ON recent_visit (user_id, workspace_id, last_visited_at DESC);

CREATE TABLE favorite (
  user_id uuid NOT NULL, workspace_id uuid NOT NULL,
  block_id uuid NOT NULL, order_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, block_id)
);
CREATE INDEX ON favorite (user_id, workspace_id, order_key);
```

- **권한의 저장 지점이 아니다(C-7 과 충돌하지 않는다).** 여기 행이 있다고 접근이 생기지 않는다.
  조회할 때마다 `effective()` 로 다시 거른다 — 07 F-07-04 엣지 케이스: *"최근 방문한 페이지의
  권한이 회수됨 → 목록에서 즉시 제거(권한 필터를 **조회 시점에** 재적용)."*
- **제목을 복사해 두지 않는다.** 같은 엣지 케이스 표: *"페이지 제목 변경 → 목록은 현재 제목을
  보여줘야 함 → 제목을 복사 저장하지 말고 조인."*
- `visit_count` 는 재방문 시 upsert 로 올린다. 같은 페이지를 오갈 때마다 행이 늘면 목록이 한
  페이지로 가득 찬다.
- 보관 상한(사용자당 200건)은 GC 의 몫이고 스키마 제약이 아니다 `[추정]`.
- **[보강 10n-57] 즐겨찾기 순서 바꾸기** — 07 F-07-16 *"사용자가 순서를 바꿀 수 있다"*. 명령은 "이 즐겨찾기를 `before` 앞에"(null 이면 맨
  뒤 — 뷰 탭 순서와 같은 모양)이고 이웃 사이의 키를 새로 낸다(`order_key` — 이진 순서 · 다른 행을 다시 쓰지 않는다). **자기 즐겨찾기만** —
  이 워크스페이스에서 이 사람의 행이 아니면 `not_found`(옮길 것도 `before` 도). 볼 수 없게 된 행도 차례에는 남는다(목록이 거를 뿐 — 다시
  보이면 제자리로 돌아온다). 그 사람의 즐겨찾기 행을 잠근 뒤 이웃을 읽는다(두 탭에서 같은 자리로 옮겨도 키가 겹치지 않는다) · 이미 그
  자리면 쓰지 않는다. 화면은 사이드바의 즐겨찾기 줄을 끌어 놓고, 끌 수 없는 손을 위해 키보드(Alt+↑ · Alt+↓)로도 옮긴다.

**[추가] `link_edge` — 멘션의 역인덱스 · 백링크의 원천 ⟨07 F-07-08 · F-07-09 · 05 F-05-09 / 마이그레이션 0021⟩**

> 초판에는 이 표가 없다. 05 F-05-09 가 `mention_index(source_type, source_id, page_id,
> mentioned_type, mentioned_id, created_at)` 를, 07 F-07-09 가 `link_edge(source_block_id,
> source_page_id, target_page_id, link_type, created_at)` 를 각각 "데이터 모델 함의"로 제시했다.
> 같은 것이다 — 본문의 멘션 노드를 거꾸로 찾는 파생 표. 07 의 이름을 쓰고 05 의 다형 대상을 받는다.

```sql
CREATE TABLE link_edge (
  source_page_id  uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  source_block_id uuid NOT NULL,               -- 본문 블록. FK 없음 — 그 행은 Y.Doc 의 투영이다 [X-1]
  target_kind     text NOT NULL CHECK (target_kind IN ('page','user')),
  target_id       uuid NOT NULL,               -- 다형. FK 없음 — 지워진 대상은 조회가 거른다
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (source_block_id, target_kind, target_id)
);
CREATE INDEX ON link_edge (target_kind, target_id, source_page_id);   -- 백링크 · "누가 나를 멘션했나"
CREATE INDEX ON link_edge (source_page_id);                           -- 투영이 페이지 단위로 갈아 끼운다
```

- **불변식 L1 — 이 표는 프로젝터만 쓴다.** 마스터 문서 §5.2 는 *"에디터가 `mention` 인라인 노드를
  만들 때 역인덱스를 함께 기록한다"* 고 적었지만, 이 문서의 판결 X-1 이 이긴다: 본문의 정본은
  Y.Doc 이고 행은 그 투영이다. 에디터가 따로 기록하면 진실이 둘이 된다 — 동시 편집으로 멘션이
  지워졌는데 행이 남거나, 오프라인에서 넣은 멘션의 행이 없다. **Y.Doc 에 넣은 멘션이 투영될 때**
  이 표가 갱신된다(`block` 행 · `search_document` 와 같은 시점, 같은 트랜잭션).
- **불변식 L2 — 트리는 여기 없다.** 하위 페이지 참조(`page_ref` 노드)는 `block.parent_id` 가 정본이고
  이 표에 들어가지 않는다. 07 F-07-09 가 경고한 순환(`link_type='child'` 를 섞으면 breadcrumb ·
  `ancestor_ids` 가 무한 루프)은 그래서 생기지 않는다 — 이 표의 그래프는 순환해도 된다.
- **불변식 L3 — 멘션 하나가 알림 하나가 아니다.** 투영 한 번에 **새로 생긴** (페이지, 사람) 당 알림
  하나다(05 F-05-09: *"한 문단에 같은 사람 5번 멘션 → 알림 1건"*). 이미 있던 edge 는 다시 알리지
  않는다. 그래서 투영은 페이지의 edge 를 통째로 갈아 끼우지 않고 **차분**(넣을 것 · 지울 것)을 쓴다.
- 멘션 노드는 **표시 텍스트를 저장하지 않는다**(07 F-07-08 · 05 F-05-09 *"page_id 만 저장하고 렌더 시
  조인"*). 이름 · 제목은 그릴 때 권한으로 거른 맵에서 온다 — 하위 페이지 참조의 제목과 같은 규칙(§3.2-22).

**[보강] 검색 필터 — 색인에 이미 있는 칸으로 좁힌다** ⟨플랫폼 잔여 10a-1조각 · F-07-03 / 마이그레이션 없음⟩

> 07 F-07-03 *"검색 결과를 메타데이터 조건으로 좁힌다"* · 클론 대안 *"v0 는 `Title only` 토글 + `Created by`(본인/전체) + `Date`(전체/1주/1개월/
> 1년) · `In` 필터는 현재 페이지 하위에서 검색"*. 필요한 칸은 모두 `search_document` 에 있다(`created_by` · `created_at` · `last_edited_at` ·
> `ancestor_ids`) — 칸을 더하지 않는다.
>
> ① **넷** — `titleOnly`(제목에서만 찾는다 — 라틴 축은 제목의 tsvector, CJK 축은 제목 LIKE · 빼는 말은 그대로) · `createdBy: 'me'`(내가 만든 —
> 다른 사람 고르기는 사람 고르개와 함께 다음) · `edited`(최근 편집 — `day` 1일 · `week` 7일 · `month` 30일 · `year` 365일 · 편집 시각이 없으면 만든
> 시각) · `within`(이 페이지 아래 — `ancestor_ids` 에 그 페이지가 있다 · 그 페이지 자신은 빼다). 틀린 값은 버린다(필터 없음 — 400 을 내지 않는다 ·
> 정렬과 같은 태도)
>
> ② **권한은 그대로 `WHERE` 의 스코프** — 필터는 그 위에 더하는 술어다(후처리가 아니다 · F-07-07). `within` 의 페이지를 볼 수 없으면 그 아래의
> 볼 수 있는 페이지만 나온다(그 페이지의 존재는 알리지 않는다 — 결과에 그 페이지가 없다)
>
> ③ **필터만 있고 검색어가 없으면 유효한 질의다**(07 엣지 *"match_all + filter"* — "지난주 내가 만든 모든 페이지"). 검색어가 짧으면(1자 이상 ·
> 최소 미만) 여전히 `query_too_short` — 빈 검색어만 필터로 찾는다. 필터도 없으면 지금처럼 최근 방문(빈 상태)
>
> ④ 팀스페이스 필터(요금제 게이트 · 07 *"Plus/Business/Enterprise"*) · 최종 편집자 · 사람 고르기는 다음. 덮개의 칩(제목만 · 내가 만든 · 기간 ·
> 이 페이지 안에서)과 주소 직렬화는 10a-2
>
> ⑤ **[10a-2] 덮개의 칩** — 입력 아래에 늘 선다(검색어를 치기 전에도 고른다): 제목만 · 내가 만든 · 편집 기간(언제든 · 오늘 · 7일 · 30일 · 1년) ·
> 이 페이지 안에서(페이지 화면에서 열었을 때만 — **지금 페이지일 때만 효과가 있다**: 다른 페이지로 옮겨 가면 저절로 풀린다). 좁히는 필터가 있으면
> 입력이 비어도 결과를 보인다(③). 0건이면 필터가 걸려 있다고 말하고 "필터 풀기". 필터는 정렬처럼 덮개를 닫았다 열어도 기억한다(같은 세션 동안).
> **주소에 싣지 않는다** — 덮개는 모달이고 정렬도 싣지 않는다(07 의 *"필터를 URL 에 직렬화"* 는 검색이 화면일 때의 말이다 · 서버에 주는
> 쿼리는 같은 다듬기 — `searchFilterParams`)
>
> ⑥ **[10a-3a] 사람 · 팀스페이스** ⟨마이그레이션 0105 — 엔타이틀먼트 시드 하나⟩
>
> - **사람 둘** — `createdBy`(만든 사람) · `editedBy`(최종 편집자 — `last_edited_by` · 07 MCP 스펙의 `editor` 축)는 `'me'` 또는 사람 id.
>   사람 id 는 **이 워크스페이스를 떠난 사람이어도 받는다**(07 엣지 *"삭제된 사용자로 Created by 필터 → 필터는 계속 동작"* — 색인의 칸은 id
>   그대로다). 그 사람이 이 워크스페이스의 사람인지 묻지 않는다 — 권한 스코프 위의 술어라 모르는 id 는 0건일 뿐 새는 것이 없다
> - **팀스페이스** — `teamspace`(uuid). 페이지의 팀스페이스는 **루트 블록(`ancestor_ids[1]`, 없으면 자기)의 부모**다(0028 머리말 — 아래
>   페이지는 칸을 따로 갖지 않는다 · 루트를 옮기면 바로 따라간다). 고를 수 있는 것은 **내가 멤버인 보관되지 않은 팀스페이스**(사이드바와 같은
>   규칙 — 07 엣지 *"teamspace 접근 권한 상실 → 후보에서 제거"*). 아니면(없다 · 보관됐다 · 멤버가 아니다) **0건 — 없는 팀스페이스와 같은
>   답**이다(private 의 존재를 알리지 않는다 · 따로 공유받은 페이지로 그 소속을 캐지 못하게)
> - **요금제 게이트** — 엔타이틀먼트 `search.teamspace_filter`(boolean — Plus · Business · Enterprise · 07 헬프센터 *"Teamspace(Plus/
>   Business/Enterprise 플랜 한정)"*). **질의를 만드는 곳에서** 묻는다(07 *"UI 에서 칩만 숨기고 API 가 필드를 받아주면 그대로 우회된다"*).
>   허락하지 않으면 `plan_required`(403) — **버리지 않는다**: 필터가 걸린 줄 아는 사람에게 넓은 결과를 보이지 않는다(틀린 모양의 id 는
>   ①대로 버린다 — 그것은 필터가 아니다). 07 MCP 스펙이 게이트하는 다른 축(최종 편집자 · 제목만 · 기간)은 게이트하지 않는다 — 헬프센터는
>   Teamspace 하나만 게이트하고 UI 에서도 그런지는 07 `[확인필요]`
> - 셋 모두 좁히는 필터다(③ — 검색어 없이 찾는다). 덮개의 칩(다른 사람 고르기 · 최종 편집자 · 팀스페이스 고르개)은 10a-3b
>
> ⑦ **[10a-3b] 덮개의 사람 · 팀스페이스** ⟨마이그레이션 없음⟩
>
> - **사람 칩 둘** — "만든 사람" · "최종 편집자". 누르면 칩 줄 아래 **제자리에** 사람 고르개가 펼쳐진다(표의 사람 칸과 같은 고르개 — 이름 ·
>   메일로 찾는다 · 게스트에게는 후보가 없다(7d-2) · 맨 위 "나"). 떠 있는 고르개는 대화상자가 자른다. 고르면 그 한 사람이 값이고 칩이
>   이름을 말한다(나 · 이름). 고른 사람을 다시 고르면 푼다. **Esc 는 고르개만 닫는다**(덮개는 그대로) · 고르개가 펼쳐진 동안 ↑↓ · Enter 는
>   고르개의 것이다. "내가 만든"(⑤)은 "만든 사람: 나" 와 같은 상태다
> - **고른 사람의 이름은 고른 순간에 안다** — 필터를 주소에 싣지 않으므로(⑤) 다시 읽어 올 일이 없다. 모르면 "떠난 사용자"
> - **팀스페이스 고르개** — 후보는 레이아웃이 이미 읽은 내 팀스페이스(사이드바와 같은 목록 · ⑥의 판정과 같은 규칙). 요금제가 허락하지 않으면
>   고르개 대신 잠긴 칩이 그 까닭을 말한다(표시 전용 — 서버가 다시 묻는다). 고른 팀스페이스가 후보에서 빠지면(나갔다 · 보관) **효과가 없다** —
>   "이 페이지 안에서" 와 같은 규칙(07 엣지 *"이미 선택돼 있으면 해제"* · `effectiveSearchFilters` 하나가 둘을 함께 정한다)
> - 화면을 연 뒤 요금제가 내려가 서버가 `plan_required` 를 주면 덮개가 **그렇게 말한다** — 다른 실패("검색하지 못했습니다")와 가르고, 조용히
>   넓히지 않는다

**[보강] 데이터베이스 행의 제목 색인 — 행도 이름으로 찾는다** ⟨플랫폼 잔여 10p-1조각 · F-07-01 / 마이그레이션 0107⟩

> 07 F-07-01 *"검색 대상 — 페이지 제목 · 본문 · 데이터베이스 엔트리 이름과 property 값"*. 행은 `type='page'` 블록이라 색인 행(0012 의 트리거)은
> 생기는데, `title_text` 를 쓰는 길(`createPage` · `renamePage` · 본문 저장)을 행이 지나지 않아 **색인에 있지만 이름으로 찾을 수 없었다** — 본문을
> 한 번 저장한 행만 그때의 제목으로 걸렸다(그 뒤 이름을 바꾸면 옛 이름으로).
>
> ① **행의 제목은 투영하는 그 자리에서 색인한다** — 정본은 `title` 셀(EAV)이고 `block.properties.title` 은 투영이다(§3.5). 투영하는 곳은
> 셀 쓰기의 한 곳(`projectTitle` — 행을 넣는 문장은 `insertRowIn` 하나이고 셀 고치기는 `updateCellsIn` 하나다 · 템플릿 · 복제 · 자동화 ·
> 폼 응답이 모두 그 둘을 지난다)이고, **같은 트랜잭션에서**
> `search_document.title_text` 도 쓴다(`indexPageTitle` — 본문을 읽지 않는다 · `lang` 은 있으면 둔다). outbox 를 거치지 않는다 — 페이지의
> 이름 바꾸기와 같은 길이다.
> ② **템플릿 행은 검색에 나오지 않는다** — R1(*"모든 뷰/API 쿼리는 is_template=false"*). 전역 검색 · `@` 후보 · 필터만의 검색이 모두 같은
> 술어를 건다(`page.is_template` 인 문서를 뺀다). 색인에서 빼지 않는 까닭: 템플릿이 일반 행으로 바뀌는 길이 생겨도 색인을 다시 쓸 필요가 없다.
> ③ **권한은 그대로 행 블록의 `perm_scope_id`** — 데이터베이스를 볼 수 있으면 그 행도 찾고, 상속을 끊은 행은 자기 스코프로 걸러진다(§3.3 의
> 끊겨 빠진 행 · 10l-3 의 표와 같은 답). **행 단위 접근 규칙(만든 사람 · 사람 칸)으로만 열리는 행은 v1 에서 검색에 나오지 않는다** — 덜
> 보여 줄 뿐 새지 않는다(규칙의 술어를 검색 질의에 옮기는 것은 다음 · HANDOFF §7).
> ④ **이미 있는 색인은 블록의 제목 투영으로 채운다**(마이그레이션 0107) — 색인 제목이 비어 있고 블록에 제목이 있는 페이지 문서(행 · 0012 의 백필이
> 남긴 페이지)에 RichText 의 `plain_text` 를 이은 값을 쓴다(앱의 `toPlainText` 와 같은 규칙). 본문 · `lang` 은 건드리지 않는다.
> ⑤ 속성 값(07 의 *"property 값"*)으로 찾는 것은 아직이다 — 사이드카(`text_value` · pg_bigm — 2e-1 의 뷰 검색)가 있어 같은 축으로 넓힐 수
> 있다(HANDOFF §7). 데이터베이스 **자신**의 이름도 아직이다 — 색인 행은 `type='page'` 블록에만 생긴다(0012 의 트리거) → 10p-2 가 했다(아래).
> ⑥ **결과의 경로는 데이터베이스를 지난다** — 행(과 행 밑의 페이지)의 조상에 데이터베이스가 있다. 경로는 볼 수 있는 조상만 세우는 규칙
> 그대로(8c-2) 페이지와 **데이터베이스**를 읽는다 — 행 페이지의 머리가 데이터베이스를 세우는 것과 같다.

**[보강] 데이터베이스 자신의 이름 색인 — 데이터베이스도 이름으로 찾는다** ⟨플랫폼 잔여 10p-2조각 · F-07-01 / 마이그레이션 0108⟩

> 07 F-07-01 의 검색 대상은 *"페이지 제목 · 본문 · 데이터베이스 엔트리 이름과 property 값"* 이고, 데이터베이스는 페이지와 같은 목록에 선다 —
> 사이드바 · 이동 피커가 이미 둘을 한 목록으로 다룬다. 그런데 색인 행은 0012 의 트리거가 `type='page'` 에만 만들었고 CHECK
> (`ck_search_page_scoped`)이 그것을 묶었다 — 0012 의 머리말이 *"확장하면 이 CHECK 을 떼는 마이그레이션이 그 변경의 일부"* 라고 적어 두었다.
> 그래서 **표의 이름으로는 찾을 수 없었다**(행은 10p-1 부터 찾는다).
>
> ① **색인 단위를 "페이지 · 데이터베이스 노드"로 넓힌다** — CHECK 은 `type IN ('page','database') AND page_id = doc_id`(이름 `ck_search_node_scoped`
> — 본문 블록은 여전히 아니다. 블록 단위 색인은 이 변경이 아니다). 트리거는 둘에서 돈다(정의의 `WHEN` — 본문 블록에서 호출 자체를 건너뛰는
> 이유 그대로). 메타(권한 축 · 감사 · 판)는 트리거가 블록에서 따라간다 — 페이지와 같다.
> ② **이름은 쓰는 두 곳에서 같은 트랜잭션으로 색인한다** — `createDatabase` · `renameDatabase`(블록의 `properties.title` 과 `database.title_rich`
> 를 함께 쓰는 곳 — 이름의 쓰기자는 그 둘뿐이다). 페이지의 이름 바꾸기와 같은 함수(`indexPageTitle`)다. 본문은 없다(`body_text` 는 NULL —
> 행 · 뷰 · data source 의 이름은 이 노드의 글이 아니다. 행은 자기 색인 행을 갖는다).
> ③ **권한은 데이터베이스 블록의 `perm_scope_id`** — 볼 수 있는(`view`) 사람만 찾는다. "만들기만" 받은 사람(6f-2b-1 — 표를 열지만 모든 행을
> 보지는 않는다)은 v1 에서 찾지 못한다 — 덜 보여 줄 뿐 새지 않는다(10p-1 ③ 의 행 단위 규칙과 같은 태도).
> ④ **결과는 종류를 싣는다**(`kind` — 페이지 · 데이터베이스) — 데이터베이스는 자기 주소(`/w/{ws}/db/{id}`)로 연다(사이드바와 같은 갈림 —
> 페이지 주소는 데이터베이스를 받지 않는다). 아이콘은 `database.icon`(8c-3b — 블록의 `format` 은 페이지 행만 갖는다). 경로는 비어 있다
> (데이터베이스는 최상위에만 선다 — 7c-8). 방문 가산은 늘 없다(최근 방문은 페이지만 기록한다).
> ⑤ **`@` 후보는 그대로 페이지만** — 멘션 칩은 페이지 주소로 연다(`openPage`). 데이터베이스를 가리키는 멘션의 이름 · 아이콘은 이미 읽지만
> 여는 길이 없다 — 후보에 넣는 것은 칩이 종류를 아는 다음 조각이다(HANDOFF §7).
> ⑥ 휴지통 · 영구 삭제와는 맞물리지 않는다 — 데이터베이스 블록은 휴지통에 가지 않는다(휴지통은 페이지와 data source 를 받는다). 트리거의
> `purged` 처리는 그대로 둔다(노드 종류를 가리지 않는다).
> ⑦ **이미 있는 데이터베이스는 마이그레이션이 채운다**(0108) — 색인 행을 만들고 제목은 블록의 `properties.title` 의 `plain_text` 를 이은
> 값이다(0107 과 같은 규칙 — 앱의 `toPlainText`).

**[보강] 검색 오타 대체 — 0건일 때만 제목의 낱말 유사도로** ⟨플랫폼 잔여 10p-3조각 · F-07-02 / 마이그레이션 없음⟩

> 07 F-07-02 엣지 *"오타 — 클론은 trigram fallback 권장"* · 클론 대안 *"오타 대응은 `pg_trgm` similarity 를 0건일 때만 fallback 으로
> 실행"*. 확장(`pg_trgm` 1.6)은 이미 있다.
>
> ① **0건일 때만** — 첫 쪽(커서 없음)이 비었고 검색어가 있을 때(필터만의 검색은 아니다). 결과가 하나라도 있으면 돌지 않는다 — 맞는 결과에
> 비슷한 것을 섞으면 무엇이 맞았는지 흐려진다.
> ② **대안 · 제외가 없는 검색어만** — 가장 잘 맞는 순의 "제목이 정확히 같다" 와 같은 규칙(`exactTitleTarget` — 말을 공백 하나로 이은 것).
> `OR` · `-빼는 말` 이 있으면 "비슷한 것" 의 뜻이 서지 않는다. 찾는 말이 **3자 이상**(공백 뺀)일 때만 — 두 글자는 무엇과도 비슷하다(실측:
> `ab` 와 `abc def` 의 낱말 유사도 0.67).
> ③ **제목에서만 · 낱말 유사도**(`word_similarity(검색어, 제목)` — 검색어와 제목 안의 가장 닮은 조각) **0.35 이상**. 전체 유사도
> (`similarity` · pg_bigm 의 `bigm_similarity` · `=%`)는 짧은 검색어와 긴 제목에서 낮게 나와(실측: `회의룩` 과 `주간 회의록 정리` 0.17 ·
> 0.20) 긴 제목 안의 한 낱말 오타를 놓친다. 이 PC 에서 잰 값 — 걸려야 하는 것 0.38~0.71(`raodmap`↔`Q3 product roadmap draft` 0.38 ·
> `분기보고사`↔`2026 분기보고서 최종` 0.67 · `프로젝트 게획`↔`신규 프로젝트 계획서` 0.63), 아니어야 하는 것 0~0.25(`보고서`↔`보도자료 모음`
> 0.25). 본문은 보지 않는다 — 본문의 "비슷한 낱말" 은 잡음이 크다.
> ④ **권한 · 휴지통 · 템플릿 · 필터는 그대로** — 같은 술어(스코프 · `in_trash` · `notTemplateRow` · 필터)를 건다. 대체는 후처리가 아니라
> 다른 축의 질의다.
> ⑤ **정렬은 유사도 높은 순 → 최근 편집 순** — 고른 정렬과 상관없다(대체 결과에 "편집 순" 은 뜻이 약하다). 한 쪽(상한)만 — 다음 쪽이 없다.
> 결과는 **대체라는 것을 싣는다**(`fuzzy`) — 화면이 "일치하는 결과가 없어 비슷한 제목을 보여 줍니다" 를 말한다. 제목이 걸렸다(`titleHit`)는
> 거짓이다.
> ⑥ **인덱스를 더하지 않는다** — 0건일 때만 돌고, 워크스페이스 · 스코프 술어(`ix_search_scope`)로 좁힌 뒤 계산한다. 이 PC 의 DB(색인 행
> 88만 · 가장 큰 워크스페이스 614)에서 2~3ms. 워크스페이스 하나의 색인 행이 수만을 넘어 대체가 느려지면 `title_text gin_trgm_ops` GIN 을
> 더한다(HANDOFF §7).

**[보강] 페이지 안 찾기 — 서버가 아니라 편집기의 문서 모델에서 찾는다** ⟨플랫폼 잔여 10b조각 · F-07-05 / 마이그레이션 없음⟩

> 07 F-07-05 *"현재 열려 있는 페이지 안에서만 문자열을 찾고 매칭 위치로 이동한다"* · *"브라우저 기본 찾기를 가로채서 자체 구현"*(접힌 toggle 안 ·
> DOM 에 없는 블록을 브라우저는 못 찾는다) · *"인덱스가 아니라 클라이언트 문서 모델이 대상 — 방금 타이핑한 미저장 텍스트도 검색된다"* ·
> *"하이라이트는 decoration — DOM 에 직접 `<mark>` 을 넣으면 편집 모델이 오염되고 undo 스택이 깨진다"*.
>
> ① **대상은 본문 편집기의 문서**(ProseMirror 상태 — 협업 서버가 아직 받지 않은 글자도). 글자 블록(문단 · 제목 · 목록 · 토글 · 인용 · 코드 · 표의
> 칸 …)마다 찾는다 — **블록을 넘는 매칭은 없다**. 원자(멘션 · 커스텀 이모지 · 인라인 수식 · 줄바꿈)는 한 칸의 자리표시로 두어 매칭이 그것을
> 넘지 않는다. 대소문자를 가리지 않는다(소문자로 바꿔 길이가 달라지는 블록은 그대로 비교한다 — 자리가 어긋나지 않게). 겹치지 않게 앞에서부터.
> 상한 1000개(카운터는 `1000+`) · 검색어 200자
>
> ② **페이지 제목 · 블록 수식의 식 · 표 화면의 행은 찾지 않는다** — 제목은 편집기 밖의 입력이고, 식은 문서의 글자가 아니며(속성), 박힌
> 데이터베이스의 행은 그 문서에 없다(07 *"데이터베이스 뷰의 미로드 행"* 은 뷰가 서버에서 찾을 일 — 다음)
>
> ③ **하이라이트는 decoration**(플러그인 `find-in-page.ts`) — 문서 · Y.Doc · 되돌리기 기록에 아무것도 쓰지 않는다. 다른 사람이 고쳐도 다시 찾고
> 지금 매칭은 **고친 자리를 따라** 옮긴다(옛 자리를 매핑해 그 뒤의 첫 매칭 — 07 *"전역 offset 이 아니라 앵커링"*)
>
> ④ **열기 · 옮기기** — `Ctrl/Cmd+F`(모달이 열려 있으면 비켜선다) · 입력하면 캐럿 뒤의 첫 매칭이 지금 것 · `Enter` 다음 · `Shift+Enter` 이전(돌아
> 감는다) · 카운터 `n/N` · 0건이면 `0/0` 과 붉은 테두리. 지금 매칭이 **접힌 토글 안이면 그 토글을 펼친다** — 접힘은 보는 사람의 화면 상태라
> (F-01-13) 남에게 번지지 않는다. 닫아도 다시 접지 않는다(07 *"원상복구 여부는 정책 결정"* — 찾은 자리를 보고 있는 사람의 화면을 다시 바꾸지
> 않는다)
>
> ⑤ **닫기**(`Esc` · ×) — 지금 매칭이 있으면 **그 글자를 골라 둔 채** 편집기로 포커스를 돌려준다(브라우저 찾기와 같다 — 찾은 자리에서 이어
> 쓴다). 없으면 선택을 옮기지 않는다

**[보강] Home — 검색 없이 성격별 목록으로 찾는다** ⟨플랫폼 잔여 10c-1조각 · F-07-19 / 마이그레이션 없음⟩

> 07 F-07-19 *"검색어를 치지 않고도 워크스페이스 콘텐츠를 성격별 목록(최근 · 즐겨찾기 · 공유 · 비공개 · teamspace)으로 브라우징"* · *"트리는
> `parent_id` 계층, Home 은 계층을 무시한 평면 목록 — 같은 페이지가 두 표면에 동시에 나타나는 것이 정상"* · 엣지 *"빈 섹션 7개는 '고장난
> 화면'으로 읽힌다 → 온보딩 카드로 대체"* · *"각 섹션이 각각 권한 필터를 통과"* · *"Home 진입 시 여러 쿼리 → 묶을 것"*.
>
> ① **섹션은 이미 있는 목록이다** — 최근 방문(`listRecent` — 20개) · 즐겨찾기(`listFavorites`) · 팀스페이스(내가 멤버인 것마다 그 최상위 ·
> `listMyTeamspaces`) · 공유된 페이지 · 개인 페이지 · 워크스페이스 페이지(사이드바의 섹션 나누기 그대로 — `groupSidebarRoots`). 각 목록이
> 조회 시점에 권한 · 휴지통을 거른다(새 질의를 두지 않는다). 홈 화면 하나가 한 번에(`Promise.all`) 읽는다. Upcoming events · Agents 는 없다
>
> ② **빈 섹션은 세우지 않는다**(페이지 없는 팀스페이스도 — 사이드바의 `+` 가 그 자리다). **모두 비면 시작 카드**(첫 페이지 만들기). 같은
> 페이지가 여러 섹션에 서는 것은 정상이다(빼지 않는다). 데이터베이스 루트는 데이터베이스 화면으로 연다
>
> ③ 섹션마다 처음 **6개**, 나머지는 "모두 보기 (N)" 로 편다(07 *"Show 로 항목 수 조절"* 의 축약 — 사람마다 저장하지 않는다). 섹션의
> 이름은 머리말로 단다 — 사이드바와 같은 `aria-label` 을 쓰지 않는다
>
> ④ Library(탭 · 이름 검색 · 커서 페이지네이션 · 표시 항목 고르기)는 다음
>
> ⑤ **[10c-2] Library** ⟨마이그레이션 없음⟩ — `/w/{ws}/library`. 07 *"Library 의 검색은 이름(제목) 기준이고 스코프가 탭으로 미리 고정된다 —
> 전문 검색이 아니다 · 백엔드는 검색 인덱스가 아니라 일반 목록 쿼리 + 정렬/필터"*.
>
> - **탭 여섯** — 최근 방문(100개까지) · 즐겨찾기 · 팀스페이스 · 워크스페이스 · 공유됨 · 개인. 목록은 Home 과 같은 함수(각자 권한 · 휴지통을
>   거른다) — **탭이 고른 목록만 읽는다**. 팀스페이스 · 워크스페이스 · 공유됨 · 개인은 사이드바의 섹션 나누기(`groupSidebarRoots`) 그대로이되
>   **계층을 펴서**(그 아래 페이지까지 · 트리 차례 — 07 *"계층을 무시한 평면 목록"*) 줄마다 **위치**(부모의 제목 · 루트면 팀스페이스 이름)를
>   함께 보인다
> - **이름으로 찾기** — 그 탭의 목록에서 제목에 든 말(대소문자 무시 · 공백을 접고 100자). 제목 없는 페이지는 "제목 없음" 으로 찾는다(07 —
>   빼면 방금 만든 빈 페이지를 못 찾는다). 0건이면 그렇다고 말한다
> - **주소가 상태다** — `?tab=` · `?q=`(07 *"Library 필터 상태는 URL 에 직렬화"* — 덮개와 달리 화면이다). 찾기는 GET 폼이고 탭 링크가 검색어를
>   지닌다. 기본 탭 · 빈 검색어는 주소에서 뺀다. 모르는 탭은 기본 탭
> - 사이드바의 "라이브러리"(홈 아래)가 연다
> - 커서 페이지네이션 · 표시 항목 고르기 · 필터는 아직 — 목록이 사이드바가 이미 읽는 것과 같은 크기라(트리 전체) 나누어 읽을 쓸모가 그와 함께
>   온다(F-01-22)

---

### 3.10 자동화 · 파일 · 과금 · 외부 동기화 ⟨08 / 01·09 / 13 / 15⟩

```sql
CREATE TABLE automation (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('button_block','button_property','db_automation')),
  host_id uuid NOT NULL,                       -- block.id | property.id | database.id (다형)
  name text, label text NULL, style jsonb NULL,
  trigger_mode text NOT NULL DEFAULT 'any' CHECK (trigger_mode IN ('any','all')),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,                    -- 실행 권한 판정 기준 [확인필요]
  updated_at timestamptz NOT NULL
);
CREATE TABLE automation_trigger (
  id uuid PRIMARY KEY, automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('page_added','property_edited','schedule','manual_click')),
  property_id text NULL REFERENCES property(id),          -- text [X-12]
  condition jsonb NULL, schedule jsonb NULL
);
CREATE TABLE automation_action (
  id uuid PRIMARY KEY, automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
  order_idx text NOT NULL, type text NOT NULL, config jsonb NOT NULL
);
CREATE TABLE automation_run (
  id uuid PRIMARY KEY, automation_id uuid NULL, workspace_id uuid NOT NULL,
  run_kind text NOT NULL DEFAULT 'automation'
    CHECK (run_kind IN ('automation','ai_autofill','agent','sync')),   -- 통합 실행 로그 뼈대
  trigger_page_id uuid NULL, actor_id uuid NULL,
  origin text NOT NULL CHECK (origin IN ('user','automation','schedule','api','sync')),
  depth int NOT NULL DEFAULT 0,                -- 연쇄 깊이. 루프 차단
  status text NOT NULL CHECK (status IN ('queued','running','success','partial','failed')),
  idempotency_key text NULL, error jsonb NULL,
  started_at timestamptz, finished_at timestamptz,
  UNIQUE (workspace_id, idempotency_key)
);
-- 불변식 AU1: 자동화 실행은 V-5 경로 ② 다 — 서버측 Y.transact 1회 + 같은 DB 트랜잭션.
-- 불변식 AU2: DB 쓰기 이벤트는 커밋 후 outbox 로 흘려보낸다. 이 패턴이 없으면
--             CRDT 경로와 자동화 경로가 어긋난다.
-- 불변식 AU3: 트리거는 spam_score 임계 미만 행에만 발화한다. <17 F-17-10>

CREATE TABLE file (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, region_id text NOT NULL REFERENCES region(id),
  storage_key text NOT NULL, mime text, size_bytes bigint,
  original_name text, checksum text,
  ref_count int NOT NULL DEFAULT 0,            -- block + page_version 참조를 모두 포함 <S5> · 페이지 · 데이터베이스의 이미지 아이콘도 [8c-4]
  uploaded_by uuid NULL, created_at timestamptz NOT NULL
);
-- 서명 URL 은 저장하지 않고 조회 시점에 생성한다(저장하면 만료 관리가 불가능).

CREATE TABLE plan (
  id uuid PRIMARY KEY, code text NOT NULL UNIQUE
    CHECK (code IN ('free','plus','business','enterprise')),
  display_name text, price_monthly numeric, price_annual numeric, currency text
);
CREATE TABLE plan_entitlement (                -- 엔타이틀먼트는 코드가 아니라 데이터다
  plan_id uuid NOT NULL REFERENCES plan(id), key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('boolean','limit','duration','credit')),
  value jsonb NOT NULL,
  PRIMARY KEY (plan_id, key)
);
-- 필수 key 집합(도메인 요구): 'history.days', 'charts.max', 'forms.conditional_logic',
--   'synced_database.count', 'synced_database.rows', 'write_back.enabled'   <15 R11>
--   'workspace_analytics', 'data_residency', 'audit_log', 'ip_allowlist', 'custom_admin_role' <17>
-- 불변식 PE1: if (plan === 'business') 를 코드에 흩뿌리지 않는다.
--             entitlement(workspace_id, key) 단일 조회 함수만 쓴다.

CREATE TABLE billing_subscription (            -- 구 13 `subscription`. 개명 [X-10]
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  plan_id uuid NOT NULL REFERENCES plan(id),
  billing_cycle text CHECK (billing_cycle IN ('monthly','annual')),
  status text CHECK (status IN ('active','past_due','canceled','grace')),
  current_period_start timestamptz, current_period_end timestamptz
);
-- 불변식 PE2: seats 컬럼을 두지 않는다. 좌석은 workspace_seat_count 뷰가 유일한 원천이다. <C-14부속>

CREATE TABLE external_connection (             -- <15 F-15-02>
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  provider text NOT NULL, auth_mode text NOT NULL
    CHECK (auth_mode IN ('user_token','admin_api_token','oauth_app')),
  installed_by uuid NOT NULL, external_tenant text NOT NULL,
  credential_ref text NOT NULL,                -- 시크릿 스토어 참조. 토큰 원문을 DB 에 두지 않는다
  status text NOT NULL CHECK (status IN ('active','invalid_token','revoked')),
  scopes jsonb, created_at timestamptz, updated_at timestamptz,
  UNIQUE (workspace_id, provider, external_tenant)
);

CREATE TABLE external_sync_source (            -- 구 external_binding. 정본 이름 [X-13]
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES external_connection(id),
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  resource_kind text NOT NULL,                 -- 'jira_project'|'github_repo_pr'|...
  resource_scope jsonb NOT NULL,
  row_limit int NULL,                          -- plan_entitlement('synced_database.rows') 캐시
  auto_relation boolean NOT NULL DEFAULT false,
  write_back boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('backfilling','live','failed','stopped','detached')),
  last_synced_at timestamptz,
  UNIQUE (data_source_id)                      -- data_source 하나에 외부 소스는 최대 1개
);
-- 부속 테이블(정의는 15-external-sync.md 를 그대로 채택하되 아래 2가지만 정정):
--   external_field_map(binding_id -> sync_source_id, property_id **text**)
--   external_row_link(sync_source_id, external_id, page_id, ..., UNIQUE(page_id))
--   sync_run / sync_issue / user_external_identity / external_relation_pending / external_write_back
-- 불변식 XS1: 외부 소스는 database 가 아니라 data_source 에 바인딩된다.
-- 불변식 XS2: origin 은 (행, 프로퍼티, 블록) 세 층에서 각각 결정된다. 하나의 페이지 플래그가 아니다.
--             행=page.origin / 프로퍼티=property.origin+writable / 본문 블록=언제나 native.
-- 불변식 XS3: 소스 삭제로 버려진 행은 block.trash_reason='source_deleted' 이며 복원 버튼이 없다.
--             복원 허용 시 다음 sync 에서 다시 삭제되는 무한 루프가 생긴다.
-- 불변식 XS4: write-back 의 actor 는 "노션 user + 그 사람의 외부 계정" 복합이다.
--             워크스페이스 토큰으로 대리 쓰기 금지(외부 감사 로그에 실제 행위자가 남아야 한다).
--             게스트·공개 링크 접근자는 write-back 불가.
```

**[보강] 엔타이틀먼트 — 표 · 조회 하나 · 운영자 명령** ⟨잔여 묶음 8k-1 / 마이그레이션 0047⟩

> 13 F-13-18 *"엔타이틀먼트는 코드가 아니라 데이터여야 한다 … `entitlement(workspace_id, 'charts.max')` 하나의 조회 함수로 통일 … 모든 한도
> 검사는 서버의 생성 트랜잭션 안에서"* · 클론 대안 *"결제는 Stripe Billing 에 위임 … v1은 축 ①(기능 온/오프)과 ②(개수 한도)만"*.
>
> ① **표 셋은 위 DDL 그대로이고 넷을 조였다** — `plan` 은 넷을 시드한다(가격은 13 의 1차 출처 KRW · `price_annual` 은 연 결제의 **월 환산액** ·
> Enterprise 는 NULL = 문의) · `billing_subscription.status` 는 NOT NULL(상태 없는 구독은 판정할 수 없다) · `created_at` · `canceled_at` 을 더했다
> (취소 시각은 취소에만 — CHECK) · `workspace.plan_code`(파생 캐시)는 `plan(code)` 를 가리킨다(FK — 없는 요금제를 가리키지 못한다).
> ② **값의 모양은 종류가 정한다**(CHECK) — boolean 은 참거짓 · limit · duration 은 0 이상의 정수 또는 JSON null(**무제한**) · credit 은 객체.
> 키는 점으로 나눈 소문자(`history.days`). 같은 키의 종류가 요금제마다 같은 것 · 모든 요금제가 모든 키를 갖는 것은 시드와 검사가 지킨다.
> ③ **결제 연동은 없다** — 유료 SaaS(Stripe 등)에 기대지 않는다(CLAUDE.md 절대 제약 1). 요금제는 **운영자 명령**(`setWorkspacePlan` ·
> `npm run plan:set`)이 준다 — 살아 있는 구독을 취소하고(이력이 남는다) 새 구독 한 줄과 `plan_code` 를 한 트랜잭션에. free 는 구독이 없는
> 상태다. 살아 있는(취소되지 않은) 구독은 워크스페이스마다 하나(부분 UNIQUE). 사용자가 부르는 요금제 변경 라우트는 없다.
> ④ **조회는 `entitlement(workspace, key)` 하나다**(PE1) — 키는 코드의 닫힌 목록(오타가 컴파일에서 걸린다) · 받는 값은 그 종류의 모양 ·
> **줄이 없으면 던진다**(조용히 기본값으로 메우면 표와 코드가 다른 말을 한다). 쓰기의 한도는 그 트랜잭션으로 묻는다.
> ⑤ **내려도 있는 것은 지우지 않는다** — 한도는 새로 만드는 쪽에만 걸린다(13 *"기존 것은 남기되 신규 생성 차단"*). 버전의 보존 기한은 만들
> 때 고정이다(§3.7 [보강] 버전 기록 ④).
> ⑥ **키는 소비자가 생길 때 더한다** — 8k-1 은 `history.days`(7 · 30 · 90 · 무제한 — 버전 기록이 상수로 기다리던 것) 하나. 게스트 한도 ·
> private teamspace · 파일 크기 상한은 거부와 화면을 함께 거는 조각에서(위 "필수 key 집합"은 도메인의 요구 목록이지 시드 목록이 아니다).

**[보강] 요금제 게이트 — 게스트 한도 · private teamspace** ⟨잔여 묶음 8k-2 / 마이그레이션 0048⟩

> 13 F-13-18 *"게스트 Free 10명 / 유료 무제한 · private teamspace 는 Business 부터 · 게스트 한도 초과 상태 — 이미 초대된 게스트를 쫓아낼 수는
> 없다 → 신규 초대만 차단"* · 축 ①(켜고 끄기) · ②(개수).
>
> ① **키 둘** — `guests.max`(limit · Free 10 · 나머지 무제한) · `teamspace.private`(boolean · Business · Enterprise).
> ② **게스트 한도는 들이는 도우미 하나(`admitGuestIn`)와 대기 초대에서 묻는다** — 이메일 공유와 접근 요청의 허락이 같은 문을 지난다. 세는
> 것은 **활성 게스트 + 받아들이지 않은 게스트 초대의 이메일**(대기 초대는 자리를 미리 잡는다 — 받아들일 때 다시 묻지 않아 링크를 연 사람이
> 막히지 않는다). 같은 이메일의 대기 초대가 여럿이어도 한 사람이고, 이미 세어진 사람을 다시 들이는 것(이미 게스트인 사람에게 페이지를 더 주기
> · 같은 이메일의 둘째 대기 초대)은 자리를 더 쓰지 않는다. 넘으면 아무것도 쓰지 않고 `guest_limit` — 허락이면 요청은 대기 중으로 남는다.
> 한도 바로 밑의 동시 초대는 워크스페이스마다 advisory 잠금으로 줄을 세운다.
> ③ **private teamspace 는 만들 때와 private 로 바꿀 때 묻는다** — `plan_required`. 이미 private 인 것은 요금제를 내려도 그대로이고 이름 ·
> 아이콘을 고칠 수 있으며 넓힐 수 있다(넓힌 뒤 다시 좁히는 것은 묻는다).
> ④ **내려도 있는 것은 그대로다** — 넘친 게스트 · private teamspace 를 지우거나 내쫓지 않는다. 새로 들이고 새로 만드는 것만 막는다.
> ⑤ 거부 코드는 권한 거부(`forbidden`)와 가른다 — HTTP 는 403 이되 코드가 다르고, 화면은 "요금제" 를 말한다(요금제 이름은 말하지 않는다 —
> 요금제 표가 바뀌어도 문구가 거짓이 되지 않게).

**[보강] 휴지통 보관 기간** ⟨히스토리 · 활동 4b-3 · F-11-06 / 마이그레이션 0071⟩

> 11 F-11-06 *"(Enterprise 워크스페이스 소유자) Settings → Security → Data retention → 휴지통 보관일 수를 1일~10년 범위에서 설정"* ·
> §3.4 정본 상수 `TRASH_DAYS_DEFAULT`(30 · 범위 1~3650 · Enterprise 만 변경).
>
> ① **키 `trash.custom_retention`**(boolean · Enterprise 만) — 축 ①(켜고 끄기).
> ② **값은 `workspace.trash_days`**(초판의 칸 · CHECK 1~3650 · 기본 30). 설정 레지스트리의 `workspace.trash_days` — 워크스페이스 보안 절 ·
> 소유자만 보고 고친다 · 숫자 컨트롤(1~3650일) · 요금제 게이트(§3.1 [보강] 설정 정보구조 ⑦).
> ③ **바꾼 값은 지금부터 버리는 것에** — `purge_after` 는 버릴 때 적는다(§3.4 전이표 `live` → `trashed`). 이미 휴지통에 있는 것은 버릴 때의
> 기간을 따른다 — 줄여도 이미 버린 것을 앞당겨 비우지 않는다(되살릴 수 있다고 들은 기간이 말없이 줄지 않게). 화면이 그렇게 말한다.
> ④ 요금제를 내려도 값은 그대로다 — 바꾸는 것만 막는다([보강] 요금제 게이트 ④).
> ⑤ 영구 삭제 뒤 30일(`PURGED_HARD_DELETE_DAYS`)은 설정이 아니다 — 사용자 · API 에 보이지 않는 GC 지연이다(정본 상수).

**[보강] 요금제 패널 — 지금 요금제 · 쓴 양 · 비교** ⟨잔여 묶음 8k-3 / 마이그레이션 없음⟩

> 13 F-13-18 *"설정 내 사용량 대시보드(크레딧·게스트·도메인 잔여) … 잠긴 기능 옆 업그레이드 배지"*.
>
> ① **설정의 워크스페이스 묶음에 "요금제" 절** — 워크스페이스 소유자 · 멤버 관리자만 본다(요금제 · 게스트 수는 운영의 정보다 · 역할 이름으로
> 묻는다). 읽기만 한다 — 바꾸는 길은 운영자 명령이고 화면은 그렇게 말한다(결제 연동 없음 · [보강] 엔타이틀먼트 ③).
> ② **비교 표의 값은 엔타이틀먼트 표 그대로다** — 코드에 요금제별 값을 두지 않는다. 화면이 가진 것은 키의 이름과 값을 읽는 말(일 · 명 · 무제한 ·
> 쓸 수 있음)뿐이고, 모르는 키는 키 그대로 보인다(표에 키가 더해져도 화면이 깨지지 않는다).
> ③ **쓴 양은 게이트의 셈과 같다** — 활성 게스트 + 받아들이지 않은 게스트 초대의 이메일(같은 SQL 을 쓴다).
> ④ **고르개는 서버의 규칙을 그대로 보인다**(표시 전용) — teamspace 공개 범위의 private 는 요금제가 허락하지 않으면 막고 "요금제 필요"를 붙인다.
> 이미 private 인 teamspace 의 설정에서는 막지 않는다(서버는 바꿀 때만 묻는다). 거부는 서버가 다시 한다(`plan_required`).


**[보강] 공용 스케줄러 — `scheduled_job` 하나** ⟨히스토리 · 활동 4a-1 / 마이그레이션 0068⟩

> 마스터 문서 §6 *"스케줄러는 하나만 만든다. 리마인더 · 반복 템플릿 · 히스토리 GC · verification 만료 · resync 가 전부 '시각이 되면
> 실행'이다. 세 벌 만들면 세 벌 다 미묘하게 틀린다"* · 같은 표가 BullMQ(Redis) 또는 pg-boss 를 들었다. 초판의 표 목록에는 작업 표가
> 없다. **둘 다 쓰지 않고 표 하나를 둔다** — 근거: (a) pg-boss 는 자기 스키마(`pgboss.*`)를 자기 마이그레이션으로 소유한다 — 이 저장소의
> 규칙(*"스키마는 SQL 로 쓰고 애플리케이션은 읽기만 한다"*)과 부딪힌다 (b) BullMQ 는 일을 Valkey 에 두어 "이 행을 지웠으면 그 일도
> 넣는다"를 한 트랜잭션으로 할 수 없다 — 리마인더 · 만료는 DB 쓰기와 같은 트랜잭션에서 일을 넣어야 한다 (c) 필요한 것은 작다 —
> `FOR UPDATE SKIP LOCKED` 로 여러 워커가 겹치지 않게 가져가는 행 큐.
>
> ```sql
> CREATE TABLE scheduled_job (
>   id           uuid PRIMARY KEY,
>   kind         text NOT NULL CHECK (kind IN (...)),          -- 소비자가 들어올 때마다 늘린다(마이그레이션)
>   run_at       timestamptz NOT NULL,
>   payload      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
>   dedupe_key   text NULL,                                      -- 살아 있는 일은 키마다 하나(부분 UNIQUE)
>   attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
>   locked_until timestamptz NULL,                               -- 가져간 워커의 임대 — 지나면 다른 워커가 다시 가져간다
>   last_error   text NULL,
>   dead_at      timestamptz NULL,                               -- 다섯 번 실패하면 멈춘다(지우지 않는다 — 사람이 본다)
>   created_at   timestamptz NOT NULL DEFAULT now(),
>   CHECK (dead_at IS NULL OR locked_until IS NULL)
> );
> CREATE UNIQUE INDEX … ON scheduled_job (dedupe_key) WHERE dedupe_key IS NOT NULL AND dead_at IS NULL;
> CREATE INDEX … ON scheduled_job (run_at) WHERE dead_at IS NULL;
> ```
>
> ① **가져가기** — 때가 된(`run_at ≤ now`) · 임대가 없거나 지난 · 죽지 않은 일을 `FOR UPDATE SKIP LOCKED` 로 잠그고 임대(`locked_until`)를
>    건 뒤 커밋하고, 일은 그 바깥에서 한다(긴 일이 행 잠금을 오래 쥐지 않게). 워커가 죽으면 임대가 지나 다른 워커가 다시 가져간다 —
>    **일은 두 번 돌아도 같은 결과여야 한다**(멱등).
> ② **끝나면 행을 지운다** — 기록은 남기지 않는다(표가 쌓이지 않게). 주기 일은 끝날 때 다음 실행을 같은 키로 다시 넣는다 — 키의 부분
>    UNIQUE 가 "살아 있는 주기 일은 하나"를 지킨다. 워커가 뜰 때도 주기 일을 넣어 본다(이미 있으면 그대로).
> ③ **실패하면 물러난다** — `attempts` 를 올리고 `last_error` 를 적고 1분 · 2분 · 4분 … 뒤로 미룬다. 다섯 번째 실패면 `dead_at` 을 적고
>    멈춘다(행은 남는다).
> ④ **시각은 하나** — 실행기의 `now` 를 SQL 에 넘긴다(검사가 시각을 정한다 · DB 시계와 앱 시계를 섞지 않는다).
> ⑤ **누가 돌리나** — 별도 프로세스(`npm run worker` — 협업 서버처럼)다. 세션 없이 도는 **시스템 주체**라 권한을 묻지 않는다 — 일마다
>    무엇을 해도 되는지는 그 일의 규칙이 정한다(예: 버전 GC 는 만료된 것만).
>
> **첫 소비자 — 버전 GC(F-11-03 · `version_gc`)**: 만료된(`expires_at < now`) 버전을 지운다. 단 ⓐ 페이지의 **가장 최근 버전은 남긴다**
> (11 F-11-03 *"최소 1개는 보관 기간과 무관하게 유지"*) ⓑ **다른 버전이 `restored_from` 으로 가리키는 버전은 남긴다** — 가리키는 쪽이
> 더 나중에 만료되므로 그것이 지워진 다음 판에 지워진다(`restored_from` 의 FK 를 SET NULL 로 바꾸면 `reason='restore' ⇔ restored_from`
> CHECK 와 부딪힌다). 지울 때 그 버전이 담은 파일 참조(S5)를 기록할 때와 같은 셈으로 내리고 행을 지운 뒤(한 트랜잭션), 커밋하고 나서
> 바이트를 저장소에서 지운다(실패하면 고아로 남는다 — 저장소 고아 쓸기는 파일 GC 와 함께). 한 판에 200개 — 남았으면 곧 다시, 다
> 지웠으면 한 시간 뒤.
>
> **두 번째 소비자 — 휴지통 자동 비우기(F-11-06 · `trash_purge`)**: §3.4 [보강] 휴지통 자동 비우기(4b-1 · 마이그레이션 0069).
>
> **세 번째 소비자 — 물리 삭제(F-11-06 · `trash_hard_delete`)**: §3.4 [보강] 물리 삭제(4b-2 · 마이그레이션 0070).

**[보강] 자동화 엔진 · 버튼 속성** ⟨자동화 5a · F-08-07 · F-03-15(= 08 F-08-08) / 마이그레이션 0078⟩

> 08 F-08-07 의 클론 대안 *"액션을 플러그인 인터페이스(`execute(ctx, config)`)로 정의하고 내부 액션 3~4종만 먼저"* 그대로다. 5a 는
> **버튼 속성** 하나로 엔진을 세운다 — DB 트리거(5b) · 웹훅 액션(5c) · 변수(5d) · 버튼 블록(5e)이 그 위에 선다. 위 DDL 의 넷 중
> `automation` · `automation_action` · `automation_run` 을 만든다(`automation_trigger` 는 5b).
>
> ① **[정정] `automation.host_id`(다형) → 주인 칸 셋** — `host_property_id text NULL REFERENCES property(id)` ·
>    `host_data_source_id uuid NULL REFERENCES data_source(id)` · `host_page_id uuid NULL REFERENCES block(id)` 와, `kind` 마다 **정확히 그
>    하나만** 채운다(CHECK — 버튼 속성은 속성 · DB automation 은 데이터 소스 · 버튼 블록은 그 블록이 있는 페이지). 다형 칸은 FK 를 걸 수 없어
>    주인이 지워져도 남는다 — 물리 삭제(4b-2)가 지울 표 목록에 손으로 더해야 하는 표가 된다. 모두 `ON DELETE CASCADE`. DB automation 의
>    주인이 database 가 아니라 **data_source** 인 것은 행 · 속성의 주인이 data_source 이기 때문이다(0013).
> ② **버튼 속성은 셀이 없는 타입** — 값이 없다(정렬 · 필터 · rollup · 수식이 읽는 값이 없다). 셀 가드(0025)의 목록에 `button` 을 더한다.
>    속성을 더하면 automation(kind `button_property`)이 **함께** 생긴다(액션 0개 — 눌러도 아무 일이 없다). 버튼의 글자는 속성 이름이다.
>    타입 바꾸기로 들어오거나 나가지 못한다. 속성은 소프트 삭제되므로(`deleted_at`) automation 은 남고 · 속성을 되살리면 함께 돌아온다.
> ③ **누르는 사람의 권한으로** — 버튼은 클릭한 사람으로 실행한다(08 *"버튼 클릭 권한 = 페이지의 편집 + 액션 대상별 추가 조건"*).
>    누르기는 그 행의 `edit_content`(03 *"Can edit content 도 클릭 가능"*). 액션마다 그 대상을 **그 사람의 권한으로 다시** 판정한다 — 액션이
>    권한을 넓히지 않는다. 액션을 고치는 것은 그 데이터 소스의 `edit_structure`(속성 설정과 같은 무게).
> ④ **한 트랜잭션 · 실행 기록 하나**(AU1) — 누르면 `automation_run`(run_kind `automation` · origin `user` · depth 0)을 남기고 액션을
>    순서대로 **같은 트랜잭션에서** 실행한다. 대상을 고칠 권한이 없거나 잠겨서 못 하는 액션은 **건너뛰고**(세이브포인트) 실행은 `partial`
>    — 08 *"접근이 제한된 페이지에는 영향을 주지 않는다 … 전체 실패가 아니라 스킵 + 로그"*. 그 밖의 실패(값이 틀렸다 · 대상 속성이
>    사라졌다)는 **전부 되돌리고** `failed` 를 따로 남긴다 — 반쪽 실행이 남지 않게. [보강] 칸 `automation_run.steps jsonb` — 단계마다의
>    결과(`done` · `skipped` 와 까닭 · `failed` 와 까닭). 실행 기록은 대상의 **내용**을 담지 않는다(id 와 까닭만 — 레벨이 전순서가 아니라
>    `create` 만 받은 사람이 기록으로 행을 읽으면 안 된다 · A2).
> ⑤ **연타는 한 번** — 화면이 누를 때마다 만든 uuid 를 멱등 키로 보낸다(`UNIQUE (workspace_id, idempotency_key)` — 키는 `button:{uuid}`).
>    같은 키가 다시 오면 실행하지 않고 처음 실행의 결과를 돌려준다(08 *"클릭 연타 — 서버 멱등 토큰"*).
> ⑥ **액션은 등록부** — `automation_action.type` 은 처음부터 상위집합으로 CHECK 한다(`edit_property` · `add_page_to` · `insert_blocks` ·
>    `send_webhook` · `define_variables` · `show_confirmation`). 5a-1 은 `edit_property`(**그 행**의 셀을 바꾼다), 5a-2 는 `add_page_to`(다른
>    데이터 소스에 행을 더한다 · 템플릿 값이 이긴다 — 08 *"The values from the template overwrite the values from the button"*).
>    `config` 는 판(`v: 1`)을 갖는다. 값은 지금은 **고정 값만** — 셀 쓰기 API 의 `CellValue` 그대로다(멘션 · 수식 슬롯은 5d).
>    `automation_action.order_idx` 는 0부터의 네 자리 글자(`0000`)다 — 액션 목록은 통째로 바꿔 쓴다(부분 이동이 없다).
> ⑦ **자동화가 쓴 셀은 `filled_by = 'automation'`** — 활동의 행위자는 누른 사람이다. 자동화가 쓴 것이 다른 자동화를 깨우지 않는 규칙
>    (08 F-08-10 *"automation 은 다른 automation 을 트리거하지 않는다 · 단 버튼이 만든 페이지는 발동한다"*)은 트리거(5b)가 정한다.
> ⑧ 실행 기록은 automation 마다 **최근 50건**만 남긴다(08 F-08-10 클론 대안 *"실행 로그는 최근 50건만 보관"* · `data_retention`).
> ⑨ **`add_page_to`**(5a-2) — `config = { v: 1, dataSourceId, cells, templateId? }`. 그 데이터 소스(같은 표여도 된다)에 행을 하나
>    더한다. 대상 표의 `create_child` 를 **누른 사람의 권한으로** 묻고, 없으면 그 액션만 건너뛴다(`partial` — ④). 템플릿을 고르면 그
>    템플릿으로 만들되 **템플릿 값이 버튼 값을 덮는다**(08 *"The values from the template overwrite the values from the button"*) — 보드의
>    열에서 만든 카드가 "열 값이 템플릿을 덮는" 것과 반대다. 그래서 템플릿으로 행 만들기는 우선순위를 고르는 칸을 갖는다(기본은 지금대로
>    준 값이 이긴다). 저장할 때: 대상 표를 저장하는 사람이 볼 수 있어야 하고(아니면 `unknown_data_source` — 없는 표와 같은 답), 셀은
>    **대상 표의** 스키마에 대어 보고, 템플릿은 그 표의 살아 있는 템플릿이어야 한다(`unknown_template`). 실행 때 템플릿이 사라졌으면
>    실패다(정의가 깨졌다 — ④). 실행 기록의 단계는 만든 행의 id 를 담는다(`pageId` — 화면이 열어 준다 · 내용은 담지 않는다). 만든 행의
>    셀도 `filled_by = 'automation'`.
> ⑩ **화면**(5a-3) — 버튼 칸은 **속성 이름의 단추**다. 누르면 그 행에서 실행하고 결과를 칸에 짧게 말한다(완료 · 일부 건너뜀(권한 ·
>    잠금) · 실행하지 못함). 누를 때마다 화면이 새 멱등 키를 만들고 도는 동안 단추를 막는다(두 번 눌러도 한 번 — 서버도 키로 막는다).
>    단추는 그 표의 값을 고칠 수 있는 사람에게만 눌린다(화면은 `canEditContent` 로 막고 서버가 다시 묻는다 — 거절은 말로). 액션 편집은
>    열 머리 메뉴의 **"버튼 설정"** — 구조를 고칠 수 있는 사람에게만 메뉴가 선다(서버가 다시 묻는다). 5a-3 의 편집기는 **"이 행의 값
>    바꾸기"(`edit_property`)** 만 고친다 — 속성을 고르고 그 타입의 값을 넣는다(숫자 · 체크 · 선택 · 상태 · 글 · 날짜). 그 밖의 액션
>    (다른 표에 행 추가 — 5a-4)은 목록에 요약으로 서고 저장할 때 **그대로 남는다**(화면이 모르는 액션을 지우지 않는다). 버튼 열은 정렬 ·
>    필터 · 그룹 · 집계 · 유형 바꾸기의 대상이 아니다(값이 없다). 보드 · 갤러리 · 캘린더의 카드와 행 페이지에는 아직 서지 않는다(5a-4 · §7).
> ⑪ **화면 — 5a-4** — 편집기는 보기의 컬럼이 아니라 **그 표의 스키마**(`GET …/properties`)로 속성을 고른다(숨긴 속성도 — ⑩ 의
>    한계를 닫는다). **"다른 표에 행 추가"(`add_page_to`)** 를 고친다 — 대상 표(데이터베이스 목록 · 이 표도 된다) · 그 표의 템플릿(없음 ·
>    템플릿들) · 그 표의 값(같은 값 칸). 템플릿을 고르면 *"템플릿이 정한 칸은 템플릿 값이 이긴다"* 를 한 줄로 알린다(08 *"직관과
>    반대이므로 클론은 설정 화면에서 경고해야 한다"*). 버튼은 표 · 행 페이지 · 보드 · 갤러리의 카드에 선다(카드를 여는 누르기로 번지지
>    않게) — 캘린더 카드는 제목만 그리므로 서지 않는다. **템플릿 행에서는 누르지 않는다** — 템플릿은 행이 아니라 새 행의 모양이다
>    (누르면 템플릿의 값이 바뀐다). 화면은 단추를 막고 서버도 거절한다(`not_found` — 템플릿은 누를 행이 아니다).
> ⑫ **`send_webhook` — 정의 · 쌓기**(5c-1 · 08 F-08-13 · 마이그레이션 0081) — 그 행의 고른 속성 값을 JSON 으로 바깥 URL 에 POST 한다.
>    페이지 웹훅(§3.8 [보강])과 **같은 발송기 · 같은 봉인**을 쓴다(그 블록 머리 — *"같은 발송기를 자동화의 `send_webhook` 이 쓴다"*).
>    - **세 모양** — 받는 것 `{ v: 1, url?, keep?, headers: [{ name, value? }], properties: [propertyId] }` · 저장하는 것 `{ v: 1, urlSealed,
>      urlHint, headers: [{ name, valueSealed }], properties }`(봉인은 base64) · 읽어 주는 것 `{ v: 1, ref, urlHint, headers: [{ name }],
>      properties }`. **URL 과 헤더 값은 비밀이다**(Slack 의 incoming webhook URL · 인증 토큰) — 봉인해서 저장하고(`sealWebhookUrl` 과 같은
>      키) 화면 · API 에 돌려주지 않는다(힌트 · 헤더 이름만). 고칠 때 URL 을 다시 넣지 않으면 `keep`(읽을 때 받은 `ref` — **같은 automation**
>      의 이전 `send_webhook` 액션)에서 옮기고, 헤더 값을 비우면 그 액션의 같은 이름 헤더 값을 옮긴다. 옮길 것이 없으면 거절(`unknown_ref`) —
>      다른 automation 의 비밀을 끌어오지 못한다.
>    - **검사** — URL 은 페이지 웹훅과 같다(`checkOutboundUrl` — https · 자격 증명 없음 · 포트 · 사설 주소 · 2048자 → `invalid_url`).
>      automation 마다 **5개까지**(08 *"automation 당 최대 5개"* → `too_many_webhooks`). 헤더는 10개까지 · 이름은 토큰 글자 · 값은 1024자까지 ·
>      발송기가 정하는 이름(`host` · `content-length` · `content-type` · `connection` · `transfer-encoding` · `user-agent`)은 못 쓴다. 속성은
>      **그 automation 의 표**(버튼 — 버튼이 있는 표 · DB automation — 그 표)의 살아 있는 **셀 속성**이고(버튼 · relation 은 못 고른다 — 08 *"DB
>      버튼 property 는 전송 필드로 선택 불가"* → `unknown_property`) 50개까지 · 0개면 행의 id 와 주소만 간다.
>    - **요금제** — 유료 요금제만(08 *"`Send webhook` … 유료 플랜 전용"*) — 엔타이틀먼트 `automation.webhook`(Free false · 나머지 true). 저장할
>      때 막는다(`plan_required`). 실행 때도 다시 묻는다 — 요금제를 내린 뒤에는 그 액션을 **건너뛴다**(`skipped` · `plan` — 실패가 아니다).
>    - **[10n-70] 워크스페이스 스위치** — 소유자가 웹훅을 껐으면(§3.8 [보강] 페이지 웹훅 ⑩) 저장할 때 막고(`webhooks_disabled`) 실행 때는
>      쌓지 않고 **건너뛴다**(`skipped` · `webhooks_disabled`). 요금제와 같은 자리 · 같은 모양이다.
>    - **실행은 쌓기만** — 엔진은 바깥으로 나가지 않는다. 트랜잭션 안에서 네트워크를 타지 않고(락을 쥔 채 10초를 기다리지 않는다) · 되돌린
>      실행이 이미 보낸 요청을 되돌릴 수 없어서다. 같은 트랜잭션에서 **배달 한 줄**(`automation_delivery` — 그때의 봉인된 URL · 헤더를 옮겨
>      싣는다: 나중에 고쳐도 쌓인 배달은 그때의 것)을 쌓고 단계는 `done`(`deliveryId`). 실행이 되돌려지면 배달도 함께 사라진다. 몸(payload)은
>      **그때의 값을 실행 주체의 권한으로** 읽어 싣는다 — `{ run_id, automation_id, page: { id, url }, properties: { ‹속성 이름›: ‹셀 값› } }`(선택지 · 상태는 옵션 이름을 붙인다 — 셀은 id 만 담는다).
>      `run_id` 는 받는 쪽의 중복 제거 키다(08 *"페이로드에 `run_id` 를 반드시 포함"*). 보내기 · 재시도 · 실패 뒤 멈춤은 5c-2.
> ⑬ **`send_webhook` — 보내기**(5c-2 · 마이그레이션 0082) — 공용 스케줄러의 여덟 번째 소비자 `automation_webhook`(남았으면 곧바로 · 아니면
>    5초 뒤). 페이지 웹훅의 보내기(§3.8 [보강] 보내기 ⓒ ~ ⓕ)와 같은 규칙이다.
>    - **잡기** — 보낼 차례(`pending` · `next_attempt_at` 이 지났다)를 `FOR UPDATE SKIP LOCKED` 로 잡아 임대를 걸고 커밋한다. 워커가 보내다
>      죽으면 임대가 지나 다시 보낸다 — **적어도 한 번**이고, 받는 쪽은 몸의 `run_id` 로 겹친 것을 거른다.
>    - **다시 보기** — automation 이 꺼졌으면(사람이 껐든 실패로 멈췄든) 보내지 않고 `dropped`(`paused`) — 멈춘 뒤에도 쌓여 있던 것이
>      상대 서버를 계속 두드리지 않게. 봉인을 풀지 못하면 `dropped`(`unseal_failed`). 요금제는 다시 묻지 않는다(쌓을 때 물었다 — 이미
>      실행된 일이다). **워크스페이스 스위치는 다시 묻는다**(10n-70) — 꺼졌으면 `dropped`(`webhooks_disabled`): 끈 뒤에 이미 쌓인 것이
>      나가면 끈 것이 아니다.
>    - **보내기** — 트랜잭션 밖에서 `net/outbound.ts` 의 한 길로(`postJson` — 주소 고정 · 리다이렉트 없음 · 10초). 헤더는 봉인을 풀어
>      싣는다. 몸은 쌓을 때의 것 그대로.
>    - **적기** — 내 임대일 때만. 성공(2xx)이면 `sent`. 실패면 1 · 2 · 4분 뒤 다시, 네 번째도 실패면 `failed` 로 끝내고 **automation 을
>      멈춘다**(`enabled = false` · `disabled_reason = 'webhook_failed'` — 08 *"전송 실패 시 느낌표가 표시되고 automation 이 자동 일시정지되며
>      사용자가 수동으로 재개해야 한다"*). 버튼이면 버튼이 꺼진다(누르면 *"꺼진 버튼입니다"*). DB automation 은 ⚡ 의 `!` 와 꺼진 까닭이
>      말한다. 다시 켜면 까닭이 지워진다(5b-1).
>    - 끝난 배달(`sent` · `failed` · `dropped`)은 **7일** 뒤 지운다(`data_retention` — 페이지 웹훅의 배달과 같다).
> ⑭ **`send_webhook` — 화면 ① 편집**(5c-3a) — 버튼 · DB automation 의 액션 편집(`action-editor.tsx` — 같은 부품)에 *"+ 웹훅 보내기"*. 칸은 셋이다.
>    - **받는 주소** — 새로 넣을 때만 친다. 저장된 주소는 **힌트로만** 보이고(*"지금: hooks.example.com/…xyz"*) 비워 두면 그대로다(`keep`).
>    - **헤더** — 이름과 값 · 10개까지. 저장된 값은 보이지 않고 비워 두면 그대로다(같은 이름의 값을 옮긴다). 새 헤더는 값이 있어야 한다.
>    - **보낼 속성** — 그 표의 스키마의 셀 속성을 고른다(숨긴 속성도 — 5a-4 ⓐ). 고르지 않으면 행의 id 와 주소만 간다.
>    요금제는 화면이 미리 묻지 않는다 — 저장할 때 서버가 거절하고(`plan_required`) 화면이 *"이 요금제에서는 웹훅을 보낼 수 없습니다"* 를
>    말한다. 다른 거절도 몇 번째 액션의 무엇인지 말한다(주소 · 헤더 · 다섯 개 넘음 · 옮길 것 없음).
> ⑮ **`send_webhook` — 화면 ② 배달 상태 · 다시 켜기**(5c-3b) — 실패로 멈춘 것을 사람이 알아보고 다시 켤 수 있어야 한다(⑬ · 08 *"수동 재개"*).
>    - **실행 기록의 배달 상태** — DB automation 의 실행 기록(화면 ① ⓓ)에서 웹훅 단계는 그 배달의 상태를 함께 말한다(*보낼 차례* · *보냄* ·
>      *실패* · *버림*, 실패면 마지막 HTTP 상태). 주소 · 몸 · 응답 본문은 싣지 않는다. 문은 실행 기록과 같다.
>    - **꺼진 버튼 다시 켜기** — 버튼에는 실행 기록 화면이 없으므로 "버튼 설정" 편집기가 꺼진 까닭을 적고(*"웹훅을 네 번 보내지 못해
>      꺼졌습니다"*) **다시 켜기**를 둔다. 문은 버튼 설정과 같다(그 표의 `edit_structure` · 잠긴 데이터베이스면 `locked`). 켜면 꺼진 까닭이
>      지워진다(5b-1 과 같다). 버튼 칸은 꺼진 버튼을 누르면 *"꺼진 버튼입니다"* 라 답한다(5a-3).
> ⑯ **값 슬롯 — 고정 값 · 동적 값**(5d-1 · 08 F-08-11) — 액션의 셀(`edit_property` · `add_page_to` 의 `cells`)은 고정 값 `{ propertyId, value }`
>    또는 **동적 값** `{ propertyId, from }` 이다. 08 의 클론 대안(*"v1 은 `Define variables` 없이 mention 만: 현재 사용자 · 현재 시각 · 트리거 페이지의
>    ‹property›"*)을 따르되, 사람(person) 속성이 아직 없어 *현재 사용자*는 그 속성이 올 때 더한다(§7). 08 이 P0 로 짚은 **"값 슬롯의 스키마"**가
>    이것이다 — 셀이 처음부터 판(`v`)을 가진 객체라 평문 마이그레이션이 없다.
>    - `from: { kind: 'now' }` — **실행한 시각**(그 실행의 시작 · ISO 날짜와 시각). **날짜 속성에만**.
>    - `from: { kind: 'row_property', propertyId }` — **일하는 행**(버튼 — 누른 행 · DB automation — 트리거된 행)의 그 속성 값. 받는 속성과 **같은 타입**
>      이어야 하고 선택지 · 상태는 못 쓴다(옵션은 속성마다 다르다 — 이름으로 맞추는 것은 v2). 값이 비었으면 빈 값을 쓴다(08 *"빈 값 참조 —
>      폴백, 오류 아님"*).
>    - **저장할 때** — 받는 속성은 기존 셀 검사(살아 있는 셀 속성 · 읽기 전용 아님), 동적 값의 짝(지금은 날짜 · 같은 타입 · 선택지 아님)은
>      `invalid_dynamic`. 원본 속성은 **그 automation 의 표**의 셀 속성이다(`add_page_to` 면 받는 표와 다르다).
>    - **실행할 때** — 그때의 값으로 풀어 기존 명령(`updateCellsIn` · `createRowIn`)에 넘긴다(⑤ 의 권한 · ⑦ 의 `filled_by` 그대로). 원본 값은
>      **실행하는 사람이 그 행을 볼 수 있을 때만** 읽는다(볼 수 없으면 그 액션을 건너뛴다 — ⑫ 의 웹훅과 같다). 원본 속성이 사라졌거나 타입이
>      바뀌었으면 정의가 깨진 것이다 — 실패(④).
>    - 수식 슬롯 · `define_variables` 는 v2(08 *"수식은 v2"*).
>    - **화면**(5d-2) — 값 칸 옆에 **출처**를 고른다: *값*(고정) · *지금*(날짜 속성일 때만) · *누른 행의 ‹속성›*(버튼) / *트리거된 행의 ‹속성›*
>      (DB automation) — 같은 타입이고 선택지 · 상태가 아닌 그 automation 의 표의 속성만 목록에 선다(저장 검사와 같은 규칙). 받는 속성을
>      바꾸면 출처는 *값* 으로 돌아간다. 다른 표에 행 추가의 값도 같다(원본은 일하는 행의 표).
> ⑰ **버튼 블록**(5e-1 · 08 F-08-06) — 페이지 본문에 놓이는 단추. 누르면 액션을 실행한다(버튼 속성과 같은 엔진 · 같은 액션 편집).
>    - **블록 타입 `button`** — 원자 블록(글 · 자식 · 색 없음) · `properties.label`(1~100자 · 비면 *"버튼"* · 정화는 수식의 `expression` 과 같은 자리).
>      본문(Y.Doc)에 산다 — 라벨은 본문의 것이라 협업 · 버전 · 되돌리기를 다른 블록처럼 탄다.
>    - **액션은 `automation(kind = 'button_block', host_page_id = 그 블록의 id)`** — 처음 저장할 때 만든다(블록마다 하나 · 부분 UNIQUE).
>      블록이 본문에서 지워지면 그 행이 지워지고 automation 도 함께 사라진다(FK CASCADE). 복제 · 붙여넣기는 새 블록이라 액션을 옮기지 않는다(§7).
>    - **문** — 읽기는 그 페이지를 볼 수 있으면, 고치기 · 누르기는 그 페이지의 `edit_content`(08 *"생성 · 클릭 권한: Full access 또는
>      Can edit"*) · 잠긴 페이지면 `locked`. 주소는 페이지와 블록(`/pages/{pageId}/buttons/{blockId}`)이고 블록은 **그 페이지의 본문**에 있어야
>      한다. 투영이 밀려 블록의 행이 아직 없으면 밀린 투영을 먼저 한다(편집기는 Y.Doc 을 본다 — 방금 만든 블록일 수 있다).
>    - **일하는 행이 없다** — 값 바꾸기 · 일하는 행의 속성 · 웹훅의 보낼 속성은 고를 수 없다(저장 검사가 빈 표로 본다 → `unknown_property` ·
>      `invalid_dynamic` · 08 *"트리거 페이지가 없는 컨텍스트에서 페이지 property 참조 → 그 옵션을 노출하지 않음"*). 쓸 수 있는 것은 다른 표에 행
>      추가(고정 값 · 지금) · 웹훅(몸은 그 페이지의 id 와 주소) · 블록 넣기(5e-2).
>    - **실행** — 엔진의 `kind: 'button_block'`(누른 사람 · origin `user` · depth 0 · 쓰기는 `button` — DB automation 이 받는다) · 멱등 키는
>      버튼 속성과 같은 `button:{uuid}` · 실행 기록의 `trigger_page_id` 는 그 페이지.
>    - **화면** — `/버튼` 으로 만든다(라벨 *"버튼"* · 곧바로 설정이 열린다 — 08 *"액션 없는 빈 버튼이 남지 않게"*). 블록은 라벨의 단추로 그려지고
>      누르면 실행해 결과를 단추 옆에 짧게 말한다(버튼 속성과 같은 말). ⚙ 로 설정(라벨 · 액션 — 액션 편집 부품 그대로). 읽기 전용 화면에서는
>      누르지 않는다. 내보내기 · 복사의 평문은 `[버튼: ‹라벨›]`.
> ⑱ **`insert_blocks` — 블록 넣기**(5e-2 · 08 F-08-06) — 누르면 미리 적어 둔 블록 묶음을 본문에 복제해 넣는다(구 template button 의 후신).
>    - **설정** `{ v: 1, position: 'below' | 'bottom', blocks: EditorBlock[] }` — 넣을 블록은 본문 저장 트리의 모양 그대로(`validateDoc`).
>      위치는 08 클론 대안의 둘(*버튼 아래* · *페이지 끝*). 블록은 하나 이상(08 *"삽입 블록이 비어 있음 → 저장 시 경고"*) · 자식까지 50개 · 깊이 3.
>    - **넣을 수 있는 타입은 글 계열** — 문단 · 제목 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 · 구분선 · 코드 · 블록 수식. 하위 페이지 · 데이터베이스 ·
>      이미지 · 버튼 · 표 · 컬럼 · 목차 · 이동 경로는 못 넣는다(08 *"삽입 블록에 DB/서브페이지 포함 → 매 클릭마다 새 DB/페이지 생성 — 폭증"* ·
>      파일 참조 수 · 버튼 속의 버튼) → `invalid_blocks`.
>    - **버튼 블록에서만** — 버튼 속성 · DB automation 은 받지 않는다(`unsupported_here` — 08 의 표: *Insert blocks* 는 DB automation X · 행
>      페이지의 본문에 넣는 버튼 속성은 v2).
>    - **실행** — 엔진이 그 페이지의 본문을 **명령 경로로** 연다(판결 V-5 의 경로 ② — 페이지 행 잠금 → 본문 세션 → 변경 → 투영 · 로그 · 퍼뜨리기 ·
>      출처 `api`). 블록마다 **새 id** 로 복제하고, 버튼 아래(그 버튼과 같은 부모 안 · 바로 뒤) 또는 페이지 끝에 넣는다. 버튼이 그사이 본문에서
>      사라졌으면 페이지 끝. 같은 트랜잭션이라 실행이 되돌려지면 넣은 블록도 남지 않는다. 투영이 거부하면(깊이 상한 등) 그 액션은 실패(④).
>    - **화면**(5e-3) — 버튼 블록의 설정 창에 *"+ 블록 넣기"* · 자리(*버튼 아래* · *페이지 끝*) · **줄 목록**(줄마다 타입 · 글 — 텍스트 · 제목 1~3 ·
>      글머리 · 번호 · 할 일 · 토글 · 인용 · 콜아웃 · 구분선 · 코드). v1 은 **한 단계**다(08 의 중첩 편집기 대신) — 자식이 든 저장값은 고치지 않고
>      남긴다(편집기가 모르는 액션과 같다). 줄이 없으면 저장하지 않는다(서버도 `invalid_blocks`).

**[보강] DB automation — 정의 · 실행 주체** ⟨자동화 5b-1 · F-08-09 · F-08-10 / 마이그레이션 0079⟩

> 08 F-08-09 의 규칙형 automation 이다 — 데이터베이스(정확히는 data_source)에서 일이 생기면 액션을 실행한다. 이 조각은 **정의**와 **실행
> 주체**를 세운다. 일을 받아 실행하는 것은 5b-2, 화면은 5b-3.
>
> ① **실행 주체 = 만든 사람**(08 F-08-10 *"automation 생성자로 실행 + 실행 시점 재검증"* — 08 이 [확인필요]로 남긴 자리를 사용자와 정했다
>    · 2026-10-10). 세션 없는 워커가 그 사람을 대신하는 컨텍스트는 **`resolveDelegatedContext(workspaceId, automationId)` 하나만** 발급한다
>    — A9 의 두 번째 발급자. 발급 전에 그 automation 의 `created_by` 가 **지금** 지워지지 않았고(`user.deleted_at`) · 그 워크스페이스의
>    활성 멤버인지 본다. SSO 강제 · 2단계 인증은 묻지 않는다 — 로그인의 문이고, 그 사람이 만들 때 이미 지났다(API 토큰과 같은 판단).
>    통과하지 못하면 automation 을 **끈다**(`enabled = false` · [보강] 칸 `disabled_reason` — `creator_left` · 조용히 실패하지 않는다).
>    권한은 실행할 때마다 그 사람의 **지금** 권한으로 판정된다(액션이 부르는 명령이 묻는다 — 저장할 때의 권한을 쓰면 권한 상승 경로다).
>    위임 컨텍스트는 `delegation: { automationId }` 를 싣고 `sessionId` 자리에 automation id 를 둔다 — 세션에 매인 명령(비밀번호 ·
>    2단계 인증)을 이 컨텍스트로 부르지 않는다.
> ② **정의** — kind `db_automation` · 주인은 data_source(④ 의 [정정] 그대로). 만들기 · 읽기 · 고치기 · 켜고 끄기 · 지우기는 그 데이터베이스의
>    **전체 권한**(`manage_perm` — 08 *"automation 생성·편집에는 DB 의 full access 필요"* · 액션이 바깥으로 나갈 수 있고(5c) 남의 권한으로
>    돈다). 고친 사람이 바뀌어도 실행 주체는 **처음 만든 사람**이다(`created_by` 는 바뀌지 않는다) — 넘기려면 지우고 다시 만든다(§7).
>    이름은 1~100자. 표마다 automation 50개.
> ③ **트리거**(`automation_trigger` — DDL 그대로): `page_added`(조건 없음) · `property_edited`(그 속성 · 조건 선택). 조건은 **보기의 필터와 같은
>    모양** — 그 속성에 대한 잎 하나(`{ property_id, operator, value }` · `validateFilter` 가 본다)이고, 판정은 필터 컴파일러가 그 행 하나에
>    묻는다(5b-2 — 판정이 두 벌이 되지 않게). **값의 모양도 저장할 때 본다**(숫자 · 체크 · 날짜 · 글 — `validateFilter` 는 연산자와 값의
>    유무만 본다 · 사람이 보지 않는 워커가 판정하므로 그때 깨지지 않게). 트리거는 automation 마다 1~5개 · `trigger_mode` 는 `any` 만(`all` 은 §7). `schedule` ·
>    `manual_click` 은 이 조각에서 받지 않는다. 트리거가 가리키는 속성이 지워지면 그 트리거는 맞지 않는다(5b-2 가 끄고 까닭을 남긴다).
> ④ **액션** — 등록부 그대로(`edit_property` 는 **트리거된 행** · `add_page_to`). 저장할 때 버튼과 같은 검사를 지난다(그 표의 스키마 · 대상 표).
> ⑤ 템플릿 행은 트리거하지 않는다(⑪ 과 같은 까닭 — 5b-2).
>
> **받기 · 실행 — 5b-2 에서 정한 것** ⟨마이그레이션 0080⟩
>
> ```sql
> CREATE TABLE automation_event (
>   id            uuid PRIMARY KEY,
>   automation_id uuid NOT NULL REFERENCES automation(id) ON DELETE CASCADE,
>   page_id       uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,   -- 트리거된 행
>   page_added    boolean NOT NULL DEFAULT false,
>   before        jsonb NOT NULL DEFAULT '{}',   -- 감시하는 속성의 창 전 값 { property_id: 셀 값 | null }
>   window_end    timestamptz NOT NULL,           -- 첫 일 + 3초
>   status        text NOT NULL CHECK (status IN ('collecting','dispatching')),
>   locked_until  timestamptz NULL,               -- dispatching 일 때만(임대)
>   created_at    timestamptz NOT NULL DEFAULT now()
> );
> CREATE UNIQUE INDEX ux_automation_event_collecting ON automation_event (automation_id, page_id) WHERE status = 'collecting';
> ```
>
> ⓐ **받는 곳 — 쓰기와 같은 트랜잭션**(AU2 를 4e-2 의 방식으로): 행 만들기(`createRowIn` → `page_added`)와 셀 쓰기(`updateCellsIn` → 바뀐
>    속성마다 `property_edited`). 그 표에 켜진 DB automation 이 그 일을 볼 때만 쌓는다(질의 하나 — 없으면 끝). 활동 기록(5분 접기)은
>    쓰지 않는다 — 접힌 편집이 트리거를 잃는다. relation 연결 · 행 제목이 아닌 본문 편집 · 수식 · 롤업 재계산은 트리거하지 않는다(08 *"사용자
>    편집에 의한 직접 변경만"* — 셀 속성만 · §7).
> ⓑ **3초 창 · 순변화**(08 *"Database automations work over a three second window"*) — automation · 행마다 모으는 묶음 하나. 첫 일에서
>    감시하는 속성의 **창 전 값**(`before`)을 붙들고 창 안의 일은 그것을 덮지 않는다(가장 이른 값이 남는다). 창이 끝나면 그 속성의 지금
>    값과 비교해 **바뀌었고**(셀이 없는 것과 빈 값의 셀은 같다) 조건이 지금 값에 맞을 때만 실행한다 — 창 안에서 되돌리면 실행하지 않는다. `page_added` 는 행이 아직
>    살아 있으면. 창이 끝난 뒤 **워커의 다음 판**에 실행된다 — 판은 5초마다(남았으면 곧바로) · 워커는 다음 일의 시각까지만 쉰다(길어도 `WORKER_INTERVAL_MS`).
> ⓒ **자동화는 자동화를 깨우지 않는다**(08 F-08-10) — 쓰기는 `origin` 을 싣는다(`user` · `button` · `automation`). `automation` 이 쓴 것은
>    받지 않는다. **버튼이 쓴 것은 받는다**(08 *"버튼 클릭으로 페이지가 생성되면 automation 은 발동한다"*). 셀의 `filled_by` 는 둘 다
>    `automation` 이다(누가 채웠나 — 사람이 아니다). DB automation 의 실행은 origin `automation` · depth 1.
> ⓓ **실행 — 공용 스케줄러의 일 `automation_dispatch`**: 창이 끝난 묶음을 잡아(`dispatching` · 임대 · `FOR UPDATE SKIP LOCKED`) 하나씩 —
>    위임 컨텍스트를 받는다(못 받으면 automation 을 끈다 — `creator_left`) · automation 이 켜져 있고 행이 살아 있고 템플릿이 아니고
>    데이터베이스가 잠기지 않았는지(08 *"DB 가 잠겨 있으면 트리거하지 않는다"*) · 트리거의 속성이 아직 살아 있는지(아니면 끈다 —
>    `trigger_broken`) · 순변화와 조건(필터 컴파일러가 그 행 하나에 묻는다) → 맞는 트리거가 하나라도 있으면(`any`) 엔진으로 실행한다(멱등 키
>    `event:{묶음 id}`). 끝나면 묶음을 지운다 — 기록은 실행 기록이 남는다.
> ⓔ **실패가 이어지면 끈다** — 같은 automation 의 최근 실행 셋이 모두 `failed` 면 `failures` 로 끈다(사람이 다시 켠다). 권한 · 잠금으로 건너뛴
>    것(`partial`)은 실패가 아니다.
> ⓕ 한 판에 묶음 50개 — 큰 가져오기는 여러 판에 나뉜다.
>
> **화면 ① 목록 · 켜고 끄기 · 실행 기록 — 5b-3a 에서 정한 것** ⟨마이그레이션 없음⟩
>
> ⓐ **자리 — 도구줄 줄의 ⚡ "자동화"**(08 *"DB 헤더의 ⚡ 아이콘(활성 automation 개수 배지), automation 목록 팝오버, 켜기/끄기 토글"*).
>    지금 보기의 소스(`host_data_source_id`)의 **전체 권한**이 있는 사람에게만 선다 — 서버가 정의의 문(`manage_perm`)으로 물어 배지와 함께
>    준다. 배지는 켜진 수, 꺼진 까닭이 있는 것이 하나라도 있으면 `!`(08 *"automation 에 느낌표가 붙고"*).
> ⓑ **목록은 열 때 받는다**(템플릿 패널과 같다). 항목마다 이름 · 트리거 요약(*"새 항목이 추가되면"* · *"‹속성›이 바뀌면"* · 조건이 있으면
>    *"‹속성›이 ‹조건›"* — 여럿이면 *"또는"*, 정본 받기 · 실행 ⓓ 의 `any`) · 액션 요약(버튼과 같은 말) · 실행 주체(만든 사람 — 떠났으면
>    *"떠난 사람"*) · 켜고 끄기(스위치) · 꺼진 까닭(만든 사람이 떠남 · 트리거의 속성이 지워짐 · 실패가 이어짐 — 켜면 지워진다 · 0079 ②).
>    속성 이름은 그 표의 스키마에서 읽는다(숨긴 속성도 · 5a-4 ⓐ 와 같다) — 사라진 속성은 *"지워진 속성"*.
> ⓒ **지우기는 한 번 더 묻는다** — 실행 기록이 함께 사라진다(FK CASCADE).
> ⓓ **실행 기록** — automation 마다 최근 50개(보관 상한과 같다 · 새것부터) · 문은 정의와 같다. 줄마다 시각 · 결과(성공 · 일부 건너뜀 · 실패)
>    · 트리거된 행(보는 사람이 볼 수 있으면 제목 링크 · 볼 수 없으면 *"볼 수 없는 항목"* · 지워졌으면 *"지워진 항목"* — relation 의 제목 맵과
>    같은 셋) · 단계마다 결과와 까닭(버튼과 같은 말). 만든 행(`add_page_to`)은 열어 주지 않는다(⑥ — 기록은 id 만 담는다 · 그 행의 권한은
>    따로 묻지 않는다).
> ⓔ **잠금** — 데이터베이스가 잠기면 실행하지 않지만(받기 · 실행 ⓓ) 정의 · 켜고 끄기는 잠금과 무관하다(정의의 문이 잠금을 보지 않는다 —
>    5b-1). 패널은 잠긴 동안 *"잠긴 동안은 실행되지 않습니다"* 를 알린다. 붙인 소스의 보기는 **원본**의 잠금을 본다(실행 쪽이 보는 것).
> ⓕ 만들기 · 고치기(이름 · 트리거 · 조건 · 액션)는 5b-3b.
>
> **화면 ② 만들기 · 고치기 — 5b-3b 에서 정한 것** ⟨마이그레이션 없음⟩
>
> ⓐ **여는 곳** — 패널의 *"+ 새 자동화"* 와 항목마다의 *"고치기"*. 같은 편집기다. 저장은 만들기 `POST` · 고치기 `PATCH`(이름 · 트리거 ·
>    액션 — 켜짐은 목록의 스위치만 바꾼다). 저장하면 목록이 그 결과로 바뀐다(배지도).
> ⓑ **이름** — 1~100자(서버가 다시 본다). 새 자동화의 기본 이름은 *"새 자동화"*.
> ⓒ **트리거** — 1~5개. *"새 항목이 추가되면"* · *"‹속성›이 바뀌면"*(그 표의 스키마의 셀 속성 — 숨긴 속성도 · 5a-4 ⓐ 와 같다). 속성 편집에는
>    **조건을 하나** 걸 수 있다 — 연산자와 값 칸은 보기의 필터와 같은 부품이다(카탈로그의 연산자 · 타입별 값 칸). 값이 필요한 연산자에 값이
>    없으면 저장하지 않는다. 둘 이상이면 *"하나라도 일어나면 실행합니다"* 를 적는다(받기 · 실행 ⓓ 의 `any`).
> ⓓ **액션** — 버튼 편집기와 **같은 부품**(`action-editor.tsx`): *"트리거된 행의 값 바꾸기"*(`edit_property`) · *"다른 표에 행 추가"*(대상
>    표 · 템플릿 · 값). 편집기가 모르는 액션은 저장해도 남는다(버튼 ⑩ 과 같다).
> ⓔ **거절은 자리와 함께** — 서버의 `invalid_trigger` · `invalid_action`(+ `problem` · `index`) · `invalid_name` · `too_many` 를 *"2번째
>    트리거: 조건이 그 속성에 맞지 않습니다"* 처럼 말한다. 저장하지 못하면 편집기는 닫히지 않는다.
> ⓕ **실행 주체를 말한다** — 고칠 때 *"실행 주체는 처음 만든 ‹이름›으로 남습니다"*(정의 ① — 고친 사람으로 바뀌지 않는다), 만들 때 *"내
>    권한으로 돕니다"*.

---

**[보강] 성능 계측 — 실사용 측정값(RUM)** ⟨플랫폼 잔여 10e-1a조각 · F-12-18 / 마이그레이션 0106⟩

> 12 F-12-18 *"지표 이름을 제품 동작으로 정의 · P95 를 본다"* · *"sample_rate 와 completed 를 이벤트에 같이 저장 — 둘 중 하나라도 없으면 사후
> 재계산이 불가능하다"* · *"계측 payload 에 페이지 제목 · 본문이 섞이면 정보 유출 — 식별자만 · 워크스페이스 id 도 해시 검토"* · 클론 대안 *"웹은
> web-vitals(LCP/INP/CLS) + 커스텀 마크 · 샘플링 10~20% 와 sample_rate 를 이벤트에"*. 12 의 `perf_event` 는 사람 · 공간의 해시와 플랫폼 칸을
> 가졌다 — 여기는 그것을 **두지 않는다**(아래 ①).
>
> ```sql
> CREATE TABLE perf_event (
>   id bigserial PRIMARY KEY,
>   metric_key  text NOT NULL CHECK (metric_key IN ('TTFB','FCP','LCP','CLS','INP','editor_ready')),
>   value       double precision NOT NULL CHECK (value >= 0 AND value < 600000),   -- 밀리초(CLS 는 점수)
>   route       text NOT NULL CHECK (length(route) <= 120 AND route ~ '^(/|(/([a-z0-9._-]{1,20}|\[[a-z]{1,10}\]))+)$'),
>   navigation  text NULL CHECK (navigation IN ('navigate','reload','prerender','back-forward','back-forward-cache','restore')),
>   completed   boolean NOT NULL DEFAULT true,
>   sample_rate real NOT NULL CHECK (sample_rate > 0 AND sample_rate <= 1),
>   recorded_at timestamptz NOT NULL DEFAULT now()
> );
> ```
>
> ① **아무도 가리키지 않는다** — 사람 · 워크스페이스 · 페이지의 id(해시도)를 두지 않는다. 경로는 **틀**(`/w/[id]/db/[id]`)만 — 알려진 정적
> 조각만 남기고 uuid 는 `[id]`, 나머지(공개 토큰 · 사이트 이름 · 제목)는 `[x]`(`routeTemplate` — 브라우저가 보낸 경로도 서버가 다시 틀로
> 만든다). 표가 모양을 막는다(조각 20자 · 소문자 — uuid 36자 · 토큰 22자 · 한글이 들어오지 못한다). 지역 · 플랫폼 · 버전 칸은 쓰임이 오면
>
> ② **표본 비율과 끝났는가를 함께** — 추정 수는 `sum(1 / sample_rate)` · 끝나지 않은 측정(시작했으나 끝나지 않았다 — 생존자 편향)은
> `completed = false` 로 남기고 백분위에서 뺀 채 그 비율을 따로 본다
>
> ③ **받는 문** — `POST /api/perf`(살아 있는 세션의 사람만 · 사람마다 1분에 60번 · 한 번에 20개 · 모양이 틀린 것은 그 하나만 버린다 ·
> `sendBeacon` 의 글 몸). 워크스페이스를 묻지 않는다
>
> ④ **읽는 곳은 운영자 명령 하나**(`npm run perf -- [일수]` — 지표 · 경로마다 p50 · p75 · p95 · 미완료율 · 추정 수). HTTP 로 열지 않는다.
> 브라우저의 수집기(웹 바이탈 · `editor_ready`)는 10e-1b. 보관 기간(지우는 일)은 스케줄러에 쓰임이 오면
>
> ⑤ **[10e-1b] 브라우저의 수집기** — 워크스페이스 화면(레이아웃)에 하나. **표본은 페이지 읽기마다 한 번**(비율은 환경 변수
> `PERF_SAMPLE_RATE` — 기본 0.2 · 0 이면 끈다 · 측정값마다 싣는다). 웹 바이탈(`useReportWebVitals` — TTFB · FCP · LCP · CLS · INP)과
> `editor_ready`(**문서를 처음 읽은 뒤의 첫 본문 편집기** — 읽기를 시작한 때부터 쓸 수 있게 되기까지 · 그 전에 화면을 떠나면 `completed=false`
> · 화면 안에서 옮겨 간 뒤의 편집기는 재지 않는다). 모아 두었다가 20개가 차거나 화면을 떠날 때(`visibilitychange` hidden · `pagehide`)
> `sendBeacon`. 경로는 보내기 전에 틀로(받는 쪽이 다시 한다)
>
> ⑥ **[10g-1] 번들 예산**(12 F-12-07 *"로케일 데이터 같은 '전부 번들되는 데이터'가 조용히 번들을 키운다"*) — 경로마다 **처음 받는 JS**
> (gzip)의 상한을 CI 가 본다(빌드 바로 뒤 · `npm run check:bundle`). 처음 받는 것은 모든 경로가 받는 것(`build-manifest.json` 의
> `rootMainFiles`) ∪ 그 경로의 레이아웃 · 페이지의 진입 청크(`page_client-reference-manifest.js` 의 `entryJSFiles`) — 지연 로드(`import()`)는
> 세지 않는다(그쪽으로 옮기는 것이 이 예산이 바라는 일이다). 크기는 파일마다 gzip 한 것의 합. 예산은 규칙 다섯(앞에서부터 처음 맞는 것) —
> 데이터베이스 템플릿 편집 470KB · 데이터베이스 화면 520KB · 페이지 450KB · 워크스페이스의 다른 화면 230KB · 나머지(로그인 · 공개 · 초대)
> 160KB. **여유는 가장 작은 무거운 덩어리보다 작게**(KaTeX ≈ 75KB — 수식 · 코드 문법 · 이모지 자료 중 하나라도 정적으로 들어오면 넘는다 ·
> 정할 때 규칙에서 가장 큰 경로의 크기를 함께 적고 테스트가 여유를 본다 · 크기가 크게 다른 경로는 규칙을 나눈다). 예산을 올리는 것은 커밋으로 보이는 결정이다 — 왜 커졌는지 적고 올린다. 요청 워터폴(첫 화면의 DB 왕복)은 다음
**[보강] 새 버전 알림 — 배포의 표지** ⟨플랫폼 잔여 10h-1조각 · F-12-17⟩

> 12 F-12-17 *"브라우저 탭을 3일간 열어둔 채 편집한다 → 그 사이 서버가 배포되었다 → 요청이 400 으로 실패하거나, 새 번들 청크를 못 찾는다"* ·
> 클론 대안 *"응답 헤더에 빌드 해시를 실어 클라이언트가 다르면 새로고침 배너"*. Next 의 `deploymentId` 는 **화면을 옮길 때만** 어긋남을
> 잡는다(그때 전체 새로고침) — 옮기지 않고 오래 연 편집기는 우리가 묻는다.
>
> ① **표지는 서버가 런타임에 안다** — 환경 변수 `APP_RELEASE`(배포가 준다) · 없으면 빌드의 `.next/BUILD_ID` · 그것도 없으면(개발) 모른다
> (null). 모양은 영숫자 · `.` `_` `-` 64자까지(아니면 모른다). 프로세스마다 한 번 읽는다. 저장하지 않는다(표 없음)
> ② **묻는 문** — `GET /api/release` → `{ release }`(세션 없이 · DB 없이 · `no-store`)
> ③ **문서가 실려 온 표지** — 워크스페이스 레이아웃이 그 렌더의 표지를 감시자에게 넘기고, 감시자는 **처음 받은 것을 문서가 끝날 때까지**
> 쥔다(나중의 렌더 — `router.refresh()` — 가 새 서버의 값을 넘겨도 바꾸지 않는다: 돌고 있는 JS 는 처음 문서의 것이다)
> ④ **언제 묻나** — 화면이 다시 보일 때(`visibilitychange` → visible) · 10분마다. 문서를 처음 열 때는 묻지 않는다(방금 받았다)
> ⑤ **다르면 띠** — "새 버전이 있습니다" · [새로고침] · [나중에]. 둘 중 하나라도 모르면 다르다고 하지 않는다. "나중에" 는 **그 표지**를
> 덮는다 — 더 새 표지가 오면 다시 선다. 강제로 새로고침하지 않는다(편집 중일 수 있다 — 본문은 협업 서버가 이미 저장한다)
> ⑥ **[10h-2] 앱의 청크를 못 받으면 곧바로 묻는다** — 지연 로드는 `<script>` · `<link>` 를 붙여 받는다(Turbopack) — 창의 **포착 단계
> `error`** 로 그 실패를 한곳에서 본다(각 `import()` 자리를 고치지 않는다). **이 앱의 정적 자산만**(같은 출처 · `/_next/static/`) · **30초에
> 한 번**(여러 청크가 한꺼번에 실패해도 한 번 묻는다). 배포 뒤 옛 청크가 지워졌으면(404) 다시 보이기를 기다리지 않고 곧바로 띠가 선다
> ⑦ 오래된 청크를 남겨 두는 일(CDN 유예) · 요청 스키마의 호환 검사는 다음
**[보강] 지원 브라우저 — 기능 감지** ⟨플랫폼 잔여 10i-1조각 · F-12-15⟩

> 12 F-12-15 *"어떤 OS · 브라우저 버전에서 동작한다고 보증하는지"* · 클론 대안 *"런타임 체크는 caniuse 대신 기능 감지 3~4개로 축약 · 플랫폼
> 매트릭스는 상수 파일 1개로 시작"*.
>
> ① **지원 범위** — Next 16 의 기본 대상(Chrome · Edge 111+ · Firefox 111+ · Safari 16.4+)과 Tailwind v4 가 내는 CSS(`oklch` · `color-mix` ·
> `:where`)가 겹치는 곳 — 안내에는 "Chrome · Edge 111 · Firefox 113 · Safari 16.4 이상" 으로 적는다(Firefox 의 `color-mix` 가 113)
> ② **버전 문자열(UA)을 읽지 않고 기능을 본다** — 다섯: `structuredClone` · `Array.prototype.at` · `Object.hasOwn` · CSS `color-mix()` · CSS
> `:where()`(`platform/browser-support.ts` 의 표 하나). 하나라도 없으면 화면 위에 안내 띠(`role="alert"` · 무엇이 없는지 `data-missing`)를
> 세운다. **앱을 막지 않는다**(될 수도 있다 — 쓰는 사람이 고른다)
> ③ **첫 HTML 의 인라인 스크립트**(ES5 · 루트 레이아웃의 `<head>`) — 앱의 JS 가 돌기 전에, 그 JS 가 못 도는 브라우저에서도 선다. 모든 화면
> (공개 화면 · 로그인 포함). 서버로 아무것도 보내지 않는다(어느 브라우저가 못 미쳤는지 남기지 않는다)
> ④ `isAvailable(featureKey)` 게이팅(플랫폼마다 빠지는 기능)은 플랫폼이 둘이 될 때 — 지금은 웹 하나다
**[보강] 좁은 화면 — 사이드바 서랍** ⟨플랫폼 잔여 10j-1조각 · F-12-12⟩

> 12 F-12-12 *"모바일 읽기는 P0 에 가깝고(공유 링크가 폰에서 열린다) · 모바일 편집은 P1"* · 클론 대안 *"네이티브 앱 대신 반응형 웹 + PWA"*.
> 지금까지 사이드바는 폭과 상관없이 256px 이었다 — 폰(390px)에서 본문이 130px 남짓이었다.
>
> ① **`md`(768px) 미만은 서랍** — 사이드바를 숨기고 화면 왼쪽 위의 "☰" 로 연다. 열면 본문 위에 덮개로 서고(폭 18rem · 화면의 85% 까지)
> 뒤를 어둡게 덮는다. **닫힘** — 덮인 곳을 누르거나 · Esc · 화면을 옮기면(연 주소를 기억해 비교한다 — 효과로 닫지 않는다)
> ② **넓은 화면은 그대로** — 접기(`Ctrl/Cmd + \` · "»")는 넓은 화면의 것이다. 좁은 화면에서는 접힌 레일 대신 "☰"
> ③ 컬럼은 이미 640px 이하에서 세로로 쌓는다(편집기 · 공개 화면 — 1c · 6a). 공개 화면에는 사이드바가 없다
> ④ 소프트 키보드는 ⑪ — 터치 끌기는 ⑨ · PWA 는 ⑩
> ⑤ **[10j-2] 화면마다 가로 스크롤이 없다**(폰 폭 390) — 설정 · 인박스 · 라이브러리 · teamspace · 공개 화면 · 로그인 · 워크스페이스 고르기.
> 설정 줄은 좁은 화면(`sm` 미만)에서 이름 위 · 컨트롤 아래로 쌓는다(입력칸이 256px 고정이라 문서 폭이 520px 로 늘었다). **데이터베이스의
> 표는 예외** — 표 바깥(머리 · 도구줄)만 넘치지 않고 표는 문서가 가로로 흐른다. 표를 넘침을 담는 틀에 넣으면 칸 안에 떠 있는 메뉴 ·
> 편집기(열 메뉴 · 고르개 · 사람 · 관계)가 잘린다 — 그것들을 포털로 옮기는 것이 먼저다(다음)
> ⑥ **[10j-3a] 기준점에 붙는 층** — 팝오버를 그 자리에 절대 위치로 그리지 않고 **몸(body)으로 내보내 `position: fixed`** 로 세운다
> (`AnchoredLayer`). 기준점은 그 자리의 **위치를 가진 가장 가까운 조상**(절대 위치였을 때의 기준과 같다). 자리는 순수 함수 하나(`placeLayer`
> — 아래에 · 자리가 모자라고 위가 더 넓으면 위로 · 가로는 정렬(시작 · 끝)에 맞추되 화면 안으로 · 넘치면 최대 높이). 스크롤(어느 틀이든) ·
> 창 크기 · 층과 기준점의 크기가 바뀌면 다시 잰다. React 의 사건은 포털을 넘어 그대로 흐르지만 DOM 의 `contains` 는 아니다 — "포커스가 칸
> 안에 머무는가"처럼 DOM 으로 보는 곳은 `containsAcrossLayers`(층에서 그 기준점으로 거슬러 올라가 본다). 첫 대상은 select · status 칸의
> 고르개 — 나머지(열 메뉴 · 사람 · 관계 · 열 추가 · 계산 · 새 행)를 옮긴 뒤에 표를 자기 틀 안에서 흐르게 한다
> ⑦ **[10j-3b] 표의 팝오버 여섯** — 열 메뉴 · 열 추가 · 계산(위를 선호 — `prefer`) · 새 행 메뉴 · 사람 · 관계도 층으로. 팝오버의 틀(역할 ·
> 이름표 · 키 · 폼 제출)은 그대로 두고 층이 감싼다(층은 자리만 맡는다). **원래 자리의 글자 모양**(글꼴 · 크기 · 굵기 · 줄 높이 · 자간 ·
> 색)을 열 때 층에 옮겨 둔다 — 몸으로 나가면 칸 · 머리 칸에서 물려받던 것이 끊긴다(머리 칸의 메뉴는 12px). 새 행 메뉴의 바깥 클릭은
> `containsAcrossLayers` 로 — DOM 의 포함만 보면 메뉴 안을 누르는 순간 바깥으로 읽고 닫혀 고른 것이 사라진다. 필터 값의 사람 고르개를
> 품은 틀의 blur 도 같다. **쪽(위 · 아래)은 열 때 정해 쥔다** — 내용이 자랄 때마다(버튼 설정에 액션을 더하듯) 다시 고르면 뒤집혀 자리가
> 튀고 누르던 것이 비켜 간다. 그 뒤에는 자리 · 최대 높이만 다시 잰다(모자라면 층 안에서 스크롤). **스크롤바 자리는 늘 비워 둔다**
> (`scrollbar-gutter: stable`) — 내용이 최대 높이를 넘는 순간 스크롤바가 생겨 층이 넓어지면, 끝에 맞춘 층은 다음 프레임에 그만큼
> 옆으로 밀려 누르던 단추가 손 밑에서 비켜 간다
> ⑧ **[10j-3c] 표는 자기 틀 안에서 가로로 흐른다** — 칸의 마지막 팝오버(날짜 칸의 알림 종 메뉴)도 층으로 옮기고(바깥 클릭은
> `containsAcrossLayers`), 표를 `overflow-x: auto` 틀로 감싼다. ⑤의 예외가 닫힌다 — 폰 폭의 데이터베이스도 문서는 가로로 흐르지 않고,
> 넓은 화면에서 넓은 표도 페이지가 아니라 표가 스크롤한다(머리 · 도구줄은 제자리). 틀은 한 축이 `auto` 라 세로도 자르므로(CSS 규칙)
> **표 안에는 칸 밖으로 그리는 것이 없어야 한다** — 새 팝오버는 처음부터 층으로. 열린 층은 틀이 가로로 스크롤하면 기준점을 따라간다
> (포착 단계의 scroll)
> ⑨ **[10m-1] 터치** — 터치 기기(`hover: none`)에서. 12 F-12-12 *"드래그 재정렬은 터치에서 long-press → drag 로만 가능하며 스크롤
> 제스처와 충돌한다"*.
> ⓐ **블록 손잡이는 그대로 선다** — 탭이 호환 마우스 이벤트를 쏘아 그 줄의 손잡이가 화면 안에 서고, 손잡이는 포인터 이벤트 +
> `touch-action: none` 이라 끌면 옮기고 눌러만 떼면 블록 메뉴가 열린다. 손잡이는 그것만을 위한 자리라 길게 누르기가 필요 없다
> ⓑ **보드 카드는 길게 눌러 끈다** — 카드 전체에 `touch-action: none` 을 주면 폰의 보드(거의 카드로 덮인다)를 손가락으로 스크롤할 수
> 없다. 누른 채 **350ms 를 8px 안에서** 버티면 끌기가 시작되고, 그 전에 8px 넘게 움직이면 스크롤이다(끌기를 시작하지 않는다). 끄는
> 동안의 `touchmove` 는 막아 스크롤로 가지 않게 한다 — 보드가 늘 비수동(`passive: false`) `touchmove` 를 듣고 끄는 동안만 막는다(막을지는
> 손가락이 닿는 순간의 처리기로 정해지므로 끄기 시작할 때 붙이면 늦다). 길게 누르는 동안 글자 선택 · 기기의 길게 누르기 메뉴는 뜨지 않는다.
> 마우스 · 펜은 그대로(4px 움직이면 끌기)
> ⓒ **hover 로만 보이던 단추는 터치에서 늘 보인다** — Tailwind 의 `hover:` 는 `(hover: hover)` 안에서만 걸려 터치 기기에서는 영영 보이지
> 않았다(그래도 탭은 받아 보이지 않는 단추를 누를 수 있었다). `touch:`(= `@media (hover: none)`) 변형으로 **그 단추 말고는 길이 없는
> 것**만 — 행의 "열기"(표 · 보드) · 사이드바 줄의 + · ⋯ · 날짜 칸의 알림 종 · 페이지 아이콘 넣기 · 표 바닥의 계산. 캘린더 날짜마다의
> + 는 뺀다 — 폰 달력에 서른다섯 개가 늘 서고, 만들기는 다른 길(New)이 있다
> ⑩ **[10m-3] 설치할 수 있는 웹 앱(PWA)** — 12 F-12-12 클론 대안 *"네이티브 앱 대신 반응형 웹 + PWA"*.
> ⓐ **설치** — 웹 앱 매니페스트(`app/manifest.ts` → `/manifest.webmanifest` · 이름 · 시작 주소 `/` · `standalone` · 색 · 아이콘 192 · 512 와
> 가장자리까지 채운 512 maskable) · 아이콘은 코드로 그린다(`app/icon.tsx` · `apple-icon.tsx` — 파일을 두지 않는다) · 화면 머리의 색(`theme-color` —
> 밝은 · 어두운 테마) · iOS 의 홈 화면(`apple-mobile-web-app-*`). 매니페스트 · 아이콘은 로그인 없이 받는다(브라우저가 쿠키 없이 받는다)
> ⓑ **오프라인 셸(서비스 워커의 캐시)은 넣지 않는다** — 화면이 로그인한 사람의 것을 서버에서 그리므로(권한으로 거른 제목 · 목록) 캐시하면 로그아웃한
> 뒤 · 권한을 잃은 뒤에도 그 화면이 남는다. 오프라인의 편집은 이미 보존된다(IndexedDB · F-05-04 — 다시 붙으면 보낸다). 푸시 알림도 없다(알림은 인박스)
> — 서비스 워커는 그것들이 생길 때 함께 들인다
> ⑪ **[10j-4] 소프트 키보드** — 12 F-12-12 *"소프트 키보드가 뷰포트를 절반 가리므로 caret 자동 스크롤 보정이 필요하다(`visualViewport` API)"*.
> ⓐ **키보드가 화면을 줄인다** — 뷰포트 머리표에 `interactive-widget=resizes-content`. 안드로이드의 Chrome · Firefox 는 키보드가 레이아웃 뷰포트를
> 줄여 본문의 틀이 함께 줄고 브라우저가 캐럿을 보이게 한다(위에 고정한 상단 바도 그대로 선다)
> ⓑ **그 머리표를 모르는 브라우저(iOS Safari)는 보이는 영역만 준다** — 터치 기기(`hover: none`)에서 편집 칸(`contenteditable` · 입력칸)에 포커스가
> 있을 때 `visualViewport` 의 **크기**가 바뀌면 캐럿(선택의 끝 자리 · 입력칸은 칸 자신)이 보이는 영역 안(위아래 여백 16px)에 있는지 보고, 밖이면
> 그만큼 캐럿을 담은 스크롤 틀을 굴린다(순수 함수 `caretScrollDelta` 하나). 보이는 영역의 **스크롤**은 듣지 않는다 — 키보드를 연 채 다른 곳을 보려고
> 굴리면 캐럿으로 끌려 돌아온다. 넓은 화면 · 마우스에서는 하지 않는다(창 크기 · 확대를 키보드로 오해하지 않는다)
> ⓒ 키보드 위의 서식 줄(노션 모바일의 키보드 상단 툴바)은 두지 않는다 — 글자를 고르면 서는 서식 툴바가 있다

### 3.11 알고리즘 정본

**유효 권한 `effective()`**

```
-- 0단계: 정책 게이트 (유일한 deny 계층. ACL 보다 먼저)
if not policy_allows(workspace(N), action):            return DENY
if not can_enter_workspace(session, workspace(N)):     return DENY      -- <14 R-11> SSO 강제

-- 1단계: grant 합집합
effective(session S, node N) -> level:
    U = S.user_id
    local = MAX_BY_CAP over acl_entry(N) where principal in P(U)
    if block_acl_meta(N).inherits_from_parent and parent(N) exists:
        local = MAX_BY_CAP(local, effective(S, parent(N)))     -- 절단 노드에서 멈춘다
    -- 아래 2항은 노드 로컬 grant. 절단 플래그의 영향을 받지 않는다.
    -- [정정 6a-1] public_link_grant(U,N) 는 이 합집합에 없다 — 공개 경로가 따로 판정한다(§3.3 끝 [정정] 웹 게시).
    local = MAX_BY_CAP(local, page_access_rule_grant(U,N), form_submitter_grant(U,N))
    return local or 'none'

  P(U) = {('user',U)} + {('group',g) : g in active_groups(U)}
       + {('teamspace',t) : t in active_teamspaces(U)}
       + {('workspace_everyone',NULL) : U 가 role in (owner,membership_admin,member) 인 active 멤버}
  -- [정정 6a-1] ('public',NULL) 은 P(U) 에 없다. acl_entry 의 'public' 행은 쓰지 않는다(CHECK · 0084).
  -- guest 와 restricted_member 는 workspace_everyone 에 포함되지 않는다. [확인필요] 6-7

-- 2단계: 잠금 게이트
if node_lock(N) exists and action in {edit_content, edit_structure, edit_layout}:  return BLOCK
```

`MAX_BY_CAP` = capability 비트마스크 OR 후 가장 가까운 표시용 레벨로 환원. **단순 정수 MAX 금지**(규칙 A2).
Enterprise 관리자 콘텐츠 검색·감사는 `effective()` 의 항이 아니라 별도 경로다("Admin roles don't change what someone can see or edit").

**권한 스코프 `perm_scope_id`**

> `perm_scope_id(N)` = N 자신 또는 가장 가까운 조상 중 **`acl_entry` 를 1개 이상 갖거나, `inherits_from_parent=FALSE` 인 노드**의 id. 없으면 teamspace 루트(또는 Private 루트) id. ([정정 6a-1] *"`public_link.enabled=true` 인 노드"* 를 뺐다 — 공개는 판정 밖이다.)

재계산 트리거는 정확히 4개다 — ① 첫 `acl_entry` 삽입 ② 마지막 `acl_entry` 삭제 ③ `inherits_from_parent` 전이 ④ 서브트리 이동. 전부 `UPDATE block SET perm_scope_id=... WHERE ancestor_path @> ARRAY[:N]` 형태의 서브트리 일괄 갱신이다. ([정정 6a-1] X-8 이 더한 ⑤ `public_link.enabled` 전이는 없다 — §3.3 끝 [정정] 웹 게시 ②.)

**상속 차단 쓰기 알고리즘**

```
restrict(N, principal P):        -- Share 패널에서 '상속됨' P 를 Remove
  if block_acl_meta(N).inherits_from_parent: materialize(N)   -- 순서를 바꾸면 P 외 전원도 잃는다
  DELETE FROM acl_entry WHERE node_id=N AND principal=P
  recompute_perm_scope(N); INCR acl_epoch; INCR perm_ver:{path(N)}

materialize(N):
  INSERT INTO acl_entry(node_kind,node_id,principal_type,principal_id,level)
  SELECT 'block', N, p.type, p.id, MAX_BY_CAP(p.level) FROM inherited_grants(parent(N)) p
  ON CONFLICT DO NOTHING                                       -- 노드 로컬 명시 부여가 우선
  UPDATE block_acl_meta SET inherits_from_parent=false, materialized_at=now() WHERE node_id=N

move_to_private(N, U):
  block.parent_id <- U 의 private root                          -- reparent
  DELETE FROM acl_entry WHERE node_id=N AND NOT (principal_type='user' AND principal_id=U)
  UPSERT acl_entry(N,'user',U,'full_access')
  -- inherits_from_parent 는 건드리지 않는다. 하위 명시 부여는 그대로 살아남는다.
```

**[보강] Private 루트는 숨은 단일 블록이 아니라 — `owner_user_id` 를 진 최상위 페이지들이다** ⟨Teamspace · 게스트 · 그룹 7c-7 / 마이그레이션 없음⟩

> 위 `move_to_private` 의 *"U 의 private root"* 는 사용자당 **하나의 숨은 루트 블록**으로 읽힐 수 있다. 그렇게 읽지
> 않는다 — 판결문 C-9 자신이 `workspace` 부모를 *"Private 루트 페이지(`owner_user_id NOT NULL`) 및 워크스페이스 직속
> 페이지"* 로, 구분을 *"`parent_type` + `owner_user_id`"* 로 적었고, 스키마에도 단일 루트를 강제할
> UNIQUE(workspace, owner) 가 없다. **개인 페이지는 `owner_user_id` 를 진 최상위 페이지 하나하나**이고, 숨은 컨테이너
> 블록은 없다.
>
> ① 숨은 루트 블록을 두면 그 블록이 **페이지이므로** 휴지통 · 이동 · 공유 · 검색 · 복제 · 내보내기 · breadcrumb · 깊이
> 계산 전부에서 "이 페이지는 예외"를 알아야 한다 — 새는 특수 취급이 서브시스템 수만큼 생긴다. 주인 표시 방식이면
> 개인 페이지는 **행이 좁은 보통 페이지**다: 판정 · 목록 · 검색이 이미 ACL 로 거르므로 새 축이 없다.
>
> ② 그래서 `move_to_private(N, U)` 의 reparent 는 `parent_type='workspace'` + `owner_user_id=U` 로 읽는다. ACL 재설정
> 부분(나 아닌 노드 로컬 행 삭제 · 내 full_access UPSERT · 상속 플래그 불변 · 하위 명시 부여 생존)은 의사코드
> 그대로다. 주인의 full_access 행은 **그 자리의 상속분**이다 — 공용 최상위의 `workspace_everyone` 행과 같은 지위
> (위 7c-3 보강 ①)이고, 개인 최상위를 떠나면 거둔다.
>
> ③ B4 의 *"복원 실행자의 Private 루트로 재부모화"* = 워크스페이스 부모 + `owner_user_id=복원자` + 복원자의
> full_access 행. 단 B4 는 `move_to_private` 가 아니므로 **기존 명시 부여를 지우지 않는다**(§3.2-21 ③ 의 결정 그대로 —
> 복원은 사람이 자리를 고른 것이 아니다).
>
> ④ 사이드바 구분(F-07-16 · C-9): 루트 블록이 teamspace 부모면 **Teamspaces**, 워크스페이스 부모 + 주인이 나면
> **개인 페이지**, 주인이 남이거나 조상이 보이지 않아 트리 중간에서 루트가 된 조각이면 **공유됨**, 주인이 없으면
> **워크스페이스 페이지**다. 전부 파생이다 — 저장된 분류가 없다.
>
> ⑤ 개인 페이지를 만들고 옮길 수 있는 것은 게스트가 아닌 멤버다(게스트는 받은 페이지로만 산다 — F-06-09).
> `restricted_member` 는 **만들 수 있다** — 개인 페이지는 아무것도 노출하지 않으므로 "받은 것만 본다"와 충돌하지
> 않는다.

**[보강] 고아 teamspace — 막는 쪽과 되살리는 쪽** ⟨Teamspace · 게스트 · 그룹 7c-10 / 마이그레이션 없음⟩

> 06 F-06-04: *"클론은 '마지막 owner 이탈 차단' 또는 'workspace owner 의 강제 owner 지정' 중 하나를 필수 구현"*. 둘 다 한다.
>
> ① **막기 — owner 를 셀 때는 행동할 수 있는 주체만 센다.** 이 워크스페이스의 활성 · 게스트 아닌 사람, 또는 지워지지 않은
> 그룹. 행이 남아 있어도 떠난 사람 · 지운 그룹은 owner 가 아니다. **그룹을 지우는 것도 owner 가 빠지는 길이다** — 그
> 그룹이 어느 teamspace(보관된 것 포함)의 마지막 owner 면 지우기를 거부하고, 지울 수 있으면 그 그룹의 teamspace 멤버
> 행과 teamspace 노드의 owner 부여를 함께 거둔다(`group` 의 ACL 캐스케이드가 블록 노드만 보던 것을 넓힌 것이다).
>
> ② **되살리기 — 워크스페이스 owner 는 모든 teamspace 를 보고 스스로 owner 로 들어간다.** 목록은 비공개 · 보관된 것까지
> 이름 · 공개 범위 · 보관 여부 · owner 수만 준다(콘텐츠 없음). 들어가는 것은 **멤버 행을 넣는 일**이라 멤버 목록에 이름이
> 선다. 역할이 볼 수 있는 것을 바꾸지 않는다는 원칙(F-06-02 *"Admin roles don't change what someone can see or edit"*)을
> 이렇게 지킨다 — 접근을 주는 것은 워크스페이스 역할이 아니라 **드러나는 멤버십**이다. 보관된 teamspace 에도 들어가고
> 그 다음 되살린다(§3.3 teamspace.archived_at [보강] ④ 가 예고한 "워크스페이스 owner 도 되살린다"가 이 두 걸음이다).
>
> ③ 이 경로는 **워크스페이스 `owner` 만**이다(membership_admin 아님) — 비공개 teamspace 의 존재를 보여 주는 가장 넓은
> 문을 가장 좁은 역할에 둔다.

**[보강] 서브트리 이동과 뿌리의 상속 — 워크스페이스 최상위 · teamspace 최상위** ⟨Teamspace · 게스트 · 그룹 7c-3 / 마이그레이션 0029⟩

> 초판의 이동 규칙은 재계산 트리거 ④ 와 `move_to_private` 뿐이다. 06 F-06-20 은 *"이동 즉시 새 부모의 권한이 상속되고, 이전 부모
> 기반 접근은 소멸한다 · 명시 ACL 은 유지"* 라고 적었다. 두 뿌리에서 그 뜻을 정한다.
>
> ① **워크스페이스 최상위(`parent_type='workspace'`)의 상속은 그 노드의 `('workspace_everyone') → full_access` 행이다** — 0010 이
> "워크스페이스 멤버면 본다"를 루트 행으로 옮겼고, 최상위에 만들거나 옮겨 올 때 같은 행을 둔다(이미 있으면 `full_access` 로
> 올린다). 그래서 최상위에서 그 행은 늘 **상속분**이고, **최상위를 떠나면 지운다** — 출처 열 없이 자리로 가른다. 상속을 끊은
> 노드(P2 — 그 행은 절단 시점의 자기 부여다)와 다른 주체의 행(명시 부여)은 그대로다.
> ② **teamspace 최상위는 행을 두지 않는다** — teamspace 노드의 부여를 물려받는다(§3.3 [보강]). 스코프는 경계가 아니면 teamspace
> id 다(위 `perm_scope_id` 의 정의).
> ③ **뿌리가 바뀌는 이동에는 옮길 페이지의 `manage_perm` 이 있어야 한다.** 뿌리는 루트 블록의 부모다(워크스페이스 또는
> teamspace). 워크스페이스 ↔ teamspace, teamspace A ↔ B 로 옮기면 그 페이지를 볼 수 있는 사람이 통째로 바뀐다 — 공유를 바꾸는
> 것과 같다. 같은 뿌리 안에서는 전과 같이 `edit_content`(+ 대상의 `create_child`)다.
> ④ 트리거 ④ 의 "서브트리 이동"은 **부모만 바뀌는 이동**도 포함한다 — 최상위 페이지는 `ancestor_path` 가 비어 있고 경계면
> 스코프도 그대로라, 권한이 바뀌었다는 신호는 `parent_type` · `parent_id` 의 변경도 본다(0029).

**캐시 키 규약 (Redis) — 무효화는 키 삭제가 아니라 카운터 INCR**

| 키 | 값 | 증가 트리거 |
|---|---|---|
| `perm_gen:{user_id}` | int | group / teamspace 멤버십 변경, workspace_member.role·status 변경 |
| `perm_ver:{workspace_id}:{node_id}` | int | 해당 서브트리 acl_entry 변경, inherits 전이, 서브트리 이동 |
| `acl_epoch:{workspace_id}` | int | 위 두 트리거 전부(포괄 상위) |
| `perm:{user_id}:{gen}:{node_id}:{ver}` | level | 판정 결과. TTL 300s |
| `scopes:{user_id}:{acl_epoch}` | uuid[] | `user_accessible_scopes`. TTL 600s |

**그룹 멤버 1건 변경 시 일어나는 일 전부**: ① `group_member` upsert/removed_at ② `INCR perm_gen:{user}` ③ `INCR acl_epoch:{ws}` ④ `permission_changed{user_id}` emit(제거는 동기, 부여는 비동기) ⑤ **검색 재색인 0건** ⑥ 사이드바는 다음 요청 시 자연 반영. SCIM 대량 변경은 배치 내에서 `perm_gen` 을 사용자당 1회로 coalesce 하고 `acl_epoch` 는 배치 종료 시 1회만 올린다.

**block 프로젝터 (Y.Doc → block 테이블) [X-1]**

```
project(page_id):                                   -- 디바운스 실행. 페이지당 단일 워커(직렬화)
  doc = load(doc_snapshot[page_id])
  for each child node in doc.fragment (순서대로):
      upsert block(id=node.attrs.blockId, parent_type='block', parent_id=page_id,
                   type=node.type, properties=..., format=...)
      order_key = between(prev.order_key, next.order_key)   -- 변경된 자식만
  hard-delete block rows: parent_id=page_id AND type<>'page' AND id NOT IN doc
  soft-handle: type='page' 인데 doc 에 없으면 -> lifecycle='trashed' 로 전이(참조 노드 제거)  [X-3]
  block.version += 1;  doc_snapshot.projected_seq = merged_seq
  enqueue search_document upsert
```
**[추가] 디바운스를 거는 경로 ⟨CRDT 5d · HANDOFF §3.2-25⟩** — 디바운스는 **참여자 update(쓰기 경로 ①) 가운데 하위 페이지 참조를 넣거나 지우지 않은 것**에만 건다. 협업 서버가 쌓기만 하고 페이지마다 창을 열어 한 번에 투영한다. 참조를 건드린 update 는 쌓는 트랜잭션에서 곧바로 투영한다 — `soft-handle`(휴지통 전이)은 그 update 를 보낸 사람의 권한으로 **받는 순간** 거부하거나 받아야 해서다(미루면 이미 퍼진 뒤라 거부할 수 없다). 서버 명령(경로 ②)은 디바운스하지 않고 본문 전체를 투영하므로 밀린 투영을 함께 따라잡는다. 투영한 단위가 스냅샷을 잠근 채 `projected_seq` 를 적는다.

프로젝터가 **`order_key` 의 유일한 쓰기자**이므로 `UNIQUE(parent_id, order_key)` 충돌이 구조적으로 발생하지 않는다. `parent_type in ('data_source','teamspace','workspace')` 인 행은 프로젝터가 건드리지 않는다(그쪽은 order_key 가 정본).

---

**[보강] 화면 요청 하나 안의 권한 읽기 메모** ⟨플랫폼 잔여 10l-1 · F-12-07 / 마이그레이션 없음⟩

> 판정의 입력(P(U) · 스코프 `scopesWith` · 노드의 유효 권한 · teamspace 의 권한)은 **화면 요청 하나 안에서는 처음 읽은 것을 다시 쓴다**
> (`permissions/request-memo.ts`). 페이지를 열면 레이아웃 · 화면의 로더 열여덟이 저마다 읽기 트랜잭션을 열어 같은 사람의 P(U) 와 스코프를
> 따로 읽었다 — 열기마다 쿼리 208개, 그중 170개가 같은 답(10l-1 측정 · 풀이 포화해 쿼리 하나가 130~220ms). 조건은 둘이다: ① **읽기 전용
> 트랜잭션**(`Tx.readOnly`)에서만 — 명령의 쓰기 트랜잭션은 늘 자기 스냅샷에서 읽는다(HANDOFF §3.3-183 "P(U) 는 판정하는 트랜잭션에서") ② **켜는
> 곳은 화면 요청**(`requirePageVisitor` — React `cache` 로 요청마다 하나인 ctx)뿐 — 협업 서버(연결을 오래 든다) · API 라우트 · 명령은 켜지
> 않는다. 받아들이는 낡음은 요청 하나의 길이(수십 ms)다 — 요청 안의 로더들은 어차피 저마다 다른 스냅샷을 봤으므로 더 나빠지는 것이 없다.
> 함께, 스코프 판정은 경계 노드마다 셋씩 읽던 사슬 입력(ACL · 절단 · 규칙)을 **합집합 질의 셋**으로 한 번에 읽고 사슬마다 가른다 — 같은 답이다.

## 4. 핵심 설계 결정 요약

> 판결문 4건의 판결 요약표를 하나로 합친 것이다. 요구된 26건보다 실제 판결은 **31건**이므로 전부 싣는다. 근거 상세는 `_canon/*.md` 의 해당 판결 절을 보라.

### 4.1 블록 트리 (block-tree)

| # | 결정 | 채택 | 폐기 | 이유 | 판결 ID |
|---|---|---|---|---|---|
| 1 | 삭제 상태 | `lifecycle ENUM('live','trashed','purged')` + `trashed_at`/`trashed_by`/`trash_root_id`/`purge_after`/`purged_at` | `is_alive`/`alive` boolean, 4번째 값 `'retained'`, 02의 4-timestamp 암묵 상태머신 | boolean 은 30일 카운트다운·Enterprise 1일~10년 커스텀·복원 주체를 표현할 수 없다. `retained` 는 누구에게도 보이지 않으므로 도메인 상태가 아니라 GC 지연이다 | C-1 / V-4 |
| 2 | DB 행의 정체성 | 행 = `block` 행 (`type='page'`, `parent_type='data_source'`) + `page` 1:1 확장 | 04 `row_page` 독립 테이블 | 분리하면 휴지통·권한 재귀·검색 인덱싱·백링크·버전 히스토리가 **전부 2벌**이 된다 | C-3 / V-6 |
| 3 | parent 종류 | `ENUM('workspace','teamspace','block','data_source')` — **teamspace 는 트리 노드다** | `{block,space,collection}`, `{...,page_id,block_id,database_id}`, `{...,database}` | teamspace 가 트리 노드가 아니면 트리 밖 `space_id` 라는 두 번째 권한 전파 경로가 생긴다. 트리 이동 = 권한 이동이 자동 성립해야 한다 | C-9 / V-9 |
| 4 | 자식 순서 | `block.order_key text` fractional index 단일 방식 (wire op `listAfter/listBefore/listRemove` 는 존치) | `content uuid[]` 저장, 컬럼명 `position`/`order_idx` | 배열은 부모 행을 페이지 전체 편집의 직렬화 지점으로 만든다. 정보 이중화로 정합성 검사가 상시 필요 | C-10 |

### 4.2 데이터베이스 저장 (database-storage)

| # | 결정 | 채택 | 폐기 | 이유 | 판결 ID |
|---|---|---|---|---|---|
| 5 | 행 셀 저장 | EAV `page_property_value` + 타입별 사이드카, relation 은 `relation_edge` 별도 테이블 | `row_page.properties jsonb` 단일 컬럼, relation-in-jsonb | 단일 JSONB 는 "A는 Status, B는 Due" 동시 편집에서 **침묵 데이터 손실**을 낸다. 역방향 relation 조회 불가로 rollup 무효화가 성립하지 않는다 | C-2 / V-2 |
| 6 | 읽기 성능 | `page.properties_cache` + `page.search_tsv` **파생 읽기 모델**(쓰기 금지, 트리거 갱신) | "JSONB 가 아니면 검색 벡터가 불가능"이라는 전제 | 행 목록 렌더는 캐시 1컬럼, 정렬·필터·집계만 EAV 를 탄다 | C-2 보조 |
| 7 | 행 테이블 이름 | `page` | `row_page` | 04 자신이 "행 페이지"라 부른다. 개념과 이름을 일치시킨다 | C-3 참조 |
| 8 | property.id 타입 | `text PRIMARY KEY` (nanoid 21, **전역 유니크**) | `uuid PK`, 복합 PK `(data_source_id, id)` 양쪽 다 | property id 는 필터 AST·formula AST·레이아웃·자동화 조건 등 **사용자 데이터 JSON 안에 파묻힌다**. JSON 안의 참조는 스칼라 1개여야 한다 | C-4 / V-7 |
| 9 | 동명 프로퍼티 | `UNIQUE (data_source_id, name)` 강제, 대소문자 구분, 정확 일치 해석 | 무제약, `[확인필요]` 태그 | data source 의 `properties` 가 **name 키 객체**이므로 동명 금지가 API 형태에서 연역된다 | V-7 |
| 10 | data_source ↔ database | `owner_database_id NOT NULL`(소유) **와** `database_data_source`(부착)을 **다른 축으로 병존**. `is_linked` 는 파생 | "단일 FK 는 결함" 판정, 조인 테이블 부재 양쪽 다 | 하나의 축이라고 착각한 것이 실은 두 개의 축이었다. 소유가 없으면 삭제 주체·원본 무손상이 표현 불가, 부착이 없으면 linked database 저장 불가 | C-5 |
| 11 | 뷰별 컬럼 설정 | `view_property` 단일 테이블, `position`→`order_idx` | 03 `view_property_config` | 같은 개념의 테이블이 두 이름으로 존재할 이유가 없다 | C-6 |
| 12 | 컬럼 고정 | `view.frozen_upto_property_id text NULL` **경계 포인터** | `view_property.frozen boolean` 열별 플래그 | 1차 출처 조작은 `Freeze up to column` = 접두 경계다. 열별 boolean 은 "1·3열 고정, 2열 비고정"이라는 표현 불가능 상태를 합법화한다 | C-6 부속 |
| 13 | 필터 중첩 상한 | `MAX_FILTER_DEPTH = 3`, **쓰기 경로만 검증** | "1차 출처 두 개의 불일치"라는 진단, 03의 2단계 단정 | 상충이 아니라 **표면이 둘**(API 2 / UI 3)이다. 클론은 비대칭을 승계하지 않고 넓은 쪽으로 통일 | C-15 / V-10 |
| 14 | 항목 레이아웃 | 16의 `page_layout`+`layout_tab`+`layout_module` 3테이블 비준 | 03 `page_layout_slot` 전체 | `page_layout_slot` 은 프로퍼티 없는 모듈·섹션·모듈 승격·탭 소속을 표현할 수 없다 | U-1 |

### 4.3 권한 (permission)

| # | 결정 | 채택 | 폐기 | 이유 | 판결 ID |
|---|---|---|---|---|---|
| 15 | ACL 테이블 | `acl_entry` 단일 (`node_kind ∈ {block,teamspace}`, principal 5값, level 6값) | 02 `permission`, 04 `acl`, `object_type='data_source'` 축 | 1차 출처: "permissions are managed at the **database** level, not per data source" | C-7 |
| 16 | deny 계층 | **없다.** `level='none'` 행은 존재하지 않고 회수는 행 DELETE | `none` 저장, 노드 단위 deny 엔트리 | "Notion respects the broadest level of access" — deny 가 있으면 이 문장이 거짓이 된다 | C-7 (A1) |
| 17 | level 비교 | `level_capability` 테이블 경유 | 정수 서열 비교 | `create` 는 `view` 를 포함하지 않는다. 전순서가 아니다 | C-7 (A2) |
| 18 | 상속 차단 | `block_acl_meta.inherits_from_parent` 실재. 단 **사용자 토글이 아니라 쓰기 부수효과** | 02 불변식 I2("루트까지 재귀"), "차단 메커니즘 없음" 가설 | 2.10 릴리스 노트가 `restrict permissions for any sub-page` 를 명시. restrict 는 순수 합집합 모델에서 **수학적으로 불가능**하므로 절단이 반드시 존재한다 | C-8 / V-1 |
| 19 | 유효권한 캐시 축 | `block.perm_scope_id` 1컬럼이 권한 재귀 종료점 + 검색 필터 키를 겸함 | `depth <= nearest_inheritance_break` 쿼리(조회 1회 추가) | 스코프 경계가 아닌 노드는 스코프 루트와 유효권한이 항상 동일하다 → 문서 단위 권한 비정규화 없이 검색이 성립 | C-8 부속 |
| 20 | Private 이동 | reparent + **노드 로컬 ACL 재설정**. 상속 플래그는 건드리지 않음 | "Private 이동 = 상속 차단 켜기" | 1차 출처: "This override will only apply to the parent page — 하위 부여는 그대로" | V-1 부속 |
| 21 | 워크스페이스 역할 | 5값 + `is_temporary` + `status` + `expires_at` + `join_method`/`invited_by`/`accepted_at`/`removed_at` | 02의 4값, `temporary_member` 를 6번째 enum 값으로 두는 안 | temporary 는 "member-level access" 이므로 역할이 아니라 **역할과 직교한 수명 축**이다 | C-14 |
| 22 | 좌석 산식 | `active ∧ ¬temporary ∧ role≠guest`. **restricted_member 는 좌석을 소비한다** | "restricted 는 제한적이므로 미소비"라는 직관 | 1차 출처가 정면으로 부정("affect your billing in the same way") | C-14 부속 |
| 23 | 멤버 제거 | soft delete (`status='removed'` + `removed_at`, group/teamspace 도 `removed_at`) | 물리 삭제 | 30일 내 재가입 시 private 페이지·그룹·teamspace 멤버십이 복원되어야 한다 | C-14 |
| 24 | 봇/에이전트 principal | `user(type ∈ {person,bot,agent})` + `principal_type='user'` | `principal_type='integration'`/`'agent'` | 공개 API 의 User 객체가 이미 person/bot 을 한 스키마에 담는다. principal 어휘를 늘리면 `effective()` 분기가 곱해진다 | V-8 |
| 25 | 소유권 이관 | `sso_config`·`scim_token` → 14, `audit_log` → 17 `audit_event` | 06 이 3종을 소유하던 상태 | 인증 흐름의 산물이지 권한 판정의 입력이 아니다. `security_policy` 만 06 잔류(0단계 게이트) | V-8 부속 |
| 26 | 그룹 변경 무효화 | 주체축 `perm_gen:{user_id}` INCR 1회로 종결. **검색 재색인 0건** | `search_document.principals[]` 방식 A | 그룹 1건 변경이 수만 문서 재색인을 유발하고, 재색인 지연 구간이 곧 권한 누출 창이다 | U-3 |
| 27 | 스코프 캐시 무효화 | 워크스페이스 단위 `acl_epoch` 로 통째 무효화(coarse) | 노드별 정밀 무효화를 MVP 부터 | 무효화 누락이 곧 권한 누출인 도메인에서 **"누가 영향받는가"를 열거하는 로직 자체가 XL 의 원인**이다. 열거를 없애면 누락도 없다 | U-3 부속 |

### 4.4 동기화 · 버전 · 알림 · 검색 (sync-version)

| # | 결정 | 채택 | 폐기 | 이유 | 판결 ID |
|---|---|---|---|---|---|
| 28 | 동기화 구독 단위 | **문서(페이지) 채널 + CRDT update push 단일 축** | `sub:{record_id}` 레코드 구독, thin invalidation, `syncRecordValues` pull, `page_channel` 테이블 | 레코드 축은 연결당 구독이 수백~수천이 된다. CRDT 를 택한 이상 "알림 → 되당김" 왕복은 순손해다 | C-11 / V-3 |
| 29 | 버전 스냅샷 | `doc_update` / `doc_snapshot` / `page_version(state_ref, state_vector, editor_ids, reason, restored_from, expires_at)` 3분리 | 02 `page_version(snapshot bytea)`, 05 `page_snapshot(record_map jsonb)` | state_vector 없으면 버전 간 diff·delta 전송이 불가능하다. 행에 bytea 를 박으면 목록 조회가 TOAST 로 무너진다 | C-12 |
| 30 | 구독·알림 | 11 스키마 + `page_kind` CHECK 분기 + `UNIQUE(group_key)` 제약 제거 | 05의 평면 4값 level, payload 복제형 notification, `notification_digest` | 1차 출처가 일반 페이지 2종 / DB 항목 3종으로 나뉜다. 쓰기 시점 병합은 부분 읽음·이벤트별 권한 재검사·팬아웃 락 3가지를 깨뜨린다 | C-13 |
| 31 | 트랜잭션 원자성 | `[확인]` 유지하되 **서버 명령 경로(②) 한정 불변식**으로 축소 | "부분 적용은 존재하지 않는다"를 시스템 전역 불변식으로 쓰는 것 | 실시간 편집(①)에는 트랜잭션 개념 자체가 없다. 원자성은 단일 행 INSERT 가 보장한다 | V-5 |
| 32 | 검색 인덱스 | 07 `search_document` 정본 (색인 단위 = block) | 09 `search_index(acl_root_path ltree)`, 12 `search_index(page_id,...)` | ltree 는 페이지 경로이지 principal 집합이 아니다 — 그룹·게스트·teamspace 권한을 표현 불가. 12는 권한 축이 아예 없다 | U-6 |
| 33 | 제안 편집 표현 | **Y.Doc 안의 ProseMirror mark 3종**. 서버 `suggestion` 행은 메타데이터 인덱스 | 별도 Y.Doc 브랜치, CRDT 밖 서버측 오버레이 + 상대좌표 앵커 | 제안이 문서의 일부이면 앵커 문제가 원천 소멸하고, 실시간 전파가 공짜이며, 수락이 `Y.transact` 1회로 원자적이다 | U-2 |
| 34 | presence 스키마 | `cursor`(텍스트 범위)와 `block_selection`(블록 배열) **2필드 병존**, `mode` 에 `'suggest'` 추가, DB 미저장 | 단일 union 필드, `focus_block_id` 독립 필드, 절대 offset | 둘은 동시에 존재할 수 없지만 **서로 다른 렌더러가 그린다**. union 하면 수신측이 매번 타입 스니핑을 한다 | U-9 |

---

## 5. 클러스터 간 접점 검증 — 이 단계의 존재 이유

판결문 4건은 서로를 모르는 상태로 쓰였다. 직접 대조한 결과 **13건의 모순·미결합**을 발견했고, 아래에서 최종 판결한다.

### X-1 · Yjs 문서 내부 순서와 RDB `order_key` 의 공존 — **어느 쪽이 정본인가**

**모순**: C-10 은 "자식 순서는 `block.order_key` **단일 방식**"이라고 했다. C-11 은 "페이지 1개 = Y.Doc 1개, 편집은 Yjs update push"라고 했다. y-prosemirror 를 쓰면 페이지 본문의 블록 시퀀스는 `Y.XmlFragment` 의 **내재적 순서**로 표현된다. 즉 같은 사실이 두 곳에 있다 — C-10 이 `content uuid[]` 를 폐기한 바로 그 이유(정보 이중화)가 되살아난다.

**판결 — 입도로 축을 자른다. 두 판결 모두 자기 영역에서 유효하다.**

| 부모 종류 | 순서의 정본 | `block.order_key` 의 지위 |
|---|---|---|
| `parent_type='block'` (부모가 페이지 또는 컨테이너 블록) | **Y.Doc**(`Y.XmlFragment` 시퀀스) | **파생.** 프로젝터가 계산해 쓰는 읽기 모델 |
| `parent_type='data_source'` (DB 행) | **RDB** | **정본.** 어떤 Y.Doc 도 행 목록을 담지 않는다 |
| `parent_type='teamspace'` / `'workspace'` (사이드바 최상위) | **RDB** | **정본.** 동일 |

**근거**

1. **C-10 의 논거는 그대로 살아난다.** C-10 이 `content uuid[]` 를 버린 이유는 "부모 행이 동시 편집의 직렬화 지점"이기 때문이다. Y.Doc 시퀀스는 부모 **행**이 아니라 CRDT 시퀀스이며 동시 삽입이 서로를 막지 않는다 — C-10 이 원한 성질을 Yjs 가 더 강하게 제공한다.
2. **C-10 의 op 번역표는 경로 ②에서만 살아남는다.** C-11 이 이미 "op 어휘는 와이어에서 사라진다, 단 REST/자동화/템플릿에는 남는다"고 했다. 그 남은 경로에서 `listAfter` → order_key 계산이 아니라 **`listAfter` → Y.Doc 노드 삽입**이 되고, order_key 는 그 결과로 프로젝터가 다시 쓴다.
3. **DB 행·사이드바에는 Y.Doc 이 없다.** 행 목록은 SQL 쿼리 결과이고 사이드바 최상위는 트리 조회다. 여기서 order_key 를 버리면 순서를 담을 곳이 없다.

**따라서**: `UNIQUE(parent_id, order_key)` 는 유지하되, **프로젝터가 ydoc-authority 행의 유일한 쓰기자**이므로 충돌 재시도 로직이 필요한 것은 rdb-authority 행뿐이다. `order_authority(N)` 은 **컬럼으로 저장하지 않는다** — `parent_type` 에서 파생된다(이중 진실 금지 원칙).

**대가**: `block` 테이블은 페이지 본문에 대해 **결과적 일관성(eventual consistency)** 을 가진다. `doc_snapshot.projected_seq < merged_seq` 인 창 동안 검색·API·사이드바는 낡은 값을 본다. 에디터는 Y.Doc 을 직접 보므로 영향받지 않는다. 이 창을 짧게 유지하는 것이 프로젝터 SLO 다(권고 p95 < 2s).

---

### X-2 · `page.id` 와 `database.id` 의 FK 확정

**미결**: database 판결은 "`page.id REFERENCES block(id)` 인지는 block-tree C-3 판결에 종속"이라며 열어뒀고, block-tree 는 C-3 에서 "행은 block 이다"라고 판결했다.

**판결**: `page.id uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE` **확정**. 동일하게 `database.id REFERENCES block(id)` — database 도 블록이므로(inline/full-page database 는 페이지 안의 블록이다) 별도 `parent_block` 컬럼은 폐기하고 `block.parent_id` 가 그 역할을 한다. `page.data_source_id` 는 `block.parent_id` 의 **파생 캐시**임을 명시한다(불변식 R3).

---

### X-3 · `lifecycle` 3값과 append-only `doc_update` 로그 — **삭제는 로그에서 어떻게 표현되는가**

**모순**: C-1 은 "**모든 블록**에 lifecycle 을 두고, 삭제 시 자손 전체에 전파하며, `parent_id`/`order_key` 를 보존해 원위치 복원을 공짜로 만든다"고 했다. C-11/C-12 는 "본문의 정본은 append-only Yjs 로그"라고 했다. 문단 하나를 지우면 Yjs 는 노드를 시퀀스에서 제거하고, 그 내용은 CRDT 내부 tombstone 으로만 남아 **주소지정이 불가능**하다. 즉 `lifecycle='trashed'` 인 문단 행이 있어도 **복원할 콘텐츠가 없다**.

**판결 — `lifecycle` 은 `type='page'` 블록의 축이다. 비페이지 블록의 삭제는 CRDT 삭제이고, 복구는 `page_version` 이 담당한다.**

| 삭제 대상 | 표현 | 복구 경로 |
|---|---|---|
| 비페이지 블록 (문단·이미지·토글 …) | Y.Doc 에서 노드 제거 → 프로젝터가 `block` 행 **hard delete** | ① 세션 내: Yjs UndoManager ② 이후: `page_version` 복원(비파괴적) |
| 서브페이지 / DB 행 / 최상위 페이지 | `block.lifecycle='trashed'` + `trash_root_id` + `purge_after`. **부모 Y.Doc 에서는 참조 노드만 제거**되고 대상의 자체 Y.Doc 은 무손상 | 휴지통 복원 → 부모 Y.Doc 에 참조 노드 재삽입 |

**근거**

1. **C-1 의 근거 7번("블록 단위 삭제도 되돌릴 수 있어야 한다")은 CRDT 채택으로 대체되었다.** 그 요구는 UndoManager + 버전 히스토리가 이미 충족한다. lifecycle 로 중복 충족하면 "휴지통에 문단이 쌓이는" 원본에 없는 동작이 생긴다.
2. **C-1 스스로 "휴지통 UI 는 `type='page'` 로 필터한다"고 했다.** 즉 비페이지 블록의 `lifecycle='trashed'` 상태는 **어떤 사용자에게도 보이지 않는다** — C-1 이 `'retained'` 를 폐기할 때 쓴 논리("보이지 않는 것은 도메인 상태가 아니다")를 자기 자신에게 적용한 결과다.
3. **FK 무결성 우려(C-1 근거 7의 후반)는 발생하지 않는다.** 비페이지 블록을 참조하는 것은 `discussion.parent_block_id`(코멘트)와 `search_document.doc_id` 뿐이며, 전자는 앵커 소실 처리 규칙이 이미 있고 후자는 인덱스다.
4. **삭제 전파 비용이 대폭 감소한다.** 페이지 삭제 시 O(서브트리 전체 블록)이 아니라 **O(page 타입 자손)** 만 UPDATE 한다. 100만 블록 워크스페이스에서 자릿수 차이다.

**append-only 로그에서의 삭제 표현 (최종)**: `doc_update` 에는 삭제 op 가 **없다**. 삭제는 ① 대상의 RDB 상태 전이 ② 부모 문서에 대한 통상의 Yjs update 두 가지로 표현된다. 로그 자체의 삭제는 **`purged` 전이 시 page_id 파티션 단위 물리 삭제**뿐이다(불변식 S1). 이로써 "append-only 인데 삭제를 어떻게?"라는 질문은 **삭제를 로그에 담지 않음으로써** 해소된다.

**결과로 무효가 되는 것**: C-1 의 "모든 블록에 lifecycle 적용" 문장, 그리고 `CONSTRAINT ck_lifecycle_page` 가 새로 추가된다.

---

### X-4 · EAV 셀 값과 "페이지 1개 = Y.Doc 1개" — **행 하나가 Y.Doc 인가, 셀은 CRDT 밖인가**

**모순**: C-2 는 셀을 `page_property_value` EAV 행으로 저장한다고 했다. C-11 은 페이지 1개 = Y.Doc 1개이고 편집은 CRDT push 라고 했다. C-3 에 의해 **DB 행은 페이지**다. 그렇다면 행의 셀은 Y.Doc 안인가 밖인가? 두 판결 모두 답하지 않았다.

**판결 — 행은 Y.Doc 을 가지되, 그 Y.Doc 은 본문 블록 트리만 담는다. 셀 값은 CRDT 밖의 RDB 정본이다.**

| 대상 | 저장 | 편집 경로 | 병합 단위 |
|---|---|---|---|
| 행의 **본문 블록 트리** | 그 행의 Y.Doc (`doc_update[page_id]`) | 경로 ① 실시간 CRDT | CRDT |
| 행의 **셀 값** | `page_property_value` / `relation_edge` / `derived_value` | 경로 ② 서버 명령 | `(page_id, property_id)` 행 단위 LWW |

**근거**

1. **C-2 의 채택 근거가 곧 이 결론이다.** C-2 는 "사용자가 독립적으로 바꾸는 두 값은 서로 다른 행에 있어야 한다"는 규칙으로 EAV 를 택했다. 셀을 Y.Doc 에 넣으면 병합은 해결되지만 **필터·정렬·rollup 무효화·부분 인덱스가 전부 불가능**해진다(C-2 근거 3·5). CRDT 는 병합을 주지만 **쿼리 가능성을 주지 않는다.**
2. **셀 편집은 초당 수십 회의 문자 입력이 아니다.** 셀은 select 선택·날짜 지정·체크박스처럼 **이산적 커밋**이 대부분이며, 텍스트 셀조차 blur 시점 커밋이다. CRDT 의 문자 단위 병합이 필요한 워크로드가 아니다.
3. **rollup/formula 는 서버측 그래프 순회다.** `property_dependency` → `relation_edge` 역방향 인덱스 → `derived_value` 무효화는 CRDT 문서 안에서 실행할 수 없다.
4. 다만 **긴 텍스트 셀(rich text property)** 의 동시 편집은 LWW 로 손실이 발생한다. 이것이 이 판결의 유일한 실질 손실이며, 완화책은 §5 말미 참조.

**전파 경로 판결 [X-5 로 이어짐]**: 셀 변경은 Y.Doc update 가 아니므로 `doc:{page_id}` 채널로 나갈 수 없다.

---

### X-5 · 셀·행·스키마 변경의 실시간 채널 — `ds:{data_source_id}` 신설

**모순**: C-11 은 채널을 `doc:{page_id}` 하나로 통일하고 "두 종류를 한 채널에 섞지 않는다"고 했다. 그런데 X-4 로 셀 값이 CRDT 밖이 되었고, 테이블 뷰는 화면에 행 100개를 띄운다. 행마다 `doc:` 채널을 구독하면 **C-11 이 폐기한 레코드 단위 구독 폭발이 정확히 재현**된다.

**판결**: 채널을 3종으로 확정한다 — `doc:{page_id}`(Yjs 전용) / `ds:{data_source_id}`(행·셀·스키마·뷰) / `layout:{data_source_id}`(레이아웃, 16 R13 요구). 연결당 구독 수는 **열린 페이지 1~3 + 열린 뷰 1~3** 로 유지된다.

**C-11 의 규율을 위반하지 않는 조건 2가지** — 둘 다 지켜야 한다.
1. **섞지 않는다**: 각 채널의 봉투는 단일 `kind` 집합을 가지며 서로 침범하지 않는다.
2. **되당김 신호를 실지 않는다**: `ds:` 봉투는 반드시 **적용 가능한 post-image 값**을 싣는다. `{row_id, changed}` 같은 무효화 신호를 실으면 pull 모델이 되살아난다.

gap 감지 축은 `data_source.change_seq`(단조 증가)이며, 재동기는 `WHERE change_seq > :last` 델타 조회다.

**[보강] X-5 의 단계 — 0단계는 "다시 읽어라" 한 종류** ⟨DB 심화 2k-1조각 · F-04-24 / 마이그레이션 0063⟩

조건 2(post-image)를 **0단계에서 유예한다.** 0단계의 `ds` 채널은 봉투가 `changed` **한 종류**다 — 무엇이 바뀌었는지 싣지 않고 받는
화면이 뷰 질의로 다시 읽는다. 근거:

- ① **멤버십은 서버의 SQL 컴파일러만 정확하다.** post-image 를 받은 화면이 "이 행이 이제 내 필터에 드는가 · 어디에 서는가"를 정하려면
  필터 · 정렬 평가기를 SQL 과 인메모리 **두 벌**로 가져야 한다(04 F-04-24 *"두 경로의 결과가 어긋나면 유령 행이 생긴다"* — F-04-09 가
  XL 인 이유). 서버가 구독마다 판정하면 변경마다 구독 수만큼 질의가 돈다. 개인 필터(2h-1)까지 있으면 구독 단위가 뷰 × 사용자다.
- ② 04 F-04-24 의 현실적 대안 1단계가 바로 이것이다 — *"뷰 전체 재조회 알림만. 정확성 100%, 효율만 나쁨"*.
- ③ X-5 · C-11 이 막으려던 해는 생기지 않는다 — 조건 1(섞지 않는다)은 지킨다. 봉투가 한 종류라 받는 쪽이 분기하지 않고, 다시 읽기는
  늘 지금의 것을 읽으므로 신호의 순서에 기대지 않는다. C-11 이 폐기한 것은 **레코드 단위 구독**과 레코드 pull(`syncRecordValues`)이다 —
  이 신호는 **표 단위**(연결당 구독 1~3 그대로)이고 다시 읽기는 뷰 질의 하나다.
- 신호는 쓰는 트랜잭션의 트리거가 `pg_notify('db_rows', ds_id)` 로 보낸다(0063 · 0016 과 같은 길 — 커밋된 것만 · 같은 트랜잭션의 같은 신호는
  하나로). 구독 시점 권한검사 · 권한 회수 시 서버가 닫는다(위 레지스트리의 규칙 그대로). 전달은 SSE(`…/data-sources/[id]/changes`)다 —
  WebSocket 협업 서버는 본문(`doc:`)의 것이고, 0단계의 신호는 HTTP 세션 그대로 붙는 편이 단순하다.
- **레이아웃(항목 레이아웃 3e-2 · 0067)** — 정본의 `layout:{data_source_id}` 채널(위 레지스트리 · 16 R13)도 0단계에서는 `db_rows` 에 같은
  표 id 를 싣는다(레이아웃 머리 `page_layout` 의 넣기 · 바꾸기가 보낸다). 열린 행 페이지가 신호를 받으면 레이아웃 **버전**을 묻고 바뀌었을
  때만 다시 그린다 — 16 F-16-12 *"페이로드는 version 만 보내고 클라이언트가 재조회"* 와 같은 모양이다. 채널을 나누는 것은 1단계(봉투가
  무엇이 바뀌었나를 실을 때)와 함께다.
- **구독이 붙기 전의 틈** ⟨#250⟩ — 화면은 서버 렌더로 읽은 **뒤에** SSE 를 연다. 그 사이의 신호는 이미 지나갔다(Postgres 는 신호를 쌓아
  두지 않는다). 0단계는 `change_seq` 없이 메운다: 서버 렌더가 **읽기 전의 시각**(`since`)을 화면에 주고, 화면은 그것을 들고 구독한다.
  서버의 신호 허브는 표마다 마지막 신호를 받은 시각과 **듣기 시작한 시각**(LISTEN 이 걸린 때 — 다시 붙으면 새로)을 기억하고, `ready`
  바로 뒤에 `since` 이후 그 표가 바뀌었으면 — 또는 그 시각에 듣고 있지 않았으면(모르면 바뀐 것으로 친다) — `changed` 를 보낸다. 거짓
  양성(이미 읽은 것을 한 번 더 읽음)은 허용한다. `change_seq` 를 쓰기마다 올리면 한 표의 모든 쓰기가 `data_source` 한 행의 잠금에 줄을
  선다 — gap 감지 축은 1단계(post-image)에서 다시 본다. 시각은 서버 프로세스의 시계 하나다(인스턴스가 여럿이면 그 사이의 시계 차만큼
  틈이 남는다 — 그때도 1단계의 `change_seq` 가 답이다).
- **화면이 뒤로 가기 캐시(bfcache)에 들면 구독을 닫고, 돌아오면 다시 열며 한 번 다시 읽는다** ⟨10n-7⟩ — 얼어 있는 화면의 SSE 가 열린 채
  남으면 화면을 몇 번 옮겨 다니는 사이 호스트당 연결 수(HTTP/1.1 은 6)를 다 차지해 새 화면의 요청이 서버에 닿지 못한다. 닫은 동안의
  신호는 지나갔으므로 돌아오면 다시 읽는다 — `since` 로 묻지 않는다(숨은 때를 브라우저의 시계로 재면 서버의 시계와 어긋나 놓칠 수 있다 ·
  거짓 양성은 허용한다).
- **늦게 온 다시 읽기는 화면의 새 행을 덮지 않는다** ⟨#468⟩ — 다시 읽기는 늘 지금의 것을 읽지만 **도착은 늦을 수 있다**. 셀 저장과 겹치면
  저장이 커밋되기 전에 DB 를 읽은 결과가, 저장 응답(새 `version`)으로 이미 바뀐 화면의 행보다 늦게 온다. 화면은 행마다 `version` 을
  비교해 더 새 것을 지킨다(`mergeReloaded` — 셀 저장 응답의 "늦게 온 응답은 버린다" 와 같은 규칙 · 같은 `version` 이면 다시 읽은 것).
  `version` 은 행의 단조 증가 값이다(X-6). 이 규칙이 없으면 서버에는 새 값 · 칸에는 옛 값이 다음 신호까지 남는다(e2e 8c-3a 가 보았다).
- **1단계(X-5 그대로)가 목표다**: `data_source.change_seq`(gap 감지) · 행의 post-image(`row_upsert` · `row_removed` — 행의 읽기 모델은 보는
  사람과 무관하다) · 서버의 구독별 멤버십 판정. 0단계의 연결 · 권한 규칙은 그대로 두고 봉투만 바꾼다. 그때 이 [보강]을 지운다.

---

### X-6 · `search_document.version` 의 소스 — `doc_update.seq` 는 불완전하다

**모순**: U-6 은 "`version` 은 `block.version` 이 아니라 `doc_update.seq` 다"라고 못박았다. 그러나 X-4 로 셀 값이 CRDT 밖이 되었으므로, **행의 셀을 바꿔도 `doc_update.seq` 는 오르지 않는다.** 그 상태로 external version 을 쓰면 셀 변경이 검색 인덱스에 영원히 반영되지 않거나, 반영되더라도 버전이 역행해 거부된다.

**판결**: `search_document.version = block.version` 으로 되돌린다. 단 `block.version` 의 의미를 **페이지 단위 단조 변경 카운터**로 재정의하고, 다음 3개 쓰기자가 함께 올린다 — ① 프로젝터 배치(Y.Doc 변경 반영) ② 셀/relation/derived 쓰기 ③ 구조 변경(이동·삭제·복원). `doc_update.seq` 는 **CRDT 재동기 전용 축**으로 역할을 좁힌다(불변식 S2). 두 값은 서로 다른 것을 재므로 이중 진실이 아니다.

부수효과: 인덱싱 트리거가 `doc_update` outbox 하나가 아니라 `doc_update` outbox + `page_property_value` outbox 둘이 된다.

---

### X-7 · `ancestor_path uuid[]` 와 `block.path text` — 같은 사실의 두 표현

**모순**: block-tree 는 `ancestor_path uuid[]` + GIN 을 확정했다. permission 은 "`block.path text` materialized path 를 block 테이블에 추가해 달라, prefix 일괄 갱신 때문에 closure table 보다 이것을 택했다"고 요구했다. 둘 다 두면 이동 시 **두 컬럼을 동시에 갱신**해야 하고 어긋나면 권한이 조용히 틀어진다.

**판결**: `ancestor_path uuid[]` **단일 유지**. `block.path text` 폐기.

**근거**: permission 이 필요로 한 연산은 "서브트리 일괄 UPDATE" 하나이며, `WHERE ancestor_path @> ARRAY[:node_id]` 가 GIN 인덱스로 동일하게 단일 술어다. 반대로 `path text` 만 남기면 block-tree 의 조상 판정·부분 복원 판정이 문자열 파싱이 된다. **배열 쪽이 두 요구를 모두 만족하는 유일한 표현이다.** `perm_scope_id` 컬럼 요구는 그대로 수용한다(그것은 파생이 아니라 독립 정보다).

---

### X-8 · `acl_epoch`/`perm_gen` 캐시 무효화와 `search_document.principals[]` 의 정합성 — **정합하지 않는다**

**모순**: permission U-3 은 `search_document.principals[]`(07 방식 A)를 **명시적으로 폐기**하고 `perm_scope_id`(방식 B)를 정본으로 확정했다. sync U-6 은 07 스키마를 정본으로 비준하면서 **`principals uuid[]` 를 포함한 채로** 채택했다. 두 판결문이 같은 컬럼을 놓고 정반대다.

**판결 — permission U-3 이 이긴다.** `search_document` 에서 `principals uuid[]` 삭제, `perm_scope_id uuid NOT NULL` 채택.

**근거**
1. **U-3 은 이 충돌을 인지하고 판결했다.** U-3 은 07 F-07-07 의 방식 A 를 명시적으로 이름 불러 폐기했다. U-6 은 permission 판결의 존재를 모른 채 07 스키마를 통째로 비준했을 뿐이며, `principals[]` 를 **독립적으로 옹호한 근거를 제시하지 않았다**(1차 출처 대조표에서 "권한: per-document permission resolution" 은 노션이 문서 생성 시 권한을 해석한다는 사실만 말하고 저장 형태를 말하지 않는다).
2. **정합성 자체가 성립하지 않는다.** `perm_gen`/`acl_epoch` 는 **O(1) 카운터 INCR** 로 무효화를 끝내는 설계다. `principals[]` 는 그 무효화가 **인덱스 문서 N건의 재색인**을 요구한다. 카운터를 올려도 인덱스는 낡은 principals 로 답한다 → **무효화가 도달하지 않는 저장소가 생기고, 그 지연 구간이 곧 권한 누출 창이다.** 두 설계는 공존할 수 없다.
3. U-6 이 실제로 원한 것(색인 단위 = block, 라우팅 키, external version, 권한이 쿼리에 함께 걸릴 것)은 방식 B 로 전부 충족된다.

**부수 판결 3건**
- `search_document.routing` 의 값은 `workspace_id` 다. block-tree 가 `block.space_id` 를 폐기했으므로 "space_id" 라는 이름은 더 이상 존재하지 않는다.
- `perm_scope_id` 재계산 트리거에 **`public_link.enabled` 전이**를 추가한다(공개 링크는 노드 로컬 grant 이므로 그 노드가 스코프 루트가 되어야 익명 검색이 스코프 필터로 성립한다). **[정정 6a-1] 뺐다** — 공개는 `effective()` 의 항이 아니므로 판정의 경계(스코프)를 만들지 않는다. 익명 검색은 게시 루트의 서브트리로 거른다(§3.3 끝 [정정] 웹 게시 ②).
- **`page_access_rule` 로만 접근 가능한 행은 스코프 필터에 걸리지 않는다.** 이것은 방식 B 의 알려진 구멍이며 §6-3 에 실측 항목으로 남긴다. 잠정 대응: person property 기반 접근 행은 검색 결과에서 제외하고, 대신 그 DB 의 뷰에서만 노출한다.

---

### X-9 · 잠금 표현 이중화 — `database.is_locked` vs `node_lock`

**모순**: permission 은 "`node_lock` 테이블로 통합, 04 의 `database.is_locked` 컬럼 폐기"라고 판결했는데, database 판결문의 정본 DDL 에는 `is_locked boolean NOT NULL DEFAULT false` 가 그대로 남아 있다(C-5 절 `CREATE TABLE database`).

**판결**: `database.is_locked` 폐기, `node_lock` 단일. 잠금 대상은 페이지·데이터베이스 양쪽이고, `node_lock.scope` 에 `content_and_layout` 을 두어 16 R8(레이아웃 편집도 잠금 대상)을 흡수한다.

---

### X-10 · `subscription` 이름 충돌 — 페이지 팔로우 vs 결제 구독

**모순**: sync C-13 은 페이지 팔로우 테이블 이름을 `subscription` 으로 확정했다(`page_subscription` 폐기). 13-adjacent-products 는 결제 구독을 `subscription` 으로 정의했고, permission C-14 부속은 "`subscription.seats` 는 파생값"이라며 **결제 쪽 의미로** 이 이름을 썼다. 같은 이름이 두 개다.

**판결**: `subscription` = **페이지 팔로우**(C-13 이 명시 판결했으므로). 결제 구독은 `billing_subscription` 으로 개명. 그리고 `billing_subscription` 에서 `seats` 컬럼을 **삭제**한다 — C-14 부속이 좌석의 유일한 원천을 `workspace_seat_count` 뷰로 확정했으므로, 캐시 컬럼을 남기면 이중 진실이 된다(필요하면 조회 시 뷰를 읽는다).

---

### X-11 · `session` → `user_session` 개명

`session` 은 "협업 세션", "편집 세션", "결제 세션" 등과 충돌하는 과부하 이름이며, 실시간 클러스터가 런타임에서 `conn:` 을 쓰므로 영속 테이블은 `user_session` 으로 명확히 한다. `user_session.device_id` 를 `device_offline_manifest.device_id` 와 같은 축으로 정렬한다(C-11 이 요구한 오프라인 권한 회수가 세션 축과 만나는 지점).

---

### X-12 · `property_id` 타입 전파 누락

C-4 가 `property.id text` 를 확정했으나, permission 판결문의 `page_access_rule.source_property_id uuid`, 15 의 `external_field_map.property_id uuid` / `external_relation_pending.property_id uuid`, 11 의 `reminder.property_id uuid`, 08 의 `automation_trigger.property_id uuid` 가 여전히 uuid 다. **전부 `text REFERENCES property(id)` 로 정정**한다. 16 의 두 컬럼은 database 판결이 이미 정정 지시했다.

---

### X-13 · `external_binding` → `external_sync_source` 개명

정본 엔티티 목록의 명칭을 `external_sync_source` 로 확정한다. `binding` 은 15 문서 내부에서만 통용되던 이름이고, "외부 동기화 소스"라는 도메인 어휘가 `data_source` 와의 관계(1:1 부착)를 더 정확히 드러낸다. 부속 테이블의 `binding_id` FK 는 `sync_source_id` 로 개명한다.

---

### X-14 · X-4 의 잔여 손실과 완화책

긴 텍스트 프로퍼티(rich text cell)의 동시 편집은 `(page_id, property_id)` 행 LWW 이므로 **후행 쓰기가 선행 쓰기를 덮는다**. 완화책 3안 중 클론은 **(b)** 를 채택한다.

| 안 | 내용 | 판정 |
|---|---|---|
| (a) 셀도 Y.Doc 에 넣는다 | 필터·정렬·rollup 이 전부 불가능 | 폐기 |
| **(b) 셀 편집 중 낙관적 잠금 + presence 배지** | `page_property_value.updated_at` 을 If-Match 로 검사, 충돌 시 사용자에게 병합 UI. presence 로 "누가 이 셀을 편집 중" 표시 | **채택.** MVP 는 배지만, v1 에 If-Match |
| (c) 텍스트 셀만 별도 Y.Doc | 셀당 문서가 생겨 X-5 의 채널 폭발이 재현 | 폐기 |

---

## 6. 남은 불확실성

> 각 항목은 **잠정 결정 → 실측 방법 → 결과가 바뀌면 스키마가 어떻게 움직이는가** 순으로 적는다. 잠정 결정이 없는 항목은 없다.

### 6.1 판결문에서 승계한 미해결 (실측 대상)

| # | 확정 못 한 것 | 잠정 결정 | 실측 방법 | 뒤집히면 바뀌는 것 |
|---|---|---|---|---|
| 1 | 최대 트리 깊이 `MAX_TREE_DEPTH` | 100, 초과 시 명시적 에러 | 테스트 워크스페이스에서 서브페이지를 1단씩 생성 → 실패 지점 기록. `ancestor_path` 배열 길이 상한과 breadcrumb 동작 동시 관찰 | 상수 1개 |
| 2 | `purged` 상태에서 Enterprise owner 가 무엇을 볼 수 있는가 | UI 노출 없음(GC 지연으로만 존재) | Enterprise 에서 영구 삭제 → owner 의 데이터 보존 화면에 남는지 확인 | ENUM 3값은 유지, **조회 권한 조건만 추가** |
| 3 | `page_access_rule` 로만 접근 가능한 행이 검색에 나와야 하는가 | **제외.** 스코프 필터에 걸리지 않으므로 | person property 로만 공유된 행을 그 사용자 계정으로 전역 검색 | 나와야 한다면 `search_document` 에 `access_rule_ds_id` 보조 축 추가 + 쿼리에 OR 절 |
| 4 | 행을 데이터베이스 밖으로 이동시켰을 때 셀 값의 운명 | `parent_type: data_source → block` 전이 시 `page_property_value` **보존**(page 확장 행 유지) | 행을 일반 페이지 하위로 Move to → 되돌렸을 때 값 복구 여부 | 삭제로 밝혀지면 이동 시 `page` 확장 행 캐스케이드 + 되돌리기 불가 고지 |
| 5 | teamspace 기본 권한 값 집합 (`default_member_level`) | `[확인필요]` NULL 허용 → **[해결 · 7c-12]** 컬럼이 아니라 teamspace 노드의 `('teamspace', T)` 행의 level 이고, 값은 page 매트릭스의 넷(`full_access` · `edit` · `comment` · `view`) — 0031 의 CHECK | Business 이상에서 teamspace 설정 드롭다운 관찰 | CHECK 제약 1줄 |
| 6 | `acl_entry.hidden_from_search` 실재 여부 | 컬럼 유지, 기본 false | 워크스페이스 전체 공유 페이지의 Share 패널에 검색 노출 토글 존재 확인 | 없으면 컬럼 삭제 |
| 7 | `restricted_member` 가 `workspace_everyone` grant 를 받는가 | **받지 않는다**(P(U) 에서 제외) | restricted member 계정으로 workspace 전체 공유 페이지 접근 시도 | `P(U)` 정의 1줄 + 검색 스코프 계산 |
| 8 | DB 잠금이 하위 row 페이지로 상속되는가 | **상속 안 됨**(노드 단독 판정) | DB 잠금 후 row 페이지 본문 편집 시도 | 상속이면 `node_lock` 판정이 조상 체인 조회가 되고 `ancestor_path` 조인 추가 |
| 9 | 동명 프로퍼티가 대소문자 구분 유니크인가 | **구분** 유니크, 폴백 없음 | `Status` 생성 후 `status` 생성 시도 → 거부 여부 | `UNIQUE(data_source_id, lower(name))` 로 변경 |
| 10 | 컬럼 고정 경계가 뷰별인가 사용자별인가 | **뷰별(공유)** | 계정 2개로 같은 공유 뷰에서 Freeze 실행 → 상대 화면 반영 확인 | 사용자별이면 `view_user_override` 에 컬럼 추가로 흡수 |
| 11 | 하나의 data_source 가 몇 개 database 에 linked 로 붙는가 | 상한 없음 | 같은 DS 를 5~10개 database 에 붙여 거부 지점 관찰 | `database_data_source` 개수 제한 추가 |
| 12 | linked data_source 의 스키마 편집이 원본에 전파되는가 | **전파된다**(스키마는 data_source 소유, 부착별 오버레이 없음) | linked 로 붙인 DB 에서 프로퍼티 추가 → 원본 확인 | 오버레이 필요 시 `database_data_source.property_overrides jsonb` 추가 |
| 13 | 프로퍼티 500개 한도의 스코프 | data_source 당 | API 로 501개 추가 시도 | 상수 위치 |
| 14 | 자동 버전 생성 임계값 | 10분 주기 / 2분 idle **(클론의 설계 선택)** | 편집 간격을 30초/3분/15분으로 바꾸며 버전 생성 시각 기록(3세션 이상) | 상수 2개 |
| 15 | 인박스 병합이 서버측인가 렌더측인가 | **조회 시점 병합**(결과와 무관하게 유지) | 5초 간격 코멘트 5건 → 개별/병합 여부, 부분 읽음 동작 관찰 | 유지. 근거가 제품 관측과 독립 |
| 16 | 제안이 실시간으로 보이는가 | 보인다(마크 기반이므로 자동) | 2계정 동시 접속, Suggesting 모드 타이핑 → 상대 화면 관찰 | 안 보여도 마크 방식 유지(폐기 근거가 모방이 아니라 원자성) |
| 17 | 같은 범위에 서로 다른 `sid` 마크 동시 적용 시 병합 | 중첩된다고 가정, 렌더러가 다중 sid 지원 | 두 Y.Doc 인스턴스에서 동일 범위에 서로 다른 sid 적용 → 병합 결과 확인 | 하나가 이기면 렌더러 단순화 + 충돌 고지 UI |
| 18 | `state_ref` blob GC 와 `file.ref_count` 갱신 시점 | 버전 생성 시 증가 / GC 시 감소 | 파일 도메인과 합의 필요 | refcount 갱신 트리거 위치 |
| 19 | 세션 최대 수명 범위 `[모순]` | 기본 90일, 정책 범위 1시간~90일 | 워크스페이스 설정에서 실제 선택 가능 범위 확인 | `session_policy` CHECK 1줄 |
| 20 | 계정당 이메일 최대 개수 `[모순]` | 5 | 6번째 이메일 추가 시도 | 상수 1개 |

### 6.2 이 문서의 판결(X-N)이 만든 새 실측 항목

| # | 검증할 것 | 왜 위험한가 | 실측 방법 | 임계와 대안 |
|---|---|---|---|---|
| 21 | **프로젝터 지연**(`merged_seq - projected_seq`) | X-1 의 대가. 이 창 동안 검색·API·사이드바가 낡은 값을 본다 | 초당 op 10건 주입 중 p50/p95/p99 지연 측정 | **p95 < 2s**. 초과 시 프로젝터를 페이지별 파티션 워커로 수평 확장, 그래도 초과 시 order_key 계산을 변경 자식만으로 축소 |
| 22 | **프로젝터 쓰기 증폭** | 문자 하나 입력마다 block 행을 UPDATE 하면 DB 가 죽는다 | 디바운스 창(200ms / 1s / 3s)별 초당 UPDATE 수 측정 | 디바운스 1s 기본. `block.version` 은 배치당 1회만 증가 |
| 23 | **`ds:` 채널 팬아웃**(X-5) | 큰 DB 를 여러 명이 보고 있으면 셀 1개 변경이 N 커넥션에 브로드캐스트 | 100/500 행 뷰를 20/100 커넥션이 열고 셀 변경 초당 5건 주입 | 50ms 배칭 + coalesce. 초과 시 뷰 필터 기반 서버측 라우팅(변경 행이 그 뷰 필터를 통과할 때만 전송) |
| 24 | **`user_accessible_scopes` 배열 크기**(X-8) | 방식 B 의 유일한 실패 모드 | `SELECT count(DISTINCT node_id) FROM acl_entry GROUP BY workspace_id` 분포 측정 | **1,000 초과**: IN 절 → 임시 테이블 조인. **5,000 초과**: `scope_grants(principal_id → scope_ids[])` 역인덱스 도입 + `acl_epoch` 통째 무효화를 정밀 무효화로 승격 |
| 25 | **`acl_epoch` 통째 무효화 비용** | 공유 1건이 전원의 스코프 캐시를 버린다 | `scopes` 캐시 미스율과 재계산 p99 측정 | 미스율 40% 또는 p99 50ms 초과 시 24번의 역인덱스로 승격 |
| 26 | **셀 LWW 실제 충돌률**(X-14) | 긴 텍스트 셀 동시 편집의 침묵 손실 | 파일럿에서 `page_property_value` 의 1분 내 재기록 비율을 property.type 별 계측 | text 계열 1% 초과 시 If-Match 낙관적 잠금을 MVP 로 앞당김 |
| 27 | **문서 채널 팬아웃 한계** | 제품 차원 상한이 없으므로 인프라가 정한다 | 1 Y.Doc 에 50/200/500 커넥션, 초당 op 10건 → relay p95·CPU·pub/sub 대역폭 | 임계 도달 시 채널별 배칭 윈도우 50ms + coalesce |
| 28 | **`ancestor_path` 서브트리 이동 비용**(X-7) | 이동 시 서브트리 전량 UPDATE (× `perm_scope_id` 재계산까지 동반) | 10/100/1,000/10,000 노드 서브트리 이동 벤치마크 | 임계 초과 시 자식 lazy 갱신으로 전환. `parent_type`/`order_key` 판결은 영향 없음 |
| 29 | **X-3 의 사용자 체감 확인** | 문단 삭제를 휴지통에서 되돌릴 수 없다는 것이 원본과 다른가 | 노션에서 문단 하나 삭제 → 휴지통에 나타나는지 확인 | 나타나면 X-3 을 뒤집는 것이 아니라 **`page_version` 기반 "블록 복원" UI** 를 추가한다(스키마 무변경) |
| 30 | **`properties_cache` 갱신 방식** | 트리거는 정합적이나 대량 임포트에서 쓰기 증폭 | 10만 행 × 30 프로퍼티 임포트를 트리거/워커 각각으로 측정 | 트리거(같은 트랜잭션) 기본. 임포트 경로만 트리거 off + 배치 재생성 예외 |

### 6.3 판결이 아니라 **합의가 필요한** 잔여 항목

| 항목 | 왜 이 문서가 정하지 않는가 | 누가 정해야 하는가 |
|---|---|---|
| `automation.created_by` 가 실행 권한 판정 기준인가, 클릭자가 기준인가 | 08 이 `[확인필요]` 로 남겼고 권한 클러스터가 판결 대상으로 삼지 않았다 | 08 × permission 합의. **잠정: 클릭자 권한으로 실행하고, 클릭자가 못 하는 액션은 실패 처리** |
| `vector_span`(임베딩) 스키마 | AI 클러스터(10) 소유이며 어휘 검색과 별개 파이프라인 | 10 단독. 단 `region_id` 축은 이 문서가 강제 |
| `analytics_rollup` / `moderation_case` / `setting_*` / `admin_role*` 의 상세 DDL | 17 고유이며 다른 문서와 충돌이 없다(17 §2.2 가 명시) | 17 단독. 이 문서는 **`workspace.region_id`, `audit_event.scope`, `block.moderation_state`, `block.created_by NULL 허용`** 4개 소급 불가 축만 정본으로 흡수했다 |
| `audit_event` 상세 컬럼 | V-8 이 17 로 이관했고 17 이 `scope`·`setting_key`·`value_before/after` 를 요구했다 | 17 단독. **소급 불가**: `scope ∈ {account, workspace, teamspace, organization}` 은 1일차에 넣어야 한다 |
| `form_submission_meta` 사이드카 | 17 F-17-10. DB 행에 넣으면 뷰·차트·자동화·내보내기로 전부 새어 나간다 | 13 × 17 합의. **이 문서의 제약: `page_property_value` 에 `ip_hash`/`captcha_score` 를 넣지 말 것** |

---

## 7. 이 문서를 반영해 고쳐야 하는 문서

> 판결문 4건의 「수정이 필요한 문서 목록」은 그대로 유효하다. 아래는 **이 문서의 X-N 판결로 추가된 수정**만 적는다.

| 문서 | 추가 수정 |
|---|---|
| `01-block-editor.md` | 블록 순서·삭제 서술에 X-1/X-3 반영 — 본문 블록의 순서 정본은 Y.Doc, 문단 삭제는 휴지통에 가지 않는다 |
| `03 / 04` | `page.id REFERENCES block(id)` 확정(X-2), `database.is_locked` 삭제(X-9), 셀 편집이 경로 ②임을 명시(X-4) |
| `05-collaboration-sync.md` | 채널 3종(X-5), `search_document` 권한 축(X-8), `block.version` 의 재정의(X-6), 프로젝터 존재(X-1) |
| `07-search-navigation.md` | `principals[]` 삭제 + `perm_scope_id`(X-8), `version = block.version`(X-6), 인덱싱 트리거 2개(X-6) |
| `08-templates-automation.md` | `automation_trigger.property_id text`(X-12), 실행이 경로 ②(V-5) |
| `11-history-notifications.md` | `reminder.property_id text`(X-12), 비페이지 블록 복구가 `page_version` 경로임(X-3) |
| `13-adjacent-products.md` | `subscription` → `billing_subscription` 전면 개명, `seats` 컬럼 삭제(X-10) |
| `14-auth-accounts.md` | `session` → `user_session`(X-11), `user.type` 3값(person/bot/agent) |
| `15-external-sync.md` | `external_binding` → `external_sync_source`, `binding_id` → `sync_source_id`, 모든 `property_id uuid` → `text`(X-12/X-13) |
| `16-item-layout.md` | `layout_module.property_id` / `layout_tab.relation_property_id` → `text`, `node_lock.scope` 로 R8 해소 |
| `17-ops-governance.md` | `audit_event` 가 06 `audit_log` 를 이관받았음. `moderation_state` 는 `block` 컬럼으로 확정 |

---

## 8. 참고 출처

이 문서의 사실 주장은 전부 판결문 4건이 이미 1차 출처로 검증한 것을 승계한다. 재확인이 필요하면 아래를 보라.

1. https://www.notion.com/blog/data-model-behind-notion — 블록 트리, `content` 배열, 조상 순회, 트랜잭션 all-or-nothing (C-10, V-5)
2. https://www.notion.com/blog/how-we-made-notion-available-offline — 페이지 채널, "new CRDT data model" (C-11)
3. https://www.notion.com/blog/rebuilding-notions-lexical-search-reindexer — 색인 단위 = block, 라우팅 키, external version (U-6)
4. https://www.notion.com/releases/2020-11-11 — "expand or **restrict** permissions for any sub-page" (C-8/V-1 의 결정적 근거)
5. https://www.notion.com/help/sharing-and-permissions — 액세스 레벨 6종, "broadest level of access", Private 이동 override (C-7, V-1 부속)
6. https://www.notion.com/help/whos-who-in-a-workspace — 역할 7종, restricted member 의 좌석 소비, temporary member 미소비 (C-14)
7. https://developers.notion.com/docs/upgrade-faqs-2025-09-03 — "permissions are managed at the database level, not per data source" (C-7)
8. https://developers.notion.com/reference/property-object — property id 는 짧은 랜덤 문자열, 이름 변경에 불변 (C-4)
9. https://developers.notion.com/reference/data-source — parent 는 단수, `database_parent` 별도, `properties` 는 name 키 객체 (C-5, V-7)
10. https://www.notion.com/help/data-sources-and-linked-databases — linked database 의 정의와 `Linked` 섹션 (C-5)
11. https://www.notion.com/help/views-filters-and-sorts — 3층 필터 그룹, `Freeze up to column` (C-15, C-6)
12. https://www.notion.com/help/custom-data-retention-settings · https://www.notion.com/help/duplicate-delete-and-restore-content — 휴지통 30일, 1일~10년 커스텀, 영구 삭제 후 30일 (C-1, C-12)
13. https://www.notion.com/help/updates-and-notifications · https://www.notion.com/help/notification-settings — 인박스 필터 4종, 페이지/DB항목 레벨 분기, 채널 4종 (C-13)
14. https://docs.yjs.dev/api/shared-types/y.xmltext · https://docs.yjs.dev/api/relative-positions · https://docs.yjs.dev/api/about-awareness — mark 의 CRDT 매핑, relative position, awareness 30초 (U-2, U-9)
15. https://www.notion.com/help/layouts — "A page layout will apply to all pages in the database" (U-1, 16 L1 스코프)
16. https://www.notion.com/help/add-members-admins-guests-and-groups — 30일 재가입 복원, temporary member 최대 1년 (C-14)
17. https://developers.notion.com/reference/user — User 객체 `type ∈ {person, bot}` 단일 스키마 (V-8, 규칙 A3)
