/**
 * 공개 API 의 웹훅 구독 — 만들기 · 확인 · 멈추기 · 지우기 · 테스트 · 목록 · 배달 기록 (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · 마이그레이션 0151
 *
 *   · 구독은 **API 토큰 하나의 것**이다 — 설정 → 내 계정 → API 토큰의 그 토큰 아래에서 만든다. 모든 명령은 **세션에 매인 명령**이다
 *     (`isLoginSession` — 토큰이 웹훅을 만들지 못한다) · 내 (폐기하지 않은) 토큰의 구독만 보이고 바뀐다(남의 것은 `not_found`).
 *   · 만들기 — 받는 주소(바깥 요청의 한 길의 규칙 — https · 기본 포트 · 사설 대역 금지 · `OUTBOUND_ALLOW_HOSTS` 만 http · 다른 포트) ·
 *     이벤트(카탈로그의 것 하나 이상). 토큰마다 5개(토큰 행을 잠그고 센다) · 워크스페이스마다 50개(워크스페이스의 advisory 잠금).
 *     만료한 토큰 · 소유자가 웹훅을 끈 워크스페이스(10n-70)에는 만들지 못한다. 커밋한 **뒤에** 받는 주소로 `{ verification_token }` 을 한 번
 *     POST 한다(노션) — 결과는 구독에 적는다(화면이 "보냈습니다 · HTTP 200" 을 말한다). "다시 보내기" 는 10초에 한 번.
 *   · 확인 — 붙여 넣은 토큰을 상수 시간으로 견준다. 맞으면 `active`. 확인 토큰은 서명의 비밀이라 **봉인해 두고** 어떤 읽기 · 감사에도
 *     싣지 않는다.
 *   · 멈추기는 `active` 에서만 · 다시 켜기는 `paused` · 실패로 꺼진 것(`disabled` · `failures`)에서. 멈추면 기다리던 이벤트는 건너뛴다.
 *   · 테스트 — `active` 일 때 `test` 이벤트 하나를 아웃박스에 넣는다(같은 워커 · 같은 서명 · 같은 기록). 기다리는 테스트는 다섯까지.
 *   · 만들기 · 확인 · 지우기는 감사 로그(`account.security_changed` — 주소의 힌트 · 토큰 id · 구독 id 만).
 */

import { randomUUID } from 'node:crypto'

import { recordForContextIn } from '../audit/audit.ts'
import { isLoginSession, type SessionContext } from '../auth/session-context.ts'
import { query, queryOne } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { postJsonText, type OutboundResult, type OutboundUrlProblem } from '../net/outbound.ts'
import { sealWebhookSecret, sealWebhookUrl, unsealWebhookSecret, unsealWebhookUrl, webhookUrlHint } from '../net/url-seal.ts'
import { webhooksAllowedIn } from '../notification/webhook-switch.ts'
import { parseEventTypes, TEST_EVENT_TYPE } from './webhook-events.ts'
import {
  checkWebhookUrl,
  MAX_WEBHOOKS_PER_TOKEN,
  MAX_WEBHOOKS_PER_WORKSPACE,
  newVerificationToken,
  shortFailure,
  verificationTokenMatches,
} from './webhook-format.ts'

/** "다시 보내기" 의 간격. */
export const VERIFICATION_RESEND_SECONDS = 10
/** 기다리는 테스트 이벤트의 상한(구독마다). */
export const MAX_PENDING_TESTS = 5
/** 배달 기록의 줄 수. */
export const DELIVERY_LOG_LIMIT = 20

export type ApiWebhookFailure =
  /** 로그인 세션이 아니다(토큰 · 위임) · 게스트(만들기). */
  | 'forbidden'
  /** 내 (폐기하지 않은) 토큰 · 그 토큰의 구독이 아니다. */
  | 'not_found'
  /** 토큰이 만료했다 — 만들기 · 다시 보내기 · 테스트를 하지 않는다. */
  | 'token_inactive'
  | 'invalid_url'
  /** 이벤트가 없거나 카탈로그 밖이다. */
  | 'invalid_events'
  /** 이 토큰의 구독이 이미 5개다. */
  | 'too_many'
  /** 이 워크스페이스의 구독이 이미 50개다. */
  | 'workspace_limit'
  /** 소유자가 이 워크스페이스의 웹훅을 껐다(10n-70). */
  | 'webhooks_disabled'
  /** 붙여 넣은 확인 토큰이 맞지 않는다. */
  | 'wrong_token'
  /** 확인을 기다리는 구독이 아니다(이미 확인했다). */
  | 'not_pending'
  /** 지금 상태에서 할 수 없다(확인 전에 멈추기 · 켜지지 않은 구독의 테스트 …). */
  | 'invalid_state'
  /** 확인 토큰을 방금 보냈다(10초). */
  | 'too_soon'
  /** 기다리는 테스트가 이미 다섯이다. */
  | 'test_pending'

