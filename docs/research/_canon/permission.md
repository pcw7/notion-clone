# 정본 결정 — 권한 · ACL · 멤버십 클러스터

> **이 문서의 지위**: 이 클러스터가 소유한 엔티티에 대해 **유일한 정답지**다. 02 / 04 / 06 / 07 / 13 / 14 의 해당 스키마 정의는 이 문서로 대체된다. 충돌 시 이 문서가 이긴다.
>
> **소유 엔티티**: `workspace_member` · `group` · `group_member` · `teamspace` · `teamspace_member` · `acl_entry` · `block_acl_meta` · `public_link` · `page_access_rule` · `security_policy` · `org_security_policy` · `access_request` · `node_lock` · `level_capability`
>
> **참조만 하는 엔티티(타 클러스터 소유)**: `block`(block-tree 클러스터) · `user` / `user_email` / `session` / `workspace_invite` / `sso_config` / `scim_token`(14 auth 클러스터) · `database` / `data_source`(database 클러스터) · `search_document`(07 search 클러스터) · `audit_event`(17 ops 클러스터) · `subscription` / `plan_entitlement`(13 billing 클러스터)
>
> 작성일 2026-09-06. 1차 출처 재확인 8건 수행(하단 §참고 출처).

---

## 판결 요약

| 항목 | 채택 | 폐기 | 파급 |
|---|---|---|---|
| **C-7** ACL 테이블 3종 | **06 `acl_entry`** 를 정본. `node_kind ∈ {block, teamspace}` 유지, `principal_type` 5값 확정({user, group, teamspace, workspace_everyone, public}), `level` 6값(`none` 삭제) | 02 `permission`, 04 `acl` 두 테이블 전부 폐기. 04의 `object_type='data_source'` 축 폐기 — **1차 출처가 "권한은 database 레벨이지 data source 별이 아니다"라고 명시** | 02 §의사스키마·F-02-18, 04 §의사스키마·F-04-25·F-04-13·F-04-24, 06 §의사스키마, 07 F-07-07 |
| **C-8 / V-1** 상속 차단 | **06 `block_acl_meta.inherits_from_parent` 채택 + [추정] → [도출확인] 승격.** 단 "사용자 가시 토글"이 아니라 **쓰기 알고리즘의 부수효과**로 재정의 | 02 불변식 **I2 폐기**(무조건 루트까지 재귀는 거짓). "차단 메커니즘 없음 / 하위를 좁힐 수 없음" 가설도 폐기 — 2.10 릴리스 노트가 `restrict permissions for any sub-page` 를 명시 | 02 I2, 06 F-06-05·F-06-14·F-06-20, 07 F-07-07, 04 F-04-25 |
| **C-8 부속** 유효권한 캐시 축 | `block.perm_scope_id` 비정규화 컬럼 1개가 **권한 재귀 종료점 + 검색 필터 키**를 겸한다 | 06 F-06-05 의 `depth <= :depth_of_nearest_inheritance_break` 쿼리(별도 조회 1회 추가 필요) 폐기 | 06 F-06-05·F-06-14, 07 F-07-06·F-07-07 |
| **C-14** 워크스페이스 역할 | **06 5값 + `is_temporary` + `status` + `expires_at`** 정본. 여기에 14 R-5(`join_method`,`invited_by`,`invite_accepted_at`) + 신규 `removed_at` 추가 | 02 4값(`owner/membership_admin/member/guest`) 폐기. `temporary_member` 를 6번째 enum 값으로 만드는 안도 폐기(1차 출처: temp 는 "member-level access"이므로 role 과 직교) | 02 §의사스키마, 06 F-06-02·F-06-09, 13 F-13-18, 14 R-5/R-14 |
| **C-14 부속** 좌석 산식 | `seat = count(status='active' AND is_temporary=FALSE AND role ≠ 'guest')`. **restricted_member 는 좌석을 소비한다**(1차 출처 확인) | "restricted member 는 제한적이므로 미소비"라는 직관 폐기 | 13 F-13-18, 06 F-06-02 |
| **V-8** 인증 도메인 접점 | `user` 계열 5종은 14 소유. ACL 은 `user.id` 만 참조. **integration / agent 는 `principal_type` 값이 아니라 `user.type` 값**(14 R-12 을 이 방향으로 확정) | 06 의 `acl_entry.principal_type='integration'`, `'agent'` 폐기 | 06 F-06-13·F-06-18, 09 F-09-02, 14 R-12 |
| **V-8 부속** 소유권 이관 | `sso_config`·`scim_token` → 14 로 이관. `audit_log` → 17 `audit_event` 로 이관(중복 정의 제거). `security_policy` 는 06 잔류(권한 알고리즘의 0단계 게이트이므로) | 06 이 이 3종을 모두 소유하던 상태 폐기 | 06 F-06-12·F-06-19, 14, 17 F-17-13 |
| **U-3** 그룹 변경 무효화 | **주체축 세대 카운터 `perm_gen:{user_id}` INCR 만으로 종결.** 검색 인덱스는 **재색인 0건**(07 방식 B 채택의 직접적 대가) | 07 F-07-07 **방식 A(`search_document.principals[]`) 폐기**. 그룹 1건 변경 → 수만 문서 재색인 경로를 원천 제거 | 07 F-07-06·F-07-07, 06 F-06-03·F-06-14, 06 F-06-12(SCIM 배치) |
| **U-3 부속** 스코프 캐시 무효화 | `user_accessible_scopes` 는 **워크스페이스 단위 `acl_epoch`** 로 통째 무효화(coarse). 실측 임계 초과 시에만 `scope_grants` 역인덱스로 승격 | 노드별 정밀 무효화를 MVP 부터 짜는 안 폐기(무효화 트리거 7종을 전부 정확히 잡는 것이 XL 의 원인) | 06 F-06-14 |
| **V-1 부속** Private 이동 | reparent + **노드 로컬 ACL 재설정**. 상속 차단 플래그는 건드리지 않는다 | "Private 이동 = 상속 차단 켜기"라는 해석 폐기(하위 명시 부여 보존 문구와 어긋남) | 06 F-06-20, 02 F-02-08·F-02-12 |

---

## 정본 스키마

### 1. 멤버십

