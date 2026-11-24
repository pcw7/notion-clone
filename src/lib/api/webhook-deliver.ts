/**
 * 공개 API 웹훅 보내기 — 공용 스케줄러의 열 번째 소비자 `api_webhook_deliver` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ · §3.10 [보강] 공용 스케줄러 · 마이그레이션 0151
 *
 * 아웃박스(`api_webhook_event`)의 때가 된 줄을 보낸다. 페이지 웹훅 · 자동화의 보내기(`notification/webhook-delivery.ts` ·
 * `automation/webhook-send.ts`)와 같은 뼈대다.
 *
 *   ① 잡기 — 때가 된 줄이 있는 구독을 `FOR UPDATE SKIP LOCKED` 로 잡아 **구독 행에** 임대를 걸고 커밋한다 — 한 구독에 동시에 하나만
 *     보낸다. 지운 워크스페이스의 구독은 건드리지 않는다(되살리면 이어 간다 · AD-1 ③).
 *   ② 차례 — 구독 안에서 때가 된 줄 중 **같은 대상의 앞선 줄이 기다리는 중이 아닌** 것을 차례로(대상마다 순서를 지킨다 · 다른 대상은
 *     앞의 실패에 막히지 않는다). 한 판에 구독마다 열까지. 묶는 중인 줄(API-9 · `window_started_at`)이면 **먼저 봉인한다** — 창을 비우고
 *     그 순간의 합친 내용을 다시 읽는다. 합치던 쓰기가 줄을 잡고 있으면 그 커밋을 기다린다 · 봉인한 뒤의 변경은 새 줄로 간다(보낸 것에
 *     합쳐 사라지지 않는다).
 *   ③ 다시 보기 — **보내기 전마다** 구독의 상태(멈춤 · 꺼짐 · 확인 전) · 워크스페이스 스위치(10n-70) · **토큰의 컨텍스트**를 다시 얻는다
 *     (`resolveSessionContext({ apiTokenId })` — 발급자는 그대로 둘 · 폐기 · 만료 · 사람 · 멤버십 · 게스트 · SSO 를 같은 게이트로). 안 되면
 *     그 구독의 기다리던 줄을 모두 `skipped`(까닭). 대상 이벤트는 그 사람이 지금 대상을 볼 수 있는지 묻는다 — 아니면 그 줄만 `skipped`.
 *   ④ 보내기 — **트랜잭션 밖에서** 바깥 요청의 한 길로(10초 · 리다이렉트 없음 · 응답 본문은 읽고 버린다). 본문은 봉투의 JSON 글 그대로 ·
 *     `X-Notion-Signature: sha256=<HMAC>`(비밀 = 확인 토큰 · 봉인을 풀어 쓴다).
 *   ⑤ 적기 — 내 임대일 때만. 2xx 면 `delivered` · 잇단 실패 수를 0 으로. 아니면 다음 시도(`webhookRetryDelayMs`) · 여덟 번째도 실패면
 *     `failed` 로 끝내고 잇단 실패 수를 올린다 — 셋이면 구독을 끈다(`disabled` · `failures` · 기다리던 줄은 건너뛴다).
 *
 * 워커가 보내다 죽으면 임대가 지나 다시 보낸다 — **적어도 한 번**이다(노션은 "많아야 한 번"). 받는 쪽은 봉투의 `id` 로 겹친 것을 거른다.
 */

import { resolveSessionContext, type SessionContext, type SessionDenialReason } from '../auth/session-context.ts'
import { query, queryMaybe } from '../db/pool.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { unsealWebhookSecret, unsealWebhookUrl } from '../net/url-seal.ts'
import { webhooksAllowedIn } from '../notification/webhook-switch.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import {
  AUTO_DISABLE_AFTER_FAILED_EVENTS,
  buildWebhookEnvelope,
  MAX_WEBHOOK_ATTEMPTS,
  shortFailure,
  SIGNATURE_HEADER,
  signWebhookBody,
  webhookRetryDelayMs,
} from './webhook-format.ts'
import { defaultWebhookSender, skipPendingApiWebhookEventsIn, type ApiWebhookSender } from './webhooks.ts'

/** 한 판에 잡는 구독의 수. */
export const DELIVERY_SUBSCRIPTIONS = 20
/** 한 판에 구독마다 보내는 줄의 수. */
export const EVENTS_PER_SUBSCRIPTION = 10
/** 구독의 임대 — 한 줄의 시간 상한(10초) × 열 줄보다 넉넉히. */
const LEASE_MS = 5 * 60_000

