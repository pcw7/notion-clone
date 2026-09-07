# [DIGEST] 14. 계정 · 인증 · 세션

> 원본: `docs/research/14-auth-accounts.md` (864줄, 101KB) / 원본 `### F-` 개수 = **16** / 아래 인벤토리 행 수 = **16** (일치 검증됨)
> 태그: `[추정]` 공개문서 미확인 추론 · `[확인필요]` 실측 필요 · `[모순]` 1차 출처 충돌

## 0. 도메인 한 줄 요약
Notion의 정체성 단위는 `user`이고 **이메일은 user에 1:N으로 붙는 별개 레코드**다. **비밀번호가 없는 계정이 정상 상태**이며(기본 로그인 = 이메일 OTP), 자격증명(password/passkey/oauth)은 서로 독립 병존한다. 세션은 **폐기 가능한 서버측 레코드**여야 한다(순수 JWT 만료 의존 불가).

---

## 1. 기능 인벤토리 (전수 16개)

| F-ID | 기능명 | 난이도 | 우선순위 | 의존 |
|---|---|---|---|---|
| F-14-01 | 계정 생성 (이메일 · Google · Apple · Microsoft) | M | **P0** (소셜은 P1) | 도메인 루트, 실질적으로 F-14-02 |
| F-14-02 | 이메일 로그인 코드(OTP) 발급·검증 | S | **P0** | F-14-01, 트랜잭션 메일 인프라(11 F-11-11, 큐 분리 필수) |
| F-14-03 | 비밀번호 설정·변경·**제거**·재설정 | S | P1 | F-14-01, F-14-02, F-14-08(세션 폐기) |
| F-14-04 | Passkey (WebAuthn) 등록·로그인·삭제 | M | P2 (**credential 다형 스키마는 P0**) | F-14-01, HTTPS, rp_id 확정 |
| F-14-05 | 2단계 인증 (TOTP · SMS · 백업코드) | M | P1 | **F-14-03(비밀번호 필수 전제)**, F-14-02, F-14-08 |
| F-14-06 | 소셜 로그인 결합·계정 병합 규칙 | M | P1 | F-14-01, F-14-07 |
| F-14-07 | 계정당 이메일 최대 5개 (별칭 로그인·공유·멘션) | M | P1 (**스키마는 P0**) | F-14-01, F-14-02 / 06 F-06-06·11 F-11-08이 역의존 |
| F-14-08 | 세션·디바이스 관리·전체 로그아웃·신규 로그인 알림 | M | P1 (**세션 테이블은 P0**) | F-14-01~06, 12 F-12-04, 11 F-11-11, 05 connection |
| F-14-09 | 다중 계정 전환 + 워크스페이스 전환 | M | P2 (**워크스페이스 전환은 P0**) | F-14-08, 02, 12 F-12-04 |
| F-14-10 | 워크스페이스 초대·수락·자동 가입 (4개 진입 경로) | **L** | **P0** (MVP는 이메일 초대만) | F-14-01, F-14-07, 06 F-06-02, 13-18 F-13-18, 02 |
| F-14-11 | SAML SSO 강제와 예외 (게스트·owner 백도어) | **L** | P2 (**session.auth_method는 P0**) | 06 F-06-12, F-14-08, F-14-12, F-14-10 |
| F-14-12 | SCIM 프로비저닝 · managed user | **XL** | P2 (**external_id·status는 P0**) | F-14-11, 06 F-06-12/F-06-03, 11 F-11-12, 13-18, 02 |
| F-14-13 | 계정 삭제와 데이터 처리 (워크스페이스 연쇄 파괴) | **L** | P1 | F-14-08, 02(ws 삭제·job), 09 F-09-14, 11 F-11-06, 13-18 |
| F-14-14 | bot / integration user와 person user의 구분 | S | **P0**(스키마) / P2(기능) | 09 F-09-02, 06 F-06-13, F-14-01 |
| F-14-15 | 프로필 · 이메일 변경 · 계정 프라이버시 설정 | S | P1 | F-14-07, F-14-03, 12(user_setting), 11 F-11-18 |
| F-14-16 | 인증 남용 방어 (레이트리밋·계정 열거 방지·이상 로그인) | M | **P0** | F-14-02/03/05/08, 11 F-11-11 |

---

## 2. 데이터 모델 (이 도메인이 **요구**하는 것 — 스키마 정본은 00번 문서)

