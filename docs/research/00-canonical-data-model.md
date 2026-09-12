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
| `page_property_value` | DB | **셀 값 EAV 정본** + 타입별 사이드카 컬럼 | 03, 04, 09 |
| `relation_edge` | DB | relation 셀의 유일한 정본. 역방향 조회를 가능하게 하는 축 | 03, 04, 15 |
| `property_dependency` / `derived_value` | DB | formula·rollup 의존 그래프와 값 캐시 | 03 |
| `view` | DB(views) | 뷰 본체. `owner_kind` 로 DB뷰/레이아웃탭/대시보드위젯 구분 | 04, 16 |
| `view_property` | DB | 뷰별 컬럼 설정 (행 단위 테이블) | 03, 04 |
| `row_position` | DB | 뷰별·그룹별 수동 행 순서 | 04 |
| `view_user_override` | DB | 개인 필터/정렬 | 04 |
| `page_layout` / `layout_tab` / `layout_module` | IL | 행 페이지 화면 정의. data_source 당 1벌 | 16, 03 |
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
| `plan` / `plan_entitlement` / `billing_subscription` | MISC(13) | 플랜 → 기능/한도 매핑. **코드가 아니라 데이터** | 13, 15, 17 |
| `external_sync_source` | XS | 외부 커넥션 + 범위 → data_source 바인딩 (구 `external_binding`) | 15 |
| `external_connection` / `external_field_map` / `external_row_link` / `sync_run` / `sync_issue` / `user_external_identity` / `external_write_back` | XS | 외부 동기화 부속 | 15 |
| `region` / `analytics_rollup` / `moderation_case` / `setting_definition` / `setting_value` / `setting_lock` / `admin_role*` | OG | 리전·분석·모더레이션·설정 IA | 17 |

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
-- 불변식 A5: kind='password' 행은 user 당 <=1 (0 이 정상 — 비밀번호 없는 계정)
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
  CHECK ((kind = 'email') = (email IS NOT NULL))             -- 암묵 규약을 CHECK 로 승격
);
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
    CHECK (join_method IN ('invite_email','invite_link','allowed_domain','saml_jit','scim','guest_upgrade')),
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
  UNIQUE (workspace_id, lower(name)),
  UNIQUE (workspace_id, external_id)
);
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
-- 불변식 G3: role='restricted_member' 는 group_member 가 될 수 있다. 그것이 유일한 대량 부여 수단이다.

CREATE TABLE teamspace (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
  name text NOT NULL, icon text NULL,
  visibility text NOT NULL CHECK (visibility IN ('open','closed','private')),
  is_default boolean NOT NULL DEFAULT false,                 -- visibility 와 직교
  who_can_invite text NOT NULL DEFAULT 'all_members'
                 CHECK (who_can_invite IN ('owners','all_members')),
  default_member_level text NULL,                            -- [확인필요] 6-5
  archived_at timestamptz NULL
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
  CHECK (NOT hidden_from_search OR principal_type = 'workspace_everyone')
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
  robots_directive text NOT NULL DEFAULT 'index'
    CHECK (robots_directive IN ('index','noindex')),          -- <17 F-17-11>
  ai_crawler text NOT NULL DEFAULT 'allow'
    CHECK (ai_crawler IN ('allow','deny')),                   -- <17 F-17-11> 2축 분리
  created_by uuid, created_at timestamptz
);

CREATE TABLE page_access_rule (                              -- <C-7: data_source 단위가 정본>
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('person_property','created_by')),
  source_property_id text NULL REFERENCES property(id),      -- uuid 아님. text <C-4> [X-12]
  level text NOT NULL CHECK (level IN ('view','comment','edit','full_access')),
  CHECK ((source_kind='person_property') = (source_property_id IS NOT NULL))
);