export type ApiWebhookResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ApiWebhookFailure; readonly problem?: OutboundUrlProblem }

const fail = (reason: ApiWebhookFailure, problem?: OutboundUrlProblem) =>
  ({ ok: false, reason, ...(problem === undefined ? {} : { problem }) }) as const

export type ApiWebhookStatus = 'pending_verification' | 'active' | 'paused' | 'disabled'
export type ApiWebhookEventStatus = 'pending' | 'delivered' | 'failed' | 'skipped'

/** 목록의 한 줄 — 주소는 힌트만 · 확인 토큰은 없다. 시각은 ISO 문자열. */
export type ApiWebhookSummary = {
  readonly id: string
  readonly tokenId: string
  readonly urlHint: string
  readonly eventTypes: readonly string[]
  readonly status: ApiWebhookStatus
  readonly disabledReason: 'failures' | 'token_revoked' | null
  /** 토큰이 만료했다 — 상태와 따로 보내지 않는다(화면이 "멈춤 · 토큰 만료"). */
  readonly tokenExpired: boolean
  readonly createdAt: string
  readonly verifiedAt: string | null
  readonly verification: { readonly sentAt: string | null; readonly httpStatus: number | null; readonly error: string | null }
  /** 마지막으로 시도했거나 끝난 이벤트. */
  readonly lastDelivery: {
    readonly status: ApiWebhookEventStatus
    readonly at: string
    readonly httpStatus: number | null
    readonly attempts: number
    readonly error: string | null
    readonly skipReason: string | null
  } | null
  readonly pending: number
}

/** 배달 기록의 한 줄 — 응답 본문은 없다(상태 코드 · 짧은 까닭만). */
export type ApiWebhookDelivery = {
  readonly id: string
  readonly eventId: string
  readonly type: string
  readonly status: ApiWebhookEventStatus
  readonly attempts: number
  readonly occurredAt: string
  readonly lastAttemptAt: string | null
  readonly nextAttemptAt: string | null
  readonly httpStatus: number | null
  readonly error: string | null
  readonly skipReason: string | null
}

/** 보내기를 바꿔 끼운다 — 검사가 받는 쪽을 흉내 낸다(라우트 · 워커는 주지 않는다). 본문은 이미 만든 JSON 글이다. */
export type ApiWebhookSender = (url: string, json: string, headers: Readonly<Record<string, string>>) => Promise<OutboundResult>

export const defaultWebhookSender: ApiWebhookSender = (url, json, headers) => postJsonText(url, json, { headers })

// ── 문 ────────────────────────────────────────────────────────────────

/** 내 (폐기하지 않은) 토큰인가 — 바꾸는 명령은 토큰 행을 잠근다(토큰마다 세기를 줄 세운다). */
async function tokenGate(
  tx: Tx,
  ctx: SessionContext,
  tokenId: string,
  lock: boolean,
): Promise<{ readonly ok: true; readonly expired: boolean } | ReturnType<typeof fail>> {
  if (!isLoginSession(ctx)) return fail('forbidden')
  if (!isUuid(tokenId)) return fail('not_found')
  const row = await tx.queryMaybe<{ expired: boolean }>(
    `SELECT (expires_at IS NOT NULL AND expires_at <= now()) AS expired FROM api_token
      WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND revoked_at IS NULL
      ${lock ? 'FOR UPDATE' : ''}`,
    [tokenId, ctx.workspaceId, ctx.userId],
  )
  return row === null ? fail('not_found') : { ok: true, expired: row.expired }
}

type SubRow = {
  id: string
  status: ApiWebhookStatus
  disabled_reason: 'failures' | 'token_revoked' | null
  url_hint: string
  url_sealed: Buffer
  secret_sealed: Buffer
  recently_sent: boolean
}