### 2-A. 기존 엔티티 변경 요구 (원본 R-1~R-16 압축)

| R# | 대상 | 요구 | 미이행 시 깨지는 것 |
|---|---|---|---|
| R-1/16 | `user`(06) | `email` 컬럼 **폐기** → `user_email` 자식 테이블, user는 `primary_email_id`만. email은 **전역 UNIQUE**(02의 ws 비정규화 예외) | 별칭 로그인/공유/멘션 불가, 미가입자 초대 표현 불가 |
| R-2 | `user` | `type ENUM('person','bot')` + `bot_integration_id` | bot의 `created_by` 조회가 person 가정으로 깨짐 |
| R-3 | `user` | `status ENUM('active','suspended','deleted')` + `deleted_at`, **하드 삭제 금지(tombstone)** | 01/05/11의 created_by·editor_ids dangling. suspend(로그인 불가+콘텐츠 보임) 표현 불가 |
| R-4 | `user` | `preferred_name`을 `name`과 분리, `is_managed`+`managed_by_org_id` | F-14-12(조직 잠금) vs F-14-15(자가 변경) 컬럼 경합 |
| R-5 | `workspace_member` | **06 role 5값 채택**(02의 4값 폐기) + `status ∈ {active,invited,suspended}` + `is_temporary`/`expires_at` + `invited_by`, `invite_accepted_at`, `join_method ENUM('invite_email','invite_link','allowed_domain','saml_jit','scim')` | 초대 즉시 과금. 유입 경로 감사 불가 |
| R-6 | `workspace`/`organization` | `allowed_email_domains[]`(자기신고→자동가입 트리거)와 `verified_domains[]`(DNS검증→managed user·SAML·claim 전제)를 **별개 축 유지** | 합치면 자동가입이 Enterprise 전용화 or 계정 소유권이 Free에서 발동 |
| R-7 | `workspace_invite` | `kind ENUM('email','link')`(암묵규약을 CHECK로) + `accepted_by_user_id`, `accepted_at`, `revoked_at`, `created_by`, `max_uses` | 링크 초대의 좌석 증가 원인 추적 불가 |
| R-8 | `user_setting`(12) | account scope 키 등록: `show_view_history`, `discoverable_by_email` + user 삭제 시 캐스케이드 | 12에 설정 항목 레지스트리 부재. 조회기록 프라이버시 저장 위치 미정 |
| R-9 | `notification`(11 F-11-11) | 이메일 채널이 `user_email WHERE is_primary` 참조. primary 변경 시 대기 알림의 주소 결정 시점 규칙 필요 | "계정 알림은 primary로만" 계약 위반 |
| R-10 | `audit_log`(11 F-11-12) | `actor_user_id NULL 허용` + `ip`·`user_agent`·`auth_method` 필수화 | 세션 없는 인증 실패를 기록 불가 → 사고 조사 불가 |
| R-11 | `effective(user,node)`(06) | 입력에 **세션 컨텍스트**(`workspace_id`,`auth_method`,`mfa_satisfied`,`session_id`) 추가 | `require_sso`가 실행 지점 없음(UI 장식화) |
| R-12 | `integration`(06 F-06-13/09 F-09-02) | 통합 생성 시 `user(type='bot')` 동반 생성. `principal_type='integration'` vs bot user **택일** | 3중 표현 → 권한 계산 분기 2배 |
| R-13 | `page_owner`(02) | 삭제·deprovision 시 private 페이지 **타인 이관** 경로 | 퇴사자 private 페이지 영구 고아화 |
| R-14 | `seat_count`(13-18) | 좌석 = `status='active'`만. invited/guest/is_temporary/deleted(유예중)는 **미소비** | 과금 오류. 06(서술)과 13-18(`subscription.seats` 단일 컬럼)의 연결 지점 |
| R-15 | `workspace` 삭제(02) | 삭제 트리거에 **"단독 admin의 계정 삭제"** 추가 | admin 없는 좀비 ws 잔존 |

### 2-B. 이 도메인이 **새로 소유**하는 엔티티

