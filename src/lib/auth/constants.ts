/**
 * 인증 정책 상수.
 *
 * 정본: docs/research/14-auth-accounts.md § D "클론 상수 (한 곳에 모아두고 여기서만 읽는다)"
 *       docs/research/14-auth-accounts.md F-14-16 (레이트리밋 규칙)
 *
 * 이 값들을 코드 여기저기에 흩뿌리지 않는다. 정책이 바뀌면 여기만 고친다.
 *
 * `[추정]` 표시는 Notion 이 공개하지 않아 클론이 정한 값이라는 뜻이다.
 * 원본 동작이라고 착각하고 다른 곳에서 근거로 쓰지 마라.
 */

// ── 계정 ──────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LEN = 8 // 1차 출처
export const MIN_UNIQUE_CHARS = 4 // 1차 출처
export const PASSWORD_ALNUM_REQUIRED_BELOW = 15 // 8~14자에만 문자1+숫자1 요구. 1차 출처
export const MAX_EMAILS_PER_ACCOUNT = 5 // 1차 출처 [모순] — 14 § 미해결 참조
export const MAX_PASSKEYS = 5 // 1차 출처
export const MAX_MFA_METHODS = 4 // TOTP 2 + SMS 2. 1차 출처
export const BACKUP_CODE_COUNT = 6 // 1회용. 1차 출처

// ── 로그인 코드 (OTP) ─────────────────────────────────────────────────

/** [추정] Notion 미공개 */
export const LOGIN_CODE_TTL_SECONDS = 10 * 60
/** [추정] Notion 미공개. 초과하면 challenge 폐기 — 계정 잠금은 하지 않는다(DoS 벡터) */
export const LOGIN_CODE_MAX_ATTEMPTS = 5
/** 숫자 6자리. autocomplete="one-time-code" 로 iOS/Android 자동 채움 */
export const LOGIN_CODE_LENGTH = 6

// ── 세션 ──────────────────────────────────────────────────────────────

/** "Login tokens expire after 90 days" — 1차 출처 */
export const SESSION_MAX_LIFETIME_DAYS = 90

// ── 레이트리밋 (F-14-16) ──────────────────────────────────────────────
//
// 전부 클론의 설계 결정이다. Notion 은 이 영역을 공개하지 않는다.
//
// 이메일당 상한이 IP 상한보다 **우선**이다. 회사 NAT 뒤에서 100명이 동시에
// 로그인하면 IP 단위 상한만으로는 정상 사용자가 차단된다. 반대로 이메일 폭탄은
// 이메일당 상한으로만 막을 수 있다.

/** 이메일당 5분에 3회 */
export const CODE_REQUEST_PER_EMAIL = { limit: 3, windowSeconds: 5 * 60 } as const
/** IP당 15분에 10회 */
export const CODE_REQUEST_PER_IP = { limit: 10, windowSeconds: 15 * 60 } as const

// ── 삭제 · 복원 ───────────────────────────────────────────────────────

export const DELETED_USER_GRACE_DAYS = 30 // 1차 출처
export const REJOIN_PRIVATE_PAGE_RESTORE_DAYS = 30 // 1차 출처
export const TEMP_MEMBER_MAX_DAYS = 365 // 06 F-06-02 와 동일
