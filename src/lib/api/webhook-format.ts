/**
 * 공개 API 웹훅의 모양 — 확인 토큰 · 서명 · 봉투 · 다시 보내기 표 · 상한 (API-8 · F-09-09 · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 09-api-integrations.md F-09-09
 *
 *   · 확인 토큰 — `secret_` + 32바이트 난수(base64url). 노션처럼 **확인 토큰이 곧 서명의 비밀**이다. 비교는 상수 시간(둘의 sha256 을 비교 —
 *     길이도 새지 않는다).
 *   · 서명 — `X-Notion-Signature: sha256=<hex HMAC-SHA256(보낸 본문 그대로, 확인 토큰)>`. 받는 쪽은 `verifyWebhookSignature` 와 같은 일을 한다.
 *   · 봉투 — 노션의 모양(`id` · `timestamp` · `workspace_id` · `workspace_name` · `subscription_id` · `integration_id` · `type` · `authors` ·
 *     `attempt_number` · `entity` · `data`). `integration_id` 는 API 토큰의 id · `accessible_by` 는 싣지 않는다(공개 통합에만 있다).
 *   · 다시 보내기 — 여덟 번까지 · n 번째 실패 뒤 `11.25분 × 2^(n-1)` (±10% 흔들기) — 11 · 22 · 45분 · 1.5 · 3 · 6 · 12시간 → 마지막 시도는
 *     첫 시도의 약 24시간 뒤(노션의 "8회 · 약 24시간").
 *   · 상한 — 토큰마다 5개 · 워크스페이스마다 50개 · 이벤트를 세 번 잇달아 끝내 보내지 못하면 끈다(`failures`).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { checkOutboundUrl, type OutboundResult, type OutboundUrlProblem } from '../net/outbound.ts'

/** 토큰마다 구독의 상한. */
export const MAX_WEBHOOKS_PER_TOKEN = 5
/** 워크스페이스마다 구독의 상한(모든 사람 · 토큰을 합쳐). */
export const MAX_WEBHOOKS_PER_WORKSPACE = 50
/** 한 이벤트의 시도 상한 — 노션의 `attempt_number` 1~8. */
export const MAX_WEBHOOK_ATTEMPTS = 8
/** 다시 보내기의 첫 간격 — 두 배씩 늘어 일곱 간격의 합이 약 24시간. */
export const WEBHOOK_RETRY_BASE_MS = 675_000
/** 이벤트를 이만큼 잇달아 끝내 보내지 못하면 구독을 끈다(`disabled` · `failures`). */
export const AUTO_DISABLE_AFTER_FAILED_EVENTS = 3
/** 서명 머리의 이름. */
export const SIGNATURE_HEADER = 'X-Notion-Signature'

/** 확인 토큰 — 노션의 `secret_…` 모양. */
export function newVerificationToken(): string {
  return `secret_${randomBytes(32).toString('base64url')}`
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

/** 붙여 넣은 확인 토큰이 맞는가 — 상수 시간(앞뒤 공백은 뗀다 — 복사할 때 묻어 온다). */
export function verificationTokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length > 1000) return false
  return timingSafeEqual(digest(given.trim()), digest(expected))
}

/** 서명 머리의 값 — `sha256=<hex>`. 본문은 보낸 바이트 그대로의 글이다. */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

/** 받는 쪽의 검사 — 서명 머리가 이 본문 · 비밀의 것인가(상수 시간). */
export function verifyWebhookSignature(body: string, header: unknown, secret: string): boolean {
  if (typeof header !== 'string') return false
  const expected = Buffer.from(signWebhookBody(body, secret), 'utf8')
  const got = Buffer.from(header.trim(), 'utf8')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** n 번째 실패 뒤 다시 보낼 때까지 — `random` 은 [0, 1) (검사가 바꿔 끼운다). */
export function webhookRetryDelayMs(failedAttempt: number, random: () => number = Math.random): number {
  const n = Math.min(Math.max(1, Math.floor(failedAttempt)), MAX_WEBHOOK_ATTEMPTS - 1)
  const jitter = 0.9 + 0.2 * Math.min(Math.max(random(), 0), 1)
  return Math.round(WEBHOOK_RETRY_BASE_MS * 2 ** (n - 1) * jitter)
}

/** 흔들기 없는 간격들 — 문서 · 검사가 읽는다. */
export const NOMINAL_RETRY_DELAYS_MS: readonly number[] = Array.from({ length: MAX_WEBHOOK_ATTEMPTS - 1 }, (_, i) => WEBHOOK_RETRY_BASE_MS * 2 ** i)

export type WebhookAuthor = { readonly id: string; readonly type: 'person' }

export type WebhookEnvelope = {
  readonly id: string
  readonly timestamp: string
  readonly workspace_id: string
  readonly workspace_name: string
  readonly subscription_id: string
  readonly integration_id: string
  readonly type: string
  readonly authors: readonly WebhookAuthor[]
  readonly attempt_number: number
  readonly entity: { readonly id: string; readonly type: string }
  readonly data: Readonly<Record<string, unknown>>
}

/** 봉투를 만든다 — 저자는 사람만 남긴다(모양이 틀린 것은 뺀다). */
export function buildWebhookEnvelope(input: {
  readonly eventId: string
  readonly occurredAt: Date
  readonly workspaceId: string
  readonly workspaceName: string
  readonly subscriptionId: string
  readonly tokenId: string
  readonly type: string
  readonly authors: unknown
  readonly attemptNumber: number
  readonly entity: { readonly id: string; readonly type: string }
  readonly data: unknown
}): WebhookEnvelope {
  const authors = Array.isArray(input.authors)
    ? input.authors.flatMap((a): WebhookAuthor[] =>
        typeof a === 'object' && a !== null && typeof (a as { id?: unknown }).id === 'string' ? [{ id: (a as { id: string }).id, type: 'person' }] : [],
      )
    : []
  const data = typeof input.data === 'object' && input.data !== null && !Array.isArray(input.data) ? (input.data as Record<string, unknown>) : {}
  return {
    id: input.eventId,
    timestamp: input.occurredAt.toISOString(),
    workspace_id: input.workspaceId,
    workspace_name: input.workspaceName,
    subscription_id: input.subscriptionId,
    integration_id: input.tokenId,
    type: input.type,
    authors,
    attempt_number: input.attemptNumber,
    entity: { id: input.entity.id, type: input.entity.type },
    data,
  }
}

/** 받는 주소의 모양 — 바깥 요청의 한 길(`checkOutboundUrl`)과 같은 규칙(https · 기본 포트 · 사설 대역 · `OUTBOUND_ALLOW_HOSTS`). */
export function checkWebhookUrl(raw: unknown): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly problem: OutboundUrlProblem } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, problem: 'invalid' }
  return checkOutboundUrl(raw.trim())
}

/** 실패를 200자 이하의 짧은 까닭으로 — 응답 본문은 싣지 않는다(`outbound.ts` 가 읽지도 않는다). */
export function shortFailure(result: Extract<OutboundResult, { ok: false }>): string {
  return `${result.reason}: ${result.detail}`.slice(0, 200)
}