| 엔티티 | 핵심 필드 | 불변식 / 주의 |
|---|---|---|
| `user_email` | user_id, email(citext), verified_at, is_primary, added_at | 전역 UNIQUE(email) / user당 is_primary 정확히 1 / primary는 verified 필수 / user당 ≤5. `verified_at IS NULL`은 로그인·공유·멘션·자동가입 어디에도 미사용 |
| `credential` | user_id, `kind ∈ {password, passkey, oauth}`, password_hash(argon2id) \| (cred_id **전역UNIQUE**, public_key, sign_count, aaguid, transports[], backup_eligible) \| (provider, provider_sub UNIQUE, is_private_relay), label, last_used_at | password ≤1/user, passkey ≤5/user. **`user.password_hash` 컬럼 금지**(제거가 NULL로 표현되어 코드 경로 분기). oauth 매칭 키는 **provider_sub**이지 email이 아님 |
| `mfa_method` | user_id, `kind ∈ {totp,sms}`, label, totp_secret(**KMS 봉인 암호화**), phone_e164, confirmed_at, last_used_at | totp ≤2 AND sms ≤2(합 4). confirmed_at 있는 행 ≥1이어야 mfa_enabled |
| `mfa_backup_code` | user_id, code_hash(평문 금지), used_at, batch_id | 6개 1회용. 재발급 시 이전 batch 전량 무효. 미사용 0이면 재발급 UI 강제 |
| `otp_challenge` | `purpose ∈ {login, email_verify, password_reset, mfa_sms}`, email, user_id, code_hash, expires_at, attempts, consumed_at, request_ip/ua | 검증 시 **purpose를 WHERE에 필수 포함**(교차 사용은 전형적 취약점). consumed_at 원자적 갱신 |
| `session` | user_id, token_hash UNIQUE, `auth_method ∈ {login_code,password,passkey,google,apple,microsoft,saml}`, `mfa_satisfied`, device_label/kind, ip, approx_location, created_at, last_seen_at, expires_at, revoked_at, `revoked_reason ∈ {user_logout, logout_all, admin_force, password_change, policy_change, account_deleted, user_reported}` | 유효 = revoked_at IS NULL AND expires_at>now. **순수 JWT 만료 의존 금지**. 폐기 = 캐시 즉시 삭제 → DB 갱신 순서 |
| `session_policy` | workspace_id PK, max_lifetime interval, updated_by/at | Enterprise 전용 |
| `auth_event` | at, email, user_id, kind(code_requested/code_failed/login_ok/login_failed/mfa_failed/passkey_added/…), ip, user_agent, meta | 11 audit_log와 **별개**(세션 없는 시도까지 수집하는 저수준 로그) |

**제약**: `credential` / `mfa_method` / `user_email` / `session`은 `user.type='person'` 전용 — bot 행 유입을 CHECK로 차단.

### 2-C. 클론 상수 (한 곳에서만 읽는다)
`MIN_PASSWORD_LEN=8` · `MIN_UNIQUE_CHARS=4` · 8~14자는 문자1+숫자1 필수, **15자 이상은 요구 해제**(NIST 800-63B 방향) · `MAX_EMAILS_PER_ACCOUNT=5` `[모순]` · `MAX_PASSKEYS=5` · `MAX_MFA_METHODS=4(TOTP2+SMS2)` · `BACKUP_CODE_COUNT=6(1회용)` · `LOGIN_CODE_TTL=10분` `[추정]` · `LOGIN_CODE_MAX_ATTEMPTS=5` `[추정]` · `SESSION_MAX_LIFETIME_DEFAULT=90일`(정책 범위 1h~90d vs 1h~180d `[모순]`) · `DELETED_USER_GRACE_DAYS=30` · `REJOIN_PRIVATE_PAGE_RESTORE_DAYS=30` · `TEMP_MEMBER_MAX=1년`

### 2-D. 로그인 상태 머신 (한 줄 압축)
`[익명] → POST /auth/identify{email}(응답 형태 항상 동일, 열거 방지) → [식별됨: 사용 가능 방법 목록만 반환] → 1차 인증(OTP | password | passkey | oauth | SAML) → mfa_method 활성 시 [MFA 대기] → [세션 생성] → 접근 가능 워크스페이스 계산(workspace_member + allowed_email_domains 매칭) → {0개: 온보딩 | 기존 멤버십: 마지막 ws | 자동가입 후보: Join 옵션}`
권고: passkey(user-verified) 성공 시 `mfa_satisfied=true`로 두고 2FA 재요구 안 함 `[확인필요]`.

---

## 3. MVP 판단

