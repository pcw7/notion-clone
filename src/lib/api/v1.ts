/**
 * 공개 API `/v1` 의 문 — 모든 `/v1` 라우트가 이 하나를 지난다 (API-1 · F-09-02 · F-09-05)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ② ③ ④ · 규약(순수)은 `v1-protocol.ts`
 *
 * 차례:
 *   1. `Authorization: Bearer <토큰>` — 없거나 우리 토큰의 모양이 아니면 401 `unauthorized`. **쿠키는 보지 않는다**(CSRF — 다른 사이트가
 *      사용자의 브라우저로 부르는 길을 열지 않는다). CORS 머리도 싣지 않는다.
 *   2. `Notion-Version` — 없으면 400 `missing_version` · 다른 판이면 400 `invalid_request`.
 *   3. 발급자 — `resolveSessionContext({ apiToken })`(발급자는 그대로 둘이다 · 같은 0단계 게이트). 모르는 · 폐기한 · 만료된 토큰과 게이트가
 *      막은 토큰(내보낸 멤버 · 멈춘 사람 · 지운 워크스페이스 · 지운 계정)은 모두 401 `unauthorized` — 어느 쪽인지 말하지 않는다.
 *   4. 레이트리밋 — 토큰마다(`API_RATE_RULE`) · 넘으면 429 `rate_limited` + `Retry-After`. 저장소 장애면 연다(`rate-limit.ts` 의 판단).
 *   5. 본문 — 500KB 까지 읽는다(넘으면 400 `validation_error`) · JSON 이 아니면 400 `invalid_json`. 파일 보내기(API-7 — `{ body: 'multipart' }`)는
 *      `multipart/form-data` 만 · 상한은 파일 하나의 상한 + 64KB(`API_MAX_MULTIPART_BYTES`) · 핸들러는 `FormData` 를 받는다.
 *   6. 처리 — 볼 수 없는 것은 404 `object_not_found`(있는지 새지 않는다 · 403 으로 답하지 않는다).
 *
 * 모든 응답에 새 `request_id`(본문 · `x-request-id` 머리)와 `cache-control: no-store` 를 싣는다. 토큰 값은 어디에도 남기지 않는다.
 */

import { randomUUID } from 'node:crypto'

import { resolveSessionContext, type SessionContext } from '../auth/session-context.ts'
import { consume } from '../rate-limit.ts'
import { unsupportedEndpoint, unsupportedMessage } from './endpoints.ts'
import { isApiTokenShape } from './token-format.ts'
import {
  API_MAX_BODY_BYTES,
  API_MAX_MULTIPART_BYTES,
  API_MESSAGES,
  API_RATE_NAMESPACE,
  API_RATE_RULE,
  apiErrorBody,
  bearerToken,
  checkNotionVersion,
  retryAfterSeconds,
  type ApiErrorCode,
} from './v1-protocol.ts'

export type V1Reply =
  | { readonly ok: true; readonly status: number; readonly json: unknown }
  | { readonly ok: false; readonly status: number; readonly code: ApiErrorCode; readonly message: string }

export const v1Ok = (json: unknown, status = 200): V1Reply => ({ ok: true, status, json })
export const v1Fail = (status: number, code: ApiErrorCode, message: string): V1Reply => ({ ok: false, status, code, message })

export type V1Request = {
  /** 토큰을 만든 사람의 컨텍스트 — `ctx.apiToken` 이 붙어 있다(세션에 매인 명령은 거부한다). */
  readonly ctx: SessionContext
  readonly request: Request
  readonly params: Readonly<Record<string, string | readonly string[] | undefined>>
  /** JSON 본문 — 없으면 undefined. `{ body: 'multipart' }` 의 라우트는 `FormData`. */
  readonly body: unknown
  readonly requestId: string
}

export type V1Handler = (input: V1Request) => Promise<V1Reply>

/**
 * 없는 주소 · 받지 않는 메서드 — 노션처럼 400 `invalid_request_url`(Next 의 405 · HTML 404 를 API 에 내지 않는다). 공식 SDK 에 있지만 받지 않는
 * 주소(`API_UNSUPPORTED` — API-10 · ⑭ ②)면 400 `validation_error` 로 SDK 메서드와 까닭을 말한다.
 */
export const v1InvalidUrl: V1Handler = async ({ request }) => {
  const gap = unsupportedEndpoint(request.method, new URL(request.url).pathname)
  return gap === null ? v1Fail(400, 'invalid_request_url', API_MESSAGES.invalidUrl) : v1Fail(400, 'validation_error', unsupportedMessage(gap))
}

