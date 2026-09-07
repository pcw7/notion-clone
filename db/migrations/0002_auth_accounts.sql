-- 계정 · 인증 · 세션
--
-- 정본: docs/research/00-canonical-data-model.md §3.2 ⟨14 소유, V-8 로 경계 확정⟩
--
-- 소유권 경계 (V-8): user / user_email / credential / mfa_* / otp_challenge /
-- user_session / session_policy / workspace_invite / sso_config / scim_token /
-- auth_event 는 전부 도메인 14(계정·인증)가 소유한다.
-- workspace_member / group / teamspace 는 도메인 06(권한)이 소유하며 0003 에서 만든다.

-- ── 사용자 ────────────────────────────────────────────────────────────

CREATE TABLE "user" (
  id                 uuid PRIMARY KEY,
  type               user_type   NOT NULL DEFAULT 'person',  -- <PM A3 + 14 R-2> agent 포함 3값
  bot_integration_id uuid NULL,                              -- type='bot' 일 때만
  status             user_status NOT NULL DEFAULT 'active',  -- <14 R-3> 하드 삭제 금지
  deleted_at         timestamptz NULL,
  primary_email_id   uuid NULL,                              -- -> user_email(id). 순환 FK 라 아래에서 DEFERRABLE 로 추가
  name               text NOT NULL,
  preferred_name     text NULL,                              -- <14 R-4> name 과 분리
  avatar_url         text,
  is_managed         boolean NOT NULL DEFAULT false,         -- <14 R-4 / F-14-12>
  managed_by_org_id  uuid NULL REFERENCES organization(id),
  external_id        text NULL,                              -- IdP 안정 식별자(SCIM)
  analytics_opt_out  boolean NOT NULL DEFAULT false,         -- <17 F-17-03> per-account
  support_access_granted_until timestamptz NULL,             -- <17 F-17-12> 기본 28일 만료
  perm_gen           bigint NOT NULL DEFAULT 0,              -- <U-3> 주체축 권한 캐시 세대. Redis 미러
  created_at         timestamptz NOT NULL,

  -- 불변식 U3 을 CHECK 으로 승격 (순수 행 단위 술어라 DB 에서 강제 가능)
  CONSTRAINT user_managed_requires_org CHECK (NOT is_managed OR managed_by_org_id IS NOT NULL)
);
COMMENT ON TABLE "user" IS
  '불변식 U1: user 행은 물리 삭제하지 않는다. created_by/last_edited_by/editor_ids[] 가 dangling 이 된다.
   불변식 U2: type=''bot''|''agent'' 인 user 도 acl_entry(principal_type=''user'') 로만 권한을 받는다. <PM A3>
   불변식 U3: is_managed=true 이면 managed_by_org_id IS NOT NULL. (CHECK 로 강제)';

-- ── 이메일 ────────────────────────────────────────────────────────────

CREATE TABLE user_email (                                    -- <14 R-1 / R-16>
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES "user"(id),
  email       citext NOT NULL,
  verified_at timestamptz NULL,                              -- NULL = 로그인/자동가입 불가
  is_primary  boolean NOT NULL DEFAULT false,
  added_at    timestamptz NOT NULL,

  UNIQUE (email),                                            -- 워크스페이스가 아니라 시스템 전역

  -- 불변식 A2 를 CHECK 으로 승격
  CONSTRAINT user_email_primary_must_be_verified
    CHECK (NOT is_primary OR verified_at IS NOT NULL)
);

-- 불변식 A1: user 당 is_primary 행 정확히 1개 (여기서는 "최대 1개"까지 강제.
-- "정확히 1개"의 하한은 계정 생성 트랜잭션이 보장한다 — 이메일 없는 user 를 만들지 않는다.)
CREATE UNIQUE INDEX ux_user_primary_email ON user_email (user_id) WHERE is_primary;

CREATE INDEX ix_user_email_user ON user_email (user_id);