### 없으면 제품이 성립 안 함
| 항목 | 근거 |
|---|---|
| F-14-02 OTP 로그인 | MVP의 **유일 인증 경로**. Notion 자체가 이것을 기본값으로 둠 |
| F-14-01 계정 생성(이메일) | 도메인 루트. 가입 트랜잭션이 credential 0개를 만드는 것이 정상 |
| F-14-10 이메일 초대 1종 | 협업 제품의 정의. 멤버십 없이는 02/06이 무의미 |
| F-14-16 레이트리밋 | **레이트리밋 없는 OTP 로그인 = 인증이 없는 것** |
| F-14-09 중 워크스페이스 전환 | 계정이 다수 ws에 소속되는 것이 전제 |
| 테이블 4개: `user`+`user_email`+`session`+`otp_challenge` | 06/09/11/12/13-18 전부가 이 위에 서 있음 |

### 빼도 되는 것 / 대체안
| 뺄 것 | 이유 | 대체안 |
|---|---|---|
| F-14-03 비밀번호 | OTP로 대체 가능(원본도 옵트인) | 없이 시작. 2FA와 SSO owner 백도어가 요구하므로 v1에 추가 |
| F-14-04 Passkey | 편의 수단, 유일 열쇠가 될 수 없음 | `credential` 다형 스키마만 선반영 → 나중 추가가 S. SimpleWebAuthn |
| F-14-05 2FA | 팀/기업 계약 시점 요구 | TOTP만. SMS 생략(비용·국제 실패율·SIM 스와핑). **백업코드는 필수 동반** |
| F-14-06 소셜 | 가입 전환율 이슈일 뿐 | Google 1종부터. Apple은 iOS 앱 심사 시점에 |
| F-14-07 별칭 UI | 행 1개만 써도 동작 | **테이블 분리는 처음부터**(나중엔 전 코드 `user.email` 제거 = L~XL). **이 문서 최중요 단일 권고** |
| F-14-08 세션 UI | 로그아웃 버튼 1개면 성립 | **세션을 서버 레코드로 두는 결정은 P0**(무상태 JWT에서 옮기면 전면 재작업) |
| F-14-09 다중 계정 | 단일 계정으로 충분 | 클라이언트 스토어를 `accountId` 키로 감싸두기(지금 비용≈0, 나중엔 L) |
| F-14-11/12 SSO·SCIM | Enterprise 계약 전 불필요 | WorkOS/Keycloak 위임(L→M). **도메인 claim은 명시적 스코프 아웃**(법적·신뢰 리스크 > 구현 비용) |
| F-14-13 셀프 삭제 | 수동 처리 가능 | soft delete + 관리자 수동. ws 소유권 이전 UI 완성 후 개방 |

### **"만들지 않되 스키마 자리는 남기는" 7개 — SYNTHESIS에 넘기는 핵심 페이로드**
1. `user.type ENUM('person','bot')`(R-2) 2. `user.status`+soft delete(R-3) 3. `user_email` 별도 테이블(R-1/16) 4. `credential` 다형 테이블 — **`user.password_hash` 금지** 5. `session.auth_method`·`mfa_satisfied`(R-11) 6. `workspace_member.status`·`join_method`(R-5) 7. `user.external_id`(R-12)
→ 지금 넣는 비용 ≈ 0, 나중 추가 시 각각 **전체 마이그레이션 + 전 코드 경로 수정**.

---

## 4. 기술 난제(L/XL)와 권장 접근