/** 그 토큰의 구독 — 잠근다(상태를 바꾸는 명령이 줄 선다). 비밀 칸은 명령 안에서만 읽고 돌려주지 않는다. */
async function lockSubscription(tx: Tx, tokenId: string, webhookId: string): Promise<SubRow | null> {
  if (!isUuid(webhookId)) return null
  return tx.queryMaybe<SubRow>(
    `SELECT id, status, disabled_reason, url_hint, url_sealed, secret_sealed,
            (verification_sent_at IS NOT NULL AND verification_sent_at > now() - make_interval(secs => $3)) AS recently_sent
       FROM api_webhook_subscription WHERE id = $1 AND api_token_id = $2
      FOR UPDATE`,
    [webhookId, tokenId, VERIFICATION_RESEND_SECONDS],
  )
}

// ── 읽기 ──────────────────────────────────────────────────────────────

type SummaryRow = {
  id: string
  api_token_id: string
  url_hint: string
  event_types: string[]
  status: ApiWebhookStatus
  disabled_reason: 'failures' | 'token_revoked' | null
  created_at: Date
  verified_at: Date | null
  verification_sent_at: Date | null
  verification_status: number | null
  verification_error: string | null
  token_expired: boolean
  pending: number
  last_status: ApiWebhookEventStatus | null
  last_at: Date | null
  last_http: number | null
  last_attempts: number | null
  last_error: string | null
  last_skip: string | null
}

// 비밀 칸(`url_sealed` · `secret_sealed`)을 고르지 않는다 — 읽기 함수는 그것을 만질 일이 없다
const SUMMARY_SELECT = `
  SELECT s.id, s.api_token_id, s.url_hint, s.event_types, s.status, s.disabled_reason, s.created_at, s.verified_at,
         s.verification_sent_at, s.verification_status, s.verification_error,
         (t.expires_at IS NOT NULL AND t.expires_at <= now()) AS token_expired,
         (SELECT count(*)::int FROM api_webhook_event p WHERE p.subscription_id = s.id AND p.status = 'pending') AS pending,
         ld.status AS last_status, ld.at AS last_at, ld.last_http_status AS last_http, ld.attempts AS last_attempts,
         ld.last_error, ld.skip_reason AS last_skip
    FROM api_webhook_subscription s
    JOIN api_token t ON t.id = s.api_token_id
    LEFT JOIN LATERAL (
      SELECT e.status, coalesce(e.finished_at, e.last_attempt_at) AS at, e.last_http_status, e.attempts, e.last_error, e.skip_reason
        FROM api_webhook_event e
       WHERE e.subscription_id = s.id AND (e.last_attempt_at IS NOT NULL OR e.finished_at IS NOT NULL)
       ORDER BY coalesce(e.finished_at, e.last_attempt_at) DESC, e.seq DESC
       LIMIT 1
    ) ld ON true`

const iso = (d: Date | null) => d?.toISOString() ?? null

const summaryOf = (r: SummaryRow): ApiWebhookSummary => ({
  id: r.id,
  tokenId: r.api_token_id,
  urlHint: r.url_hint,
  eventTypes: r.event_types,
  status: r.status,
  disabledReason: r.disabled_reason,
  tokenExpired: r.token_expired,
  createdAt: r.created_at.toISOString(),
  verifiedAt: iso(r.verified_at),
  verification: { sentAt: iso(r.verification_sent_at), httpStatus: r.verification_status, error: r.verification_error },
  lastDelivery:
    r.last_status === null || r.last_at === null
      ? null
      : {
          status: r.last_status,
          at: r.last_at.toISOString(),
          httpStatus: r.last_http,
          attempts: r.last_attempts ?? 0,
          error: r.last_error,
          skipReason: r.last_skip,
        },
  pending: r.pending,
})

async function readSummary(run: Pick<Tx, 'queryOne'>, webhookId: string): Promise<ApiWebhookSummary> {
  return summaryOf(await run.queryOne<SummaryRow>(`${SUMMARY_SELECT} WHERE s.id = $1`, [webhookId]))
}

/** 내 토큰의 구독 — 만든 차례로. */
export async function listApiWebhooks(ctx: SessionContext, tokenId: string): Promise<ApiWebhookResult<ApiWebhookSummary[]>> {
  return withReadTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    const rows = await tx.query<SummaryRow>(`${SUMMARY_SELECT} WHERE s.api_token_id = $1 ORDER BY s.created_at, s.id`, [tokenId])
    return { ok: true, value: rows.map(summaryOf) } as const
  })
}