export type ApiWebhookPass = {
  readonly delivered: number
  readonly retried: number
  readonly failed: number
  readonly skipped: number
  /** 이 판에 잇단 실패로 끈 구독. */
  readonly disabled: number
  readonly more: boolean
}

type Head = {
  id: string
  event_id: string
  type: string
  entity_id: string
  entity_type: string
  authors: unknown
  data: unknown
  occurred_at: Date
  attempts: number
  window_started_at: Date | null
}

type Skip =
  | 'paused'
  | 'disabled'
  | 'not_verified'
  | 'token_revoked'
  | 'token_expired'
  | 'access_lost'
  | 'entity_not_visible'
  | 'webhooks_disabled'
  | 'unseal_failed'

/** 컨텍스트를 얻지 못한 까닭 → 건너뛴 까닭. 폐기 · 만료 밖은 모두 "볼 수 없게 됐다"(사람 · 멤버십 · 게스트 · SSO · 지운 워크스페이스). */
function skipOfDenial(reason: SessionDenialReason): Skip {
  if (reason === 'revoked') return 'token_revoked'
  if (reason === 'expired') return 'token_expired'
  return 'access_lost'
}

/**
 * 그 사람이 지금 대상을 볼 수 있는가 — `test` 의 대상은 구독 자신. 페이지 · 블록 · 데이터베이스는 그 노드의, 데이터 소스는 그것을
 * 가진 데이터베이스의 `view`. 댓글(API-9)은 그 댓글이 사는 페이지(`data.page_id` — 마지막 댓글을 지우면 스레드째 사라지므로 줄이 든다)의
 * `view` · 제안의 스레드는 댓글이 아니다(공개 API 의 댓글 읽기와 같다).
 *
 * **휴지통의 노드도 그 ACL 로 본다**(정본 ⑬ — 휴지통은 ACL 을 지우지 않는다 · 공개 API 의 페이지 읽기가 휴지통의 페이지를 `in_trash` 로
 * 주는 것과 같다) — 그래서 `page.deleted` 는 버리기 전에 볼 수 있던 사람에게 간다. 영구 삭제한 것 · 템플릿은 없는 것이다.
 */
async function entityVisible(ctx: SessionContext, subscriptionId: string, head: Head): Promise<boolean> {
  const nodeVisible = async (tx: Tx, nodeId: string): Promise<boolean> => {
    const node = await tx.queryMaybe<{ lifecycle: string; is_template: boolean | null }>(
      `SELECT b.lifecycle::text AS lifecycle, p.is_template FROM block b LEFT JOIN page p ON p.id = b.id WHERE b.id = $1 AND b.workspace_id = $2`,
      [nodeId, ctx.workspaceId],
    )
    if (node === null || node.lifecycle === 'purged' || node.is_template === true) return false
    return can(await effectiveCaps(tx, ctx, nodeId), 'view')
  }
  switch (head.entity_type) {
    case 'webhook_subscription':
      return head.entity_id === subscriptionId
    case 'page':
    case 'block':
    case 'database':
      return withReadTransaction((tx) => nodeVisible(tx, head.entity_id))
    case 'data_source':
      return withReadTransaction(async (tx) => {
        const owner = await tx.queryMaybe<{ db: string; lifecycle: string }>(
          `SELECT owner_database_id AS db, lifecycle::text AS lifecycle FROM data_source WHERE id = $1`,
          [head.entity_id],
        )
        return owner !== null && owner.lifecycle !== 'purged' && (await nodeVisible(tx, owner.db))
      })
    case 'comment': {
      const pageId = (head.data as { page_id?: unknown } | null)?.page_id
      if (typeof pageId !== 'string') return false
      return withReadTransaction(async (tx) => {
        const suggestion = await tx.queryMaybe<{ one: number }>(
          `SELECT 1 AS one FROM comment c JOIN suggestion s ON s.thread_id = c.discussion_id WHERE c.id = $1 LIMIT 1`,
          [head.entity_id],
        )
        return suggestion === null && (await nodeVisible(tx, pageId))
      })
    }
    default:
      return false
  }
}