| F-ID | 난이도 | 왜 어려운가 | 권장 접근 |
|---|---|---|---|
| F-14-10 초대·자동가입 | L | 경로 4개 × (좌석·역할·teamspace 기본가입·감사) 조합. 실패가 **과금·보안 사고 직결**. 미검증 이메일 자동가입 = 조직 침입 경로 | MVP는 이메일 초대 + 1회용 토큰만. **좌석 강제 지점 = 수락 트랜잭션**. 자동가입 전제 = `verified_at IS NOT NULL`. **공용 도메인 블랙리스트 필수**. 초대 해석은 user_id 아닌 **email 기준**(나중 별칭 검증 시 그 계정이 승계) |
| F-14-11 SAML 강제 | L | 프로토콜은 M. 비용은 **예외 2종(owner 백도어·게스트 제외) + 다중 ws 게이팅 + 다른 인증수단(2FA·passkey) 잠금**의 상호작용 | 강제는 세션 생성이 아니라 **ws 진입 시 판정**: `can_enter(session,ws) = !ws.sso_enforced OR auth_method='saml' OR role ∈ {owner,guest}`. 기존 credential은 **삭제 말고 잠금**. WorkOS/Auth0/Keycloak 위임 시 L→M |
| F-14-12 SCIM·managed user | XL | SCIM 2.0 서버(User/Group, PATCH 연산, 필터 문법) + DNS TXT 검증(코드 1주 만료·전파 72h·검증 14일 후 claim) + 대시보드 + suspend/delete 2상태. 500명 그룹 변경 시 재색인 팬아웃(06 U-3) | WorkOS Directory Sync 위임. `user.external_id`·`group.external_id` 선반영. **ws claim 스코프 아웃**. 배치 큐 + 레이트리밋. "SCIM이 UI 변경을 덮어씀" 우선순위 규칙 명시 |
| F-14-13 계정 삭제 | L | 삭제 자체는 S. 비용은 **ws 그래프 순회**(단독 멤버 private ws·단독 admin 공유 ws는 연쇄 삭제 → **타인 데이터까지 소실**) + 30일 복구창 + tombstone 정합성 | 동기 트랜잭션 아닌 **잡**(02 `job` 재사용). 삭제 전 **영향 ws 목록 명시 확인** 강제. 복구창 동안 이메일 **예약 잠금** `[추정]`. credential/mfa/session 즉시 파기, user는 tombstone |

### 오픈소스 참고
| 프로젝트 | 방식 | 교훈 |
|---|---|---|
| AppFlowy | GoTrue(Supabase Auth) + JWT 위임 | P0를 가장 빨리 통과. 단 다중 이메일·세션 원격 폐기 UI 미제공 → 자체 테이블 필요 |
| Docmost | 내장 email+password, SSO는 엔터프라이즈 분리 | "IdP 없이 첫 사용자 즉시 시작" 원칙. 셀프호스팅 클론에 현실적. SSO 유료 경계 판단 = F-14-11 P2와 일치 |
| Outline | 자격증명 미보유, OIDC 전면 위임 | **인증을 만들지 않는 것이 가장 싼 구현**(F-14-03/05/16 상당 부분 소멸) |
| 공통 | — | 셋 다 **다중 이메일 별칭**·**세션 원격 폐기 UI** 없음 = 클론이 직접 만들 차별점 |

**권고 스택**: 인증 프리미티브(OTP 메일·OAuth 콜백·WebAuthn)는 라이브러리/서비스 위임, **`user_email`·`session`·`workspace_member` 3개만 자체 소유** — 이 3개가 다른 12개 문서와 만나는 전부. 남용 방어는 Cloudflare Turnstile + WAF 위임.

---

## 5. 다른 도메인과의 접점

| 도메인 | 접점 |
|---|---|
| **00 정본** | R-1~R-15 전체가 입력. 특히 `user.email` 폐기, role 정본(02 4값 vs **06 5값 채택 요구**), principal 표현 통일 |
| **01 블록** | `created_by`/`last_edited_by`가 tombstone user("Deleted user")와 bot user(봇 아이콘)를 렌더 가능해야 함 |
| **02 워크스페이스** | ws 삭제 트리거에 "단독 admin 계정 삭제" 추가(R-15). 모든 API가 `workspace_id` 명시 컨텍스트(불일치 = **404**). 삭제 잡에 `job` 재사용. `page_owner`로 퇴사자 콘텐츠 이관(R-13) |
| **03/04 DB·property** | people property가 삭제 user 참조 → tombstone 유지, rollup/필터가 NULL로 폭발하지 않게 |
| **05 실시간** | `connection`이 `session_id` 참조 필요. 세션 폐기가 WebSocket까지 끊어야 함 |
| **06 권한·공유** | `effective()`에 세션 컨텍스트 주입(R-11). `security_policy.require_mfa_for_guests` 신설(멤버 MFA 강제 불가, **게스트만 가능**). `acl_entry.principal_type` 정본 결정(R-12). 공유 초대는 `resolve_user_by_email()` 단일 진입점 |
| **07 검색** | 멘션 자동완성 인덱스에 별칭 5개 전부(표시는 primary+이름만). `preferred_name` 변경 시 비정규화 재색인 팬아웃 |
| **09 API·통합** | bot user = `user.type='bot'`(R-2). **통합 토큰 ≠ session** — "Log out of all devices"가 봇 토큰을 끊으면 자동화 전멸. 삭제 전 내보내기(F-09-14). PAT 만료(7~365일)는 세션과 별개 수명주기 |
| **11 알림·감사** | 이메일 채널은 primary email(R-9). audit_log에 actor NULL 허용 + ip/ua/auth_method(R-10). view history 프라이버시는 필터가 아니라 **수집 지점에서 차단**(F-11-18) |
| **12 설정·오프라인** | `user_setting(scope='account')` 키 등록(R-8). 오프라인 저장소는 **`(user_id, workspace_id)` 복합 키 파티션**(안 하면 계정 격리 붕괴 = 보안 사고). 세션 폐기 시 미전송 로컬 큐 삭제 금지 |
| **13-18 과금** | 좌석 = `status='active'`만(R-14), 강제 지점 = 초대 수락 트랜잭션. Student 플랜은 교육 이메일 제거 시 할인 상실(이메일 삭제가 과금에 영향). CAPTCHA 인프라는 13 공개 폼과 공유 |