```sql
-- 소유: 이 클러스터. user/workspace 본체는 14 / 02 소유.
CREATE TABLE workspace_member (
  workspace_id  uuid NOT NULL,                    -- → workspace(id) [02 소유]
  user_id       uuid NOT NULL,                    -- → user(id)      [14 소유]
  role          text NOT NULL
    CHECK (role IN ('owner','membership_admin','member','restricted_member','guest')),
  is_temporary  boolean NOT NULL DEFAULT false,   -- Marketplace 컨설턴트. 좌석 미소비
  expires_at    timestamptz NULL,                 -- is_temporary=true 일 때만 의미. 최대 today+1y
  status        text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','suspended','removed')),
  join_method   text NULL                         -- 14 R-5
    CHECK (join_method IN ('invite_email','invite_link','allowed_domain','saml_jit','scim','guest_upgrade')),
  invited_by    uuid NULL,
  invited_at    timestamptz,
  accepted_at   timestamptz NULL,                 -- status: invited → active 전이 시각
  removed_at    timestamptz NULL,                 -- 30일 복원 창의 기준점
  PRIMARY KEY (workspace_id, user_id),
  CHECK (NOT is_temporary OR expires_at IS NOT NULL),
  CHECK (NOT is_temporary OR role = 'member')     -- temp 는 member-level access (1차 출처)
);
CREATE INDEX ON workspace_member (workspace_id, status) WHERE status = 'active';
CREATE INDEX ON workspace_member (workspace_id, expires_at) WHERE is_temporary;

-- 좌석 산식 (13 F-13-18 이 이 뷰만 읽는다. subscription.seats 를 직접 세지 말 것)
CREATE VIEW workspace_seat_count AS
SELECT workspace_id, count(*) AS seats
FROM workspace_member
WHERE status = 'active' AND is_temporary = false AND role <> 'guest'
GROUP BY workspace_id;
```

```sql
CREATE TABLE "group" (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name         text NOT NULL,
  icon         text NULL,
  external_id  text NULL,          -- SCIM IdP 그룹 id (F-06-12)
  deleted_at   timestamptz NULL,
  UNIQUE (workspace_id, lower(name)) -- 동명 그룹 금지 (클론의 설계 선택)
);

CREATE TABLE group_member (
  group_id   uuid NOT NULL REFERENCES "group"(id),
  user_id    uuid NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz NULL,     -- soft delete. 30일 재가입 복원용 (1차 출처)
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX ON group_member (user_id) WHERE removed_at IS NULL;
-- 불변식 G1: 중첩 그룹 금지. group 은 user 만 담는다.
-- 불변식 G2: role='guest' 인 workspace_member 는 group_member 가 될 수 없다 (1차 출처: "Groups can't contain workspace guests").
--            애플리케이션 레벨 가드 + 야간 정합성 검사로 강제. DB 제약으로는 workspace_id 교차 조인이 필요해 비용이 크다.
-- 불변식 G3: role='restricted_member' 는 group_member 가 될 수 있다 (1차 출처).
```

```sql
CREATE TABLE teamspace (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL,
  name           text NOT NULL,
  icon           text NULL,
  visibility     text NOT NULL CHECK (visibility IN ('open','closed','private')),
  is_default     boolean NOT NULL DEFAULT false,   -- 전 멤버 자동 가입. visibility 와 직교
  who_can_invite text NOT NULL DEFAULT 'all_members'
                 CHECK (who_can_invite IN ('owners','all_members')),
  default_member_level text NULL,                  -- 신규 페이지의 기본 부여 레벨 [확인필요]
  archived_at    timestamptz NULL
);

CREATE TABLE teamspace_member (
  teamspace_id   uuid NOT NULL REFERENCES teamspace(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user','group')),
  principal_id   uuid NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner','member')),
  removed_at     timestamptz NULL,
  PRIMARY KEY (teamspace_id, principal_type, principal_id)
);
```

### 2. ACL (권한의 유일한 저장 지점)

```sql
CREATE TABLE acl_entry (
  id             uuid PRIMARY KEY,
  node_kind      text NOT NULL CHECK (node_kind IN ('block','teamspace')),
  node_id        uuid NOT NULL,        -- node_kind='block' → block(id) [block-tree 클러스터 소유]
                                       -- node_kind='teamspace' → teamspace(id)
  principal_type text NOT NULL
    CHECK (principal_type IN ('user','group','teamspace','workspace_everyone','public')),
  principal_id   uuid NULL,            -- workspace_everyone / public 일 때 NULL
  level          text NOT NULL
    CHECK (level IN ('view','comment','edit_content','create','edit','full_access')),
  hidden_from_search boolean NOT NULL DEFAULT false,  -- workspace_everyone 전용 [확인필요]
  granted_by     uuid NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_kind, node_id, principal_type, principal_id),
  CHECK ((principal_type IN ('workspace_everyone','public')) = (principal_id IS NULL)),
  CHECK (NOT hidden_from_search OR principal_type = 'workspace_everyone')
);
CREATE INDEX ON acl_entry (node_kind, node_id);
CREATE INDEX ON acl_entry (principal_type, principal_id);   -- 게스트 역조회 / 그룹 폐기 시 캐스케이드
```

**설계 규칙 3개 — 위반하면 나머지 알고리즘이 전부 깨진다.**

| # | 규칙 | 이유 |
|---|---|---|
| A1 | **`level='none'` 행은 존재하지 않는다.** 권한 회수 = 행 DELETE | 1차 출처가 "broadest level of access"를 명시 → deny 계층이 없다. `none` 을 저장하면 MAX 합집합에서 아무 효과가 없거나(무의미) deny 로 오독된다 |
| A2 | **`level` 은 전순서가 아니다.** 비교는 반드시 `level_capability` 를 거친다 | `create` 는 `view` 를 포함하지 않는다(1차 출처: "can create new pages ... but can't view or edit existing pages"). 정수 서열로 두면 이 케이스가 깨진다 |
| A3 | **integration / agent 는 `principal_type` 값이 아니다.** `user(type ∈ {person, bot, agent})` 행으로 만들고 `principal_type='user'` 로 부여 | 공개 API 의 User 객체가 `type ∈ {person, bot}` 로 이미 한 스키마다. principal 어휘를 늘리면 `effective()` 분기가 principal 종류 수만큼 곱해진다 |