/**
 * @param options.workspaces 이 워크스페이스들의 구독만 — 검사 · e2e 가 다른 판의 줄을 보내지 않게(워커는 주지 않는다)
 * @param options.send 보내기를 바꿔 끼운다(검사만)
 * @param options.random 다시 보내기 간격의 흔들기(검사만)
 */
export async function runApiWebhookDelivery(
  now: Date,
  options: { readonly workspaces?: readonly string[]; readonly send?: ApiWebhookSender; readonly batch?: number; readonly random?: () => number } = {},
): Promise<ApiWebhookPass> {
  const batch = options.batch ?? DELIVERY_SUBSCRIPTIONS
  const lease = new Date(now.getTime() + LEASE_MS)
  const send = options.send ?? defaultWebhookSender

  // ① 잡기
  const claimed = await withTransaction(async (tx) => {
    const due = await tx.query<{ id: string }>(
      `SELECT s.id FROM api_webhook_subscription s
        WHERE (s.locked_until IS NULL OR s.locked_until < $1)
          AND ($3::uuid[] IS NULL OR s.workspace_id = ANY($3::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM workspace w WHERE w.id = s.workspace_id AND w.deleted_at IS NOT NULL)
          AND EXISTS (SELECT 1 FROM api_webhook_event e WHERE e.subscription_id = s.id AND e.status = 'pending' AND e.next_attempt_at <= $1)
        ORDER BY (SELECT min(e.next_attempt_at) FROM api_webhook_event e WHERE e.subscription_id = s.id AND e.status = 'pending'), s.id
        LIMIT $2
        FOR UPDATE OF s SKIP LOCKED`,
      [now, batch, options.workspaces ?? null],
    )
    if (due.length === 0) return []
    await tx.query(`UPDATE api_webhook_subscription SET locked_until = $2 WHERE id = ANY($1::uuid[])`, [due.map((d) => d.id), lease])
    return due.map((d) => d.id)
  })

  const tally = { delivered: 0, retried: 0, failed: 0, skipped: 0, disabled: 0 }
  let more = claimed.length === batch
  for (const subscriptionId of claimed) {
    try {
      const full = await deliverSubscription(subscriptionId, now, lease, send, options.random ?? Math.random, tally)
      if (full) more = true
    } finally {
      await query(`UPDATE api_webhook_subscription SET locked_until = NULL WHERE id = $1 AND locked_until = $2`, [subscriptionId, lease])
    }
  }
  return { ...tally, more }
}

