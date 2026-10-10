/**
 * 웹훅 보내기 — 공용 스케줄러의 여섯 번째 소비자 (히스토리 · 활동 4e-2 · F-11-19)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 페이지 웹훅 ⑥ ⑦ ⑧ · 보내기 ⓒ ⓓ ⓔ ⓕ · 마이그레이션 0076
 *
 * 1분마다(`webhook_deliver`) 때가 된 묶음을 보낸다 — 모으는 창이 끝난 것(`collecting`)과 다시 보낼 시각이 된 것(`pending`).
 *
 *   ① 잡기 — `FOR UPDATE SKIP LOCKED` 로 잡아 `pending` 으로 바꾸고 임대를 걸어 **커밋한다**. 잡는 순간 `collecting` 을 떠나므로 보내는
 *     동안 생긴 이벤트는 새 묶음으로 간다(이미 만든 본문에 끼어 보내지 않은 채 끝나는 일이 없다).
 *   ② 다시 보기 — 웹훅이 멈췄거나 걸린 페이지가 살아 있지 않으면(휴지통 — ⑧) 보내지 않고 `dropped`. 이벤트가 하나도 남지 않았어도.
 *   ③ 보내기 — **트랜잭션 밖에서**(바깥 요청이 행 잠금을 쥐지 않게) `net/outbound.ts` 의 한 길로.
 *   ④ 적기 — 내 임대일 때만. 성공이면 `sent`. 실패면 1 · 2 · 4분 뒤 다시(`pending`), 네 번째도 실패면 `failed` 로 끝내고 웹훅을 멈춘다
 *     (`failures` — 끝없는 재시도는 상대 서버를 두드리는 것이다).
 *
 * 워커가 보내다 죽으면 임대가 지나 다시 보낸다 — **적어도 한 번**이다. 받는 쪽은 `notion_clone.delivery_id` 로 겹친 것을 거른다.
 * 세션 없는 시스템 주체다 — 권한은 웹훅을 걸 때(전체 권한) · 이벤트를 고를 때(같은 권한 범위) 이미 봤다.
 */

import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { plainTitleOf } from '../block/page.ts'
import { postJson, type OutboundResult } from '../net/outbound.ts'
import { unsealWebhookUrl } from '../net/url-seal.ts'
import { isPageActivityType } from './page-activity-types.ts'
import { buildWebhookPayload, type PayloadEvent, type WebhookPayload } from './webhook-payload.ts'

/** 한 판에 잡는 묶음의 수. */
export const DELIVERY_BATCH = 20
/** 시도 상한 — 첫 시도 + 다시 세 번(정본 ⓔ). */
export const MAX_DELIVERY_ATTEMPTS = 4
/** 보내는 동안의 임대 — 바깥 요청의 시간 상한(10초)보다 넉넉히. */
const LEASE_MS = 2 * 60_000
/** n 번째 실패 뒤 다시 보낼 때까지 — 1 · 2 · 4분. */
export const retryDelayMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1)

export type DeliveryOutcome = { readonly sent: number; readonly retried: number; readonly failed: number; readonly dropped: number; readonly more: boolean }

/** 보내기를 바꿔 끼운다 — 검사가 받는 쪽을 흉내 낸다(워커는 주지 않는다). */
export type Sender = (url: string, payload: WebhookPayload) => Promise<OutboundResult>

type Claimed = { id: string; webhook_id: string; event_ids: string[]; attempts: number }

/**
 * @param options.workspaces 이 워크스페이스들의 웹훅만 — 검사가 다른 검사의 묶음을 보내지 않게(워커는 주지 않는다)
 * @param options.send 보내기를 바꿔 끼운다(검사만)
 */
export async function runWebhookDelivery(
  now: Date,
  options: { readonly workspaces?: readonly string[]; readonly send?: Sender; readonly batch?: number } = {},
): Promise<DeliveryOutcome> {
  const batch = options.batch ?? DELIVERY_BATCH
  const lease = new Date(now.getTime() + LEASE_MS)
  const send: Sender = options.send ?? ((url, payload) => postJson(url, payload))

  // ① 잡기
  const claimed = await withTransaction(async (tx) => {
    const due = await tx.query<Claimed>(
      `SELECT d.id, d.webhook_id, d.event_ids, d.attempts
         FROM webhook_delivery d
         JOIN page_webhook w ON w.id = d.webhook_id
        WHERE ((d.status = 'collecting' AND d.window_end <= $1) OR (d.status = 'pending' AND d.next_attempt_at <= $1))
          AND (d.locked_until IS NULL OR d.locked_until < $1)
          AND ($3::uuid[] IS NULL OR w.workspace_id = ANY($3::uuid[]))
        ORDER BY coalesce(d.next_attempt_at, d.window_end), d.id
        LIMIT $2
        FOR UPDATE OF d SKIP LOCKED`,
      [now, batch, options.workspaces ?? null],
    )
    if (due.length === 0) return []
    await tx.query(
      `UPDATE webhook_delivery
          SET status = 'pending', next_attempt_at = coalesce(next_attempt_at, $2), locked_until = $3
        WHERE id = ANY($1::uuid[])`,
      [due.map((d) => d.id), now, lease],
    )
    return due
  })

  let sent = 0
  let retried = 0
  let failed = 0
  let dropped = 0
  for (const delivery of claimed) {
    const prepared = await prepare(delivery)
    if (prepared.drop !== null) {
      await finish(delivery.id, lease, { status: 'dropped', now, error: prepared.drop })
      dropped += 1
      continue
    }
    // ③ 보내기 — 트랜잭션 밖에서
    const result = await send(prepared.url, prepared.payload)
    const attempts = delivery.attempts + 1
    if (result.ok) {
      await finish(delivery.id, lease, { status: 'sent', now, attempts, httpStatus: result.status })
      sent += 1
    } else if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      await finish(delivery.id, lease, { status: 'failed', now, attempts, httpStatus: result.status, error: `${result.reason}: ${result.detail}`, pause: delivery.webhook_id })
      failed += 1
    } else {
      await finish(delivery.id, lease, {
        status: 'pending',
        now,
        attempts,
        httpStatus: result.status,
        error: `${result.reason}: ${result.detail}`,
        nextAt: new Date(now.getTime() + retryDelayMs(attempts)),
      })
      retried += 1
    }
  }
  return { sent, retried, failed, dropped, more: claimed.length === batch }
}