```sql
-- level → capability 매핑. (대상 종류, 레벨) 2차원. 코드에서 등급을 직접 비교하지 말 것.
CREATE TABLE level_capability (
  target_kind text NOT NULL CHECK (target_kind IN ('page','database','teamspace','form_submitter')),
  level       text NOT NULL,
  cap_view            boolean NOT NULL,
  cap_comment         boolean NOT NULL,
  cap_edit_content    boolean NOT NULL,
  cap_create_child    boolean NOT NULL,
  cap_edit_structure  boolean NOT NULL,
  cap_share           boolean NOT NULL,
  cap_manage_perm     boolean NOT NULL,
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

> `create` 행의 `view=X` 가 A2 의 근거다. 실무에서는 `page_access_rule(source_kind='created_by', level='edit')` 과 페어링해 "자기가 만든 행만 편집"을 만든다.

### 3. 상속 차단과 권한 스코프

```sql
CREATE TABLE block_acl_meta (
  node_id              uuid PRIMARY KEY,           -- → block(id)
  inherits_from_parent boolean NOT NULL DEFAULT true,
  materialized_at      timestamptz NULL,           -- inherits=false 로 전이한 시각
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- block 테이블에 이 클러스터가 요구하는 비정규화 컬럼 2개 (block-tree 클러스터에 반영 요청)
--   block.path          text     -- materialized path. '/{root}/{a}/{b}/'
--   block.perm_scope_id uuid     -- 아래 정의. 권한 재귀 종료 + 검색 필터 키를 겸한다
```

**`perm_scope_id` 정의**

> `perm_scope_id(N)` = N 자신 또는 가장 가까운 조상 중, **`acl_entry` 행을 1개 이상 갖거나 `inherits_from_parent=FALSE` 인 노드**의 id.
> 아무 조상도 해당하지 않으면 teamspace 루트 노드 id(또는 workspace private root id).

따라서 **스코프 경계가 아닌 노드는 자기 스코프 루트와 유효권한이 항상 동일하다**. 이것이 검색 필터를 문서 단위 비정규화 없이 성립시킨다.

`perm_scope_id` 재계산 트리거는 정확히 4개다:
1. 노드에 첫 `acl_entry` 삽입 → 그 노드가 새 스코프 루트가 됨
2. 노드의 마지막 `acl_entry` 삭제 (그리고 `inherits_from_parent=TRUE`) → 스코프 루트에서 탈락
3. `inherits_from_parent` 전이
4. 서브트리 이동(`block.parent_id` 변경)

넷 다 `UPDATE block SET perm_scope_id = ... WHERE path LIKE :prefix || '%'` 형태의 **prefix 일괄 갱신**이다. closure table 보다 materialized path 를 택한 이유가 이것이다.

### 4. 유효 권한 알고리즘 (정본)

```
-- 0단계: 정책 게이트 (유일한 deny 계층. ACL 보다 먼저 평가된다)
if not policy_allows(workspace(N), action):  return DENY

-- 1단계: grant 합집합
effective(user U, node N) -> level:
    local  = MAX_BY_CAP over acl_entry(N) where principal ∈ P(U)
    if block_acl_meta(N).inherits_from_parent and parent(N) exists:
        local = MAX_BY_CAP(local, effective(U, parent(N)))          -- 재귀. 차단 노드에서 멈춤
    -- 아래 3항은 상속 항이 아니라 노드 로컬 grant 다. 차단 플래그의 영향을 받지 않는다.
    local = MAX_BY_CAP(local,
              page_access_rule_grant(U, N),      -- N 이 DB row 이고 U 가 person property 값에 포함
              public_link_grant(U, N),           -- public_link(N).enabled
              form_submitter_grant(U, N))        -- U 가 그 row 의 제출자
    return local or 'none'

  where P(U) = {('user',U)} ∪ {('group',g) : g ∈ active_groups(U)}
             ∪ {('teamspace',t) : t ∈ active_teamspaces(U)}
             ∪ {('workspace_everyone',NULL) : U 가 role∈(owner,membership_admin,member) 인 active 멤버}
             ∪ {('public',NULL) : 항상}
  -- 주의: role='guest' 와 role='restricted_member' 는 workspace_everyone 에 포함되지 않는다.
  --       restricted member 의 대량 부여 수단은 group 뿐이다(1차 출처).

-- 2단계: 잠금 게이트
if node_lock(N).locked and action ∈ {edit_content, edit_structure}:  return BLOCK

-- 별도 경로(ACL 아님): Enterprise 관리자 콘텐츠 검색·감사. effective() 의 항이 아니다.
--   "Admin roles don't change what someone can see or edit in pages or databases" (1차 출처)
```

`MAX_BY_CAP` = capability 비트마스크 OR 후 가장 가까운 표시용 레벨로 환원. 단순 정수 MAX 금지(A2).

### 5. 그 외 소유 엔티티

```sql
CREATE TABLE public_link (
  node_id    uuid PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  level      text NOT NULL DEFAULT 'view' CHECK (level IN ('view','comment','edit')),
  token      text UNIQUE,
  expires_at timestamptz NULL,
  created_by uuid, created_at timestamptz
);

-- DB row 권한을 property 값으로 유도. **data_source 단위**가 정본이다(§C-7 판결 참조).
CREATE TABLE page_access_rule (
  id                 uuid PRIMARY KEY,
  data_source_id     uuid NOT NULL,      -- → data_source(id) [database 클러스터 소유]
  source_kind        text NOT NULL CHECK (source_kind IN ('person_property','created_by')),
  source_property_id uuid NULL,          -- source_kind='person_property' 일 때 필수
  level              text NOT NULL CHECK (level IN ('view','comment','edit','full_access')),
  CHECK ((source_kind='person_property') = (source_property_id IS NOT NULL))
);

CREATE TABLE node_lock (
  node_id   uuid PRIMARY KEY,
  kind      text NOT NULL CHECK (kind IN ('page','database')),
  locked_by uuid, locked_at timestamptz
);
-- 잠금은 행의 존재 여부로 표현한다. locked BOOL 컬럼을 두지 않는다(해제=DELETE).
-- 04 의 database.is_locked 컬럼은 폐기하고 이 테이블로 통합한다.

CREATE TABLE security_policy (
  workspace_id PRIMARY KEY,
  allow_publish_sites_and_forms      boolean NOT NULL DEFAULT true,
  allow_duplicate_to_other_workspace boolean NOT NULL DEFAULT true,
  allow_export                       boolean NOT NULL DEFAULT true,
  allow_member_invite_guests         boolean NOT NULL DEFAULT true,
  allow_member_request_add_guests    boolean NOT NULL DEFAULT true,
  allow_member_request_add_members   boolean NOT NULL DEFAULT true,
  allow_nonmember_page_access_request boolean NOT NULL DEFAULT true,
  allow_guest_request_membership     boolean NOT NULL DEFAULT true,
  require_mfa_for_guests             boolean NOT NULL DEFAULT false,   -- 14 요구
  who_can_add_restricted_members     text NOT NULL DEFAULT 'owners'
);
CREATE TABLE org_security_policy (
  org_id uuid, policy_key text,
  mode text CHECK (mode IN ('workspace_managed','enabled_for_everyone','disabled_for_everyone')),
  PRIMARY KEY (org_id, policy_key)
);

CREATE TABLE access_request (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('page_access','edit_access','join_workspace','add_member','add_guest')),
  node_id uuid NULL, requester_id uuid NULL, requester_email text NULL,
  requested_level text NULL, message text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','ignored')),
  decided_by uuid NULL, decided_at timestamptz NULL, created_at timestamptz NOT NULL
);
-- 불변식: pending 은 만료되지 않는다(1차 출처는 "accept or ignore" 2택만 서술). 무한 누적 전제로 UI 설계.
```

### 6. 캐시 키 규약 (Redis)

| 키 | 값 | 증가 트리거 |
|---|---|---|
| `perm_gen:{user_id}` | int | 그룹 멤버십 변경, teamspace 멤버십 변경, workspace_member.role/status 변경 |
| `perm_ver:{workspace_id}:{path_prefix}` | int | 해당 서브트리의 acl_entry 변경, inherits 전이, 서브트리 이동 |
| `acl_epoch:{workspace_id}` | int | 위 두 트리거 전부(포괄 상위) |
| `perm:{user_id}:{gen}:{node_id}:{ver}` | level | 판정 결과 캐시. TTL 300s |
| `scopes:{user_id}:{acl_epoch}` | uuid[] | `user_accessible_scopes`. TTL 600s |

무효화는 **키 삭제가 아니라 카운터 INCR** 로 수행한다. 삭제 대상 열거가 필요 없어지고, 무효화 누락이 곧 권한 누출인 이 도메인에서 열거 로직 자체가 사라진다.

---

## 판결별 상세

### C-7 — ACL 테이블 3종 병존

**채택**: 06 `acl_entry`. 단 3점 수정 — ① `level` 에서 `'none'` 삭제, ② `principal_type` 을 5값으로 동결하고 `'integration'`/`'agent'` 확장 금지, ③ `hidden_from_search` 를 `workspace_everyone` 전용으로 제약.

**근거**

1. **대상 축은 `node_kind ∈ {block, teamspace}` 가 옳고, 04 의 `object_type='data_source'` 는 틀렸다.** 1차 출처가 명시한다 — *"User and bot permissions are managed at the **database** level, not per data source."* (developers.notion.com/docs/upgrade-faqs-2025-09-03). data source 별로 달라지는 것은 **page-level access rule 뿐**이며, 그것은 `page_access_rule.data_source_id` 라는 별도 테이블이 이미 담당한다. 04 는 이 두 가지를 혼동해 ACL 대상 축에 data_source 를 넣었다.
2. **`level` 6값이 옳다.** 04 의 5값은 `create` 를 빠뜨렸는데, `Can create` 는 1차 출처에 명시된 Business/Enterprise 등급이다. 02·06 의 7값은 `none` 을 포함하는데, 1차 출처의 결합 규칙이 *"Notion respects the broadest level of access"* 인 이상 deny 가 없고 따라서 저장된 `none` 은 정의상 무효과다(규칙 A1).
3. **principal 어휘 확장 금지는 클론 설계 선택이다.** 06 자신이 F-06-13 에서 `'integration'`, F-06-18 에서 `'agent'` 를 principal_type 에 추가하자고 제안했고 14 가 R-12 로 "둘 중 하나 결정 필요"를 제기했다. 공개 API 의 User 객체가 이미 `type ∈ {person, bot}` 로 사람과 봇을 **한 스키마**에 담고 있으므로(developers.notion.com/reference/user), ACL 쪽이 아니라 user 쪽에서 분화시키는 것이 원본과도 일치하고 `effective()` 분기도 늘지 않는다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 02 `permission(block_id, subject_type, subject_id, level)` | teamspace 를 대상으로 삼을 수 없고(`block_id` 단일 FK), `workspace_everyone` 과 `public` 을 `subject_type='workspace'`/`'public'` 으로 뭉뚱그려 restricted_member·guest 제외 규칙을 표현하지 못한다 |
| 04 `acl(object_type, object_id, subject_type, subject_id, level)` | 대상 축이 1차 출처와 반대(data_source 별 권한은 없다), `create` 누락, `teamspace` principal 누락. 04 가 이 테이블을 만든 동기("상속 계산을 3중 조인으로 만들지 않기")는 `acl_entry` 가 이미 충족한다 |
| `level='none'` 저장 | 규칙 A1 |
| `principal_type ∈ {integration, agent}` | 규칙 A3 |

**파급**: 02 §의사스키마 3)번 블록 삭제 + F-02-18 데이터 모델 함의 / 04 §의사스키마 `CREATE TABLE acl` 삭제 + F-04-25·F-04-13·F-04-24 데이터 모델 함의 / 06 §의사스키마 `acl_entry` 정의 교체 + F-06-01·F-06-13·F-06-18 / 07 F-07-07.

---

### C-8 + V-1 — 권한 상속 차단이 실재하는가

**채택**: `block_acl_meta.inherits_from_parent BOOL DEFAULT TRUE` 를 정본으로 채택하고, **`[추정]` 태그를 `[도출확인]` 으로 승격**한다. 동시에 이것이 **사용자 가시 토글이 아님**을 명시하고, 플래그를 세우는 쓰기 알고리즘을 정본으로 규정한다.

**근거 — 비평 V-1 의 전제가 틀렸다**

비평은 "1차 출처에 stop inheriting 토글이 없고 broadest level of access 만 명시되므로 차단 메커니즘이 없을 수 있다"고 했다. 헬프센터만 보면 맞다. 그러나 **공식 릴리스 노트가 restriction 을 명시한다**:

> "Before, permissions could not be changed for any page that was nested inside another page — **they always inherited the permission level of the parent page**." ... 이제 *"expand or **restrict** permissions for any sub-page"* 가 가능하며, 예시로 *"Grant the entire workspace `Can edit` access to a wiki sub-page, but retain `Can read` access for the parent page"* 를 든다.
> — https://www.notion.com/releases/2020-11-11 (Notion 2.10)

여기서 **restrict 는 순수 조상 합집합 모델에서 수학적으로 불가능하다**. `effective(N) = ⋃(ancestors) grants` 이고 결합이 MAX 라면, N 에서 무엇을 하든 조상의 grant 는 결과에서 제거되지 않는다. 따라서 restriction 을 허용하는 이상 **절단(truncation) 메커니즘이 반드시 존재한다**. 후보는 두 개뿐이다:

| 후보 | 판정 |
|---|---|
| (a) 노드 단위 상속 절단 | **채택.** broadest-wins 와 공존 가능 |
| (b) 노드 단위 deny 엔트리 | **폐기.** 1차 출처의 *"Notion respects the broadest level of access given to a user"* 와 정면 충돌. deny 가 있다면 이 문장은 거짓이 된다 |

즉 06 의 결론은 옳았고 근거 제시가 약했을 뿐이다. 반대로 **02 의 불변식 I2("권한 확인은 parent 체인을 루트까지 올라가며 수행한다")는 거짓**이다. 노션 데이터 모델 블로그의 *"traverses ancestors up to the workspace root"* 는 트리 순회 자체를 서술한 것이지 절단이 없다는 뜻이 아니며, 2.10 릴리스 노트와 직접 충돌한다.

**단, 06 의 서술 중 두 가지는 정정한다.**

1. **사용자 가시 토글은 없다.** 헬프센터에 "stop inheriting" UI 가 문서화된 적이 없고, 안내는 *"go into a subpage and update the permissions there"* 뿐이다. 따라서 플래그는 **Share 패널에서 상속된 principal 을 Remove 하는 순간의 부수효과**로만 세워진다.
2. **Private 이동은 상속 차단이 아니다.** 1차 출처: *"moving a shared page to the `Private` section of your sidebar will remove everyone else's access on that page. **This override will only apply to the parent page** — the permissions granted for any subpages will remain the same."* 이는 reparent + 노드 로컬 ACL 재설정으로 완전히 설명되며, 플래그를 건드릴 필요가 없다.

**정본 쓰기 알고리즘**

```
restrict(N, principal P):        -- Share 패널에서 '상속됨'으로 표시된 P 를 Remove
  meta = block_acl_meta(N)
  if meta.inherits_from_parent:
      materialize(N)             -- 반드시 먼저. 순서를 바꾸면 P 외 전원도 함께 잃는다
  DELETE FROM acl_entry WHERE node_id = N AND principal = P
  recompute_perm_scope(N); INCR acl_epoch; INCR perm_ver:{path(N)}