/** 한 구독의 줄들 — 차례 · 다시 보기 · 보내기 · 적기. 열 줄을 다 채웠으면 참(더 남았을 수 있다). */
async function deliverSubscription(
  subscriptionId: string,
  now: Date,
  lease: Date,
  send: ApiWebhookSender,
  random: () => number,
  tally: { delivered: number; retried: number; failed: number; skipped: number; disabled: number },
): Promise<boolean> {
  for (let handled = 0; handled < EVENTS_PER_SUBSCRIPTION; handled += 1) {
    // ② 차례 — 같은 대상의 앞선 줄이 기다리는 중이면 뒤의 줄은 기다린다
    const found = await queryMaybe<Head>(
      `SELECT e.id, e.event_id, e.type, e.entity_id, e.entity_type, e.authors, e.data, e.occurred_at, e.attempts, e.window_started_at
         FROM api_webhook_event e
        WHERE e.subscription_id = $1 AND e.status = 'pending' AND e.next_attempt_at <= $2
          AND NOT EXISTS (SELECT 1 FROM api_webhook_event p
                           WHERE p.subscription_id = e.subscription_id AND p.entity_id = e.entity_id AND p.status = 'pending' AND p.seq < e.seq)
        ORDER BY e.next_attempt_at, e.seq
        LIMIT 1`,
      [subscriptionId, now],
    )
    if (found === null) return false
    // 묶는 중이면 봉인한다 — 합치던 쓰기의 커밋을 기다리고 그 내용으로 보낸다(머리말 ②)
    let head = found
    if (found.window_started_at !== null) {
      const sealed = await queryMaybe<{ authors: unknown; data: unknown; occurred_at: Date }>(
        `UPDATE api_webhook_event SET window_started_at = NULL
          WHERE id = $1 AND status = 'pending' AND window_started_at IS NOT NULL
          RETURNING authors, data, occurred_at`,
        [found.id],
      )
      if (sealed === null) continue
      head = { ...found, ...sealed, window_started_at: null }
    }

    // ③ 다시 보기
    const sub = await queryMaybe<{
      status: string
      url_sealed: Buffer
      secret_sealed: Buffer
      api_token_id: string
      workspace_id: string
      workspace_name: string
    }>(
      `SELECT s.status, s.url_sealed, s.secret_sealed, s.api_token_id, s.workspace_id, w.name AS workspace_name
         FROM api_webhook_subscription s JOIN workspace w ON w.id = s.workspace_id
        WHERE s.id = $1 AND s.locked_until = $2`,
      [subscriptionId, lease],
    )
    if (sub === null) return false // 지웠거나 임대를 잃었다
    const skipAll = async (reason: Skip) => {
      tally.skipped += await finishSkipAll(subscriptionId, lease, reason)
    }
    if (sub.status !== 'active') {
      await skipAll(sub.status === 'paused' ? 'paused' : sub.status === 'disabled' ? 'disabled' : 'not_verified')
      return false
    }
    if (!(await webhooksAllowedIn({ query }, sub.workspace_id))) {
      await skipAll('webhooks_disabled')
      return false
    }
    const resolved = await resolveSessionContext({ apiTokenId: sub.api_token_id })
    if (!resolved.ok) {
      await skipAll(skipOfDenial(resolved.reason))
      return false
    }
    const url = unsealWebhookUrl(sub.url_sealed)
    const secret = unsealWebhookSecret(sub.secret_sealed)
    if (url === null || secret === null) {
      await skipAll('unseal_failed')
      return false
    }
    if (!(await entityVisible(resolved.context, subscriptionId, head))) {
      if (await finishOne(head.id, subscriptionId, lease, { status: 'skipped', reason: 'entity_not_visible', now })) tally.skipped += 1
      continue
    }

    // ④ 보내기 — 트랜잭션 밖에서
    const attempt = head.attempts + 1
    const body = JSON.stringify(
      buildWebhookEnvelope({
        eventId: head.event_id,
        occurredAt: head.occurred_at,
        workspaceId: sub.workspace_id,
        workspaceName: sub.workspace_name,
        subscriptionId,
        tokenId: sub.api_token_id,
        type: head.type,
        authors: head.authors,
        attemptNumber: attempt,
        entity: { id: head.entity_id, type: head.entity_type },
        data: head.data,
      }),
    )
    const result = await send(url, body, { [SIGNATURE_HEADER]: signWebhookBody(body, secret) })

    // ⑤ 적기
    const httpStatus = result.status !== null && result.status >= 100 && result.status <= 599 ? result.status : null
    if (result.ok) {
      if (await finishOne(head.id, subscriptionId, lease, { status: 'delivered', attempt, httpStatus, now })) tally.delivered += 1
    } else if (attempt >= MAX_WEBHOOK_ATTEMPTS) {
      const outcome = await finishFailed(head.id, subscriptionId, lease, { attempt, httpStatus, error: shortFailure(result), now })
      if (outcome !== null) {
        tally.failed += 1
        if (outcome.disabled) {
          tally.disabled += 1
          tally.skipped += outcome.skipped
          return false
        }
      }
    } else {
      const nextAt = new Date(now.getTime() + webhookRetryDelayMs(attempt, random))
      if (await finishOne(head.id, subscriptionId, lease, { status: 'pending', attempt, httpStatus, error: shortFailure(result), nextAt, now })) {
        tally.retried += 1
      }
    }
  }
  return true
}

/**
 * 내 임대인가 — 같은 트랜잭션에서 구독 행을 잠그고 본다(그 사이 다른 워커 · 명령이 끼지 않게). `FOR NO KEY UPDATE` 다(API-9) — 이벤트를
 * 쓰는 명령의 FK 검사 · `FOR KEY SHARE`(`webhook-emit.ts`)는 막지 않는다. 막으면 묶는 줄을 잡은 명령과 서로 기다릴 수 있다.
 */
const HOLDS_LEASE = `SELECT 1 FROM api_webhook_subscription WHERE id = $1 AND locked_until = $2 FOR NO KEY UPDATE`