---

## 6. 최우선 미해결 질문 (Top 5)

| # | 질문 | 왜 최우선인가 | 해소 |
|---|---|---|---|
| 1 | `[정본 결정]` 통합 principal: 06의 `principal_type='integration'` vs `user(type='bot')` | 권한 계산 분기 2배. 외부 검증 불가한 **문서 간 결정** → 00번에서 지금 확정(R-12) | SYNTHESIS에서 결정 |
| 2 | `[정본 결정]` `workspace_member` role: 02의 4값 vs 06의 5값 + status/is_temporary | 좌석 과금(13-18)과 초대 수락 로직이 걸림. 이 문서는 **06 채택 + join_method/status 추가** 요구(R-5) | SYNTHESIS에서 결정 |
| 3 | 비밀번호 변경·2FA 수단 삭제 시 **다른 세션 폐기 여부**(1차 출처 미기재) | 미구현이면 탈취 세션 잔존 — 보안 설계 기본. 클론은 "폐기"로 확정 권고 | 두 기기 로그인 후 실측 |
| 4 | `[모순]` 세션 정책 범위: 1h~90d(기본 90) vs 1h~180d(managed users, 기본 180) vs "토큰 90일 만료" | `session_policy.max_lifetime` 검증 범위. 클론은 설정 가능 + 기본 90일 권고 | Enterprise 설정 실측 |
| 5 | 도메인 검증이 **기존 개인 계정에 소급되는가**("created with"가 시점 기준인지 상태 기준인지) | F-14-12 전체의 신뢰·법적 리스크. 소급이면 클론 스코프 아웃 대상 | 검증 전 생성 계정이 대시보드에 뜨는지 확인 |

> 차순위(원본 미해결 15개 중 나머지): 이메일 총 5 vs 6 `[모순]` / OTP TTL·시도상한·발송 레이트리밋 전부 미공개 / Passkey 로그인 시 2FA 재요구 여부 / SSO 강제 시 기존 credential 삭제 vs 잠금 / SCIM deprovision + SAML JIT 동시 활성 시 사용자 부활 `[추정]` / 백업코드 소진+기기 분실 시 셀프서비스 복구 경로 부재(→ 관리자 강제 해제 필수) / 별칭 정책 Enabled→Disabled 시 기존 별칭 처리 / user-owned bot 소유자 삭제 시 토큰 처리 / 계정당 ws 상한 / 딥링크 다중 계정 선택 UX / 계정 삭제와 진행 중 구독 / GDPR 삭제 vs 30일 백업 창 충돌

---

## 7. 1차 출처 (원본 20개 중 핵심)
`https://www.notion.com/help/{slug}` — log-in-and-out · account-settings · secondary-emails · passkeys · two-step-verification · delete-your-account · create-delete-and-switch-workspaces · add-members-admins-guests-and-groups · managed-users-dashboard · domain-management · saml-sso-configuration · provision-users-and-groups-with-scim · security-and-privacy · cant-log-in · workspace-settings · transfer-content-deprovisioned-user
API: `https://developers.notion.com/reference/user` · `/docs/authorization` · `/guides/get-started/personal-access-tokens` · 2차: `https://docmost.com/blog/open-source-notion-alternatives/`