materialize(N):                  -- 상속 집합을 노드 로컬로 스냅샷
  INSERT INTO acl_entry (node_kind,node_id,principal_type,principal_id,level)
  SELECT 'block', N, p.type, p.id, MAX_BY_CAP(p.level)
  FROM inherited_grants(parent(N)) p
  ON CONFLICT (node_kind,node_id,principal_type,principal_id) DO NOTHING   -- 노드 로컬 명시 부여가 우선
  UPDATE block_acl_meta SET inherits_from_parent = false, materialized_at = now() WHERE node_id = N

move_to_private(N, U):           -- Private 이동
  block.parent_id ← U 의 private root       -- reparent
  DELETE FROM acl_entry WHERE node_id = N AND NOT (principal_type='user' AND principal_id=U)
  UPSERT acl_entry(N, 'user', U, 'full_access')
  -- inherits_from_parent 는 건드리지 않는다. 하위 노드의 명시 부여는 그대로 살아남는다.
```

**이 알고리즘이 만드는 불변식**

| # | 불변식 |
|---|---|
| **P1** | `inherits_from_parent = FALSE` 인 노드는 절단 시점의 상속 집합이 `acl_entry` 로 머티리얼라이즈되어 있다. 이것이 깨지면 "1명 제거"가 "전원 상실"이 된다 |
| **P2** | 한번 절단된 노드는 이후 조상 ACL 변경을 받지 않는다. (2.10 이 명시적으로 허용한 상태 — 부모 `Can read`, 자식 `workspace Can edit`) |
| **P3** | 절단은 **되돌릴 수 있다**. `inherits_from_parent := TRUE` + 머티리얼라이즈된 행 중 부모에서 온 것과 동일한 행 삭제. UI 상 "상속 복원" 버튼으로 노출한다 (클론의 설계 선택 — 원본 UI 미확인) |
| **P4** | `page_access_rule` / `public_link` / `form_submitter` 는 **노드 로컬 grant** 이므로 절단의 영향을 받지 않는다 |

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 02 불변식 **I2** | 2.10 릴리스 노트와 충돌. "루트까지"를 "절단 노드까지"로 교체 |
| "차단 메커니즘 없음 → 하위를 상위보다 좁게 만들 수 없다가 시스템 불변식" (비평이 제시한 대안 가설) | 1차 출처가 restrict 를 명시 |
| 노드 단위 deny 엔트리 모델 | broadest-wins 원문과 충돌 |
| 06 F-06-05 의 `AND anc.depth <= :depth_of_nearest_inheritance_break` 쿼리 | 그 depth 를 알려면 조회가 1회 더 필요하다. `perm_scope_id` 비정규화로 대체 |

**파급**: 02 I2 문장 교체 / 06 F-06-05 전면 개정(추정 태그 → 도출확인, 쓰기 알고리즘 추가, 대표 쿼리 교체) · F-06-14 캐시 키 · F-06-20 Private 이동 서술 / 07 F-07-07 (아래 U-3) / 04 F-04-25 (DB 는 block 이므로 같은 알고리즘 사용, 별도 축 아님).

---

### C-14 — 워크스페이스 역할 enum

**채택**: 06 의 5값 role + `is_temporary` + `status` + `expires_at`. 여기에 14 R-5 의 `join_method` / `invited_by` / `accepted_at` 과 신규 `removed_at` 을 더한다(§정본 스키마 1 참조).

**근거 (전부 1차 출처)**

| 사실 | 출처 |
|---|---|
| `restricted member` 는 실재하며 **좌석을 소비한다** — "They affect your billing in the same way as adding a workspace member" | help/whos-who-in-a-workspace |
| `temporary member` 는 **좌석을 소비하지 않으며**, 만료일은 **최대 1년**, "get member-level access until their expiration date" | help/whos-who-in-a-workspace, help/add-members-admins-guests-and-groups |
| `guest` 는 좌석 미소비 | help/whos-who-in-a-workspace |
| `membership admin` 은 Enterprise 전용 | help/whos-who-in-a-workspace |
| 제거 후 **30일 내 재가입 시 private 페이지·공유 페이지·group membership·teamspace membership 이 복원된다** | help/add-members-admins-guests-and-groups |

마지막 항목이 스키마를 바꾼다: **멤버 제거는 hard delete 가 아니라 `status='removed' + removed_at` 전이여야 하고, `group_member` / `teamspace_member` 도 soft delete(`removed_at`) 여야 한다.** 06 F-06-03 의 엣지케이스가 "그룹 삭제 → ACL 캐스케이드 삭제"라고 쓴 것은 그룹 삭제에만 해당하며, **멤버 제거는 어떤 행도 물리 삭제하지 않는다**.

**좌석 산식 정본**

```
seats = |{ m ∈ workspace_member : m.status='active' ∧ ¬m.is_temporary ∧ m.role ≠ 'guest' }|
```
`status='invited'`(미수락)는 **세지 않는다**(14 R-14). 13 F-13-18 의 `subscription.seats int` 는 이 뷰를 캐시한 값일 뿐이며 진실의 원천이 아니다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 02 `role ∈ {owner, membership_admin, member, guest}` | `restricted_member` 누락 → 06 F-06-03 의 "restricted member 의 유일한 대량 부여 수단은 group" 규칙이 표현 불가. `status` 부재 → 초대 즉시 과금 |
| `role` enum 에 `'temporary_member'` 를 6번째 값으로 추가하는 안 | 1차 출처가 temp 를 "member-level access" 라고 정의 → 역할이 아니라 **역할과 직교하는 수명 축**. enum 값으로 만들면 향후 "temporary restricted member" 를 표현할 수 없다 |
| 좌석 산식에서 restricted_member 제외하는 안 | 1차 출처가 정면으로 부정 |
| `workspace_member` 물리 삭제 | 30일 복원 문구와 충돌 |

**파급**: 02 §의사스키마 `workspace_member` 교체 / 06 F-06-02 좌석 산식 문장·F-06-09 게스트 관리 / 13 F-13-18 (`seats` 를 파생값으로 강등, `workspace_seat_count` 뷰 참조로 교체) / 14 R-5·R-14 는 이 문서로 해소 처리.

---

### V-8 — 인증 도메인과의 경계 확정

**채택**: 소유권 경계를 아래대로 고정한다.

| 엔티티 | 소유 | 비고 |
|---|---|---|
| `user`, `user_email`, `session`, `workspace_invite`, `sso_config`, `scim_token` | **14 (auth)** | 이 클러스터는 `user.id` 만 참조 |
| `workspace_member`, `group`, `group_member`, `teamspace`, `teamspace_member` | **이 클러스터** | 14 는 초대 수락 시 `workspace_member` 를 `invited → active` 전이시킬 뿐 |
| `security_policy`, `org_security_policy` | **이 클러스터** | `effective()` 의 0단계 게이트. 알고리즘과 분리 불가 |
| `audit_log` / `audit_event` | **17 (ops)** | 06 의 `audit_log` 정의 삭제. 17 의 `audit_event(scope ∈ {account,workspace,teamspace,organization})` 로 단일화 |
| `integration`, `integration_token` | **09 (api)** | 단, ACL 부여는 반드시 대응 `user(type='bot')` 행을 경유한다(규칙 A3) |

**근거**: 14 R-12 가 "`principal_type='integration'` vs `user(type='bot')` 중 하나를 결정하라"고 요구했고, ACL 쪽 어휘는 이 클러스터의 소관이다. 공개 API 가 person 과 bot 을 한 User 스키마로 노출하는 이상, 분화 지점을 `user.type` 에 두는 것이 원본과 일치하며 `effective()` 의 principal 해석 코드가 하나로 유지된다. `sso_config`/`scim_token` 은 인증 흐름의 산물이지 권한 판정의 입력이 아니므로 14 로 넘긴다 — 단 **SCIM 프로비저닝이 `group`/`group_member` 를 쓰는 경로는 이 클러스터의 U-3 무효화 규약을 따라야 한다**(아래).

**폐기**: 06 §의사스키마의 `sso_config`, `scim_token`, `audit_log` 3개 정의. 06 의 `acl_entry.principal_type='integration'`.

**파급**: 06 §의사스키마·F-06-12·F-06-13·F-06-18·F-06-19 / 09 F-09-02 / 14 R-12 해소 / 17 F-17-13.

---

### U-3 — 그룹 멤버 변경 시 캐시 무효화 범위

**채택**: 무효화 팬아웃을 **주체축 카운터 1회 INCR** 로 종결시킨다. 그 대가로 **07 F-07-07 의 방식 A(`search_document.principals uuid[]`)를 폐기하고 방식 B(`perm_scope_id`)를 정본으로 확정**한다.

**그룹 멤버 1건 추가/제거 시 정확히 일어나는 일**

| # | 동작 | 비용 | 동기/비동기 |
|---|---|---|---|
| 1 | `group_member` upsert 또는 `removed_at` 설정 | O(1) | 동기 |
| 2 | `INCR perm_gen:{user_id}` → 그 사용자의 `perm:*` 판정 캐시 전량 무효 | **O(1)** | 동기 |
| 3 | `INCR acl_epoch:{workspace_id}` → `scopes:*` 전량 무효 | O(1) | 동기 |
| 4 | 실시간 채널로 `permission_changed{user_id}` emit → 열린 세션이 현재 노드 권한 재조회 | O(그 사용자의 연결 수) | **제거는 동기, 부여는 비동기** |
| 5 | 검색 인덱스 재색인 | **0건** | — |
| 6 | 사이드바 트리 | 다음 요청 시 `scopes` 재계산으로 자연 반영 | 지연 |

5번이 이 판결의 전부다. 방식 A 에서는 그룹 G 가 부여된 모든 서브트리의 **모든 문서**를 재색인해야 한다(수만 건). 방식 B 에서는 `search_document` 가 `perm_scope_id` 만 들고 있고 사용자의 접근 가능 스코프 집합은 쿼리 시점에 붙으므로, **그룹 변경이 인덱스를 전혀 건드리지 않는다**.

**검색 쿼리 형태 (07 이 이대로 고칠 것)**

```
scopes = scopes:{user_id}:{acl_epoch}     -- 캐시 미스 시 재계산
SELECT ... FROM search_document
WHERE workspace_id = :ws AND perm_scope_id = ANY(:scopes) AND <query terms>
ORDER BY score LIMIT 25
```
권한이 **필터 절 안**에 있으므로 페이지네이션이 깨지지 않는다(F-07-07 이 지적한 난이도 근거 2번이 해소된다). 그 대신 `scopes` 배열이 수천 개가 되면 느려지므로 상한을 둔다(아래 §남은 불확실성 3).

**`user_accessible_scopes(U)` 재계산**

```
scope_roots = SELECT id FROM block WHERE workspace_id=:ws AND perm_scope_id = id
-- 스코프 루트는 acl_entry 를 가진 노드 + 절단 노드 + teamspace 루트뿐이므로
-- 전체 노드 수가 아니라 '권한이 설정된 노드 수'에 비례한다.
return [ S for S in scope_roots if cap_view(effective(U, S)) ]
```

**노드측 변경(공유 버튼)의 무효화**는 주체축 카운터로 잡히지 않으므로 `acl_epoch:{workspace_id}` 하나로 통째 무효화한다. **거칠다** — 워크스페이스 내 공유 1건이 전원의 스코프 캐시를 버린다. 이것을 감수하는 이유: 무효화 누락이 곧 권한 누출인 도메인에서 **"어떤 사용자들이 영향받는가"를 정확히 열거하는 로직 자체가 XL 의 원인**이기 때문이다(F-06-14 가 XL 인 진짜 이유). 열거를 없애면 누락도 없다.

**SCIM 대량 변경(F-06-12)**: IdP 가 그룹 델타 수백 건을 밀 때 사용자별 `perm_gen` INCR 을 **배치 내에서 coalesce** 해 사용자당 1회로 줄이고, `acl_epoch` 는 배치 종료 시 1회만 올린다. `group.external_id` UNIQUE 로 멱등성을 확보한다.

**폐기**

| 폐기 대상 | 이유 |
|---|---|
| 07 F-07-07 방식 A (`search_document.principals uuid[]`) | 그룹 멤버 1건 변경 → 수만 문서 재색인. 클론이 감당할 수 없고, 재색인 지연 구간이 곧 권한 누출 창이다. "노션이 그렇게 한다"는 것은 노션의 인덱싱 인프라 규모를 전제한 선택이지 클론의 선택 근거가 아니다 |
| 06 F-06-14 의 `acl_principals[]` 비정규화 권고 | 위와 동일 |
| 노드별 정밀 스코프 캐시 무효화 | MVP 에서 트리거 7종을 전부 정확히 잡는 것이 이 도메인 XL 난이도의 원인. `acl_epoch` 로 대체 |

**난이도 재조정**: F-07-07 은 방식 B 확정으로 **XL → L**. F-06-14 는 무효화 열거 로직 제거로 **XL → L**. F-06-03 은 **M 유지**(캐시 결합이 O(1) 로 줄었지만 게스트 배제·restricted member 규칙 가드가 남는다).

**파급**: 07 F-07-06(인덱스 스키마에서 `principals[]` 제거, `perm_scope_id` 추가)·F-07-07(방식 B 로 확정, 난이도 하향)·F-07-15 / 06 F-06-03(데이터 모델 함의 확장)·F-06-12(SCIM 배치 규약)·F-06-14(캐시 키 표 교체, 난이도 하향) / 04 F-04-24(권한 회수 브로드캐스트를 `permission_changed{user_id}` 로 통일).

---

## 수정이 필요한 문서 목록

| 문서 | 대상 | 수정 내용 |
|---|---|---|
| `02-page-workspace.md` | §의사 스키마 3) | `permission` 테이블 정의 **삭제** → "권한은 `_canon/permission.md` 의 `acl_entry` 참조" 로 교체 |
| `02-page-workspace.md` | §의사 스키마 `workspace_member` | 5값 role + `status` + `is_temporary` + `expires_at` + `join_method` + `removed_at` 으로 교체 |
| `02-page-workspace.md` | 불변식 **I2** | "권한 확인은 parent 체인을 **`inherits_from_parent=FALSE` 인 노드까지** 올라가며 수행한다. 근거: notion.com/releases/2020-11-11" 로 교체 |
| `02-page-workspace.md` | F-02-08 / F-02-12 / F-02-18 | Private 이동 = reparent + 노드 로컬 ACL 재설정(하위 명시 부여 보존). 공유 패널 서술을 `acl_entry` 어휘로 |
| `04-database-views.md` | §의사 스키마 `CREATE TABLE acl` | **삭제**. `object_type='data_source'` 축 폐기 근거 각주 추가 |
| `04-database-views.md` | `database.is_locked` 컬럼 | 삭제 → `node_lock` 테이블 참조 |
| `04-database-views.md` | F-04-25 / F-04-13 / F-04-24 | 데이터 모델 함의를 `acl_entry` + `level_capability` 로 교체. 권한 회수 이벤트명 `permission_changed{user_id}` 통일 |
| `06-permissions-sharing.md` | §의사 스키마 | `acl_entry.level` 에서 `'none'` 삭제 / `principal_type` 5값 동결 / `sso_config`·`scim_token`·`audit_log` 정의 삭제(14·17 로 이관) / `node_lock.locked` 컬럼 삭제 / `security_policy` 에 `require_mfa_for_guests` 추가 |
| `06-permissions-sharing.md` | §유효 권한 계산 규칙 | 정본 알고리즘(§4)으로 교체. `page_access_rule`/`public_link`/`form` 항이 절단의 영향을 받지 않음을 명시 |
| `06-permissions-sharing.md` | **F-06-05** | 최다 수정. `[추정]` → `[도출확인]` + 2.10 릴리스 노트 근거 + 정본 쓰기 알고리즘(`restrict`/`materialize`/`move_to_private`) + 불변식 P1~P4 + 대표 쿼리를 `perm_scope_id` 기반으로 교체 |
| `06-permissions-sharing.md` | F-06-02 | 좌석 산식을 `workspace_seat_count` 뷰로 교체. restricted_member 좌석 소비 사실 명시 |
| `06-permissions-sharing.md` | F-06-03 | 데이터 모델 함의를 U-3 판결(무효화 6단계 표 + SCIM coalesce)로 확장. 게스트 배제 가드 G2 명시 |
| `06-permissions-sharing.md` | F-06-13 / F-06-18 | `principal_type='integration'`/`'agent'` → `user(type='bot'/'agent')` + `principal_type='user'` |
| `06-permissions-sharing.md` | F-06-14 | 캐시 키 표를 §6 으로 교체. `acl_principals[]` 권고 삭제. 난이도 **XL → L** |
| `06-permissions-sharing.md` | F-06-20 | Private 이동이 상속 플래그를 건드리지 않음을 명시. `perm_scope_id` prefix 갱신 절차 추가 |
| `06-permissions-sharing.md` | F-06-12 / F-06-19 | SSO·SCIM 스키마를 14 참조로, 감사 로그를 17 참조로 축약 |
| `07-search-navigation.md` | F-07-06 | `search_document.principals uuid[]` **삭제** → `perm_scope_id uuid` 추가 |
| `07-search-navigation.md` | **F-07-07** | 방식 B 확정(방식 A 폐기). 쿼리 형태 교체. 난이도 **XL → L**. 그룹 변경 시 재색인 0건 명시 |
| `13-adjacent-products.md` | F-13-18 | `subscription.seats int` → 파생값. 좌석 산식은 `workspace_seat_count` 뷰 단일 출처 |
| `14-auth-accounts.md` | R-5 / R-12 / R-14 | 3건 모두 **해소 처리**. R-12 는 `user.type ∈ {person, bot, agent}` 방향으로 확정됨을 기록 |
| `17-ops-governance.md` | `audit_event` | 06 에서 `audit_log` 를 이관받았음을 명시 |

---

## 남은 불확실성

| # | 불확실한 것 | 왜 지금 확정할 수 없는가 | 실측 방법 |
|---|---|---|---|
| 1 | **절단 노드의 Share 패널이 조상 grant 를 계속 "상속됨"으로 표시하는가** — 즉 노션이 절단 후에도 조상을 UI 에 보여주는지, 완전히 노드 로컬 목록으로 바뀌는지 | 릴리스 노트는 restrict 가능하다는 사실만 말하고 UI 표현은 서술하지 않음 | 테스트 워크스페이스: 부모 P 에 그룹 G(Can edit) 부여 → 자식 C 의 Share 에서 G 제거 → ① C 의 Share 목록 상태 관찰 ② 이후 P 에 사용자 X 를 추가했을 때 X 가 C 에 접근되는지 확인. X 가 접근되면 절단이 아니라 principal 단위 예외이므로 **이 문서의 P2 가 틀린다** |
| 2 | **Private 이동 시, 명시 부여가 없던 하위 페이지의 접근이 끊기는가** | 1차 출처 문구 *"the permissions granted for any subpages will remain the same"* 의 "granted" 가 명시 부여만 뜻하는지 상속 결과까지 뜻하는지 모호 | 부모 P(팀 공유) → 자식 C1(명시 부여 없음), C2(사용자 Y 명시 부여). P 를 Private 로 이동 후 Y 와 팀원 Z 의 C1/C2 접근을 각각 확인 |
| 3 | **`user_accessible_scopes` 배열의 현실적 크기** — 방식 B 의 유일한 실패 모드 | 워크스페이스당 "권한이 설정된 노드 수" 분포를 알 수 없음 | 클론 자체 계측: `SELECT count(DISTINCT node_id) FROM acl_entry GROUP BY workspace_id` 분포를 파일럿에서 측정. **임계 1,000개** — 초과하면 `scopes` 를 IN 절이 아니라 임시 테이블 조인으로 바꾸고, 5,000개 초과 시 `scope_grants(principal_id) → scope_ids[]` 역인덱스를 도입해 `acl_epoch` 통째 무효화를 정밀 무효화로 승격 |
| 4 | **`acl_epoch` 통째 무효화의 실제 비용** | 공유 빈도 × 사용자 수에 의존 | 파일럿에서 `scopes` 캐시 미스율과 재계산 p99 를 측정. **임계 50ms** 초과 또는 미스율 40% 초과 시 3번의 역인덱스로 승격 |
| 5 | **`teamspace.default_member_access` 의 실제 값 집합** | 헬프센터에 "teamspace owners can set default permissions"만 있고 선택지 목록이 없음 | Business 이상 워크스페이스에서 teamspace 설정 → 기본 권한 드롭다운의 실제 옵션 관찰 |
| 6 | **`acl_entry.hidden_from_search`(Everyone at workspace 공유를 검색에서 숨김)의 실재 여부** | 06 이 `[확인필요]` 로 남겼고 이번 조사에서도 1차 출처를 찾지 못함 | 워크스페이스 전체 공유 페이지의 Share 패널에 검색 노출 토글이 있는지 확인. 없으면 컬럼 삭제 |
| 7 | **`restricted_member` 가 `workspace_everyone` grant 를 받는가** | 1차 출처는 restricted member 가 "default teamspace 접근 없음"이라고만 함. workspace-everyone 공유가 restricted member 에게 도달하는지는 미확인 | restricted member 계정으로, workspace 전체에 Can view 로 공유된 페이지 접근 시도. §4 의 `P(U)` 정의에서 restricted_member 를 제외한 것이 이 실측에 걸려 있다 |
| 8 | **DB 잠금(`node_lock`)이 하위 row 페이지로 상속되는가** | 04·06 모두 미확인. 잠금은 ACL 축이 아니므로 별도 전파 규칙이 필요 | DB 잠금 후 row 페이지 본문 편집 시도. 이 결과에 따라 `node_lock` 판정이 노드 단독인지 조상 체인 조회인지 결정된다 |

---

## 참고 출처 (이번 판결에서 1차 확인한 것만)

1. https://www.notion.com/releases/2020-11-11 — **Notion 2.10 릴리스 노트.** "permissions could not be changed for any page that was nested inside another page — they always inherited the permission level of the parent page" / "expand or restrict permissions for any sub-page". **C-8·V-1 판결의 결정적 근거**
2. https://www.notion.com/help/sharing-and-permissions — 액세스 레벨 6종 원문 정의, "Notion respects the broadest level of access", "When you create a subpage ... take on the permissions of its parent page. To change this, go into a subpage and update the permissions there", Private 이동 override 문구, 부여 대상 5종
3. https://www.notion.com/help/whos-who-in-a-workspace — 역할 7종. restricted member "affect your billing in the same way as adding a workspace member", temporary member "don't use a paid seat", guest 좌석 미소비, membership admin Enterprise 전용
4. https://www.notion.com/help/add-members-admins-guests-and-groups — temporary member 만료 "up to one year from today", **"left and rejoined a workspace within the last 30 days → private pages, shared pages, group membership, teamspace membership will be restored"**
5. https://developers.notion.com/docs/upgrade-faqs-2025-09-03 — **"User and bot permissions are managed at the database level, not per data source."** C-7 의 data_source 축 폐기 근거
6. https://www.notion.com/help/guides/assign-custom-database-permissions — page-level access rule 은 person property / created by 2종으로 유도, "the highest level of access applies"
7. https://www.notion.com/help/create-and-manage-groups — "Only workspace members can be assigned to groups. Groups can't contain workspace guests", 그룹 생성 권한은 owner·membership admin
8. https://developers.notion.com/reference/user — User 객체 `type ∈ {person, bot}` 단일 스키마. 규칙 A3 의 근거
