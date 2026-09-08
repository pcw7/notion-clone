# 14. 계정 · 인증 · 세션

> 조사 기준일: 2026-09-06 / 1차 출처: notion.com/help, developers.notion.com / 클론 참고: Docmost(내장 email+password), AppFlowy(GoTrue/JWT), Outline(IdP 위임)
> 태그 규칙: `[추정]` = 공개 문서로 확인 불가, 동작에서 역산한 추론 / `[확인필요]` = 실제 제품에서 검증 필요 / `[모순]` = 1차 출처 두 곳이 다르게 말함
> **작성 배경**: 커버리지 비평 A-1 / V-8. 기존 13개 문서(278 F-ID) 전체에 '가입'·'password'·'2FA'·'passkey'·'session' grep 0건. 06-permissions-sharing.md가 `user(id, email, name, avatar_url, created_at)` 5컬럼으로 선언한 것이 전부였고, 05의 connection·actor, 09의 API 토큰·bot, 12의 `user_setting(scope='account')`, 13-18의 좌석 카운터, 11의 이메일 알림 팬아웃이 모두 이 정의되지 않은 `user` 위에 서 있다.
> **이 문서의 성격**: 새 스키마를 하나 더 만들지 않는다. 이 도메인이 **기존 엔티티에 무엇을 요구하는지**를 먼저 선언하고(§ 요구사항), 이 도메인이 새로 소유해야만 하는 엔티티(session, user_email, credential, mfa_method)만 정의한다. 권한·공유는 06, 감사 로그는 11 F-11-12, 통합 토큰은 09 F-09-02가 정본이며 여기서 재서술하지 않는다.

---

## 요약