/** 한 줄을 끝내거나(보냄 · 건너뜀) 다음 시도로 미룬다. 적었으면 참. */
async function finishOne(
  eventId: string,
  subscriptionId: string,
  lease: Date,
  outcome:
    | { readonly status: 'delivered'; readonly attempt: number; readonly httpStatus: number | null; readonly now: Date }
    | { readonly status: 'skipped'; readonly reason: Skip; readonly now: Date }
    | {
        readonly status: 'pending'
        readonly attempt: number
        readonly httpStatus: number | null
        readonly error: string
        readonly nextAt: Date
        readonly now: Date
      },
): Promise<boolean> {
  return withTransaction(async (tx) => {
    if ((await tx.query(HOLDS_LEASE, [subscriptionId, lease])).length === 0) return false
    if (outcome.status === 'skipped') {
      await tx.query(
        `UPDATE api_webhook_event SET status = 'skipped', skip_reason = $2, next_attempt_at = NULL, finished_at = $3
          WHERE id = $1 AND status = 'pending'`,
        [eventId, outcome.reason, outcome.now],
      )
      return true
    }
    await tx.query(
      `UPDATE api_webhook_event
          SET status = $2, attempts = $3, last_attempt_at = $4, last_http_status = $5, last_error = $6,
              next_attempt_at = $7, finished_at = $8
        WHERE id = $1 AND status = 'pending'`,
      [
        eventId,
        outcome.status,
        outcome.attempt,
        outcome.now,
        outcome.httpStatus,
        outcome.status === 'pending' ? outcome.error : null,
        outcome.status === 'pending' ? outcome.nextAt : null,
        outcome.status === 'delivered' ? outcome.now : null,
      ],
    )
    if (outcome.status === 'delivered') {
      await tx.query(`UPDATE api_webhook_subscription SET consecutive_failures = 0 WHERE id = $1 AND consecutive_failures <> 0`, [subscriptionId])
    }
    return true
  })
}

/** 여덟 번째 실패 — 줄을 `failed` 로 끝내고 잇단 실패 수를 올린다. 셋이면 구독을 끄고 기다리던 줄을 건너뛴다. 임대를 잃었으면 null. */
async function finishFailed(
  eventId: string,
  subscriptionId: string,
  lease: Date,
  outcome: { readonly attempt: number; readonly httpStatus: number | null; readonly error: string; readonly now: Date },
): Promise<{ readonly disabled: boolean; readonly skipped: number } | null> {
  return withTransaction(async (tx) => {
    if ((await tx.query(HOLDS_LEASE, [subscriptionId, lease])).length === 0) return null
    await tx.query(
      `UPDATE api_webhook_event
          SET status = 'failed', attempts = $2, last_attempt_at = $3, last_http_status = $4, last_error = $5,
              next_attempt_at = NULL, finished_at = $3
        WHERE id = $1 AND status = 'pending'`,
      [eventId, outcome.attempt, outcome.now, outcome.httpStatus, outcome.error],
    )
    const sub = await tx.queryOne<{ consecutive_failures: number; status: string }>(
      `UPDATE api_webhook_subscription SET consecutive_failures = consecutive_failures + 1 WHERE id = $1
        RETURNING consecutive_failures, status`,
      [subscriptionId],
    )
    if (sub.consecutive_failures < AUTO_DISABLE_AFTER_FAILED_EVENTS || sub.status !== 'active') return { disabled: false, skipped: 0 }
    await tx.query(
      `UPDATE api_webhook_subscription SET status = 'disabled', disabled_reason = 'failures', updated_at = GREATEST(updated_at, $2) WHERE id = $1`,
      [subscriptionId, outcome.now],
    )
    const waiting = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_webhook_event WHERE subscription_id = $1 AND status = 'pending'`,
      [subscriptionId],
    )
    await skipPendingApiWebhookEventsIn(tx, [subscriptionId], 'disabled')
    return { disabled: true, skipped: waiting.n }
  })
}

/** 구독의 기다리던 줄을 모두 건너뛴다(구독 단위의 까닭). 건너뛴 수. */
async function finishSkipAll(subscriptionId: string, lease: Date, reason: Skip): Promise<number> {
  return withTransaction(async (tx) => {
    if ((await tx.query(HOLDS_LEASE, [subscriptionId, lease])).length === 0) return 0
    const n = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM api_webhook_event WHERE subscription_id = $1 AND status = 'pending'`, [
      subscriptionId,
    ])
    await skipPendingApiWebhookEventsIn(tx, [subscriptionId], reason)
    return n.n
  })
}
