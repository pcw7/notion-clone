/**
 * 공개 API `/v1` 의 규약 — 헤더 · 오류 모양 · 제한의 셈 (API-1 · F-09-05 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④
 *       09-api-integrations.md F-09-05 — 오류 본문 `{object:"error", status, code, message, request_id}` · `Notion-Version` 누락 또는 미지원
 *       날짜 → 400 · 크기 초과 → 400 `validation_error` · 429 + `Retry-After` · 연결당 평균 초당 3요청(짧은 몰림은 받는다)
 *
 * 오류의 `message` 는 **영어**다 — 노션의 말투 그대로(노션 SDK · 스크립트가 그 글을 그대로 보인다). 코드는 노션의 것만 쓴다.
 */

import type { RateLimitRule } from '../rate-limit.ts'

/** 받는 단 하나의 `Notion-Version` — 데이터 소스 판(정본 ③). */
export const NOTION_VERSION = '2025-09-03'

/** 요청 본문의 상한 — 노션의 500KB(F-09-05). 넘으면 400 `validation_error`. */
export const API_MAX_BODY_BYTES = 500 * 1024

/**
 * 토큰마다 — 5초 창에 15번(평균 초당 3번 · 한 창 안의 몰림은 15번까지 받는다). 고정 창이라 창의 경계에서는 두 배까지 지난다
 * (`rate-limit.ts` 머리말) — 짧은 몰림을 받는다는 노션의 말과 같은 쪽이다.
 */
export const API_RATE_RULE: RateLimitRule = { limit: 15, windowSeconds: 5 }

/** 레이트리밋의 이름 공간 — 열쇠는 토큰 id. */
export const API_RATE_NAMESPACE = 'api'

export type ApiErrorCode =
  | 'unauthorized'
  | 'restricted_resource'
  | 'object_not_found'
  | 'rate_limited'
  | 'validation_error'
  | 'invalid_request'
  | 'invalid_request_url'
  | 'invalid_json'
  | 'missing_version'
  | 'conflict_error'
  | 'internal_server_error'

export type ApiErrorBody = {
  readonly object: 'error'
  readonly status: number
  readonly code: ApiErrorCode
  readonly message: string
  readonly request_id: string
}

export function apiErrorBody(status: number, code: ApiErrorCode, message: string, requestId: string): ApiErrorBody {
  return { object: 'error', status, code, message, request_id: requestId }
}

/**
 * `Authorization: Bearer <토큰>` 의 토큰 — 방식 이름은 대소문자를 가리지 않는다. 다른 방식 · 빈 값 · 공백이 낀 값은 null.
 * **쿠키는 보지 않는다** — `/v1` 은 토큰만 받는다(쿠키를 받으면 다른 사이트가 사용자의 브라우저로 부를 수 있다 · CSRF).
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer[ \t]+([^\s]+)[ \t]*$/i.exec(header)
  return match?.[1] ?? null
}

export type VersionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'missing_version' | 'invalid_request'; readonly message: string }

/** `Notion-Version` — 없으면 `missing_version` · 다른 날짜면 `invalid_request`(받는 판을 말한다). */
export function checkNotionVersion(header: string | null | undefined): VersionCheck {
  const value = header?.trim() ?? ''
  if (value === '') {
    return { ok: false, code: 'missing_version', message: `Notion-Version header is required. Use "${NOTION_VERSION}".` }
  }
  if (value !== NOTION_VERSION) {
    return {
      ok: false,
      code: 'invalid_request',
      message: `Notion-Version "${value.slice(0, 40)}" is not supported. The supported version is "${NOTION_VERSION}".`,
    }
  }
  return { ok: true }
}

/** `Retry-After`(초) — 창이 다시 열리기까지. 0 이하로 주지 않는다(곧바로 다시 부르면 또 막힌다). */
export function retryAfterSeconds(resetSeconds: number): number {
  return Number.isFinite(resetSeconds) ? Math.max(1, Math.ceil(resetSeconds)) : API_RATE_RULE.windowSeconds
}

/** 오류마다 같은 글 — 노션의 말투. */
export const API_MESSAGES = {
  unauthorized: 'API token is invalid.',
  rateLimited: 'You have been rate limited. Please try again later.',
  bodyTooLarge: `Request body too large. The limit is ${API_MAX_BODY_BYTES / 1024}KB.`,
  invalidJson: 'Error parsing JSON body.',
  invalidUrl: 'Invalid request URL.',
  internal: 'Unexpected error occurred.',
} as const
