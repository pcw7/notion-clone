/**
 * API 토큰의 문구 — 설정 → 내 계정 → API 토큰 (API-1 · F-09-02 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① — 값은 만들 때 한 번만 보인다 · 살아 있는 것 20개 · 폐기는 곧바로 듣는다
 *
 * 거부 코드(`lib/api/api-token.ts` `ApiTokenFailure`)의 말 · 만료 고르개의 말 · 목록의 가린 값을 한 곳에 둔다. 브라우저 묶음에 들어가므로
 * 서버 모듈을 부르지 않는다(상수는 `lib/api/token-format.ts` 와 같은 값을 쓴다 — 그 모듈은 node:crypto 를 부른다).
 */

const FAILURE: Readonly<Record<string, string>> = {
  forbidden: '게스트는 API 토큰을 만들 수 없습니다.',
  invalid_name: '이름은 1~100자로 적어 주세요.',
  invalid_expiry: '만료 기간을 다시 골라 주세요.',
  limit_reached: '살아 있는 토큰은 20개까지입니다. 쓰지 않는 토큰을 폐기한 뒤 만드세요.',
  not_found: '이미 폐기했거나 없는 토큰입니다.',
}

export function apiTokenFailureMessage(reason: unknown): string {
  // 자기 칸만 — `FAILURE['constructor']` 는 객체 원형의 함수다
  return typeof reason === 'string' && Object.hasOwn(FAILURE, reason) ? FAILURE[reason]! : '처리하지 못했습니다.'
}

/** 만료 고르개 — 값은 일수(문자열) · `none` 은 만료 없음. 첫째가 기본(노션의 1년). */
export const API_TOKEN_EXPIRY_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '365', label: '1년 뒤 만료' },
  { value: '180', label: '180일 뒤 만료' },
  { value: '90', label: '90일 뒤 만료' },
  { value: '30', label: '30일 뒤 만료' },
  { value: '7', label: '7일 뒤 만료' },
  { value: 'none', label: '만료 없음' },
]

/** 고르개의 값 → 명령의 `expiresInDays`(만료 없음은 null). */
export function expiryValue(option: string): number | null {
  return option === 'none' ? null : Number(option)
}

/** 목록의 가린 값 — 접두와 끝 4자만. */
export function maskedToken(last4: string): string {
  return `ntn_…${last4}`
}

/** 패널 머리의 설명. */
export const API_TOKEN_PANEL_NOTE =
  '스크립트 · 도구가 노션 API(2025-09-03)와 같은 모양으로 이 워크스페이스를 읽고 씁니다. 토큰은 내 권한 그대로 움직이니 비밀번호처럼 다루세요. 살아 있는 토큰은 20개까지입니다.'

/** 방금 만든 토큰 아래의 경고. */
export const API_TOKEN_SHOWN_ONCE = '이 토큰은 다시 볼 수 없습니다. 지금 복사해 안전한 곳에 두세요.'

/** 폐기를 묻는 말. */
export const API_TOKEN_REVOKE_CONFIRM = '폐기하면 이 토큰을 쓰는 스크립트가 곧바로 멈춥니다.'

/** 게스트에게 — 만들기 대신. */
export const API_TOKEN_GUEST_NOTE = '게스트는 API 토큰을 만들 수 없습니다.'