CREATE TABLE node_lock (                                     -- <C-7 부속. database.is_locked 폐기 X-9>
  node_id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('page','database')),
  scope text NOT NULL DEFAULT 'content_and_layout'
    CHECK (scope IN ('content','content_and_layout')),        -- <16 R8> 레이아웃 포함 [추정]
  locked_by uuid, locked_at timestamptz
);
-- 잠금은 행의 존재로 표현한다. locked BOOL 컬럼을 두지 않는다(해제 = DELETE).

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
```

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

**상태 전이 (type='page' 블록만)**

| From → To | 트리거 | 부수효과 |
|---|---|---|
| `live` → `trashed` | Delete / API `in_trash:true` / 소스 삭제 전파 | page 타입 자손 전체에 전파. 자손 `trash_root_id`=대상 id. `purge_after`=now+`trash_days`. 부모 Y.Doc 에서 참조 노드 제거 |
| `trashed` → `live` | Restore / API `in_trash:false` | `trash_root_id` 일치 자손만. 부모 Y.Doc 에 참조 노드 재삽입(order_key 위치, 불가 시 말미) |
| `trashed` → `purged` | GC(`purge_after` 경과) 또는 영구 삭제 | 누구도 접근 불가. `file.ref_count` 감소 |
| `purged` → 물리 삭제 | GC(`purged_at` + 30일) | `doc_update`/`doc_snapshot`/`page_version`/`search_document` 를 page_id 로 일괄 삭제 |

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

---

### 3.5 데이터베이스 · 프로퍼티 · 셀 ⟨C-2/V-2 · C-3 · C-4/V-7 · C-5 · C-6 · C-15⟩

```sql
CREATE TABLE database (                       -- 컨테이너. block(type='database') 의 1:1 확장
  id            uuid PRIMARY KEY REFERENCES block(id) ON DELETE CASCADE,   -- [X-2]
  title_rich    jsonb, icon jsonb, cover jsonb,
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
  unique_id_prefix      text NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);

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
  unique_seq     bigint NULL,
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
  role         text NULL CHECK (role IN ('sub_item','dependency')),
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
  stale boolean NOT NULL DEFAULT true, computed_at timestamptz NULL,
  PRIMARY KEY (page_id, property_id)
);
CREATE INDEX ON derived_value (property_id) WHERE stale;
CREATE INDEX ON derived_value (property_id, num_value) WHERE NOT stale AND num_value IS NOT NULL;
-- 불변식 D1: formula/rollup 필터·정렬은 derived_value 의 사이드카 컬럼으로만 컴파일된다.
```

**DB 상수**

```ts
const MAX_FILTER_DEPTH       = 3;       // C-15. 루트 객체를 layer 1 로 센다. layer 4 쓰기는 400
const MAX_FILTER_GROUP_ITEMS = 100;
const MAX_QUERY_PAGINATION   = 10_000;
const PROPERTY_ID_LENGTH     = 21;      // nanoid base62
const MAX_PROPERTIES_PER_DS  = 500;     // [확인필요] 스코프 = data_source 당
```
필터 깊이 검증은 **쓰기 경로에만** 건다. 읽기 경로에 걸면 나중에 상한을 낮출 때 기존 뷰가 통째로 열리지 않는다.

---

### 3.6 뷰 · 레이아웃 ⟨C-6 · U-1 · 16⟩

```sql
CREATE TABLE view (
  id uuid PRIMARY KEY,
  owner_kind text NOT NULL DEFAULT 'database_view'                      -- <16 R2>
    CHECK (owner_kind IN ('database_view','layout_tab','dashboard_widget')),
  database_id    uuid NULL REFERENCES database(id) ON DELETE CASCADE,
  data_source_id uuid NULL REFERENCES data_source(id) ON DELETE CASCADE,-- 대시보드 위젯이면 NULL
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
  card_property_width_mode text NULL, calculation text NULL,
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

CREATE TABLE view_user_override (
  view_id uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, filter jsonb, sorts jsonb,
  PRIMARY KEY (view_id, user_id)
);

-- L1 레이아웃. data_source 당 정확히 1행 <U-1 = 16 비준>
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
-- 불변식 T1: data_source 당 kind='content' 행은 정확히 1개
-- 불변식 T2: structure='simple' 이어도 content 탭 행은 유지한다(구조 전환 시 배치 보존)

CREATE TABLE layout_module (               -- page_layout_slot 대체. 그 테이블은 존재하지 않는다
  id uuid PRIMARY KEY,
  data_source_id uuid NOT NULL REFERENCES page_layout(data_source_id) ON DELETE CASCADE,
  tab_id uuid NOT NULL REFERENCES layout_tab(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('heading','property_group','property','backlinks','section')),
  area text NOT NULL CHECK (area IN ('heading','main','panel')),
  parent_module_id uuid NULL REFERENCES layout_module(id) ON DELETE CASCADE,
  property_id text NULL REFERENCES property(id) ON DELETE CASCADE,            -- text [X-12]
  label text, visible boolean NOT NULL DEFAULT true, order_idx text NOT NULL,
  CHECK ((kind='property') = (property_id IS NOT NULL))
);
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

CREATE TABLE page_version (                    -- 사용자 노출 버전 <C-12>
  id uuid PRIMARY KEY, page_id uuid NOT NULL,
  state_ref    text NOT NULL,                  -- blob 스토리지 키. 행에 bytea 를 박지 않는다
  state_vector bytea NOT NULL, byte_size int NOT NULL,
  editor_ids   uuid[] NOT NULL,                -- 구간 내 doc_update.actor_id DISTINCT
  reason text NOT NULL
    CHECK (reason IN ('interval','idle','pre_restore','manual','external_sync')),  -- <15 R14>
  restored_from uuid NULL,
  created_at timestamptz NOT NULL,
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
- `seq` / `change_seq` gap 감지 → 클라이언트가 `state_vector`(doc) 또는 `last_change_seq`(ds)를 보내고 서버가 **delta 만** 회신. full refetch 가 아니다.
- ds 채널 페이로드는 반드시 **적용 가능한 값**이어야 한다. "재조회하라"는 신호를 실으면 C-11 이 폐기한 pull 모델이 되살아난다.

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
                                               -- |'suggestion.created'|'suggestion.accepted'|...
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

**배달 파이프라인 (3단 필터, 순서 고정)**
`activity_event` → ① 대상자 산출(`subscription.level` + 직접 트리거) → ② **배달 시점 권한 재검사** → ③ presence 조회로 활성 뷰어 억제 → `notification_delivery` 스케줄.
②를 팬아웃 시점이 아니라 배달 시점에 두는 이유: 이벤트와 배달 사이에 권한이 회수될 수 있고, 알림 본문(멘션 스니펫)이 곧 콘텐츠 유출 경로다.

---

### 3.9 코멘트 · 검색 ⟨U-6 · X-8⟩

```sql
CREATE TABLE discussion (                      -- 코멘트는 CRDT 에 넣지 않는다(관계형)
  id uuid PRIMARY KEY,
  parent_block_id uuid NOT NULL,               -- 페이지 코멘트면 page block, 인라인이면 대상 block
  workspace_id uuid NOT NULL,
  anchor jsonb NULL,                           -- RelativePosition 범위 + quoted_text 폴백
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid NULL, resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX ON discussion (parent_block_id, resolved, created_at);
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
  ref_count int NOT NULL DEFAULT 0,            -- block + page_version 참조를 모두 포함 <S5>
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

---

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
    -- 아래 3항은 노드 로컬 grant. 절단 플래그의 영향을 받지 않는다.
    local = MAX_BY_CAP(local, page_access_rule_grant(U,N),
                              public_link_grant(U,N), form_submitter_grant(U,N))
    return local or 'none'

  P(U) = {('user',U)} + {('group',g) : g in active_groups(U)}
       + {('teamspace',t) : t in active_teamspaces(U)}
       + {('workspace_everyone',NULL) : U 가 role in (owner,membership_admin,member) 인 active 멤버}
       + {('public',NULL)}
  -- guest 와 restricted_member 는 workspace_everyone 에 포함되지 않는다. [확인필요] 6-7

-- 2단계: 잠금 게이트
if node_lock(N) exists and action in {edit_content, edit_structure, edit_layout}:  return BLOCK
```

`MAX_BY_CAP` = capability 비트마스크 OR 후 가장 가까운 표시용 레벨로 환원. **단순 정수 MAX 금지**(규칙 A2).
Enterprise 관리자 콘텐츠 검색·감사는 `effective()` 의 항이 아니라 별도 경로다("Admin roles don't change what someone can see or edit").

**권한 스코프 `perm_scope_id`**

> `perm_scope_id(N)` = N 자신 또는 가장 가까운 조상 중 **`acl_entry` 를 1개 이상 갖거나, `inherits_from_parent=FALSE` 이거나, `public_link.enabled=true` 인 노드**의 id. 없으면 teamspace 루트(또는 Private 루트) id.

재계산 트리거는 정확히 5개다 — ① 첫 `acl_entry` 삽입 ② 마지막 `acl_entry` 삭제 ③ `inherits_from_parent` 전이 ④ 서브트리 이동 ⑤ `public_link.enabled` 전이 [X-8 이 추가]. 전부 `UPDATE block SET perm_scope_id=... WHERE ancestor_path @> ARRAY[:N]` 형태의 서브트리 일괄 갱신이다.

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
프로젝터가 **`order_key` 의 유일한 쓰기자**이므로 `UNIQUE(parent_id, order_key)` 충돌이 구조적으로 발생하지 않는다. `parent_type in ('data_source','teamspace','workspace')` 인 행은 프로젝터가 건드리지 않는다(그쪽은 order_key 가 정본).

---

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
- `perm_scope_id` 재계산 트리거에 **`public_link.enabled` 전이**를 추가한다(공개 링크는 노드 로컬 grant 이므로 그 노드가 스코프 루트가 되어야 익명 검색이 스코프 필터로 성립한다).
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
| 5 | teamspace 기본 권한 값 집합 (`default_member_level`) | `[확인필요]` NULL 허용 | Business 이상에서 teamspace 설정 드롭다운 관찰 | CHECK 제약 1줄 |
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
