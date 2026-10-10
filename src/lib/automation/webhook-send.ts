/**
 * `send_webhook` 보내기 — 공용 스케줄러의 여덟 번째 소비자 (자동화 5c-2 · F-08-13)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑬ · 마이그레이션 0082
 *
 * 실행(엔진)이 쌓은 배달(`automation_delivery` — 5c-1)을 보낸다. 페이지 웹훅의 보내기(`notification/webhook-delivery.ts`)와 같은 규칙이다.
 *
 *   ① 잡기 — 보낼 차례(`pending` · `next_attempt_at` 이 지났다)를 `FOR UPDATE SKIP LOCKED` 로 잡아 임대를 걸고 **커밋한다**.
 *   ② 다시 보기 — automation 이 꺼졌으면 `dropped`(`paused` — 멈춘 뒤에도 쌓인 것이 상대 서버를 두드리지 않게). 봉인을 풀지 못하면
 *     `dropped`(`unseal_failed`). 요금제는 다시 묻지 않는다(쌓을 때 물었다 — 이미 실행된 일이다).
 *   ③ 보내기 — **트랜잭션 밖에서**(바깥 요청이 행 잠금을 쥐지 않게) `net/outbound.ts` 의 한 길로. 헤더는 봉인을 풀어 싣는다.
 *   ④ 적기 — 내 임대일 때만. 성공이면 `sent`. 실패면 1 · 2 · 4분 뒤 다시(`pending`), 네 번째도 실패면 `failed` 로 끝내고 **automation 을
 *     멈춘다**(`webhook_failed` — 08 *"자동 일시정지 + 수동 재개"*).
 *
 * 워커가 보내다 죽으면 임대가 지나 다시 보낸다 — **적어도 한 번**이다. 받는 쪽은 몸의 `run_id` 로 겹친 것을 거른다. 세션 없는 시스템
 * 주체다 — 권한은 실행이 쌓을 때(실행하는 사람의 권한으로 값을 읽었다) 이미 봤다.
 */

import { withTransaction } from '../db/tx.ts'
import { postJson, type OutboundResult } from '../net/outbound.ts'
import { unsealWebhookUrl } from '../net/url-seal.ts'
import { MAX_DELIVERY_ATTEMPTS, retryDelayMs } from '../notification/webhook-delivery.ts'

/** 한 판에 잡는 배달의 수. */
export const SEND_BATCH = 20
/** 보내는 동안의 임대 — 바깥 요청의 시간 상한(10초)보다 넉넉히. */
const LEASE_MS = 2 * 60_000

export type SendOutcome = { readonly sent: number; readonly retried: number; readonly failed: number; readonly dropped: number; readonly more: boolean }

/** 보내기를 바꿔 끼운다 — 검사가 받는 쪽을 흉내 낸다(워커는 주지 않는다). */
export type WebhookSender = (url: string, payload: unknown, headers: Readonly<Record<string, string>>) => Promise<OutboundResult>

type Claimed = {
  id: string
  automation_id: string
  attempts: number
  url_sealed: Buffer
  headers: { name: string; valueSealed: string }[]
  payload: Record<string, unknown>
  enabled: boolean
}

/**
 * @param options.workspaces 이 워크스페이스들의 배달만 — 검사가 다른 검사의 배달을 보내지 않게(워커는 주지 않는다)
 * @param options.send 보내기를 바꿔 끼운다(검사만)
 */
export async function runAutomationWebhooks(
  now: Date,
  options: { readonly workspaces?: readonly string[]; readonly send?: WebhookSender; readonly batch?: number } = {},
): Promise<SendOutcome> {
  const batch = options.batch ?? SEND_BATCH
  const lease = new Date(now.getTime() + LEASE_MS)
  const send: WebhookSender = options.send ?? ((url, payload, headers) => postJson(url, payload, { headers }))

  // ① 잡기
  const claimed = await withTransaction(async (tx) => {
    const due = await tx.query<Claimed>(
      `SELECT d.id, d.automation_id, d.attempts, d.url_sealed, d.headers, d.payload, a.enabled
         FROM automation_delivery d
         JOIN automation a ON a.id = d.automation_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= $1
          AND (d.locked_until IS NULL OR d.locked_until < $1)
          AND ($3::uuid[] IS NULL OR d.workspace_id = ANY($3::uuid[]))
        ORDER BY d.next_attempt_at, d.id
        LIMIT $2
        FOR UPDATE OF d SKIP LOCKED`,
      [now, batch, options.workspaces ?? null],
    )
    if (due.length === 0) return []
    await tx.query(`UPDATE automation_delivery SET locked_until = $2 WHERE id = ANY($1::uuid[])`, [due.map((d) => d.id), lease])
    return due
  })

  let sent = 0
  let retried = 0
  let failed = 0
  let dropped = 0
  for (const delivery of claimed) {
    // ② 다시 보기
    if (!delivery.enabled) {
      await finish(delivery.id, lease, { status: 'dropped', now, error: 'paused' })
      dropped += 1
      continue
    }
    const url = unsealWebhookUrl(delivery.url_sealed)
    const headers: Record<string, string> = {}
    let sealedOk = url !== null
    for (const h of delivery.headers) {
      const value = unsealWebhookUrl(Buffer.from(h.valueSealed, 'base64'))
      if (value === null) sealedOk = false
      else headers[h.name] = value
    }
    if (url === null || !sealedOk) {
      await finish(delivery.id, lease, { status: 'dropped', now, error: 'unseal_failed' })
      dropped += 1
      continue
    }
    // ③ 보내기 — 트랜잭션 밖에서
    const result = await send(url, delivery.payload, headers)
    const attempts = delivery.attempts + 1
    if (result.ok) {
      await finish(delivery.id, lease, { status: 'sent', now, attempts, httpStatus: result.status })
      sent += 1
    } else if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      await finish(delivery.id, lease, {
        status: 'failed',
        now,
        attempts,
        httpStatus: result.status,
        error: `${result.reason}: ${result.detail}`,
        pause: delivery.automation_id,
      })
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

/** ④ 적기 — 내 임대일 때만(임대가 지나 다른 워커가 가져갔으면 그쪽이 적는다). 실패로 끝나면 automation 을 멈춘다. */
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
      `UPDATE automation_delivery
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
        `UPDATE automation SET enabled = false, disabled_reason = 'webhook_failed', updated_at = now() WHERE id = $1 AND enabled`,
        [outcome.pause],
      )
    }
  })
}