/** 구독 하나와 최근 배달 기록(최근 것부터 20줄). */
export async function getApiWebhook(
  ctx: SessionContext,
  tokenId: string,
  webhookId: string,
): Promise<ApiWebhookResult<{ readonly webhook: ApiWebhookSummary; readonly deliveries: ApiWebhookDelivery[] }>> {
  return withReadTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    if (!isUuid(webhookId)) return fail('not_found')
    const row = await tx.queryMaybe<SummaryRow>(`${SUMMARY_SELECT} WHERE s.id = $1 AND s.api_token_id = $2`, [webhookId, tokenId])
    if (row === null) return fail('not_found')
    const events = await tx.query<{
      id: string
      event_id: string
      type: string
      status: ApiWebhookEventStatus
      attempts: number
      occurred_at: Date
      last_attempt_at: Date | null
      next_attempt_at: Date | null
      last_http_status: number | null
      last_error: string | null
      skip_reason: string | null
    }>(
      `SELECT id, event_id, type, status, attempts, occurred_at, last_attempt_at, next_attempt_at, last_http_status, last_error, skip_reason
         FROM api_webhook_event WHERE subscription_id = $1
        ORDER BY seq DESC LIMIT $2`,
      [webhookId, DELIVERY_LOG_LIMIT],
    )
    return {
      ok: true,
      value: {
        webhook: summaryOf(row),
        deliveries: events.map((e) => ({
          id: e.id,
          eventId: e.event_id,
          type: e.type,
          status: e.status,
          attempts: e.attempts,
          occurredAt: e.occurred_at.toISOString(),
          lastAttemptAt: iso(e.last_attempt_at),
          nextAttemptAt: iso(e.next_attempt_at),
          httpStatus: e.last_http_status,
          error: e.last_error,
          skipReason: e.skip_reason,
        })),
      },
    } as const
  })
}

// ── 만들기 · 확인 토큰 ────────────────────────────────────────────────

/** 확인 토큰을 받는 주소로 한 번 POST 하고(노션 — 서명 없음) 결과를 구독에 적는다. 트랜잭션 밖에서 부른다. */
async function postVerification(webhookId: string, url: string, secret: string, send: ApiWebhookSender): Promise<void> {
  const result = await send(url, JSON.stringify({ verification_token: secret }), {})
  const status = result.status !== null && result.status >= 100 && result.status <= 599 ? result.status : null
  await query(
    `UPDATE api_webhook_subscription
        SET verification_sent_at = now(), verification_status = $2, verification_error = $3, updated_at = now()
      WHERE id = $1`,
    [webhookId, status, result.ok ? null : shortFailure(result)],
  )
}

/**
 * 구독을 만든다 — 확인을 기다리는 상태로 두고, 커밋한 뒤 받는 주소로 확인 토큰을 보낸다.
 *
 * @param options.send 보내기를 바꿔 끼운다(검사만)
 */