- Notion 계정의 **정체성 단위는 `user`이고, 이메일은 그 user에 N:1로 붙는 별개 레코드**다. 계정당 이메일을 여러 개 붙일 수 있고, **검증된 모든 이메일이 로그인·공유 수신·@멘션 대상으로 동등하게 작동**한다. ("All your secondary emails point to the same account, so you can log in, receive shares, and be mentioned using any of your verified email addresses." — https://www.notion.com/help/secondary-emails) → 06의 `user.email` 단일 컬럼은 **이 문서가 폐기를 요구하는 첫 번째 항목**이다.
- 로그인 경로는 7종이다: ① 이메일 + 이메일로 받은 **로그인 코드(OTP)**, ② 이메일 + **비밀번호**, ③ Google, ④ Apple, ⑤ Microsoft, ⑥ **Passkey**, ⑦ **SAML SSO**(Business/Enterprise). (https://www.notion.com/help/log-in-and-out)
- **기본 경로는 비밀번호가 아니라 이메일 코드다.** 비밀번호는 "영구 비밀번호를 쓰고 싶으면 설정하는" 옵트인 자격증명이고, 설정/변경/**제거**가 모두 가능하다. 즉 **비밀번호가 없는 계정이 정상 상태**다. 이것이 클론에서 가장 자주 틀리는 지점이다 — `user.password_hash NOT NULL` 스키마는 처음부터 오답이다.
- 자격증명은 서로 **독립적으로 병존**한다: passkey는 "with or without a password"로 존재하고(https://www.notion.com/help/passkeys), 소셜 로그인은 이메일 일치로 동일 계정에 붙으며, 2FA만 예외적으로 **비밀번호가 설정되어 있어야 활성화 가능**하다(https://www.notion.com/help/two-step-verification).
- 수치 계약(전부 1차 출처 확인): 비밀번호 **최소 8자 · 고유문자 4자 이상**, 8~14자는 문자 1 + 숫자 1 필수, 15자 이상은 그 요구 해제 / passkey **최대 5개** / 2FA 검증 수단 **최대 4개(인증앱 2 + 전화번호 2)** / 백업코드 **6개, 각 1회용, 소진 후 재발급** / 이메일 **최대 5개** `[모순]`.
- 세션은 **서버측 레코드**다. 계정 설정에 활성 세션 표가 있고 개별 로그아웃과 "Log out of all devices"(현재 세션은 유지)가 제공되며, Enterprise는 **세션 수명을 정책으로 강제**하고 관리자가 전 사용자를 즉시 로그아웃시킬 수 있다. JWT 만료만으로는 이 요구를 만족할 수 없다 — **폐기 가능한 세션 테이블이 필수**다.
- 계정은 **여러 워크스페이스에 동시에 속하고**, 앱은 **여러 계정에 동시에 로그인**한 상태를 유지한다(계정 전환기). 즉 클라이언트는 `Map<account_id, session_token>`을 들고 있고, 요청마다 `(account, workspace)` 쌍이 컨텍스트다.
- 워크스페이스 진입 경로는 4개이며 각각 다른 엔티티를 요구한다: ① 이메일 초대(역할 선택), ② 비밀 초대 링크(수신자 미지정), ③ **allowed email domain 자동 가입**(온보딩 시 옵션 노출), ④ **SAML JIT 프로비저닝**. ①②는 `workspace_invite`, ③은 `workspace.allowed_email_domains[]` + **이메일 검증 상태**, ④는 `sso_config.jit_provisioning`에 의존한다.
- Enterprise에는 계정 자체를 조직이 소유하는 계층이 하나 더 있다: **verified domain으로 만들어진 계정 = managed user**. 조직 owner가 이름·이메일 변경, 강제 비밀번호 재설정, 강제 로그아웃, 세션 수명, 정지(suspend), 삭제(30일 복구 유예), 외부 워크스페이스 가입 차단까지 수행한다. (https://www.notion.com/help/managed-users-dashboard)
- **bot user는 person user와 같은 테이블의 다른 type이다.** 공개 API의 User 객체가 `type ∈ {person, bot}`으로 하나의 스키마를 공유하며, person만 `person.email` / `person.email_verified`를 갖고 bot만 `bot.owner` / `bot.workspace_limits`를 갖는다. (https://developers.notion.com/reference/user) → 09 F-09-02의 토큰, 06 F-06-13의 `acl_entry.principal_type='integration'`과 **중복 표현되지 않게 하나로 합치는 것**이 이 도메인의 요구사항이다.
- 계정 삭제는 **워크스페이스를 연쇄 파괴할 수 있다**: 단독 멤버였던 private 워크스페이스와 **단독 admin이었던 공유 워크스페이스는 함께 삭제되고, 그 워크스페이스의 다른 모든 사용자도 접근을 잃는다**. (https://www.notion.com/help/delete-your-account) 이것은 삭제 트랜잭션이 계정 하나가 아니라 워크스페이스 그래프를 훑어야 한다는 뜻이다.

---

## 핵심 개념 / 데이터 모델

### A. 이 도메인이 **기존 엔티티에 요구하는 것** (정본 결정 입력)

> 아래는 새 스키마 제안이 아니라 **기존 문서의 엔티티가 반드시 바뀌어야 하는 지점** 목록이다. 00번 정본 데이터 모델 문서 작성 시 그대로 입력으로 쓴다.

| # | 대상 엔티티 (소유 문서) | 요구사항 | 요구하지 않으면 깨지는 것 |
|---|---|---|---|
| R-1 | `user` (06 § 의사 스키마) | `email` 단일 컬럼을 **폐기**하고 `user_email` 자식 테이블로 분리. user는 `primary_email_id` FK만 보유 | 별칭 이메일 로그인·공유 수신·멘션(F-14-07). 06의 `acl_entry(principal_type='user')`가 이메일로 초대된 미가입자를 표현할 수 없음 |
| R-2 | `user` (06) | `type ENUM('person','bot') NOT NULL DEFAULT 'person'` 축 추가 + `bot_integration_id NULL` | 09 F-09-02의 bot 아이덴티티, 06 F-06-13의 `user(type='bot', integration_id)` 언급이 스키마에 실재하지 않음. `created_by`가 봇인 블록(01/11 F-11-15)이 사람 프로필 조회로 500 |
| R-3 | `user` (06) | `status ENUM('active','suspended','deleted')` + `deleted_at` + **하드 삭제 금지**(tombstone 유지) | 01/05/11의 `created_by`/`last_edited_by`/`editor_ids[]`/`authors[]`가 dangling FK가 됨. managed user suspend(F-14-12)는 "로그인 불가 + 콘텐츠는 계속 보임" 상태여서 삭제로 표현 불가 |
| R-4 | `user` (06) | `preferred_name`을 `name`과 분리, `is_managed BOOL` + `managed_by_org_id NULL` | F-14-12(조직이 계정 정보 변경을 잠글 수 있음)와 F-14-15가 같은 컬럼을 두고 싸움 |
| R-5 | `workspace_member` (02 / 06) | 02의 role 4값을 폐기하고 **06의 5값 + `status ∈ {active, invited, suspended}` + `is_temporary` + `expires_at`을 정본으로 채택**. 여기에 이 문서가 `invited_by`, `invite_accepted_at`, `join_method ENUM('invite_email','invite_link','allowed_domain','saml_jit','scim')` 추가를 요구 | 초대 수락 전/후 구분이 없으면 13-18의 좌석 카운터가 초대 즉시 과금(F-14-10). 감사·컴플라이언스에서 "이 사람이 어떻게 들어왔는가"에 답할 수 없음 |
| R-6 | `workspace` (02 / 06) | `allowed_email_domains[]`(자기 신고, 06에 이미 존재)와 `organization.verified_domains[]`(DNS 검증됨, 06에 이미 존재)를 **다른 축으로 명시 유지**. 전자는 자동 가입 트리거, 후자는 managed user·SAML·워크스페이스 claim의 전제 | 둘을 합치면 F-14-10(자동 가입)이 Enterprise 전용이 되어버리거나, F-14-12(계정 소유권)가 Free 플랜에서 발동함 |
| R-7 | `workspace_invite` (06 F-06-02에 존재) | `kind ENUM('email','link')` 명시 + `accepted_by_user_id`, `accepted_at`, `created_by` 감사 필드. `email IS NULL`이 링크형이라는 암묵 규약을 CHECK로 승격 | 링크형 초대는 수신자가 없으므로 "누가 수락했는가"가 기록되지 않으면 좌석 증가의 원인을 추적 불가 |
| R-8 | `user_setting` (12, `scope ∈ {account, device}`) | privacy 항목 2개(`show_view_history`, `discoverable_by_email`)를 **account scope 정식 키로 등록**하고, user 삭제 시 account scope 전량 캐스케이드 | 12가 설정 컨테이너만 정의하고 항목 레지스트리가 없음(비평 A-7). 조회 기록 프라이버시는 11 F-11-18이 참조하는데 저장 위치가 미정 |
| R-9 | `notification` 팬아웃 (11 F-11-11) | 이메일 채널이 `user.email`이 아니라 **`user_email WHERE is_primary`** 를 참조. primary 변경 시 대기 중 알림의 수신 주소 결정 시점 규칙 필요 | 계정 알림은 primary로만 간다는 1차 출처("Account notifications default to your primary email address")를 만족하지 못함 |
| R-10 | `audit_log` (11 F-11-12) | `actor_user_id NULL 허용` + `ip`, `user_agent`, `auth_method` 필수화. 인증 이벤트(로그인 실패, 코드 오입력, 계정 열거 시도)는 **세션이 없는 상태에서 발생**한다 | 로그인 실패를 감사에 남길 수 없음. 보안 사고 조사가 불가능해짐 |
| R-11 | `effective(user, node)` (06 유효권한 계산) | 입력이 `user_id`만이면 부족하다. **세션 컨텍스트(`workspace_id`, `auth_method`, `mfa_satisfied`, `session_id`)를 함께 받아야** SSO 강제 워크스페이스(F-14-11)를 게이팅할 수 있다 | SSO를 강제해도 기존 비밀번호 세션이 그대로 살아 있으면 강제가 무의미. 06 F-06-11 `security_policy.require_sso`가 실행 지점을 갖지 못함 |
| R-12 | `integration` (06 F-06-13 / 09 F-09-02) | 통합 생성 시 **반드시 `user(type='bot')` 행을 함께 생성**하고, `acl_entry.principal_type`은 `'integration'` 대신 `'user'`(bot)로 통일할지 결정 필요. 두 표현이 병존하면 권한 계산이 분기됨 | 06은 `principal_type='integration'`, 09는 bot user, 공개 API는 User 객체 하나 — 3중 표현 |
| R-13 | `page_owner` / 개인 페이지 (02) | 계정 삭제·deprovision 시 **private 페이지를 다른 사용자로 이관**하는 경로 필요(Enterprise). 02의 `page_owner` 테이블을 이 용도로 재사용할 것 | F-14-13/F-14-12에서 퇴사자의 private 페이지가 영구 고아가 됨 |
| R-14 | `seat_count` (13-18 F-13-18) | 좌석 산식이 `workspace_member.status='active'`만 세도록 확정. `invited`(미수락), `guest`, `is_temporary`, managed user의 `deleted`(30일 유예 중) 는 **모두 미소비** | 06은 좌석 규칙을 서술만 하고 13-18은 `subscription.seats int` 한 컬럼 — 연결 지점이 이 도메인 |
| R-15 | `workspace` 삭제 (02) | 워크스페이스 삭제 트리거에 **"단독 admin의 계정 삭제"** 를 추가. 계정 삭제가 워크스페이스 삭제를 연쇄시킨다 | F-14-13. 계정 삭제를 user 테이블 UPDATE 하나로 구현하면 워크스페이스가 admin 없는 좀비로 남음 |
| R-16 | 전역 유니크 제약 | `user_email.email`은 **워크스페이스가 아니라 시스템 전역에서 유니크**. ("Each email address can only be associated with one Notion account.") 02가 `workspace_id`를 거의 모든 테이블에 비정규화하라고 권고했으나 **이 테이블은 예외** | 별칭 추가 시 "이미 다른 계정에 묶임" 판정(F-14-07)이 불가능 |

### B. 이 도메인이 **새로 소유하는** 엔티티 (의사 스키마)

```sql
-- 이메일: user와 1:N. 전역 유니크. (R-1, R-16)
user_email(
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  email         citext NOT NULL,
  verified_at   timestamptz NULL,            -- NULL이면 미검증 = 로그인/자동가입 불가
  is_primary    bool NOT NULL DEFAULT false, -- 계정 알림 수신 주소
  added_at      timestamptz NOT NULL,
  UNIQUE (email)                             -- 시스템 전역
);
-- 불변식 A1: user당 is_primary=true 행은 정확히 1개 (partial unique index)
-- 불변식 A2: is_primary=true인 행은 verified_at IS NOT NULL
-- 불변식 A3: user당 행 개수 <= MAX_EMAILS_PER_ACCOUNT(=5)

-- 자격증명: 종류별로 0..N. password는 0 또는 1. (비밀번호 없는 계정이 정상)
credential(
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  kind          text NOT NULL,   -- 'password' | 'passkey' | 'oauth'
  -- password
  password_hash text NULL,       -- argon2id
  -- passkey (WebAuthn)
  cred_id       bytea NULL,      -- credential ID (전역 유니크)
  public_key    bytea NULL,
  sign_count    bigint NULL,
  aaguid        uuid NULL,
  transports    text[] NULL,     -- 'internal','usb','nfc','ble','hybrid'
  backup_eligible bool NULL,     -- synced passkey 여부
  -- oauth
  provider      text NULL,       -- 'google' | 'apple' | 'microsoft'
  provider_sub  text NULL,       -- IdP의 안정 식별자. 이메일이 아니다
  is_private_relay bool NULL,    -- Apple Hide My Email
  label         text NULL,       -- 사용자가 붙인 이름
  created_at    timestamptz NOT NULL,
  last_used_at  timestamptz NULL,
  UNIQUE (kind, cred_id),
  UNIQUE (provider, provider_sub)
);
-- 불변식 A4: kind='password' 행은 user당 <=1
-- 불변식 A5: kind='passkey' 행은 user당 <=5 (MAX_PASSKEYS)

-- 2단계 인증 수단
mfa_method(
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  kind          text NOT NULL,   -- 'totp' | 'sms'
  label         text NOT NULL,   -- 사용자가 붙인 이름
  totp_secret   bytea NULL,      -- 봉인 암호화(KMS)
  phone_e164    text NULL,
  confirmed_at  timestamptz NULL,-- 최초 코드 검증 전에는 활성 아님
  created_at    timestamptz NOT NULL,
  last_used_at  timestamptz NULL
);
-- 불변식 A6: kind='totp' <=2 AND kind='sms' <=2 (합계 4)
-- 불변식 A7: confirmed_at IS NOT NULL 행이 1개 이상이어야 계정의 mfa_enabled=true

mfa_backup_code(
  user_id       uuid NOT NULL,
  code_hash     text NOT NULL,   -- 평문 저장 금지
  used_at       timestamptz NULL,
  batch_id      uuid NOT NULL,   -- 재발급 시 새 batch, 이전 batch 전량 무효
  PRIMARY KEY (user_id, code_hash)
);
-- 불변식 A8: 활성 batch의 미사용 코드 수가 0이 되면 재발급 UI를 강제 노출

-- 1회용 로그인/검증 코드 (로그인 코드, 이메일 추가 검증, 비밀번호 재설정 모두 이 테이블)
otp_challenge(
  id            uuid PRIMARY KEY,
  purpose       text NOT NULL,   -- 'login' | 'email_verify' | 'password_reset' | 'mfa_sms'
  email         citext NULL,     -- login/email_verify
  user_id       uuid NULL,       -- 이미 계정을 아는 경우
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  consumed_at   timestamptz NULL,
  request_ip    inet, request_ua text,
  created_at    timestamptz NOT NULL
);

-- 세션: 서버측 레코드. 폐기 가능해야 한다. (R-11)
session(
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  token_hash    text NOT NULL UNIQUE,        -- 원문은 클라이언트만 보유
  auth_method   text NOT NULL,               -- 'login_code'|'password'|'passkey'|'google'|'apple'|'microsoft'|'saml'
  mfa_satisfied bool NOT NULL DEFAULT false,
  device_label  text,                        -- 'Chrome on macOS' 등 UA 파생
  device_kind   text,                        -- 'web'|'desktop'|'mobile'
  ip            inet,
  approx_location text,                      -- IP 기반 추정 (1차 출처가 "best estimate"라고 명시)
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,        -- 정책에서 파생
  revoked_at    timestamptz NULL,
  revoked_reason text NULL                   -- 'user_logout'|'logout_all'|'admin_force'|'password_change'|'policy_change'|'account_deleted'
);
-- 불변식 A9: 유효 세션 = revoked_at IS NULL AND expires_at > now()
-- 불변식 A10: 세션 검증은 매 요청 캐시 조회 + 폐기 이벤트 시 캐시 무효화. 순수 JWT 만료 의존 금지

-- 워크스페이스별 세션 정책 (Enterprise)
session_policy(
  workspace_id  uuid PRIMARY KEY,
  max_lifetime  interval NOT NULL,           -- 1시간 ~ 90일/180일 [모순: 출처 참조]
  updated_by    uuid, updated_at timestamptz
);

-- 인증 이벤트 (11 audit_log와 별개로, 세션 없는 시도까지 담는 저수준 로그)
auth_event(
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  email citext NULL, user_id uuid NULL,
  kind text NOT NULL,  -- 'code_requested'|'code_failed'|'login_ok'|'login_failed'|'mfa_failed'|
                       -- 'passkey_added'|'password_set'|'email_added'|'session_revoked'|...
  ip inet, user_agent text, meta jsonb
);
```

### C. 로그인 상태 머신 (클론 구현 기준)

```
[익명]
  │ POST /auth/identify {email}
  ▼
[식별됨]  ── 응답은 항상 동일한 형태여야 한다(계정 열거 방지, F-14-16)
  │   서버는 이 이메일에 어떤 자격증명이 있는지 알지만
  │   클라이언트에는 "사용 가능한 방법 목록"만 내려준다
  ├─ 코드 요청 → otp_challenge 발급 → 코드 검증 ─┐
  ├─ 비밀번호 입력 → credential(password) 검증 ──┤
  ├─ Passkey → WebAuthn assertion 검증 ─────────┤
  ├─ OAuth(Google/Apple/MS) → provider_sub 매칭 ─┤
  └─ SAML(SP-initiated) → assertion 검증 ────────┤
                                                 ▼
                                        [1차 인증 통과]
                                                 │
                              mfa_method 활성 있음? ── 아니오 ──┐
                                                 │예            │
                                                 ▼              │
                                        [MFA 대기]              │
                                  TOTP / SMS / 백업코드         │
                                                 │              │
                                                 ▼              ▼
                                        [세션 생성] ← ─ ─ ─ ─ ─ ┘
                                                 │
                          해당 이메일로 접근 가능한 워크스페이스 목록 계산
                          (workspace_member + allowed_email_domains 매칭)
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
            [워크스페이스 0개]           [기존 멤버십 있음]          [자동 가입 가능 워크스페이스 있음]
            온보딩: 생성 or 초대 대기       마지막 워크스페이스로       "Join {ws}" 옵션 노출 (F-14-10)
```

**중요**: Passkey는 그 자체로 소유+생체 2요소이므로 위 흐름에서 **MFA 단계를 건너뛰는 것이 일반적**이나, Notion 문서는 "Two-step verification remains a separate security feature"라고만 하고 passkey 로그인 시 2FA를 다시 묻는지 명시하지 않는다 `[확인필요]`. 클론 권고: passkey(user-verified) 성공 시 `mfa_satisfied=true`로 두고 재요구하지 않는다.

### D. 클론 상수 (한 곳에 모아두고 여기서만 읽는다)

| 상수 | 값 | 근거 |
|---|---|---|
| `MIN_PASSWORD_LEN` | 8 | 1차 출처 |
| `MIN_UNIQUE_CHARS` | 4 | 1차 출처 |
| `PASSWORD_ALNUM_REQUIRED_BELOW` | 15 (8~14자에만 문자1+숫자1 요구) | 1차 출처 |
| `MAX_EMAILS_PER_ACCOUNT` | 5 | 1차 출처 `[모순]` — 아래 § 미해결 참조 |
| `MAX_PASSKEYS` | 5 | 1차 출처 |
| `MAX_MFA_METHODS` | 4 (TOTP 2 + SMS 2) | 1차 출처 |
| `BACKUP_CODE_COUNT` | 6, 1회용 | 1차 출처 |
| `LOGIN_CODE_TTL` | 10분 `[추정]` | Notion 미공개 |
| `LOGIN_CODE_MAX_ATTEMPTS` | 5 `[추정]` | Notion 미공개 |
| `SESSION_MAX_LIFETIME_DEFAULT` | 90일 | 워크스페이스 전환 문서의 "Login tokens expire after 90 days" |
| `SESSION_POLICY_RANGE` | 1시간 ~ 90일 (Enterprise) `[모순]` managed users 문서는 1시간~180일·기본 180일 | 아래 § 미해결 참조 |
| `DELETED_USER_GRACE_DAYS` | 30 (managed user 삭제 복구 유예 / 백업 복원 창) | 1차 출처 |
| `REJOIN_PRIVATE_PAGE_RESTORE_DAYS` | 30 (제거된 멤버 재가입 시 private 페이지 복원) | 1차 출처 |
| `TEMP_MEMBER_MAX` | 1년 | 06 F-06-02와 동일 |

---

## 기능 명세

### F-14-01 계정 생성 (Sign up) — 이메일 · Google · Apple · Microsoft

- **한 줄 정의**: 이메일 주소를 소유했다는 사실만으로 Notion `user` 레코드를 만들고, 그 이메일이 이미 어떤 계정에도 묶여 있지 않음을 보장한다.
- **사용자 시나리오**:
  1. `notion.com/login`에서 이메일 입력 → `Continue with email`.
  2. 해당 이메일에 계정이 없으면 서버가 6자리 코드를 발송. UI 문구는 로그인/가입을 구분하지 않는다(계정 존재 여부를 노출하지 않기 위해) `[추정]`.
  3. 코드 입력 → 계정 생성 → 이름 입력 → 사용 목적 온보딩 → 워크스페이스 생성 또는 자동 가입 가능한 워크스페이스 선택(F-14-10).
  4. 또는 `Continue with Google` / `Continue with Apple` / `Continue with Microsoft` 선택 → IdP 동의 화면 → 콜백에서 계정 생성. (https://www.notion.com/help/log-in-and-out)
- **동작 상세**:
  - **소셜 가입은 이메일이 일치하면 기존 계정에 붙는다**: "Continue with Google for a faster login" if account email matches. 즉 Google 가입과 이메일 가입이 같은 주소면 **두 계정이 아니라 한 계정에 credential 2개**가 된다.
  - Apple은 "Share My Email"(실제 주소 → 기존 계정 연결)과 **"Hide My Email"(privaterelay 주소로 새 계정 생성)** 두 갈래다. 후자는 **이메일이 달라지므로 기존 계정과 절대 병합되지 않는다** — 사용자가 "내 계정이 사라졌다"고 신고하는 최대 원인.
  - 가입 직후 `user_email.verified_at`은 코드 검증 경로에서는 즉시 채워지고, 소셜 경로에서는 **IdP가 email_verified를 준 경우에만** 채운다 `[추정]`. IdP의 `email_verified=false`를 신뢰하면 이메일 탈취로 계정 탈취가 가능해진다.
  - 신규 계정은 워크스페이스가 0개인 상태로 존재할 수 있다(초대만 기다리는 계정).
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 이메일이 이미 다른 계정의 secondary로 등록됨 | 가입 거부. 1차 출처: "if email tied to another account: must delete that account first before reassigning" |
  | 오타 이메일로 가입 | 새 계정이 조용히 생성된다. 1차 출처가 "이메일 오타 시" 케이스를 다루지 않음 `[확인필요]`. 클론 권고: 온보딩 첫 화면에 로그인 중인 이메일을 크게 표시 |
  | 소셜 IdP가 주는 이메일이 이미 다른 계정 소유 | **자동 병합 금지**. 로그인 실패로 처리하고 "이 이메일은 다른 계정에 연결되어 있습니다"만 노출 |
  | Apple private relay 주소로 만든 계정에 나중에 실제 이메일 추가 | F-14-07 별칭 경로로 가능. relay 주소를 primary에서 내리면 Apple 로그인은 계속 작동(provider_sub 기준) |
  | verified domain을 가진 조직이 존재하는 도메인으로 가입 | 계정은 만들어지되 **managed user**가 된다(F-14-12). 가입 시점 조회가 필요 |
  | 동시에 같은 이메일로 2개 가입 요청 | `user_email.email` 전역 UNIQUE가 유일한 방어선. 트랜잭션 격리만으로는 부족하고 DB 제약이 필수 |
- **데이터 모델 함의**: `user` 생성 + `user_email(is_primary=true, verified_at)` + `credential(kind='oauth')` 또는 없음(코드 경로는 credential 0개). **가입 트랜잭션이 credential을 하나도 만들지 않는 경우가 정상**이라는 점을 스키마와 코드가 함께 허용해야 한다(R-1). `user.type='person'` 기본값(R-2).
- **UI/인터랙션**: 단일 이메일 입력 필드 + 소셜 버튼 3개 + `Continue with Passkey`. 비밀번호 필드는 **처음부터 노출되지 않는다** — 이메일 입력 후 해당 계정에 password credential이 있을 때만 나타난다.
- **의존 기능**: 없음(도메인 루트). F-14-02(코드 발급)를 실질적으로 요구.
- **구현 난이도**: **M** — 이메일 경로만이면 S이나 OAuth 3종 콜백·상태 검증(state/nonce/PKCE)·이메일 충돌 정책까지 포함하면 2~5일.
- **우선순위**: **P0** — 이 도메인 전체의 전제. 소셜 3종은 P1로 분리 가능(이메일 코드만으로 MVP 성립).
- **클론 시 현실적 대안**: 이메일+코드 1종만 자체 구현하고 소셜은 표준 OIDC 라이브러리(Auth.js/Supabase Auth/GoTrue)에 위임. AppFlowy가 GoTrue를 그대로 쓰는 방식이 검증된 경로다.
- **참고 출처**: https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/account-settings

---

### F-14-02 이메일 로그인 코드(OTP) 발급 · 검증

- **한 줄 정의**: 비밀번호 없이, 이메일 수신함 접근 능력만으로 로그인시키는 기본 인증 경로.
- **사용자 시나리오**: 이메일 입력 → `Continue with email` → 메일함에서 코드 확인 → 코드 입력 → 로그인. Notion은 이것을 **기본값**으로 두고, 비밀번호를 "임시 로그인 코드 대신 영구 비밀번호를 쓰고 싶을 때" 설정하는 것으로 서술한다.
- **동작 상세**:
  - 코드는 `otp_challenge`에 **해시로만** 저장하고 원문은 메일에만 존재한다.
  - `purpose='login'` 코드가 유효한 동안 재요청하면 **새 코드를 발급하고 이전 것을 즉시 무효화**해야 한다(재사용 창을 좁히기 위해) `[추정]`.
  - 검증 성공 시 `consumed_at`을 원자적으로 채우고(같은 코드로 두 세션 생성 금지), 이어서 2FA 단계로 넘어간다.
  - 만료 시간·시도 횟수·발송 레이트리밋은 **Notion이 공개하지 않는다** `[확인필요]`. 클론 상수는 § D 참조.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 존재하지 않는 이메일로 코드 요청 | ~~**동일한 성공 응답**을 주고 메일은 보내지 않는다(계정 열거 방지)~~ → **[정정 2026-09-08]** 코드를 **보낸다**. 아래 판결 참조. 응답 시간 정규화는 그대로 유효 |

> **[정정 · 판결] 존재하지 않는 이메일에도 코드를 보낸다**
>
> 위 원안은 **F-14-01 과 정면으로 모순된다.** F-14-01 사용자 시나리오 2번은
> "해당 이메일에 계정이 없으면 서버가 6자리 코드를 발송. UI 문구는 로그인/가입을
> 구분하지 않는다"고 명시한다. 이 제품은 로그인과 가입이 **같은 입구**를 쓰기 때문이다.
>
> 원안대로 메일을 보내지 않으면 **신규 사용자는 영원히 가입할 수 없다.** 이 엣지
> 케이스는 로그인만 생각하고 쓰인 것으로 보인다.
>
> **판결: F-14-01 이 이긴다.** 계정 존재 여부와 무관하게 challenge 를 만들고 코드를
> 보낸다. 계정은 코드 검증 시점에 만들어진다(`user_email.verified_at` 즉시 채움).
>
> 계정 열거 방지는 여전히 성립한다 — 응답도, 메일 문구도, 응답 시간도 동일하기
> 때문이다. 공격자는 "코드가 왔다"는 사실에서 계정 존재 여부를 알 수 없다.
>
> 남는 위험은 **임의 주소로 메일을 보낼 수 있다**는 것(이메일 폭탄)인데, 이는
> 이메일 코드로 가입시키는 모든 제품이 갖는 성질이고 F-14-16 의 이메일당
> 레이트리밋(5분 3회)이 1차 방어다.
  | 코드 5회 오입력 | challenge 폐기 + 재발급 요구. 계정 잠금은 하지 않는다(DoS 벡터) |
  | 메일이 안 옴 | 1차 출처가 이 케이스를 다루지 않음 `[확인필요]`. 클론: 스팸함 안내 + 60초 후 재발송 버튼 |
  | 코드 발급 후 사용자가 다른 브라우저에서 입력 | 허용되어야 한다(코드는 세션이 아니라 이메일에 묶임). 단 `request_ip`가 다르면 auth_event에 기록 |
  | 동일 이메일 대량 요청 | 이메일당 + IP당 이중 레이트리밋. 이메일 폭탄 방지를 위해 이메일당이 더 중요 |
  | 코드 만료 직후 입력 | "만료됨, 재발송" — "틀림"과 다른 메시지를 줘야 사용자가 무한 재시도하지 않는다 |
  | 계정에 2FA가 켜져 있음 | 코드 검증 후에도 로그인 아님. MFA 단계로(F-14-05) |
- **데이터 모델 함의**: `otp_challenge`(§ B). `purpose` 축 하나로 로그인·이메일 검증·비밀번호 재설정 3용도를 공유하되, **purpose가 다른 코드는 절대 교차 사용되지 않도록** 검증 시 purpose를 WHERE 절에 포함한다(전형적인 취약점). `auth_event(kind='code_requested'|'code_failed')`(R-10).
- **UI/인터랙션**: 6칸 분할 입력(붙여넣기 시 자동 분배), 자동 제출, `autocomplete="one-time-code"`(iOS/Android 자동 채움). 재발송 버튼은 카운트다운 후 활성.
- **의존 기능**: F-14-01. 트랜잭션 메일 발송 인프라(11 F-11-11의 이메일 채널과 **동일한 발송기를 쓰되 큐를 분리**해야 한다 — 알림 폭주가 로그인 코드를 지연시키면 로그인 불가 장애가 된다).
- **구현 난이도**: **S** — 테이블 1개 + 메일 1통. 단 레이트리밋·타이밍 정규화까지 하면 S 상단.
- **우선순위**: **P0** — MVP의 유일한 필수 인증 경로.
- **클론 시 현실적 대안**: 원본대로. 개발 환경에서는 메일 발송 대신 코드를 서버 로그에 출력하는 스위치를 두는 것이 실용적이다.
- **참고 출처**: https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/account-settings

---

### F-14-03 비밀번호 설정 · 변경 · 제거 · 재설정

- **한 줄 정의**: 선택적으로 붙일 수 있는 영구 자격증명. **없는 것이 기본 상태**이며, 설정 후에도 제거할 수 있다.
- **사용자 시나리오**:
  - 설정: Settings → {내 이름} → `Set a password`.
  - 변경/제거: 같은 위치에서 change / remove.
  - 재설정: `notion.com/login` → `Forgot password?` → 이메일 입력 → `Send reset link` → 메일의 링크 → **Settings 화면으로 이동**해 새 비밀번호 설정. (Notion의 재설정은 별도 페이지가 아니라 로그인 후 설정 화면으로 들어가는 형태다.)
- **동작 상세**:
  - 정책: **최소 8자, 고유 문자 4자 이상**. 8~14자면 **문자 1개 + 숫자 1개 이상** 필수, **15자 이상이면 그 요구가 해제**된다. 특수문자는 허용되나 필수 아님. → "고유 문자 4자 이상"은 `aaaaaaaa`, `12121212` 류를 막는 규칙이며, **길이에 따라 규칙이 완화되는 구조**(NIST 800-63B의 passphrase 친화 방향)를 그대로 따르고 있다.
  - `remove`가 존재한다는 것은 **비밀번호가 계정의 필수 요소가 아니라 옵션**이라는 설계 선언이다.
  - **2FA는 비밀번호를 전제로 한다** — "Must have a password set". 따라서 **2FA가 켜진 상태에서 비밀번호 제거는 차단**되어야 한다 `[추정: 문서에 명시 없음, 전제 조건의 역방향 귀결]`.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 비밀번호 변경 성공 | **다른 모든 세션을 폐기**해야 한다(`revoked_reason='password_change'`). 1차 출처에 명시 없음 `[확인필요]`이나 미구현 시 탈취 세션이 살아남음 |
  | 2FA 활성 상태에서 비밀번호 제거 시도 | 차단 또는 "2FA도 함께 해제됩니다" 확인 `[추정]` |
  | 재설정 링크를 요청했으나 계정 없음 | 메일 미발송 + 동일 응답(열거 방지) |
  | 재설정 링크 재사용 | 1회용. `consumed_at` |
  | 재설정 링크 유효 중에 비밀번호를 직접 변경 | 기존 링크 전량 무효화 |
  | 정책 미달 비밀번호 | 클라이언트와 서버 **양쪽에서** 검증. 서버 검증만이 실제 방어선 |
  | 유출 비밀번호 사용 | Notion 문서에 언급 없음. 클론 권고: HIBP k-anonymity API로 차단(선택) |
  | SSO 강제 워크스페이스 사용자 | 비밀번호가 있어도 그 워크스페이스 진입에는 쓸 수 없다(F-14-11) |
- **데이터 모델 함의**: `credential(kind='password', password_hash)` 0..1행. **`user` 테이블에 password 컬럼을 두면 안 된다** — 그러면 "제거"가 NULL로 표현되어 다른 credential 종류와 다른 코드 경로가 생긴다. 해시는 argon2id(또는 bcrypt cost≥12). `otp_challenge(purpose='password_reset')`.
- **UI/인터랙션**: 강도 미터가 아니라 **규칙 체크리스트**를 실시간 표시(길이에 따라 규칙 항목이 사라지는 동적 UI가 필요 — 15자 넘으면 "문자+숫자" 항목이 회색으로 소거된다).
- **의존 기능**: F-14-01, F-14-02(재설정 메일). F-14-05가 이것을 전제로 함.
- **구현 난이도**: **S** — 표준 구현. 단 "세션 전량 폐기" 연동까지 포함하면 F-14-08 의존.
- **우선순위**: **P1** — MVP는 F-14-02만으로 성립한다. 그러나 2FA(P1)와 SSO 우회 경로(F-14-11)가 이것을 요구하므로 v1에는 필요.
- **클론 시 현실적 대안**: 원본대로. 정책 상수는 § D에서 단일 소스로 읽는다.
- **참고 출처**: https://www.notion.com/help/account-settings , https://www.notion.com/help/cant-log-in

---

### F-14-04 Passkey (WebAuthn) 등록 · 로그인 · 삭제

- **한 줄 정의**: 기기 잠금 해제 방식(Face ID/Touch ID/보안키)으로 비밀번호 없이 로그인하는 공개키 자격증명. 계정당 최대 5개.
- **사용자 시나리오**:
  1. 등록: Settings → {내 이름} → Account security → `Add passkey` → OS/브라우저 다이얼로그 → 생체 확인 → 저장 위치 선택(iCloud Keychain / Google Password Manager / 1Password / Bitwarden / YubiKey 등).
  2. 로그인: 로그인 화면에서 `Continue with Passkey` → 저장 위치 선택 → Face ID/Touch ID.
  3. 삭제: Settings → `Manage passkeys` → 삭제. (기기/암호관리자 쪽 삭제는 별도 작업)
- **동작 상세**:
  - **최대 5개**. 두 종류를 모두 지원한다: **synced passkey**(iCloud Keychain, Google Password Manager, 1Password, Bitwarden)와 **device-bound passkey**(FIDO2 하드웨어 키, 기기 내장 인증).
  - **비밀번호와 독립**: "users can maintain passkeys with or without a password". 2FA와도 별개 기능이라고 명시.
  - **IdP 로그인을 요구하는 조직(Okta / Azure / Google Workspace)에서는 사용할 수 없다.** SSO 강제와 상호 배타적이다.
  - **워크스페이스 owner가 조직 전체에 passkey를 강제할 수 없다** — 정책 축이 존재하지 않는다.
  - 분실 시: passkey는 복구 수단이 아니라 편의 수단이므로, **Google/Apple 로그인 또는 이메일 코드로 항상 되돌아갈 수 있다**. 즉 passkey는 계정의 유일한 열쇠가 될 수 없다.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 6번째 passkey 등록 | 거부 + 기존 목록에서 삭제하도록 유도 |
  | 같은 기기에서 중복 등록 | WebAuthn `excludeCredentials`에 기존 `cred_id` 전량을 넣어 브라우저 단계에서 차단 |
  | passkey를 모두 잃음 | 계정 잠김이 아니다 — 이메일 코드로 로그인 후 재등록. **이것이 passkey를 "유일한 인증 수단"으로 만들지 않는 이유** |
  | sign_count 역행 | 복제 의심 신호. synced passkey는 sign_count가 0으로 고정되는 경우가 많아 **0이면 검사를 건너뛴다**(표준 권고) |
  | 조직이 SSO를 강제로 켬 | 기존 passkey는 남아 있으나 해당 워크스페이스 진입에 사용 불가 |
  | 도메인 변경(RP ID 변경) | 등록된 passkey 전량 무효. `rp_id`는 초기에 확정하고 절대 바꾸지 않는다 |
  | 사파리/파이어폭스 미지원 브라우저 | `PublicKeyCredential.isConditionalMediationAvailable()`로 사전 판정 후 버튼 숨김 |
- **데이터 모델 함의**: `credential(kind='passkey', cred_id UNIQUE, public_key, sign_count, aaguid, transports[], backup_eligible, label)`. **`cred_id`는 전역 유니크**여야 한다(사용자 식별 없는 discoverable 로그인 = usernameless 흐름을 지원하려면 cred_id → user_id 역인덱스가 필수). 챌린지는 서버 세션(짧은 TTL, 1회용)에 보관.
- **UI/인터랙션**: 로그인 폼에 `autocomplete="username webauthn"`으로 conditional UI(자동 제안) 적용. 관리 화면은 label + 생성일 + 마지막 사용일 표.
- **의존 기능**: F-14-01. HTTPS 필수. `rp_id` 확정(도메인 전략 = 13-adjacent의 커스텀 도메인과 충돌하지 않도록 앱 도메인 고정).
- **구현 난이도**: **M** — 라이브러리(SimpleWebAuthn 등)로 서버 3~4개 엔드포인트. 어려운 부분은 프로토콜이 아니라 **복구 경로 설계와 브라우저 편차**다.
- **우선순위**: **P2** — 클론 MVP·v1에 불필요. 단 `credential` 테이블을 처음부터 다형 구조로 잡아두면 나중에 추가가 S가 된다. **그 다형 구조 결정 자체는 P0**이다.
- **클론 시 현실적 대안**: SimpleWebAuthn(Node) / py_webauthn 등 검증된 라이브러리 사용. 자체 CBOR/COSE 파싱 구현은 금지.
- **참고 출처**: https://www.notion.com/help/passkeys

---

### F-14-05 2단계 인증 (인증앱 · SMS · 백업코드)

- **한 줄 정의**: 1차 인증 통과 후 추가 소유 증명을 요구하는 계정 단위 옵트인 보안 계층.
- **사용자 시나리오**:
  1. 전제: **비밀번호가 설정되어 있어야 한다**.
  2. Settings → {내 이름} → Account security → 2-step verification 옆 `Add verification method`.
  3. 인증앱: QR 스캔 → 수단 이름 입력 → 앱의 1회용 코드 입력 → 확정.
  4. SMS: 전화번호 추가 → 문자로 받은 코드 입력 → 확정.
  5. 최초 설정 시 **백업 코드 6개**를 받는다. 각 코드는 **1회만** 사용 가능.
  6. 로그인 시 기기 분실이면 `Use backup code`.
  7. 해제: 수단 옆 `•••` → Delete → 확인.
- **동작 상세**:
  - **최대 4개 수단**: 인증앱 2개 + 전화번호 2개.
  - 백업 코드는 **전부 소진한 뒤 설정에서 새 세트를 생성**할 수 있다.
  - **SSO/IdP 로그인 사용자는 Notion 2FA를 쓸 수 없다** — IdP 쪽에서 설정하라고 명시.
  - **Enterprise 조직 owner는 게스트에게만 MFA를 강제할 수 있고, 워크스페이스 멤버에게는 강제할 수 없다.** (멤버는 SSO로 통제한다는 설계.) → 06 F-06-11 `security_policy`에 `require_mfa_for_guests` 항목 추가 요구.
  - "이 기기 기억하기"는 문서에 없다 `[확인필요]`.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 비밀번호가 없는 계정에서 2FA 켜기 | 차단. 먼저 비밀번호 설정 유도 |
  | 마지막 수단 삭제 | 계정의 `mfa_enabled=false`로 전이. 백업 코드도 함께 무효화해야 한다 `[추정]` |
  | 백업 코드 소진 + 기기 분실 | 계정 복구 불가 상태. 1차 출처에 셀프서비스 복구 경로 없음 → 지원팀 경유 `[확인필요]`. 클론: 관리자 강제 해제 경로(managed user, F-14-12) 필수 |
  | TOTP 시계 오차 | ±1 윈도우(±30초) 허용 |
  | 같은 TOTP 코드 재사용 | 사용된 (user, code, window)를 짧게 캐시해 replay 차단 |
  | SMS 미지원 지역 | 1차 출처가 "regional restrictions may limit SMS availability" 명시. 인증앱만 노출 |
  | SIM 스와핑 | SMS는 근본적으로 약한 수단. 클론 권고: TOTP를 기본, SMS는 선택으로 두고 UI에서 순서를 바꾼다 |
  | 2FA 켠 채 SSO 강제 전환 | Notion 안내대로면 2FA가 사실상 무력. `session.mfa_satisfied`는 SAML 세션에서 IdP 주장(AuthnContext)으로 채운다 `[추정]` |
- **데이터 모델 함의**: `mfa_method`(불변식 A6/A7) + `mfa_backup_code`(해시 저장, `batch_id`로 세대 관리, 불변식 A8). `totp_secret`은 **KMS 봉인 암호화**(DB 유출 시 즉시 전 계정 무력화되기 때문). `session.mfa_satisfied` 플래그(R-11) — 세션이 MFA를 통과했는지가 **권한 게이트의 입력**이 되어야 민감 작업 재인증(step-up)이 가능해진다.
- **UI/인터랙션**: QR + 수동 입력용 base32 시크릿 병기(카메라 없는 환경). 백업 코드는 **복사·다운로드·인쇄 3버튼 + "저장했음" 체크박스 강제**.
- **의존 기능**: F-14-03(비밀번호 필수), F-14-02(SMS 코드 경로 재사용), F-14-08(2FA 변경 시 세션 재평가).
- **구현 난이도**: **M** — TOTP 자체는 S이나, 백업 코드 세대 관리 + SMS 게이트웨이 + 복구 경로 + 강제 정책까지 2~5일.
- **우선순위**: **P1** — MVP 불필요. 다만 **팀·기업 고객을 받는 순간 계약상 요구사항**이 되므로 v1 범위.
- **클론 시 현실적 대안**: TOTP(RFC 6238)만 구현하고 SMS는 생략. SMS는 게이트웨이 비용·국제 배송 실패율·SIM 스와핑 리스크 대비 가치가 낮다. 백업 코드는 반드시 함께 구현(TOTP만 있고 백업 코드가 없으면 지원 문의가 폭증한다).
- **참고 출처**: https://www.notion.com/help/two-step-verification

---

### F-14-06 소셜 로그인 연결 (Google · Apple · Microsoft)와 계정 병합 규칙

- **한 줄 정의**: 외부 IdP의 인증 결과를 기존/신규 Notion 계정에 결합하는 규칙 집합.
- **사용자 시나리오**: 로그인 화면에서 `Continue with Google` / `Continue with Apple` / `Continue with Microsoft` → 동의 → 콜백 → 로그인 완료. 계정 이메일이 일치하면 기존 계정으로 들어간다.
- **동작 상세**:
  - Google: "Continue with Google for a faster login" — **이메일 일치 기반 결합**.
  - Microsoft: Outlook/Office 계정 대상.
  - Apple: **Share My Email**(실제 주소 → 기존 계정에 연결) / **Hide My Email**(`...@privaterelay.appleid.com` 형태의 주소로 **새 계정 생성**).
  - IdP 쪽에 2FA가 켜져 있으면 "second device로 인증"이 IdP 단계에서 일어난다 — Notion은 그 결과만 받는다.
  - **핵심 설계 결정**: 이메일 일치로 계정을 결합하면 **IdP가 이메일 소유를 검증했다는 신뢰**가 전제된다. `email_verified=false`를 주는 IdP를 신뢰하면 계정 탈취 경로가 열린다.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 사용자가 IdP에서 이메일을 바꿈 | `provider_sub`로 매칭되므로 계정은 유지. Notion의 `user_email`은 자동 변경하지 않는다 `[추정]` |
  | 두 IdP가 같은 이메일 주장 | 같은 계정에 credential 2개. 정상 |
  | Hide My Email 계정에서 relay 해제 | Apple 쪽에서 relay를 끄면 메일이 도달하지 않게 된다 → 계정 알림 유실. 클론: relay 주소는 primary로 두되 배너로 실제 이메일 추가 권고 |
  | IdP 계정 삭제 | Notion 계정은 남는다. 이메일 코드로 계속 로그인 가능 |
  | SSO 강제 워크스페이스 | Google/Apple 로그인은 **게스트에게만** 유효한 대체 경로가 된다(F-14-11) |
  | 소셜 최초 로그인이 기존 계정과 이메일 충돌하며 IdP가 미검증 이메일 제공 | 결합 거부 + 이메일 코드 검증 요구 |
- **데이터 모델 함의**: `credential(kind='oauth', provider, provider_sub UNIQUE, is_private_relay)`. **`provider_sub`가 매칭 키이고 이메일은 부차 키**다 — 이메일을 유일 키로 쓰면 IdP 측 이메일 변경 시 계정이 갈라진다. `is_private_relay`는 알림 도달성 판단(R-9)에 쓰인다.
- **UI/인터랙션**: 버튼 3개. 계정 설정의 "연결된 로그인" 목록에서 해제 가능하되, **credential이 0개가 되는 해제는 허용**(이메일 코드가 항상 남아 있으므로).
- **의존 기능**: F-14-01, F-14-07(이메일 결합 규칙).
- **구현 난이도**: **M** — 제공자 3종 × (state/nonce/PKCE, 콜백, 토큰 검증). Apple은 client_secret이 JWT라서 별도 처리 필요.
- **우선순위**: **P1** — 가입 전환율에 직접 영향하나 MVP는 아님.
- **클론 시 현실적 대안**: Google 1종만 먼저. Apple은 iOS 앱을 낼 때 필수(App Store 심사 규정)이므로 그때 추가.
- **참고 출처**: https://www.notion.com/help/log-in-and-out

---

### F-14-07 계정당 이메일 최대 5개 — 별칭의 로그인 · 공유 · 멘션 의미

- **한 줄 정의**: 한 사람이 가진 여러 이메일 주소를 하나의 계정 정체성으로 수렴시켜, **어느 주소로 초대·멘션되든 같은 사람에게 도달**하게 만든다.
- **사용자 시나리오**:
  1. Settings → {내 이름} → Account security → `Manage emails`.
  2. 주소 입력 → `Send verification code` → 코드 입력 → 별칭 추가 완료.
  3. `•••` → `Make primary`로 대표 주소 변경, `Remove`로 제거.
- **동작 상세**:
  - **최대 5개** `[모순: account-settings는 "up to 5 email addresses per account"(총 5), secondary-emails는 "up to 5 secondary emails per account"(primary 제외 5 = 총 6)]`. 클론은 **총 5개로 고정**하고 상수 하나로 관리한다.
  - **검증된 별칭은 3가지에 동등하게 작동**: ① 로그인, ② 공유 수신(그 주소로 페이지가 공유되면 내 계정으로 들어옴), ③ @멘션(그 주소로 멘션되면 내가 알림을 받고 내 계정으로 참조됨).
  - **계정 알림은 primary로만 간다** — "Account notifications default to your primary email address." → R-9.
  - **각 이메일은 전역에서 단 하나의 계정에만 속한다.** 이미 다른 계정에 묶여 있으면 그 계정을 먼저 삭제해야 재할당 가능.
  - **Enterprise 관리자 정책 3값**: `Disabled` / `Only verified domains` / `Enabled`. managed user는 **기본 Disabled**이며 관리자가 열어줘야 한다.
  - SSO 로그인 시에도 **IdP가 그 주소를 지원한다면 어느 검증 별칭으로든 로그인 가능**.
  - Student 플랜은 교육기관 이메일을 제거하면 할인을 잃는다 — 즉 **이메일 삭제가 과금에 영향을 준다**(13-18 연결점).
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 별칭을 워크스페이스 멤버 초대에 사용 | 같은 `user`이므로 **workspace_member 행이 추가되지 않고 이미 멤버**로 판정된다. 좌석 중복 증가 금지(R-14) |
  | 초대 시 대상 이메일이 아직 어떤 계정에도 없음 | `workspace_invite(email=...)` pending 상태로 저장. 나중에 그 주소가 어떤 계정의 별칭으로 검증되면 **그 계정이 초대를 이어받아야 한다** — 초대 해석은 user_id가 아니라 email 기준 |
  | primary 제거 시도 | 차단. 먼저 다른 주소를 primary로 승격 |
  | 미검증 주소 | 로그인·공유·멘션 어디에도 쓰이지 않는다. `verified_at IS NULL`인 행은 사실상 예약 |
  | 별칭 제거 후 그 주소로 온 과거 공유 | 공유는 `acl_entry(principal_id=user_id)`로 이미 해석되어 저장되므로 **유지된다**. 이메일은 해석 시점의 입력일 뿐 |
  | 관리자가 정책을 Enabled → Disabled로 변경 | 기존 별칭이 삭제되는지 잠기기만 하는지 문서 미기재 `[확인필요]`. 클론: 잠금(읽기 전용)으로 처리 |
  | @멘션 자동완성에 5개 주소가 모두 뜸 | 표시는 primary + 이름만, 검색 인덱스는 5개 전부(07 F-07 계열 자동완성에 요구사항 추가) |
- **데이터 모델 함의**: `user_email`(§ B, 불변식 A1~A3) — **R-1/R-16의 핵심**. 이메일 → 계정 해석 함수 `resolve_user_by_email(email)`가 초대(F-14-10), 공유(06 F-06-06), 멘션(01/11)의 **공통 진입점**이 되어야 한다. 세 곳이 각자 `SELECT * FROM user WHERE email=?`을 하면 별칭이 작동하지 않는다.
- **UI/인터랙션**: 주소 목록 표(주소 / 검증 상태 / primary 배지 / `•••`). 추가 시 인라인 코드 입력.
- **의존 기능**: F-14-01, F-14-02(검증 코드). 06 F-06-06(공유 초대), 11 F-11-08(멘션 알림)이 이것에 의존한다.
- **구현 난이도**: **M** — 테이블 분리 자체는 S이나, **기존 코드 전체에서 `user.email` 참조를 걷어내는 리팩터링**이 실제 비용이다. 나중에 하면 L~XL이 된다.
- **우선순위**: **P1**(기능) / **P0**(스키마 결정) — 기능은 v1로 미룰 수 있으나 **`user_email` 테이블 분리는 처음부터** 해야 한다. 이것이 이 문서에서 가장 중요한 단일 권고다.
- **클론 시 현실적 대안**: MVP에서는 UI 없이 `user_email` 테이블만 만들고 행을 1개만 쓴다. 별칭 추가 UI는 v1.
- **참고 출처**: https://www.notion.com/help/secondary-emails , https://www.notion.com/help/account-settings

---

### F-14-08 세션 · 디바이스 관리 · 전체 로그아웃 · 신규 로그인 알림

- **한 줄 정의**: 계정에 붙은 모든 활성 세션을 목록으로 보여주고 원격에서 개별/일괄 폐기할 수 있게 한다.
- **사용자 시나리오**:
  1. Settings → {내 이름}에 활성 세션 표가 있다(기기 / 위치 / 마지막 활동).
  2. 특정 기기 옆 `Log out`으로 그 세션만 종료.
  3. `Log out of all devices` → **현재 세션은 유지**되고 나머지 전부 종료.
  4. 새 기기에서 로그인하면 계정 이메일로 알림이 온다. 본인이 아니면 `This was not me`.
- **동작 상세**:
  - 1차 출처가 명시하는 유스케이스: "공용 컴퓨터에서 로그아웃을 잊었을 때, 기기를 도난당했을 때, 접근 가능한 기기가 하나라도 남아 있으면 원격 종료".
  - 신규 로그인 알림의 **위치는 IP 기반 추정치**이며 정확하지 않을 수 있다고 문서가 스스로 밝힌다.
  - **Enterprise 세션 수명 정책**: 관리자가 세션 지속 시간을 설정하고 전 사용자를 즉시 강제 로그아웃시킬 수 있다. 범위는 `[모순]` — log-in-and-out 계열 서술은 "기본 90일, 1시간~90일", managed users dashboard는 "1시간~180일, 기본 180일". 워크스페이스 전환 문서는 "Login tokens expire after 90 days"라고 한다. **클론은 정책 범위를 설정 가능한 값으로 두고 기본 90일로 시작**한다.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 현재 세션이 목록에서 어느 것인지 | `session.id`를 현재 토큰에서 알 수 있으므로 "이 기기" 배지를 붙인다. `Log out of all devices`가 자기 자신을 제외하는 근거 |
  | 오프라인 클라이언트의 세션 폐기 | 12 F-12-04의 오프라인 큐가 **재접속 시 401을 받고 로컬 큐를 폐기하지 않은 채 재인증을 요구**해야 한다. 폐기 = 로컬 데이터 삭제로 구현하면 미전송 편집이 사라진다 |
  | 다중 계정 로그인 중 한 계정 전체 로그아웃 | 다른 계정 세션에 영향 없음(F-14-09) |
  | 비밀번호 변경 / 2FA 수단 삭제 | 다른 세션 자동 폐기 권고(`[확인필요]`, 문서 미기재) |
  | 관리자 강제 로그아웃 | `revoked_reason='admin_force'`. 감사 로그에 actor를 관리자로 기록(11 F-11-12) |
  | 세션 폐기 전파 지연 | 세션 검증을 Redis 캐시로 할 경우 **폐기는 캐시 즉시 삭제 + DB 갱신**의 순서여야 한다. 반대면 폐기 후에도 TTL 동안 살아 있다 |
  | 봇/통합 토큰 | **session이 아니다.** 09 F-09-02의 토큰 수명주기와 절대 섞지 않는다. "Log out of all devices"가 통합을 끊으면 워크스페이스 자동화가 전부 죽는다 |
- **데이터 모델 함의**: `session`(§ B, 불변식 A9/A10) + `session_policy`. **JWT 무상태 검증만으로는 이 기능이 불가능**하다 — 짧은 access token(5~15분) + 서버측 refresh/세션 레코드 조합이거나, 세션 조회를 캐시로 매 요청 수행하는 구조여야 한다. `auth_event(kind='login_ok'|'session_revoked')`(R-10).
- **UI/인터랙션**: 표(기기 아이콘 / 브라우저·OS / 대략 위치 / 마지막 활동 상대시간 / Log out). 상단에 `Log out of all devices` 위험 버튼.
- **의존 기능**: F-14-01~06(세션 생성 경로), 12 F-12-04(오프라인 클라이언트), 11 F-11-11(알림 이메일 발송).
- **구현 난이도**: **M** — 테이블과 UI는 S이나, **세션 폐기가 실시간 동기화 연결(05의 WebSocket connection)까지 끊어야** 한다는 점이 비용. 05의 `connection` 엔티티가 `session_id`를 참조하도록 요구된다.
- **우선순위**: **P1** — MVP는 "로그아웃" 버튼 하나면 성립. 단 **세션을 서버 레코드로 두는 결정은 P0**(나중에 무상태 JWT에서 옮기려면 전면 재작업).
- **클론 시 현실적 대안**: 세션 테이블 + 짧은 TTL Redis 캐시. 신규 로그인 알림은 v1으로 미루되 `auth_event`는 처음부터 기록.
- **참고 출처**: https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/managed-users-dashboard , https://www.notion.com/help/security-and-privacy

---

### F-14-09 다중 계정 전환 (Account switcher)과 워크스페이스 전환

- **한 줄 정의**: 하나의 앱 인스턴스가 **여러 계정에 동시에 로그인**한 상태를 유지하고, 계정 → 워크스페이스 2단계로 컨텍스트를 전환한다.
- **사용자 시나리오**:
  1. 좌상단 워크스페이스 스위처 클릭 → 로그인된 계정들과 각 계정의 워크스페이스 목록이 함께 보인다.
  2. `Add another account` → 다른 이메일로 로그인 → **기존 계정 로그아웃 없이** 두 계정이 병존.
  3. 워크스페이스 이름 클릭 → 드롭다운에서 선택. 데스크톱 단축키 `Ctrl + Shift + {번호}`(목록상 위치).
  4. 계정별 `•••` → `Join or create workspace`.
- **동작 상세**:
  - 1차 출처: "The workspace switcher supports simultaneous login to multiple accounts via Add another account. This allows viewing all workspaces across different email addresses without logging out." + "Login tokens expire after 90 days."
  - 즉 클라이언트는 **계정별 토큰을 각각 보관**한다. 서버는 요청마다 `(session → user)`를 해석하고, 별도로 `workspace_id`를 컨텍스트로 받는다(02 F-02-x가 이미 규정: 워크스페이스 불일치는 403이 아니라 **404**).
  - 워크스페이스 전환은 사이드바·검색 인덱스·알림 인박스·설정 화면 전체의 스코프를 바꾼다.
  - **테마 등 일부 설정은 계정 단위로 워크스페이스를 가로질러 동기화**된다(12: "Appearance ... synced across workspaces") → `user_setting(scope='account')`(R-8).
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 같은 사람이 계정 A와 계정 B로 같은 워크스페이스에 존재 | 별개 멤버 2명. 좌석도 2개. **별칭(F-14-07)으로 합치는 것이 정답**이며 UI가 이를 유도해야 함 |
  | 계정 A 세션 만료, 계정 B는 유효 | 스위처에 A만 "재로그인 필요" 표시. 앱 전체를 로그아웃시키면 안 된다 |
  | 워크스페이스 0개인 계정 | 스위처에 계정은 뜨되 워크스페이스 목록이 비고 "Join or create workspace"만 노출 |
  | 오프라인 상태 전환 | 12 F-12-04의 오프라인 캐시는 **계정×워크스페이스 단위로 분리 저장**되어야 한다. 단일 로컬 DB에 섞으면 계정 격리가 깨진다(보안 사고) |
  | 데스크톱 앱 다중 창 | 창마다 다른 워크스페이스 컨텍스트 허용 여부는 문서 미기재 `[확인필요]` |
  | 딥링크(공유된 페이지 URL) 클릭 | 어느 계정으로 열지 결정해야 한다. 접근 가능한 계정이 여럿이면 선택 UI 필요 `[추정]` |
- **데이터 모델 함의**: 서버 스키마 변경은 거의 없다 — 이 기능은 **클라이언트 상태 모델**이 본체다. `Map<user_id, {token, workspaces[], last_workspace_id}>`. 서버 요구사항은 두 가지: ① 모든 API가 `workspace_id`를 명시 컨텍스트로 받을 것(02가 이미 규정), ② `GET /me/workspaces`가 세션 하나로 그 계정의 전 워크스페이스를 반환할 것. 12의 오프라인 저장소는 `(user_id, workspace_id)` 복합 키로 파티션.
- **UI/인터랙션**: 스위처 드롭다운(계정 헤더 + 워크스페이스 리스트 + 추가 버튼), `Ctrl+Shift+숫자`.
- **의존 기능**: F-14-08(세션), 02(워크스페이스), 12 F-12-04(오프라인 저장소 분리).
- **구현 난이도**: **M** — 서버는 S이나 클라이언트 상태·라우팅·로컬 캐시 파티셔닝이 2~5일. **나중에 추가하면 L**(전역 싱글턴 스토어를 계정별로 쪼개야 함).
- **우선순위**: **P2**(다중 계정) / **P0**(워크스페이스 전환) — 워크스페이스 전환은 MVP 필수, 다중 계정은 아니다. 다만 **클라이언트 스토어를 처음부터 `accountId` 키로 감싸두는 것**은 비용이 0에 가깝다.
- **클론 시 현실적 대안**: MVP는 단일 계정 + 워크스페이스 전환. 스토어 구조만 다계정 대비.
- **참고 출처**: https://www.notion.com/help/create-delete-and-switch-workspaces

---

### F-14-10 워크스페이스 초대 · 수락 · 자동 가입 (4개 진입 경로)

- **한 줄 정의**: 계정을 워크스페이스 멤버십에 연결하는 4가지 경로와 그 각각의 좌석·역할·권한 귀결.
- **사용자 시나리오** (경로별):
  - **① 이메일 초대**: 관리자 → Settings → People → `Add members` → 이메일 입력 → **역할 선택(Workspace owner / Membership admin / Member)** → 초대 메일 발송. 수신자는 링크 클릭 → (계정 없으면 F-14-01 가입) → 워크스페이스 진입.
  - **② 비밀 초대 링크**: `Copy link`로 링크 복사 → 아무에게나 전달. **클릭한 사람은 유료 멤버로 자동 가입**된다.
  - **③ allowed email domain 자동 가입**: 워크스페이스 Settings → General → Trusted domain access → `Allowed email domains`에 도메인 입력. 그 도메인 이메일로 Notion에 로그인한 사람은 **온보딩 중 "이 워크스페이스에 참여" 옵션을 본다**. 단 **워크스페이스 멤버가 실제로 그 도메인 계정을 갖고 있어야 도메인을 추가할 수 있다**. Free 플랜에서는 자동 가입자가 workspace owner로 들어간다.
  - **④ SAML JIT**: SSO 로그인 성공 시 계정·멤버십 자동 생성(F-14-11).
- **동작 상세**:
  - **게스트 vs 멤버 판정**: 게스트는 워크스페이스가 아니라 **개별 페이지에** 추가된다. 게스트 한도를 초과한 워크스페이스에서는 **워크스페이스의 이메일 도메인(allowed domain 또는 owner 도메인 또는 verified domain)에 속한 사람만 멤버로 추가 가능**하다. 즉 **한도 초과 시 신규 공유 대상의 도메인이 역할을 결정**한다.
  - **게스트 → 멤버 승격**: 체크박스 선택 후 `Upgrade {n} guest(s) to member` 배치 작업.
  - **temporary member**: 최대 1년 기한, **유료 좌석 미소비**(06 F-06-02와 동일).
  - **멤버 제거**: 즉시 접근 상실, private 페이지는 숨겨지고, **30일 내 재가입하면 복원**된다.
  - **워크스페이스 나가기**: Settings → Workspace → General → Danger zone → `Leave workspace`. 내부 콘텐츠 접근을 전부 잃으며 관리자가 다시 추가할 수 있다.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 초대 이메일이 아직 계정 없음 | `workspace_invite(email, role, token)` pending. 그 주소가 나중에 **어느 계정의 별칭으로 검증되면 그 계정이 초대를 승계**(F-14-07) |
  | 초대된 주소가 이미 그 계정의 별칭 | 이미 멤버로 판정. 좌석 중복 금지(R-14) |
  | 비밀 링크 유출 | 링크는 수신자 미지정이므로 **재발급(rotate)이 유일한 방어**. `workspace_invite.revoked_at` + 재생성 필요(R-7) |
  | 좌석 한도 초과 상태에서 수락 | 수락 시점에 좌석을 소비하므로 **수락을 막거나 과금을 늘린다**. 13-18 F-13-18의 강제 지점 = 수락 트랜잭션 |
  | 자동 가입 도메인이 gmail.com 같은 공용 도메인 | 워크스페이스 전체가 공개된다. 1차 출처가 "typically for work email domains only"라고만 함 → 클론은 **공용 도메인 블랙리스트 필수** |
  | 이메일 미검증 상태에서 자동 가입 시도 | **차단해야 한다.** 미검증 이메일로 도메인 자동 가입을 허용하면 아무나 조직 워크스페이스에 들어온다. `user_email.verified_at IS NOT NULL`이 자동 가입의 전제 조건(이 문서의 핵심 요구사항 중 하나) |
  | 초대 수락 전 관리자가 역할 변경 | pending 초대의 role을 갱신. 수락 시 최신 role 적용 |
  | 초대 수락 전 멤버 제거 | 초대 revoke |
  | 도메인 자동 가입으로 들어온 사람의 초기 권한 | teamspace 기본 가입 규칙(06 F-06-04 `is_default`)이 적용된다 — 이 두 기능이 만나는 지점이 명세되어야 함 |
- **데이터 모델 함의**: `workspace_invite`(R-7: `kind ∈ {email, link}`, `accepted_by_user_id`, `accepted_at`, `revoked_at`, `max_uses`) + `workspace_member`(R-5: `status ∈ {invited, active, suspended}`, `join_method`, `invited_by`). **좌석 산식은 `status='active'`만 카운트**(R-14). `workspace.allowed_email_domains[]`(R-6) + 자동 가입 판정 시 `user_email.verified_at` 검사. 제거 후 30일 복원을 위해 `workspace_member`는 **삭제가 아니라 `status`/`removed_at` 전이**여야 한다(R-3와 같은 원리).
- **UI/인터랙션**: People 설정 표(이름 / 이메일 / 역할 드롭다운 / 팀스페이스 / `•••`), 상단 `Add members` + `Copy link`, 게스트 탭에 승격 배치 버튼.
- **의존 기능**: F-14-01, F-14-07(이메일 해석), 06 F-06-02(역할), 13-18 F-13-18(좌석 과금), 02(워크스페이스).
- **구현 난이도**: **L** — 경로 4개 × (좌석·역할·teamspace 기본 가입·감사) 조합이 넓고, 실패 시 과금·보안 사고로 직결된다. 1~2주.
- **우선순위**: **P0** — 협업 제품의 정의상 필수. 단 **MVP는 ① 이메일 초대 하나만**으로 자르고 ②③④는 v1.
- **클론 시 현실적 대안**: MVP = 이메일 초대 + 수락 링크(1회용 토큰). 비밀 링크와 도메인 자동 가입은 보안 리스크가 크므로 정책 UI가 갖춰진 뒤에 연다.
- **참고 출처**: https://www.notion.com/help/add-members-admins-guests-and-groups , https://www.notion.com/help/create-delete-and-switch-workspaces , https://www.notion.com/help/workspace-settings

---

### F-14-11 SAML SSO 강제와 예외 (게스트 · owner 백도어)

> 06 F-06-12가 SSO/SCIM의 **존재**를 다룬다. 이 항목은 그것을 대체하지 않고 **인증 세션 관점의 계약**만 보완한다.

- **한 줄 정의**: 워크스페이스/조직 단위로 "이 워크스페이스에는 IdP를 통해서만 들어올 수 있다"를 강제하되, 강제가 불가능한 주체(게스트)와 강제하면 안 되는 주체(owner)를 예외로 남긴다.
- **사용자 시나리오**:
  1. 전제: Business/Enterprise 플랜 + **검증된 도메인 1개 이상** + workspace/org owner.
  2. Business: Settings → Identity → `Enable SAML SSO` → IdP URL 또는 metadata XML 입력. Enterprise: `Manage organization`에서 조직 단위 설정.
  3. `Enforce SAML SSO` 활성화 → **워크스페이스 사용자들이 로그아웃되고 SAML로 재로그인해야 한다**.
- **동작 상세**:
  - **예외 1 — owner 백도어**: workspace/org owner는 **IdP나 SAML 장애 시를 대비해 이메일/비밀번호 우회 접근을 유지**한다. 이것은 버그가 아니라 명시된 설계다.
  - **예외 2 — 게스트**: 페이지에 초대된 게스트는 **SAML SSO를 쓸 수 없고**, 이메일/비밀번호 또는 Google/Apple 같은 다른 방법을 써야 한다. 게스트는 IdP 디렉터리에 없기 때문.
  - **JIT 프로비저닝**("Automatic account creation"): SAML 로그인 성공 시 계정·멤버십 자동 생성.
  - **Enterprise workspace-level authorization**: 이메일 도메인과 무관하게 워크스페이스 진입 시 추가 SAML 승인 화면을 띄운다.
  - **SSO 사용자는 Notion의 2FA를 쓸 수 없고**(F-14-05), **passkey도 IdP 강제 조직에서 사용 불가**(F-14-04). 즉 **SSO 강제는 다른 인증 수단을 비활성화하는 정책**이다.
  - 강제 전환 시 기존 비밀번호·2FA·passkey가 삭제되는지 잠기는지는 문서 미기재 `[확인필요]`. 클론 권고: **삭제하지 않고 잠금**(강제 해제 시 복구 가능해야 함).
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | IdP 장애 | owner 백도어로 진입 → enforce 해제. **이 경로가 없으면 조직 전체가 잠긴다** |
  | enforce 켜는 순간의 기존 세션 | 전량 폐기(`revoked_reason='policy_change'`) — 1차 출처가 "logged out and required to log back in"이라 명시 |
  | 다중 워크스페이스 계정 | 한 계정이 SSO 강제 워크스페이스 A와 일반 워크스페이스 B에 동시 소속. **세션 하나로 A는 막고 B는 허용**해야 한다 → 강제는 세션 생성이 아니라 **워크스페이스 컨텍스트 진입 시 판정**(R-11) |
  | 게스트가 SSO 도메인 이메일을 가짐 | 게스트는 여전히 SAML 불가. 역할이 판정 기준이지 도메인이 아니다 |
  | SAML assertion의 이메일이 별칭 | 검증된 별칭이면 매칭 허용(F-14-07의 SSO 서술과 일치) |
  | JIT로 생성된 계정의 이메일 검증 상태 | IdP 주장을 검증으로 인정. 단 그 도메인이 **verified domain일 때만**(R-6) |
  | SCIM으로 deprovision된 사용자가 SAML로 재로그인 | 멤버십이 없으므로 워크스페이스 목록에 없음. JIT이 켜져 있으면 **되살아난다** — SCIM과 JIT을 함께 켜면 deprovisioning이 무력화될 수 있음 `[추정]` |
- **데이터 모델 함의**: 06의 `sso_config(workspace_id, idp_metadata_url, entity_id, x509_cert, jit_provisioning, enforced)`를 그대로 사용. 이 문서가 추가로 요구하는 것은 **`session.auth_method`와 워크스페이스 진입 게이트**(R-11): `can_enter_workspace(session, workspace) = NOT ws.sso_enforced OR session.auth_method='saml' OR member.role='owner' OR member.role='guest'`. 이 함수가 없으면 enforce 플래그는 UI 장식에 불과하다.
- **UI/인터랙션**: 로그인 화면에서 이메일 입력 시 도메인이 SSO 강제 도메인이면 **비밀번호 필드 대신 "Continue with SSO"만 노출**(SP-initiated 흐름).
- **의존 기능**: 06 F-06-12, F-14-08(세션 폐기), F-14-12(verified domain), F-14-10(JIT = 자동 멤버십).
- **구현 난이도**: **L** — SAML 자체는 라이브러리로 M이나, **예외 2종 + 다중 워크스페이스 게이팅 + 다른 인증수단 잠금**의 상호작용이 실제 비용. 1~2주.
- **우선순위**: **P2** — 클론 MVP·v1 무관. Enterprise 판매 시점에 필요. 단 **`session.auth_method` 컬럼을 미리 두는 것은 P0급 비용 0 결정**.
- **클론 시 현실적 대안**: 자체 SAML 구현 대신 WorkOS/Auth0/Keycloak 등 SSO 브로커에 위임하면 L → M. Docmost가 SSO를 엔터프라이즈 유료 기능으로 분리한 것도 같은 판단.
- **참고 출처**: https://www.notion.com/help/saml-sso-configuration , https://www.notion.com/help/provision-users-and-groups-with-scim

---

### F-14-12 SCIM 프로비저닝과 managed user — 조직이 계정을 소유하는 계층

- **한 줄 정의**: 검증된 도메인으로 만들어진 계정은 조직의 자산이 되어, 조직 owner가 그 계정의 이름·이메일·자격증명·세션·존재 여부까지 통제한다.
- **사용자 시나리오**:
  1. 조직 owner가 도메인 검증(DNS TXT) → **그 도메인 이메일로 만들어진 모든 계정이 managed user**가 된다.
  2. Settings → Identity & provisioning → SCIM Configuration에서 토큰 발급(**Enterprise org owner만**).
  3. IdP(Okta/Azure AD/Google Workspace)에 토큰 등록 → 사용자·그룹이 자동 프로비저닝/디프로비저닝.
  4. Managed users dashboard에서 개별 사용자에 대해: 이름·이메일 변경 / 강제 비밀번호 재설정 / 로그아웃 / 정지 / 삭제 / 외부 워크스페이스에서 제거.
- **동작 상세**:
  - **managed user 정의**: "any user with an account created with the organization's verified email domain." 조직이 도메인을 검증하면 **그 도메인의 기존 개인 계정까지 관리 대상**이 된다는 뜻이다(문서가 "created with"라고만 하고 소급 여부를 명시하지 않음 `[확인필요]` — 그러나 도메인 claim 기능의 존재상 소급이 자연스럽다).
  - **도메인 검증 절차**: 코드 발급 → DNS TXT 레코드 등록 → 검증. **코드는 1주일 후 만료**, DNS 전파는 보통 몇 분이나 최대 **72시간**. 검증 **14일 후**부터 조직 owner는 그 도메인으로 만들어진 워크스페이스를 claim(다중 멤버 워크스페이스는 Enterprise로 업그레이드하며 흡수, 단독 멤버 워크스페이스는 소유권 이전 요청 또는 삭제)할 수 있다.
  - **상태 2종**:
    - **Suspend**: 로그인 불가. **좌석은 계속 과금되고 콘텐츠는 계속 보인다.**
    - **Delete**: **30일 복구 유예**. 삭제된 사용자는 **과금 좌석에 포함되지 않는다.**
  - **세션 수명**: 1시간 ~ 180일, 기본 180일 `[모순: F-14-08의 90일 서술과 충돌]`.
  - **SCIM 우선 원칙**: SCIM을 쓰는 워크스페이스에서 **Notion UI로 한 변경은 다음 SCIM 동기화 때 덮어써진다.**
  - **SAML만으로는 deprovisioning이 되지 않는다** — SCIM이 필요하다. 이 둘은 별개 축이다.
  - 조직 owner는 managed user의 **외부 워크스페이스 가입 여부**, **Notion 지원팀 접근 허용 여부**, **계정 정보 자가 변경 허용 여부**까지 통제한다.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 개인 용도로 그 도메인 계정을 쓰던 사람 | 계정이 조직 통제로 넘어간다. 개인 워크스페이스는 claim 대상. **클론이 이 기능을 만들 때 가장 큰 신뢰 문제** |
  | managed user가 별칭으로 개인 이메일 추가 | 조직 정책이 기본 **Disabled**(F-14-07). 열려 있으면 개인 이메일로 로그인해 통제를 우회할 수 있으므로 정책 기본값이 Disabled인 것 |
  | SCIM deprovision + JIT 활성 | 재로그인으로 되살아날 수 있음(F-14-11 참조) `[추정]` |
  | 삭제 후 30일 내 복구 | 콘텐츠·멤버십 복원. 즉 삭제는 `status='deleted' + deleted_at`이며 **행 삭제가 아니다**(R-3) |
  | 삭제된 사용자의 private 페이지 | Enterprise의 "Transfer content from a deprovisioned user"로 다른 사용자에게 이관(R-13) |
  | SCIM 대량 변경(그룹 500명 추가) | 06 U-3이 지적한 재색인 팬아웃 문제와 직결. **배치 큐 + 레이트리밋 필수** |
  | 이메일 변경(조직이 강제) | 새 이메일도 **verified domain 소속이어야** 한다 |
  | 도메인 검증 코드 만료 | 재발급. DNS 전파 72시간 케이스를 UI가 안내해야 함 |
- **데이터 모델 함의**: `user.is_managed` + `managed_by_org_id` + `status ∈ {active, suspended, deleted}`(R-3, R-4). `organization.verified_domains[]`(06에 존재, R-6). SCIM 매핑을 위해 **`user.external_id`(IdP의 안정 식별자)와 `group.external_id`** 가 필요하다 — 06 U-3이 지적한 누락. `session_policy`(§ B). `scim_token`(06에 존재) + 감사(11 F-11-12).
- **UI/인터랙션**: 관리자 대시보드 표(사용자 / 상태 / 세션 / `•••` 액션 메뉴). 위험 액션은 이중 확인.
- **의존 기능**: F-14-11(SAML), 06 F-06-12, 06 F-06-03(그룹), 11 F-11-12(감사), 13-18(좌석 카운터), 02(워크스페이스 삭제).
- **구현 난이도**: **XL** — SCIM 2.0 서버(User/Group 리소스, PATCH 연산, 필터 문법) + 도메인 검증 + 관리 대시보드 + 워크스페이스 claim. 2주 이상.
- **우선순위**: **P2** — Enterprise 계약 없이는 불필요. 단 **`user.external_id`와 `status` enum은 P0**(나중에 추가하면 전 사용자 마이그레이션).
- **클론 시 현실적 대안**: SCIM 서버 자체 구현 대신 WorkOS Directory Sync 등에 위임. 도메인 claim(남의 계정을 흡수하는 기능)은 **클론에서 명시적 스코프 아웃**을 권고한다 — 법적·신뢰 리스크가 구현 비용보다 크다.
- **참고 출처**: https://www.notion.com/help/managed-users-dashboard , https://www.notion.com/help/provision-users-and-groups-with-scim , https://www.notion.com/help/domain-management , https://www.notion.com/help/transfer-content-deprovisioned-user

---

### F-14-13 계정 삭제와 데이터 처리 (워크스페이스 연쇄 파괴 포함)

- **한 줄 정의**: 계정을 영구 삭제하되, 그 계정이 유일한 소유자였던 워크스페이스를 함께 파괴하고, 다른 사람이 만든 콘텐츠의 작성자 참조는 보존한다.
- **사용자 시나리오**: Settings → {내 이름} → `Delete my account` → 확인. 문서가 **삭제 전 데이터 내보내기(09 F-09-14)를 권고**한다.
- **동작 상세** — 워크스페이스 처리 규칙(1차 출처 직역):
  | 계정의 워크스페이스 내 위치 | 결과 |
  |---|---|
  | 유일한 멤버였던 private 워크스페이스 | **워크스페이스 삭제** |
  | 유일한 admin이었던 공유 워크스페이스 | **워크스페이스 삭제** |
  | 멤버 중 1명 / admin이 여럿인 워크스페이스 | 해당 워크스페이스에서 **제거만** |
  - **연쇄 파괴의 범위**: "Any deleted workspaces will be deleted for everyone in them. This means all users who were part of a workspace before it was deleted will no longer have access to that workspace or any content inside that workspace." → **한 사람의 계정 삭제가 다른 사람들의 데이터를 지운다.**
  - **복구**: Notion은 DB 백업을 유지하며 **과거 30일 이내 스냅샷 복원**을 지원팀 경유로 제공한다. 즉 "영구 삭제"는 UX 표현이고 실제로는 30일 창이 있다.
  - managed user의 삭제는 별도 경로(F-14-12, 30일 유예 + 좌석 미소비).
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 삭제된 사용자가 만든 블록의 `created_by` | **tombstone user를 남긴다**(R-3). 01/11 F-11-15의 작성자 표시가 "Deleted user"로 렌더되어야 하며 FK가 깨지면 안 됨 |
  | 삭제된 사용자가 person property 값으로 들어 있는 DB 행 | 03/04의 people property는 user_id 참조 → tombstone 유지. rollup·필터가 NULL 참조로 폭발하지 않게 |
  | 삭제 시 진행 중이던 세션 | 전량 폐기(`revoked_reason='account_deleted'`) |
  | 삭제 후 같은 이메일로 재가입 | `user_email` 행이 해제되어야 재가입 가능. 30일 복구 창과 충돌 → **복구 창 동안 이메일을 예약 상태로 잠그는** 것이 안전 `[추정]` |
  | 삭제 대상이 유일 admin인 워크스페이스에 다른 멤버 100명 | 1차 출처대로면 전원 데이터 상실. 클론 권고: **삭제 전 "admin을 지정하거나 워크스페이스를 삭제하겠다"는 명시 확인 단계**를 강제 |
  | 진행 중인 결제 구독 | 13-18의 구독 해지·환불 경로와 연결 필요. 문서 미기재 `[확인필요]` |
  | GDPR 삭제 요청 | 30일 백업 창과 법적 요구가 충돌할 수 있음 `[확인필요]` |
- **데이터 모델 함의**: `user.status='deleted' + deleted_at`(**행 삭제 금지**, R-3) + `user_email` 행 해제/예약 + `credential`·`mfa_method`·`session` 즉시 파기 + 워크스페이스 그래프 순회. 삭제는 **동기 트랜잭션이 아니라 잡**이어야 한다(02의 `job` 테이블 재사용). 워크스페이스 삭제는 02가 소유(R-15).
- **UI/인터랙션**: 위험 영역(빨간 섹션), 이메일 재입력 확인, **영향받는 워크스페이스 목록을 미리 보여주기**(원본에 있는지 `[확인필요]`이나 클론에는 필수).
- **의존 기능**: F-14-08(세션 폐기), 02(워크스페이스 삭제·job), 09 F-09-14(내보내기), 11 F-11-06(보존 정책), 13-18(구독).
- **구현 난이도**: **L** — 삭제 자체는 S이나 **워크스페이스 그래프 순회 + 30일 복구 창 + tombstone 정합성**이 1~2주.
- **우선순위**: **P1** — MVP에는 없어도 되나(수동 처리), 실사용자를 받는 순간 법적 요구(GDPR 등)가 된다.
- **클론 시 현실적 대안**: v1까지는 **soft delete + 관리자 수동 처리**로 두고, 셀프서비스 삭제 버튼은 워크스페이스 소유권 이전 UI를 만든 뒤에 연다.
- **참고 출처**: https://www.notion.com/help/delete-your-account , https://www.notion.com/help/account-settings , https://www.notion.com/help/delete-a-workspace

---

### F-14-14 bot / integration user와 사람 user의 구분

> 토큰 발급·capability는 09 F-09-02가 정본. 여기서는 **user 테이블 관점의 통합 요구**만 다룬다.

- **한 줄 정의**: 통합(connection)은 워크스페이스 안에서 **bot user라는 1급 사용자**로 존재하며, 사람 user와 같은 스키마를 공유하되 person 전용 필드를 갖지 않는다.
- **사용자 시나리오**: 개발자가 Developer portal에서 connection을 만들거나 사용자가 public connection을 OAuth로 설치 → **워크스페이스에 bot user가 생성**됨 → 페이지를 그 connection에 공유하면 bot이 접근 → 페이지의 "마지막 편집자"에 봇 이름이 뜬다.
- **동작 상세**:
  - 공개 API User 객체: `object`, `id`, `type ∈ {person, bot}`, `name`, `avatar_url`.
    - `type='person'` → `person.email`, `person.email_verified` (**connection이 이메일 접근 capability를 가질 때만 노출**).
    - `type='bot'` → `bot.owner.type ∈ {workspace, user}`, `bot.workspace_name`(owner가 user면 null), `bot.workspace_id`, `bot.workspace_limits.max_file_upload_size_in_bytes`.
  - OAuth 응답에 `bot_id`, `workspace_id`, `workspace_name`, `owner`(**인가한 사용자의 user object**), `duplicated_template_id`, `access_token`, `refresh_token`이 온다.
  - **owner 축의 의미**: workspace-owned bot은 워크스페이스 전체 맥락에서 동작하고, user-owned bot은 **그 사용자만이 상호작용·공유할 수 있다**.
  - internal connection은 정적 토큰, public connection은 refresh 가능한 OAuth 토큰.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | bot에게 로그인·세션·2FA를 적용 | **불가**. `credential`/`mfa_method`/`session`은 `user.type='person'` 전용. CHECK 제약으로 강제 |
  | bot의 이메일 조회 | 없다. `person` 서브객체가 아예 없다 |
  | 사람 user 조회 시 이메일 노출 | connection capability에 종속. **권한 없는 통합에 이메일을 흘리면 개인정보 사고** |
  | bot을 소유한 사람의 계정 삭제 | user-owned bot은 함께 무효화되어야 한다 `[추정]`. workspace-owned bot은 무관 |
  | "Log out of all devices"가 봇 토큰을 끊는가 | **끊으면 안 된다**(F-14-08). 세션과 통합 토큰은 별개 수명주기 |
  | 06의 `principal_type='integration'` vs bot user | **둘 중 하나로 통일 필요**(R-12). 권한 계산 분기가 2배가 되는 것을 피해야 함 |
  | bot이 만든 블록의 `created_by` | bot user id. UI는 봇 아이콘+이름으로 렌더 |
- **데이터 모델 함의**: `user.type`(R-2) + `user.bot_integration_id`. **person 전용 자식 테이블(credential, mfa_method, user_email, session)에 bot 행이 들어오지 못하게** 하는 제약이 이 기능의 전부다. `bot.workspace_limits`는 워크스페이스 플랜에서 파생되는 계산값이지 저장 컬럼이 아니다 `[추정]`.
- **UI/인터랙션**: 멤버 목록에 별도 섹션(Connections), 멘션 자동완성에서 봇 제외 `[확인필요]`, 활동 피드에서 봇 아이콘.
- **의존 기능**: 09 F-09-02(토큰/capability), 06 F-06-13(연결 권한), F-14-01(user 테이블).
- **구현 난이도**: **S** — `type` 컬럼 + 제약. **단 나중에 추가하면 M~L**(모든 user 조회가 person을 가정하고 있으므로).
- **우선순위**: **P0**(스키마 축) / **P2**(실제 통합 기능) — 컬럼 하나를 처음에 넣는 비용이 0이고 나중 비용이 크다.
- **클론 시 현실적 대안**: 원본대로. `user.type`을 처음부터 넣고 MVP에서는 'person'만 사용.
- **참고 출처**: https://developers.notion.com/reference/user , https://developers.notion.com/docs/authorization

---

### F-14-15 프로필 · 이메일 변경 · 계정 프라이버시 설정

- **한 줄 정의**: 계정에 붙은 표시 정보(이름·사진)와 발견 가능성·조회 기록 프라이버시를 사용자가 통제한다.
- **사용자 시나리오**:
  - 프로필: Settings → {내 이름} → 사진 업로드(**데스크톱/웹 전용**), `Preferred name` 입력.
  - 이메일 변경: Account security → `Manage emails`에서 새 주소 추가·검증 → `Make primary` → 기존 주소 `Remove`. **비밀번호가 설정되어 있어야 이 경로를 쓸 수 있다**(가입 이메일 접근을 잃은 경우의 공식 복구 절차).
  - 프라이버시: Settings → Preferences → Privacy → `Show my view history`를 "Don't record"로 / 이메일이 일치하는 사람에게 프로필 노출 여부 토글.
- **동작 상세**:
  - 이메일 "변경"은 별도 기능이 아니라 **추가 + primary 승격 + 제거의 합성**이다. 이 사실이 F-14-07의 `user_email` 모델을 강제한다.
  - "가입 이메일 접근을 잃었을 때"의 공식 절차가 곧 이 흐름이다 → **비밀번호가 사실상 계정 복구 수단**으로 기능한다.
  - `Show my view history = Don't record`는 11 F-11-04(Updates & analytics)와 11 F-11-18에 직접 영향한다 — **조회 이벤트를 아예 기록하지 않는다**는 뜻이므로, 기록 후 필터가 아니라 **수집 지점에서 차단**해야 한다.
  - 프로필 발견 가능성 토글은 "내 이메일을 아는 사람에게 내 이름·사진을 보여줄지"를 제어한다 → 초대 UI의 자동완성·미리보기에 영향.
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 비밀번호 없는 계정이 가입 이메일 접근을 잃음 | **셀프서비스 복구 불가**. 지원팀 경유 `[확인필요]`. 클론: 소셜 로그인이나 passkey가 남아 있으면 그것으로 진입 후 이메일 교체 |
  | preferred_name 변경 | 워크스페이스 전역에 즉시 반영. 멘션 캐시·검색 인덱스(07)의 사용자 이름 비정규화가 있으면 재색인 팬아웃 발생 |
  | managed user | 조직이 계정 정보 변경을 잠글 수 있음(F-14-12) → 필드가 읽기 전용으로 렌더 |
  | 프로필 사진 업로드가 모바일에서 불가 | 1차 출처 명시. 클론에서는 굳이 따를 이유 없음 |
  | view history를 끈 뒤 과거 기록 | 삭제되는지 유지되는지 문서 미기재 `[확인필요]` |
  | Student 플랜 교육 이메일 제거 | 할인 상실(13-18 연결) |
- **데이터 모델 함의**: `user.name` / `user.preferred_name` / `user.avatar_url`(R-4) + `user_email`(F-14-07) + `user_setting(scope='account')`에 `show_view_history`, `discoverable_by_email` 키 등록(R-8). **11 F-11-18의 조회 기록 파이프라인이 이 설정을 수집 시점에 읽어야 한다** — 설정 조회가 이벤트 기록 hot path에 들어가므로 캐시 필요.
- **UI/인터랙션**: 아바타 클릭 업로드, 인라인 이름 편집, 이메일 표, 프라이버시 토글 2개.
- **의존 기능**: F-14-07, F-14-03(비밀번호 전제), 12(user_setting), 11 F-11-18.
- **구현 난이도**: **S** — 폼 몇 개. 단 preferred_name 변경의 비정규화 재색인이 07과 연결되면 M.
- **우선순위**: **P1** — 이름/사진은 협업 UI의 전제라 사실상 P0에 가깝고, 프라이버시 토글은 P2.
- **클론 시 현실적 대안**: 원본대로. view history 토글은 조회 기록 기능을 만들 때 같이 만든다.
- **참고 출처**: https://www.notion.com/help/account-settings , https://www.notion.com/help/cant-log-in , https://www.notion.com/help/privacy

---

### F-14-16 인증 남용 방어 (레이트리밋 · 계정 열거 방지 · 이상 로그인)

- **한 줄 정의**: 인증 표면에 대한 자동화 공격(코드 무차별 대입, 계정 열거, 크리덴셜 스터핑, 이메일 폭탄)을 제한한다.
- **사용자 시나리오**: 정상 사용자에게는 보이지 않아야 하는 기능. 이상 시 "잠시 후 다시 시도" 또는 CAPTCHA가 노출된다.
- **동작 상세**: **Notion은 이 영역을 공개하지 않는다.** 확인 가능한 신호는 두 가지뿐이다 — ① 신규 기기 로그인 알림 + "This was not me"(1차 출처), ② 로그인 실패 시 지원팀 경유 안내(cant-log-in 페이지가 구체적 실패 케이스를 전혀 설명하지 않는 것 자체가 **의도적 정보 비공개**로 읽힌다 `[추정]`).
  아래는 전부 **클론의 설계 결정**이며 원본 동작이 아니다:
  | 방어 | 클론 규칙 |
  |---|---|
  | 코드 요청 | 이메일당 5분에 3회, IP당 15분에 10회 |
  | 코드 검증 | challenge당 5회 실패 시 폐기 |
  | 비밀번호 검증 | 계정당 지수 백오프(1s→2s→4s…), IP당 상한. **계정 잠금은 하지 않는다**(타인이 남의 계정을 잠그는 DoS) |
  | 계정 열거 | `/auth/identify`와 `/auth/reset` 응답을 **존재 여부와 무관하게 동일**하게. 응답 시간도 상수화 |
  | 이메일 폭탄 | 이메일당 발송 상한이 IP 상한보다 우선 |
  | 크리덴셜 스터핑 | 신규 IP·ASN에서의 다수 계정 로그인 시도 감지 → CAPTCHA 승급 |
  | 이상 로그인 | 신규 기기/국가 → 알림 메일 + `This was not me` 링크(그 링크는 **전 세션 폐기 + 비밀번호 잠금**) |
- **엣지 케이스**:
  | 상황 | 처리 |
  |---|---|
  | 회사 NAT 뒤 100명이 동시 로그인 | IP 단위 상한만 쓰면 정상 사용자가 차단된다. **이메일 단위 상한을 1차 방어로** |
  | CAPTCHA 도입 | 13(공개 폼)의 남용 대응(비평 A-6)과 **같은 인프라를 공유**해야 한다 |
  | 레이트리밋 저장소 장애 | fail-open(로그인 허용) vs fail-closed(전면 차단). **로그인은 fail-open + 알림**이 실용적 `[클론 결정]` |
  | 백업 코드 무차별 대입 | 6개뿐이므로 반드시 강한 상한 필요. 계정당 10회 실패 시 백업 코드 경로 잠금 |
- **데이터 모델 함의**: `auth_event`(§ B, R-10) + 레이트리밋 카운터(Redis, DB 아님). `otp_challenge.attempts`. `session.revoked_reason`에 `'user_reported'` 추가.
- **UI/인터랙션**: 실패 메시지를 **구체적으로 쓰지 않는다**("이메일 또는 코드가 올바르지 않습니다"). 재시도 카운트다운.
- **의존 기능**: F-14-02, F-14-03, F-14-05, F-14-08, 11 F-11-11(알림 메일).
- **구현 난이도**: **M** — 규칙 자체는 단순하나 정상 트래픽 오탐 튜닝이 시간을 먹는다.
- **우선순위**: **P0** — 인증 표면을 공개하는 순간 필요하다. **레이트리밋 없는 OTP 로그인은 사실상 인증이 없는 것**과 같다.
- **클론 시 현실적 대안**: 애플리케이션 레벨 자체 구현 대신 Cloudflare Turnstile + WAF 레이트리밋 규칙으로 상당 부분 위임 가능.
- **참고 출처**: https://www.notion.com/help/log-in-and-out , https://www.notion.com/help/cant-log-in , https://www.notion.com/help/security-and-privacy

---

## 구현 우선순위 요약표

| F-ID | 기능 | 난이도 | 우선순위 | MVP 절단 시 대체 |
|---|---|---|---|---|
| F-14-01 | 계정 생성 (이메일 / 소셜 3종) | M | **P0** (소셜은 P1) | 이메일 경로만 |
| F-14-02 | 이메일 로그인 코드(OTP) | S | **P0** | — (MVP의 유일 인증) |
| F-14-03 | 비밀번호 설정·변경·제거·재설정 | S | P1 | 없이 시작 가능 |
| F-14-04 | Passkey (WebAuthn) | M | P2 | `credential` 다형 스키마만 선반영(P0) |
| F-14-05 | 2단계 인증 (TOTP/SMS/백업코드) | M | P1 | TOTP만, SMS 생략 |
| F-14-06 | 소셜 로그인 결합 규칙 | M | P1 | Google 1종 먼저 |
| F-14-07 | 이메일 5개 · 별칭 해석 | M | P1 (**스키마는 P0**) | `user_email` 테이블만 만들고 행 1개 |
| F-14-08 | 세션 · 디바이스 · 전체 로그아웃 | M | P1 (**세션 테이블은 P0**) | 단일 로그아웃 버튼 |
| F-14-09 | 다중 계정 전환 | M | P2 (**워크스페이스 전환은 P0**) | 단일 계정 + 스토어만 계정키로 |
| F-14-10 | 워크스페이스 초대 · 자동 가입 | L | **P0** | 이메일 초대 1종만 |
| F-14-11 | SAML SSO 강제와 예외 | L | P2 (**`auth_method` 컬럼은 P0**) | SSO 브로커 위임 |
| F-14-12 | SCIM · managed user | XL | P2 (**`external_id`·`status`는 P0**) | WorkOS 위임 / claim 기능 스코프 아웃 |
| F-14-13 | 계정 삭제와 데이터 처리 | L | P1 | soft delete + 관리자 수동 |
| F-14-14 | bot user vs person user | S | **P0**(스키마) / P2(기능) | `user.type` 컬럼만 |
| F-14-15 | 프로필 · 이메일 변경 · 프라이버시 | S | P1 | 이름·사진만 |
| F-14-16 | 인증 남용 방어 | M | **P0** | Cloudflare Turnstile + WAF |

### MVP 최소 절단선

**만드는 것**: `user` + `user_email` + `session` + `otp_challenge` 4개 테이블. 이메일 코드 로그인, 로그아웃, 이메일 초대 수락, 워크스페이스 전환, 레이트리밋.

**만들지 않되 스키마에 자리를 남기는 것**(전부 비용 ≈ 0, 나중 추가 비용 大):
1. `user.type ENUM('person','bot')` — R-2
2. `user.status ENUM('active','suspended','deleted')` + soft delete — R-3
3. `user_email` 별도 테이블(행이 1개뿐이라도) — R-1, R-16
4. `credential` 다형 테이블(password/passkey/oauth) — `user.password_hash` 금지
5. `session.auth_method`, `session.mfa_satisfied` — R-11
6. `workspace_member.status`, `join_method` — R-5
7. `user.external_id` — R-12(SCIM)

**이 7개를 나중에 추가하면 각각 전체 마이그레이션 + 전 코드 경로 수정이 된다.** 이것이 이 문서가 SYNTHESIS 단계에 넘기는 핵심 페이로드다.

---

## 오픈소스 클론 구현 참고

| 프로젝트 | 인증 방식 | 이 도메인에 주는 교훈 |
|---|---|---|
| **AppFlowy** | GoTrue(Supabase Auth 포크) + JWT | 인증을 **완제품 서비스에 위임**하고 앱은 `user_id`만 신뢰. 클론이 가장 빨리 P0를 통과하는 경로. 단 GoTrue는 "계정당 이메일 5개"·"세션 원격 폐기 UI" 같은 이 도메인 고유 요구를 기본 제공하지 않으므로 그 부분은 자체 테이블이 필요하다 |
| **Docmost** | 내장 email + password. SSO(SAML/OIDC)는 엔터프라이즈 기능으로 분리 | **"IdP 없이도 첫 사용자가 즉시 시작 가능"**을 설계 원칙으로 삼음. Notion의 "비밀번호는 옵션"과 정반대이지만, 셀프호스팅 클론에는 이쪽이 현실적. SSO를 유료 경계로 두는 판단은 F-14-11의 우선순위(P2)와 일치 |
| **Outline** | 자체 비밀번호 저장 없이 OAuth/OIDC 제공자에 전면 위임 | 자격증명을 아예 갖지 않으면 F-14-03·F-14-05·F-14-16의 상당 부분이 사라진다. **인증을 만들지 않는 것이 가장 싼 구현**이라는 선택지 |
| 공통 | — | 세 프로젝트 모두 **계정당 다중 이메일 별칭**과 **세션 원격 폐기 목록 UI**를 제공하지 않는다. 이 두 가지가 Notion 계정 모델의 차별점이자 클론이 직접 만들어야 하는 부분이다 |

**권고 스택**: 인증 프리미티브(OTP 메일, OAuth 콜백, WebAuthn)는 라이브러리/서비스에 위임하고, **`user_email` · `session` · `workspace_member` 3개 테이블만 자체 소유**한다. 이 3개가 이 도메인이 다른 12개 문서와 만나는 전부다.

---

## 미해결 / 확인필요

| # | 항목 | 왜 중요한가 | 해소 방법 |
|---|---|---|---|
| 1 | `[모순]` **계정당 이메일 총 개수 5 vs 6** — account-settings는 "up to 5 email addresses per account", secondary-emails는 "up to 5 **secondary** emails per account" | `MAX_EMAILS_PER_ACCOUNT` 상수와 UI 상한. 1 차이지만 검증 로직에 박히면 되돌리기 번거로움 | 실제 계정에서 6번째 주소 추가 시도 |
| 2 | `[모순]` **세션 정책 범위** — 90일(기본 90일, 1시간~90일) vs 180일(managed users: 1시간~180일, 기본 180일) vs "Login tokens expire after 90 days" | Enterprise 계약 문구와 `session_policy.max_lifetime` 검증 범위 | Enterprise 워크스페이스 설정 화면 실측 |
| 3 | 로그인 코드 **TTL·시도 상한·발송 레이트리밋** 전부 미공개 | F-14-02/F-14-16의 핵심 상수. 클론 자체 결정으로 확정 선언하는 편이 나음 | 실측(코드 발급 후 시간 경과 테스트) 또는 클론 상수로 확정 |
| 4 | **비밀번호 변경·2FA 수단 삭제 시 다른 세션이 폐기되는가** | 탈취 세션 잔존 여부. 보안 설계의 기본이나 문서 미기재 | 두 기기 로그인 → 한쪽에서 비밀번호 변경 → 다른 쪽 동작 관찰 |
| 5 | **Passkey 로그인 시 2FA를 다시 묻는가** | `session.mfa_satisfied` 결정 규칙 | 2FA 활성 계정에 passkey 등록 후 로그인 |
| 6 | **SSO 강제 시 기존 비밀번호/2FA/passkey가 삭제되는가 잠기는가** | enforce 해제 시 복구 가능성. 삭제라면 되돌릴 수 없는 파괴적 동작 | Business 워크스페이스에서 enforce 토글 실험 |
| 7 | **도메인 검증이 기존 개인 계정에 소급 적용되는가** | F-14-12의 신뢰 문제 전체. "created with the verified domain"이 시점 기준인지 상태 기준인지 | 검증 전에 만든 계정이 managed users 목록에 나타나는지 확인 |
| 8 | **SCIM deprovision + SAML JIT을 함께 켜면 사용자가 되살아나는가** | 디프로비저닝이 무력화되면 컴플라이언스 실패 | IdP에서 사용자 비활성화 후 SAML 로그인 시도 |
| 9 | **2FA 백업 코드 소진 + 기기 분실 시 셀프서비스 복구 경로** | 문서에 없음. 없다면 지원팀이 유일 경로이며 클론은 관리자 강제 해제를 반드시 구현해야 함 | 지원 문서·커뮤니티 확인 |
| 10 | **이메일 별칭 정책을 Enabled → Disabled로 바꾸면 기존 별칭이 삭제되는가** | managed user의 개인 이메일 우회 차단 실효성 | Enterprise 설정 실측 |
| 11 | **user-owned bot의 소유자 계정이 삭제될 때** bot과 그 토큰의 처리 | 09 F-09-02의 토큰 수명주기와 F-14-13의 접점. 문서 미기재 | API 실측 |
| 12 | `[정본 결정 필요]` **06의 `acl_entry.principal_type='integration'` vs `user(type='bot')`** — 통합을 principal로 표현하는 방식이 2가지 | 권한 계산 분기 2배. R-12 | 문서 간 결정(외부 검증 불가) |
| 13 | `[정본 결정 필요]` **02의 role 4값 vs 06의 5값 + status/is_temporary** — 이 문서는 06 채택을 요구 | R-5. 좌석 과금(13-18)이 여기 걸림 | 문서 간 결정 |
| 14 | **워크스페이스 최대 개수 / 계정당 워크스페이스 상한** | 스위처 UI와 `GET /me/workspaces` 페이지네이션 필요 여부 | 1차 출처에 없음. 실측 |
| 15 | **딥링크를 여러 계정이 접근 가능할 때의 계정 선택 UX** | F-14-09. 다중 계정의 실사용 마찰 지점 | 실측 |

---

## 출처

**1차 출처 (Notion 공식 헬프센터 / API 레퍼런스)**

1. https://www.notion.com/help/log-in-and-out — 로그인 방법 7종, 신규 로그인 알림, "Log out of all devices"(현재 세션 유지), Apple Share/Hide My Email, 개별 세션 로그아웃
2. https://www.notion.com/help/account-settings — 비밀번호 정책(8자·고유 4자·8~14자 문자+숫자·15자 이상 해제), 계정당 이메일 최대 5개, 이메일 추가/primary/remove, 계정 삭제 진입점, 30일 백업 복원, view history·프로필 발견 가능성 프라이버시 토글
3. https://www.notion.com/help/secondary-emails — secondary email 최대 5개, 검증 절차, "log in, receive shares, and be mentioned", 계정 알림은 primary로, 이메일-계정 전역 1:1, 관리자 정책 3값(Disabled / Only verified domains / Enabled), SSO에서 별칭 사용
4. https://www.notion.com/help/passkeys — 최대 5개, synced vs device-bound, "with or without a password", IdP 강제 조직에서 사용 불가, 강제 정책 부재, 분실 시 대체 경로
5. https://www.notion.com/help/two-step-verification — 비밀번호 전제, 인증앱/SMS, 최대 4개(2+2), 백업코드 6개 1회용·소진 후 재발급, SSO 사용자 제외, Enterprise는 **게스트에게만** MFA 강제 가능
6. https://www.notion.com/help/delete-your-account — 계정 삭제 시 워크스페이스 처리 3규칙, 연쇄 삭제의 전체 영향, 내보내기 권고
7. https://www.notion.com/help/create-delete-and-switch-workspaces — 워크스페이스 생성·가입(초대/자동가입)·나가기, 계정 전환기(`Add another account`), `Ctrl+Shift+숫자`, "Login tokens expire after 90 days"
8. https://www.notion.com/help/add-members-admins-guests-and-groups — 이메일 초대 + 역할 선택 3종, 비밀 초대 링크, 게스트 vs 멤버, 게스트 한도 초과 시 도메인 기반 멤버 강제, 게스트→멤버 배치 승격, 제거 후 30일 복원, temporary member 1년
9. https://www.notion.com/help/managed-users-dashboard — managed user 정의(verified domain), 이름·이메일 변경, 강제 비밀번호 재설정, 개별/전체 로그아웃, 세션 1시간~180일(기본 180일), suspend(과금 유지·로그인 불가) vs delete(30일 복구·좌석 미소비), 외부 워크스페이스 통제
10. https://www.notion.com/help/domain-management — verified domain DNS TXT 검증, 코드 1주 만료, 전파 최대 72시간, 검증 14일 후 워크스페이스 claim, 다중 도메인
11. https://www.notion.com/help/saml-sso-configuration — Business/Enterprise + verified domain 요구, Enforce 시 전원 재로그인, **owner의 email/password 백도어**, **게스트는 SAML 불가**, JIT(automatic account creation), Enterprise workspace-level authorization
12. https://www.notion.com/help/provision-users-and-groups-with-scim — Enterprise 전용, org owner만 토큰 발급, SAML만으로는 deprovisioning 불가, SCIM이 UI 변경을 덮어씀
13. https://developers.notion.com/reference/user — User 객체 `type ∈ {person, bot}`, `person.email` / `person.email_verified`(capability 종속), `bot.owner.type ∈ {workspace, user}`, `bot.workspace_limits`
14. https://developers.notion.com/docs/authorization — internal vs public connection, **인가 시 bot user 생성**, OAuth 토큰 응답 필드(`bot_id`, `workspace_id`, `owner`, `duplicated_template_id`, `refresh_token`), user-owned bot의 접근 제한
15. https://www.notion.com/help/security-and-privacy — 세션 원격 종료, 신규 로그인 알림 위치는 IP 기반 추정치, 전송/저장 암호화
16. https://www.notion.com/help/cant-log-in — 비밀번호 재설정 절차, **가입 이메일 접근 상실 시 복구 = 비밀번호 보유 전제로 이메일 교체**, 구체적 실패 케이스 미공개
17. https://www.notion.com/help/workspace-settings — Trusted domain access / Allowed email domains / Verified domains 설정 위치
18. https://www.notion.com/help/transfer-content-deprovisioned-user — 퇴사자 private 콘텐츠 이관(Enterprise)
19. https://developers.notion.com/guides/get-started/personal-access-tokens — PAT 만료 옵션(7/30/90/180일·1년, 기본 1년) — 세션과 토큰 수명주기가 별개임을 보여주는 근거

**2차 출처 (오픈소스 클론 구현 참고)**

20. https://docmost.com/blog/appflowy-alternatives/ , https://docmost.com/blog/open-source-notion-alternatives/ — Docmost 내장 email+password / SSO 엔터프라이즈 분리, AppFlowy의 GoTrue(JWT) 위임, Outline의 IdP 전면 위임

**내부 참조 문서** (재서술하지 않고 F-ID로 참조): 02 F-02-12(권한 저장), 06 F-06-02(역할·좌석), 06 F-06-03(그룹), 06 F-06-11(보안 정책), 06 F-06-12(SAML/SCIM 존재), 06 F-06-13(연결 권한), 09 F-09-02(토큰·capability), 09 F-09-14(내보내기), 11 F-11-06(보존 정책), 11 F-11-11(알림 팬아웃), 11 F-11-12(감사 로그), 11 F-11-15(created_by), 11 F-11-18(조회 기록 프라이버시), 12 F-12-04(오프라인), 13 F-13-18(엔타이틀먼트·좌석)