/** Next 라우트 핸들러의 모양 — 두 번째 인자는 `{ params }`. */
export type V1RouteHandler = (request: Request, routeContext?: { readonly params?: Promise<unknown> }) => Promise<Response>

function respond(status: number, json: unknown, requestId: string, extra: Readonly<Record<string, string>> = {}): Response {
  return Response.json(json, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extra } })
}

function error(status: number, code: ApiErrorCode, message: string, requestId: string, extra?: Readonly<Record<string, string>>): Response {
  return respond(status, apiErrorBody(status, code, message, requestId), requestId, extra)
}

/** 본문을 상한까지만 읽는다 — `content-length` 가 넘으면 읽지 않고, 없거나 거짓이면 읽으며 센다. */
async function readCappedBody(request: Request, max: number): Promise<{ readonly ok: true; readonly bytes: Buffer } | { readonly ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return { ok: false }
  if (request.body === null) return { ok: true, bytes: Buffer.alloc(0) }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return { ok: false }
    }
    chunks.push(value)
  }
  return { ok: true, bytes: Buffer.concat(chunks) }
}

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 라우트의 선택 — 본문의 모양(기본 JSON · 파일 보내기는 `multipart`). */
export type V1RouteOptions = { readonly body?: 'json' | 'multipart' }

type BodyRead = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly code: ApiErrorCode; readonly message: string }

/** 본문 — JSON(500KB) 또는 multipart(파일의 상한 + 64KB → `FormData`). */
async function readBody(request: Request, kind: 'json' | 'multipart'): Promise<BodyRead> {
  if (kind === 'multipart') {
    const type = request.headers.get('content-type') ?? ''
    if (!/^multipart\/form-data\s*;/i.test(type)) return { ok: false, code: 'validation_error', message: API_MESSAGES.multipartRequired }
    const read = await readCappedBody(request, API_MAX_MULTIPART_BYTES)
    if (!read.ok) return { ok: false, code: 'validation_error', message: API_MESSAGES.fileTooLarge }
    try {
      return { ok: true, body: await new Response(read.bytes as BodyInit, { headers: { 'content-type': type } }).formData() }
    } catch {
      return { ok: false, code: 'validation_error', message: API_MESSAGES.invalidMultipart }
    }
  }
  const read = await readCappedBody(request, API_MAX_BODY_BYTES)
  if (!read.ok) return { ok: false, code: 'validation_error', message: API_MESSAGES.bodyTooLarge }
  const text = read.bytes.toString('utf8')
  if (text.trim() === '') return { ok: true, body: undefined }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, code: 'invalid_json', message: API_MESSAGES.invalidJson }
  }
}

/** `/v1` 라우트 하나를 만든다 — `export const GET = v1Route(handler)` · 파일 보내기는 `v1Route(handler, { body: 'multipart' })`. */
export function v1Route(handler: V1Handler, options: V1RouteOptions = {}): V1RouteHandler {
  return async (request, routeContext) => {
    const requestId = randomUUID()
    try {
      const token = bearerToken(request.headers.get('authorization'))
      if (token === null || !isApiTokenShape(token)) return error(401, 'unauthorized', API_MESSAGES.unauthorized, requestId)

      const version = checkNotionVersion(request.headers.get('notion-version'))
      if (!version.ok) return error(400, version.code, version.message, requestId)

      const resolved = await resolveSessionContext({ apiToken: token })
      if (!resolved.ok) return error(401, 'unauthorized', API_MESSAGES.unauthorized, requestId)
      const ctx = resolved.context

      // 토큰 id(컨텍스트의 sessionId 자리) — 값은 열쇠에 넣지 않는다
      const limit = await consume(API_RATE_NAMESPACE, ctx.sessionId, API_RATE_RULE)
      if (!limit.allowed) {
        return error(429, 'rate_limited', API_MESSAGES.rateLimited, requestId, { 'retry-after': String(retryAfterSeconds(limit.resetSeconds)) })
      }

      let body: unknown = undefined
      if (!BODYLESS.has(request.method.toUpperCase())) {
        const read = await readBody(request, options.body ?? 'json')
        if (!read.ok) return error(400, read.code, read.message, requestId)
        body = read.body
      }

      const params = ((await routeContext?.params) ?? {}) as V1Request['params']
      const reply = await handler({ ctx, request, params, body, requestId })
      return reply.ok ? respond(reply.status, reply.json, requestId) : error(reply.status, reply.code, reply.message, requestId)
    } catch (e) {
      // 토큰 · 본문은 찍지 않는다 — 요청 id 와 까닭만
      console.error(`[v1] ${requestId} — ${(e as Error).message}`)
      return error(500, 'internal_server_error', API_MESSAGES.internal, requestId)
    }
  }
}