export async function createApiWebhook(
  ctx: SessionContext,
  tokenId: string,
  input: { readonly url: unknown; readonly eventTypes: unknown },
  options: { readonly send?: ApiWebhookSender } = {},
): Promise<ApiWebhookResult<ApiWebhookSummary>> {
  if (!isLoginSession(ctx) || ctx.role === 'guest') return fail('forbidden')
  const checked = checkWebhookUrl(input.url)
  const events = parseEventTypes(input.eventTypes)
  const secret = newVerificationToken()
  const id = randomUUID()

  const made = await withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, true)
    if (!gate.ok) return gate
    if (gate.expired) return fail('token_inactive')
    // 워크스페이스 스위치(10n-70) — 권한 다음에 묻는다
    if (!(await webhooksAllowedIn(tx, ctx.workspaceId))) return fail('webhooks_disabled')
    if (!checked.ok) return fail('invalid_url', checked.problem)
    if (events === null) return fail('invalid_events')
    const perToken = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_webhook_subscription WHERE api_token_id = $1`, [tokenId])
    if (perToken.n >= MAX_WEBHOOKS_PER_TOKEN) return fail('too_many')
    // 워크스페이스마다 세기 — 다른 사람 · 토큰의 동시 만들기와 줄 선다
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('api-webhooks:' || $1, 0))`, [ctx.workspaceId])
    const perWorkspace = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_webhook_subscription WHERE workspace_id = $1`, [
      ctx.workspaceId,
    ])
    if (perWorkspace.n >= MAX_WEBHOOKS_PER_WORKSPACE) return fail('workspace_limit')
    const urlHint = webhookUrlHint(checked.url)
    await tx.query(
      `INSERT INTO api_webhook_subscription (id, workspace_id, api_token_id, user_id, url_sealed, url_hint, secret_sealed, event_types, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'pending_verification')`,
      [id, ctx.workspaceId, tokenId, ctx.userId, sealWebhookUrl(checked.url.href), urlHint, sealWebhookSecret(secret), events],
    )
    await recordForContextIn(tx, ctx, 'account.security_changed', {
      metadata: { change: 'api_webhook_created', tokenId, webhookId: id, name: urlHint, events },
    })
    return { ok: true, value: checked.url.href } as const
  })
  if (!made.ok) return made

  await postVerification(id, made.value, secret, options.send ?? defaultWebhookSender)
  return { ok: true, value: await readSummary({ queryOne }, id) }
}

/** 확인 토큰을 다시 보낸다 — 확인을 기다릴 때만 · 10초에 한 번. */
export async function resendApiWebhookVerification(
  ctx: SessionContext,
  tokenId: string,
  webhookId: string,
  options: { readonly send?: ApiWebhookSender } = {},
): Promise<ApiWebhookResult<ApiWebhookSummary>> {
  const claimed = await withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    const sub = await lockSubscription(tx, tokenId, webhookId)
    if (sub === null) return fail('not_found')
    if (sub.status !== 'pending_verification') return fail('not_pending')
    if (gate.expired) return fail('token_inactive')
    if (!(await webhooksAllowedIn(tx, ctx.workspaceId))) return fail('webhooks_disabled')
    if (sub.recently_sent) return fail('too_soon')
    const url = unsealWebhookUrl(sub.url_sealed)
    const secret = unsealWebhookSecret(sub.secret_sealed)
    if (url === null || secret === null) return fail('not_found')
    // 간격을 먼저 차지한다 — 같은 순간의 두 번째 누름이 두 번 보내지 않게
    await tx.query(`UPDATE api_webhook_subscription SET verification_sent_at = now(), updated_at = now() WHERE id = $1`, [webhookId])
    return { ok: true, value: { url, secret } } as const
  })
  if (!claimed.ok) return claimed
  await postVerification(webhookId, claimed.value.url, claimed.value.secret, options.send ?? defaultWebhookSender)
  return { ok: true, value: await readSummary({ queryOne }, webhookId) }
}

/** 붙여 넣은 확인 토큰으로 구독을 켠다. */
export async function verifyApiWebhook(
  ctx: SessionContext,
  tokenId: string,
  webhookId: string,
  verificationToken: unknown,
): Promise<ApiWebhookResult<ApiWebhookSummary>> {
  return withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    const sub = await lockSubscription(tx, tokenId, webhookId)
    if (sub === null) return fail('not_found')
    if (sub.status !== 'pending_verification') return fail('not_pending')
    const secret = unsealWebhookSecret(sub.secret_sealed)
    if (secret === null || !verificationTokenMatches(verificationToken, secret)) return fail('wrong_token')
    await tx.query(
      `UPDATE api_webhook_subscription SET status = 'active', verified_at = now(), updated_at = now() WHERE id = $1`,
      [webhookId],
    )
    await recordForContextIn(tx, ctx, 'account.security_changed', {
      metadata: { change: 'api_webhook_verified', tokenId, webhookId, name: sub.url_hint },
    })
    return { ok: true, value: await readSummary(tx, webhookId) } as const
  })
}

// ── 멈추기 · 지우기 · 테스트 ──────────────────────────────────────────

/** 기다리던 이벤트를 건너뛴 것으로 — 멈추기 · 끄기 · 토큰 폐기가 같은 트랜잭션에서 부른다. 묶는 중인 줄은 창도 닫는다(API-9). */
export async function skipPendingApiWebhookEventsIn(tx: Pick<Tx, 'query'>, subscriptionIds: readonly string[], reason: string): Promise<void> {
  if (subscriptionIds.length === 0) return
  await tx.query(
    `UPDATE api_webhook_event
        SET status = 'skipped', skip_reason = $2, next_attempt_at = NULL, finished_at = now(), window_started_at = NULL
      WHERE subscription_id = ANY($1::uuid[]) AND status = 'pending'`,
    [subscriptionIds, reason],
  )
}

/** 멈추거나(`active` → `paused`) 다시 켠다(`paused` · 실패로 꺼진 것 → `active`). 이미 그 상태면 그대로다. */
export async function setApiWebhookPaused(
  ctx: SessionContext,
  tokenId: string,
  webhookId: string,
  paused: unknown,
): Promise<ApiWebhookResult<ApiWebhookSummary>> {
  if (typeof paused !== 'boolean') return fail('invalid_state')
  return withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    const sub = await lockSubscription(tx, tokenId, webhookId)
    if (sub === null) return fail('not_found')
    if (paused) {
      if (sub.status === 'paused') return { ok: true, value: await readSummary(tx, webhookId) } as const
      if (sub.status !== 'active') return fail('invalid_state')
      await tx.query(`UPDATE api_webhook_subscription SET status = 'paused', updated_at = now() WHERE id = $1`, [webhookId])
      await skipPendingApiWebhookEventsIn(tx, [webhookId], 'paused')
    } else {
      if (sub.status === 'active') return { ok: true, value: await readSummary(tx, webhookId) } as const
      const resumable = sub.status === 'paused' || (sub.status === 'disabled' && sub.disabled_reason === 'failures')
      if (!resumable) return fail('invalid_state')
      await tx.query(
        `UPDATE api_webhook_subscription
            SET status = 'active', disabled_reason = NULL, consecutive_failures = 0, updated_at = now()
          WHERE id = $1`,
        [webhookId],
      )
    }
    return { ok: true, value: await readSummary(tx, webhookId) } as const
  })
}

/** 지운다 — 기다리던 이벤트 · 기록도 함께 사라진다(FK CASCADE). */
export async function removeApiWebhook(ctx: SessionContext, tokenId: string, webhookId: string): Promise<ApiWebhookResult<null>> {
  return withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    if (!isUuid(webhookId)) return fail('not_found')
    const removed = await tx.queryMaybe<{ url_hint: string }>(
      `DELETE FROM api_webhook_subscription WHERE id = $1 AND api_token_id = $2 RETURNING url_hint`,
      [webhookId, tokenId],
    )
    if (removed === null) return fail('not_found')
    await recordForContextIn(tx, ctx, 'account.security_changed', {
      metadata: { change: 'api_webhook_deleted', tokenId, webhookId, name: removed.url_hint },
    })
    return { ok: true, value: null } as const
  })
}

/**
 * `test` 이벤트를 아웃박스에 넣는다 — 워커가 보통의 이벤트처럼 보낸다. 대상은 구독 자신 · 저자는 이 사람.
 *
 * @param options.now 이벤트의 시각 · 첫 시도 시각(검사가 정한다 · 라우트는 지금)
 */
export async function sendApiWebhookTest(
  ctx: SessionContext,
  tokenId: string,
  webhookId: string,
  options: { readonly now?: Date } = {},
): Promise<ApiWebhookResult<{ readonly eventId: string }>> {
  const now = options.now ?? new Date()
  return withCommandTransaction(async (tx) => {
    const gate = await tokenGate(tx, ctx, tokenId, false)
    if (!gate.ok) return gate
    const sub = await lockSubscription(tx, tokenId, webhookId)
    if (sub === null) return fail('not_found')
    if (gate.expired) return fail('token_inactive')
    if (sub.status !== 'active') return fail('invalid_state')
    if (!(await webhooksAllowedIn(tx, ctx.workspaceId))) return fail('webhooks_disabled')
    const waiting = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_webhook_event WHERE subscription_id = $1 AND status = 'pending' AND type = $2`,
      [webhookId, TEST_EVENT_TYPE],
    )
    if (waiting.n >= MAX_PENDING_TESTS) return fail('test_pending')
    const eventId = randomUUID()
    await tx.query(
      `INSERT INTO api_webhook_event (id, subscription_id, workspace_id, event_id, type, entity_id, entity_type, authors, data, occurred_at, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $2, 'webhook_subscription', $6::jsonb, '{}'::jsonb, $7, 'pending', $7)`,
      [randomUUID(), webhookId, ctx.workspaceId, eventId, TEST_EVENT_TYPE, JSON.stringify([{ id: ctx.userId, type: 'person' }]), now],
    )
    return { ok: true, value: { eventId } } as const
  })
}

/** 실패를 HTTP 로 — 권한 403 · 없음 404 · 상한 · 상태 409 · 간격 429 · 그 밖 400. */
export function apiWebhookFailureStatus(reason: ApiWebhookFailure): number {
  switch (reason) {
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'too_many':
    case 'workspace_limit':
    case 'not_pending':
    case 'invalid_state':
    case 'test_pending':
      return 409
    case 'too_soon':
      return 429
    default:
      return 400
  }
}
