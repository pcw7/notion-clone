/**
 * 공개 API `/v1` 의 규약 — 헤더 · 오류 모양 · 제한의 셈 (API-1 · F-09-05 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ④
 *       09-api-integrations.md F-09-05 — 오류 본문 `{object:"error", status, code, message, request_id}` · `Notion-Version` 누락 또는 미지원
 *       날짜 → 400 · 크기 초과 → 400 `validation_error` · 429 + `Retry-After` · 연결당 평균 초당 3요청(짧은 몰림은 받는다)
 *
 * 오류의 `message` 는 **영어**다 — 노션의 말투 그대로(노션 SDK · 스크립트가 그 글을 그대로 보인다). 코드는 노션의 것만 쓴다.
 */

import { createHash } from 'node:crypto'

import { MAX_UPLOAD_BYTES } from '../file/limits.ts'
import type { RateLimitRule } from '../rate-limit.ts'

/** 받는 단 하나의 `Notion-Version` — 데이터 소스 판(정본 ③). */
export const NOTION_VERSION = '2025-09-03'

/** 요청 본문의 상한 — 노션의 500KB(F-09-05). 넘으면 400 `validation_error`. */
export const API_MAX_BODY_BYTES = 500 * 1024

/** 파일 보내기(API-7 · 정본 ⑪)의 본문 상한 — 500KB 가 아니라 파일 하나의 상한(앱의 것) + 폼의 머리 64KB. 넘으면 읽지 않고 400. */
export const API_MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024

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

/**
 * 노션의 id — 대시가 있든(8-4-4-4-12) 없든(32자리 hex) 받는다(09 F-09-01 *"요청 시 대시 유무 모두 허용"*). 우리의 모양(소문자 · 대시)으로 ·
 * 아니면 null(400 `validation_error` — 모양이 틀린 것은 "없다" 가 아니다).
 */
export function parseApiId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i.exec(raw.trim())
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase()
}

/** 값을 오류 글에 싣는 모양 — 노션처럼 백틱 안의 JSON · 길면 자른다. */
export function shownValue(value: unknown): string {
  let text: string
  try {
    text = value === undefined ? 'undefined' : (JSON.stringify(value) ?? String(value))
  } catch {
    text = typeof value
  }
  return `\`${text.length > 80 ? `${text.slice(0, 77)}...` : text}\``
}

/** 경로의 id 가 모양이 아니다 — 노션의 글 그대로(`path failed validation: …`). */
export function invalidPathIdMessage(name: string, raw: unknown): string {
  return `path failed validation: path.${name} should be a valid uuid, instead was ${shownValue(raw)}.`
}

/** 목록의 상한 — `page_size` 100(정본 ④ · 노션의 상한 그대로). 없으면 100. */
export const API_MAX_PAGE_SIZE = 100

/** `page_size` 질의 값 — 1~100 의 정수. 없으면 100 · 틀리면 null(400 `validation_error`). */
export function parsePageSize(raw: string | null): number | null {
  if (raw === null || raw === '') return API_MAX_PAGE_SIZE
  if (!/^\d{1,4}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 && n <= API_MAX_PAGE_SIZE ? n : null
}

/**
 * 커서 — 노션처럼 속을 보이지 않는 글자다. 속은 목록 안의 자리(0 부터)다 — 목록이 그 사이 바뀌면 건너뛰거나 겹칠 수 있다(노션의 커서도
 * 스냅숏이 아니다). `start_cursor` 를 읽어 자리로 · 모양이 아니면 null(400 `validation_error`).
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null): number | null {
  if (raw === null || raw === '') return 0
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(raw)) return null
  const m = /^o:(\d{1,9})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'))
  return m === null ? null : Number(m[1])
}

/** 목록의 지문 — 커서를 그 목록(블록 id · `'users'`)에 묶는다(API-5). 서명이 아니다 — 권한은 읽을 때 다시 본다. */
const bindingOf = (binding: string): string => createHash('sha256').update(binding).digest('hex').slice(0, 12)

/** 묶인 커서(API-5 — 코멘트 · 사용자 목록) — 속은 목록의 지문과 자리. 다른 목록의 커서는 받지 않는다(API-4 의 질의 커서와 같은 태도). */
export function encodeBoundCursor(binding: string, offset: number): string {
  return Buffer.from(`b:${bindingOf(binding)}:${offset}`, 'utf8').toString('base64url')
}

/** 묶인 커서를 자리로 — 없으면 0 · 모양이 아니거나 다른 목록의 것이면 null(400 `validation_error`). */
export function decodeBoundCursor(binding: string, raw: string | null): number | null {
  if (raw === null || raw === '') return 0
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(raw)) return null
  const m = /^b:([0-9a-f]{12}):(\d{1,9})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'))
  return m === null || m[1] !== bindingOf(binding) ? null : Number(m[2])
}

/** 오류마다 같은 글 — 노션의 말투. */
export const API_MESSAGES = {
  unauthorized: 'API token is invalid.',
  rateLimited: 'You have been rate limited. Please try again later.',
  bodyTooLarge: `Request body too large. The limit is ${API_MAX_BODY_BYTES / 1024}KB.`,
  fileTooLarge: `The file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB per file.`,
  multipartRequired: 'Send the file as multipart/form-data with a "file" field.',
  invalidMultipart: 'Error parsing multipart/form-data body.',
  invalidJson: 'Error parsing JSON body.',
  invalidUrl: 'Invalid request URL.',
  internal: 'Unexpected error occurred.',
} as const