/** ② 다시 보기 · 본문 만들기 — 보내지 않을 까닭이 있으면 `drop`. */
async function prepare(
  delivery: Claimed,
): Promise<{ readonly drop: string } | { readonly drop: null; readonly url: string; readonly payload: WebhookPayload }> {
  const [hook] = await query<{ url_sealed: Buffer; paused_at: Date | null; page_id: string; workspace_id: string; lifecycle: string | null; properties: { title?: unknown } | null }>(
    `SELECT w.url_sealed, w.paused_at, w.page_id, w.workspace_id, b.lifecycle, b.properties
       FROM page_webhook w
       LEFT JOIN block b ON b.id = w.page_id
      WHERE w.id = $1`,
    [delivery.webhook_id],
  )
  if (hook === undefined) return { drop: 'webhook_gone' }
  if (hook.paused_at !== null) return { drop: 'paused' }
  if (hook.lifecycle !== 'live') return { drop: 'page_not_live' }
  const url = unsealWebhookUrl(hook.url_sealed)
  if (url === null) return { drop: 'unseal_failed' }

  const rows = await query<{ id: string; type: string; page_id: string; created_at: Date; actor_id: string | null; actor_name: string | null; actor_deleted: boolean | null }>(
    `SELECT e.id, e.type, e.page_id, e.created_at, e.actor_id, u.name AS actor_name, u.deleted_at IS NOT NULL AS actor_deleted
       FROM activity_event e
       LEFT JOIN "user" u ON u.id = e.actor_id
      WHERE e.id = ANY($1::uuid[])
      ORDER BY e.created_at, e.id`,
    [delivery.event_ids],
  )
  const events: PayloadEvent[] = rows.flatMap((r) =>
    isPageActivityType(r.type)
      ? [{
          id: r.id,
          type: r.type,
          pageId: r.page_id,
          actor: r.actor_id === null ? null : { id: r.actor_id, name: r.actor_name ?? '', deleted: r.actor_deleted === true },
          at: r.created_at,
        }]
      : [],
  )
  if (events.length === 0) return { drop: 'no_events' }
  return {
    drop: null,
    url,
    payload: buildWebhookPayload({
      deliveryId: delivery.id,
      workspaceId: hook.workspace_id,
      page: { id: hook.page_id, title: plainTitleOf(hook.properties) },
      events,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    }),
  }
}

/** ④ 적기 — 내 임대일 때만(임대가 지나 다른 워커가 가져갔으면 그쪽이 적는다). 실패로 끝나면 웹훅을 멈춘다. */
async function finish(
  id: string,
  lease: Date,
  outcome: {
    readonly status: 'sent' | 'pending' | 'failed' | 'dropped'
    readonly now: Date
    readonly attempts?: number
    readonly httpStatus?: number | null
    readonly error?: string
    readonly nextAt?: Date
    readonly pause?: string
  },
): Promise<void> {
  await withTransaction(async (tx) => {
    const updated = await tx.query<{ id: string }>(
      `UPDATE webhook_delivery
          SET status = $3,
              attempts = coalesce($4::int, attempts),
              last_status = coalesce($5::int, last_status),
              last_error = $6,
              next_attempt_at = $7,
              finished_at = CASE WHEN $3::text = 'pending' THEN NULL ELSE $8::timestamptz END,
              locked_until = NULL
        WHERE id = $1 AND locked_until = $2
        RETURNING id`,
      [
        id,
        lease,
        outcome.status,
        outcome.attempts ?? null,
        outcome.httpStatus ?? null,
        outcome.error?.slice(0, 1000) ?? null,
        outcome.status === 'pending' ? (outcome.nextAt ?? null) : null,
        outcome.now,
      ],
    )
    if (updated.length > 0 && outcome.pause !== undefined) {
      await tx.query(
        `UPDATE page_webhook SET paused_at = $2, pause_reason = 'failures' WHERE id = $1 AND paused_at IS NULL`,
        [outcome.pause, outcome.now],
      )
    }
  })
}