COMMENT ON TABLE user_email IS
  '불변식 A1: user 당 is_primary 행 정확히 1개
   불변식 A2: is_primary -> verified_at IS NOT NULL (CHECK 로 강제)
   불변식 A3: user 당 행 개수 <= 5 (MAX_EMAILS_PER_ACCOUNT) — 애플리케이션이 강제
   불변식 A4: 계정 알림(notification_delivery.channel=''email'')의 수신 주소는 is_primary 행이다 <14 R-9>';

-- user.primary_email_id -> user_email.id 순환 FK.
-- 계정 생성은 user 와 user_email 을 같은 트랜잭션에서 넣으므로 DEFERRABLE 이어야 한다.
ALTER TABLE "user"
  ADD CONSTRAINT user_primary_email_fk
  FOREIGN KEY (primary_email_id) REFERENCES user_email(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ── 자격 증명 ─────────────────────────────────────────────────────────

CREATE TABLE credential (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES "user"(id),
  kind            text NOT NULL CHECK (kind IN ('password', 'passkey', 'oauth')),
  password_hash   text NULL,                                 -- argon2id
  cred_id         bytea NULL,
  public_key      bytea NULL,
  sign_count      bigint NULL,
  aaguid          uuid NULL,
  transports      text[] NULL,
  backup_eligible boolean NULL,
  provider        text NULL,
  provider_sub    text NULL,
  is_private_relay boolean NULL,
  label           text NULL,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz NULL,

  UNIQUE (kind, cred_id),
  UNIQUE (provider, provider_sub)
);
CREATE INDEX ix_credential_user ON credential (user_id);
COMMENT ON TABLE credential IS
  '불변식 A5: kind=''password'' 행은 user 당 <=1 (0 이 정상 — 비밀번호 없는 계정) — 애플리케이션이 강제
   불변식 A6: kind=''passkey'' 행은 user 당 <=5 — 애플리케이션이 강제';

-- ── 2단계 인증 ────────────────────────────────────────────────────────

CREATE TABLE mfa_method (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES "user"(id),
  kind         text NOT NULL CHECK (kind IN ('totp', 'sms')),
  label        text NOT NULL,
  totp_secret  bytea NULL,                                   -- KMS 봉인
  phone_e164   text NULL,
  confirmed_at timestamptz NULL,
  created_at   timestamptz NOT NULL,
  last_used_at timestamptz NULL
);
CREATE INDEX ix_mfa_method_user ON mfa_method (user_id);
COMMENT ON TABLE mfa_method IS
  '불변식 A7: kind=''totp'' <=2 AND kind=''sms'' <=2 (합계 4) — 애플리케이션이 강제';

CREATE TABLE mfa_backup_code (
  user_id   uuid NOT NULL REFERENCES "user"(id),
  code_hash text NOT NULL,
  used_at   timestamptz NULL,
  batch_id  uuid NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE otp_challenge (
  id          uuid PRIMARY KEY,
  purpose     text NOT NULL
              CHECK (purpose IN ('login', 'email_verify', 'password_reset', 'mfa_sms')),
  email       citext NULL,
  user_id     uuid NULL REFERENCES "user"(id),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz NULL,
  request_ip  inet,
  request_ua  text,
  created_at  timestamptz NOT NULL
);
-- 만료·미소비 챌린지 조회와 GC 를 위한 인덱스
CREATE INDEX ix_otp_challenge_open ON otp_challenge (email, purpose, expires_at)
  WHERE consumed_at IS NULL;

-- ── 세션 ──────────────────────────────────────────────────────────────

CREATE TABLE user_session (                                  -- <14 B. `session` 에서 개명 — X-11>
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  token_hash    text NOT NULL UNIQUE,
  auth_method   text NOT NULL
                CHECK (auth_method IN ('login_code', 'password', 'passkey',
                                       'google', 'apple', 'microsoft', 'saml')),
  mfa_satisfied boolean NOT NULL DEFAULT false,
  device_id     uuid NULL,                                   -- device_offline_manifest 와 연결 <C-11>
  device_label  text,
  device_kind   text CHECK (device_kind IN ('web', 'desktop', 'mobile')),
  ip            inet,
  approx_location text,
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz NULL,
  revoked_reason text NULL
);
CREATE INDEX ix_user_session_active ON user_session (user_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE user_session IS
  '불변식 A8: 유효 세션 = revoked_at IS NULL AND expires_at > now()
   불변식 A9: effective() 의 입력은 user_id 가 아니라
              (user_id, workspace_id, auth_method, mfa_satisfied, session_id) 다.
              SSO 강제는 이 컨텍스트가 없으면 UI 장식이다. <14 R-11>';

CREATE TABLE session_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id),
  max_lifetime interval NOT NULL DEFAULT '90 days',          -- 범위 [모순] -> 정본 문서 §6-4
  updated_by   uuid REFERENCES "user"(id),
  updated_at   timestamptz
);

-- ── 초대 ──────────────────────────────────────────────────────────────

CREATE TABLE workspace_invite (                              -- <14 R-7>
  id                  uuid PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES workspace(id),
  kind                text NOT NULL CHECK (kind IN ('email', 'link')),
  email               citext NULL,
  token               text UNIQUE,
  role                text NOT NULL,
  created_by          uuid NOT NULL REFERENCES "user"(id),
  created_at          timestamptz NOT NULL,
  expires_at          timestamptz NULL,
  revoked_at          timestamptz NULL,
  accepted_by_user_id uuid NULL REFERENCES "user"(id),
  accepted_at         timestamptz NULL,

  CHECK ((kind = 'email') = (email IS NOT NULL))             -- 암묵 규약을 CHECK 로 승격
);
CREATE INDEX ix_workspace_invite_open ON workspace_invite (workspace_id)
  WHERE revoked_at IS NULL AND accepted_at IS NULL;

-- ── SSO / SCIM ────────────────────────────────────────────────────────

CREATE TABLE sso_config (                                    -- <V-8: 06 -> 14 이관>
  workspace_id     uuid PRIMARY KEY REFERENCES workspace(id),
  idp_metadata_url text,
  entity_id        text,
  sso_url          text,
  x509_cert        text,
  jit_provisioning boolean NOT NULL DEFAULT false,
  enforced         boolean NOT NULL DEFAULT false,
  updated_by       uuid REFERENCES "user"(id),
  updated_at       timestamptz
);
COMMENT ON TABLE sso_config IS
  '게이트: can_enter_workspace(session, ws) =
     NOT sso_config.enforced OR session.auth_method=''saml'' OR member.role IN (''owner'',''guest'')';

CREATE TABLE scim_token (                                    -- <V-8: 06 -> 14 이관>
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  token_hash   text NOT NULL UNIQUE,
  created_by   uuid REFERENCES "user"(id),
  created_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX ix_scim_token_workspace ON scim_token (workspace_id) WHERE revoked_at IS NULL;

-- ── 감사 ──────────────────────────────────────────────────────────────

CREATE TABLE auth_event (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL,
  email      citext NULL,                                    -- 둘 다 NULL 가능(계정 열거 시도)
  user_id    uuid NULL REFERENCES "user"(id),
  kind       text NOT NULL,
  ip         inet,
  user_agent text,
  meta       jsonb
);
CREATE INDEX ix_auth_event_at ON auth_event (at DESC);
CREATE INDEX ix_auth_event_user ON auth_event (user_id, at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX ix_auth_event_email ON auth_event (email, at DESC) WHERE email IS NOT NULL;
COMMENT ON TABLE auth_event IS
  '불변식 A10: 인증 이벤트는 세션이 없는 상태에서도 기록된다. actor NOT NULL 을 강제하면
               로그인 실패를 감사에 남길 수 없다. <14 R-10>';
