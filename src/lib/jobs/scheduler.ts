/**
 * 공용 스케줄러 — "시각이 되면 실행"의 단일 행 큐 (히스토리 · 활동 4a-1)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 공용 스케줄러 — `scheduled_job` 하나(① ~ ⑤) · 마이그레이션 0068
 *       마스터 문서 §6 *"스케줄러는 하나만 만든다 — 세 벌 만들면 세 벌 다 미묘하게 틀린다"*
 *
 *   · 가져가기 — 때가 된 · 임대가 없거나 지난 · 죽지 않은 일을 `FOR UPDATE SKIP LOCKED` 로 잠그고 임대를 건 뒤 **커밋한다**. 일은 그
 *     바깥에서 한다(긴 일이 행 잠금을 오래 쥐지 않게). 워커가 죽으면 임대가 지나 다른 워커가 다시 가져간다 — 일은 멱등이어야 한다
 *   · 끝나면 행을 지운다 — 주기 일은 다음 실행을 같은 키로 다시 넣는다(부분 UNIQUE 가 "살아 있는 것은 하나"를 지킨다)
 *   · 실패하면 1 · 2 · 4 · 8분 뒤로 물러나고, 다섯 번째 실패면 `dead_at` 을 적고 멈춘다(행은 남는다 — 사람이 본다)
 *   · 시각은 실행기의 `now` 하나 — SQL 의 `now()` 를 쓰지 않는다(검사가 시각을 정한다)
 *   · 세션 없이 도는 **시스템 주체**다 — 권한을 묻지 않는다. 무엇을 해도 되는지는 그 일의 규칙이 정한다
 *
 * 일의 종류는 CHECK(`ck_scheduled_job_kind` — 0068 · 0069 · 0070 · 0073 · 0074 · 0076 · 0080 · 0082)와 아래 `HANDLERS` 두 곳에 있다 — 소비자를 더할 때 둘을 함께 늘린다.
 *
 *   · `version_gc` — 만료된 버전을 지운다(4a-1 · F-11-03 · `history/gc.ts`)
 *   · `trash_purge` — 만료된 휴지통 묶음을 `purged` 로(4b-1 · F-11-06 · `block/trash-purge.ts`)
 *   · `trash_hard_delete` — `purged` 30일이 지난 묶음의 행을 지운다(4b-2 · F-11-06 · `block/trash-hard-delete.ts`)
 *   · `reminder_fire` — 때가 된 리마인더를 알림으로(4c-2 · F-11-10 · `notification/reminder-fire.ts`) — 늘 1분마다
 *   · `data_retention` — 읽은 알림 · 오래된 활동 이벤트 · 넘친 안 읽은 알림 · 넘친 최근 방문을 지우고 파티션을 미리 만든다(4d-1 · F-11-18 ·
 *     `notification/retention.ts`)
 *   · `webhook_deliver` — 모으는 창이 끝났거나 다시 보낼 때가 된 웹훅 묶음을 보낸다(4e-2 · F-11-19 · `notification/webhook-delivery.ts`) — 늘
 *     1분마다
 *   · `automation_dispatch` — 창(3초)이 끝난 DB automation 의 묶음을 판정해 실행한다(5b-2 · F-08-09 · `automation/dispatch.ts`) — 남았으면
 *     곧바로, 아니면 5초 뒤(워커의 판 간격이 실제 지연을 정한다)
 *   · `automation_webhook` — 자동화가 쌓은 `send_webhook` 배달을 보낸다(5c-2 · F-08-13 · `automation/webhook-send.ts`) — 남았으면 곧바로,
 *     아니면 5초 뒤
 */

import { randomUUID } from 'node:crypto'

import { query } from '../db/pool.ts'
import { withTransaction, type Tx } from '../db/tx.ts'
import { runTrashHardDelete } from '../block/trash-hard-delete.ts'
import { runTrashPurge } from '../block/trash-purge.ts'
import { runVersionGc } from '../history/gc.ts'
import { runReminderFire } from '../notification/reminder-fire.ts'
import { runDataRetention } from '../notification/retention.ts'
import { runWebhookDelivery } from '../notification/webhook-delivery.ts'
import { runAutomationDispatch } from '../automation/dispatch.ts'
import { runAutomationWebhooks } from '../automation/webhook-send.ts'

export type JobKind =
  | 'version_gc'
  | 'trash_purge'
  | 'trash_hard_delete'
  | 'reminder_fire'
  | 'data_retention'
  | 'webhook_deliver'
  | 'automation_dispatch'
  | 'automation_webhook'

/** 일의 결과 — 주기 일은 다음 실행 시각을 준다(없으면 한 번으로 끝). */
export type JobOutcome = { readonly again: Date | null }

export type JobHandler = (payload: Readonly<Record<string, unknown>>, now: Date) => Promise<JobOutcome>

/** 남았으면 곧 다시(1분), 다 했으면 한 시간 뒤 — GC 들의 주기다. */
const nextSweep = (now: Date, more: boolean) => new Date(now.getTime() + (more ? 60_000 : 60 * 60_000))

/** 일의 종류마다 하는 일 — CHECK 와 같은 목록이다. */
const HANDLERS: Readonly<Record<JobKind, JobHandler>> = {
  version_gc: async (_payload, now) => ({ again: nextSweep(now, (await runVersionGc(now)).more) }),
  trash_purge: async (_payload, now) => ({ again: nextSweep(now, (await runTrashPurge(now)).more) }),
  trash_hard_delete: async (_payload, now) => ({ again: nextSweep(now, (await runTrashHardDelete(now)).more) }),
  // 리마인더는 분 단위다 — 남았든 다 했든 1분 뒤에 다시(정본 [보강] 리마인더 ⑧ ⓔ)
  reminder_fire: async (_payload, now) => {
    await runReminderFire(now)
    return { again: new Date(now.getTime() + 60_000) }
  },
  data_retention: async (_payload, now) => ({ again: nextSweep(now, (await runDataRetention(now)).more) }),
  // 웹훅 — 창이 5분이고 다시 보내기가 분 단위다. 남았으면 곧바로(다음 판), 아니면 1분 뒤(정본 [보강] 페이지 웹훅 ⓒ)
  webhook_deliver: async (_payload, now) => ({ again: new Date(now.getTime() + ((await runWebhookDelivery(now)).more ? 0 : 60_000)) }),
  // DB automation — 창이 3초다. 남았으면 곧바로, 아니면 5초 뒤(정본 [보강] DB automation ⓑ ⓓ)
  automation_dispatch: async (_payload, now) => ({ again: new Date(now.getTime() + ((await runAutomationDispatch(now)).more ? 0 : 5_000)) }),
  // 자동화의 웹훅 — 누르면 곧 나가야 한다. 남았으면 곧바로, 아니면 5초 뒤(정본 ⑬)
  automation_webhook: async (_payload, now) => ({ again: new Date(now.getTime() + ((await runAutomationWebhooks(now)).more ? 0 : 5_000)) }),
}

/** 워커가 뜰 때 넣어 보는 주기 일 — 이미 살아 있으면 그대로다(키의 부분 UNIQUE). */
export const RECURRING: readonly { readonly kind: JobKind; readonly dedupeKey: string }[] = [
  { kind: 'version_gc', dedupeKey: 'version_gc' },
  { kind: 'trash_purge', dedupeKey: 'trash_purge' },
  { kind: 'trash_hard_delete', dedupeKey: 'trash_hard_delete' },
  { kind: 'reminder_fire', dedupeKey: 'reminder_fire' },
  { kind: 'data_retention', dedupeKey: 'data_retention' },
  { kind: 'webhook_deliver', dedupeKey: 'webhook_deliver' },
  { kind: 'automation_dispatch', dedupeKey: 'automation_dispatch' },
  { kind: 'automation_webhook', dedupeKey: 'automation_webhook' },
]

/** 다섯 번째 실패면 멈춘다. */
export const MAX_ATTEMPTS = 5
/** 임대 — 일이 이보다 오래 걸리면 다른 워커가 다시 가져갈 수 있다(일은 멱등이다). */
const LEASE_MS = 5 * 60_000
/** 실패한 일의 물러남 — 1분에서 두 배씩. */
const backoffMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1)

/**
 * 일을 넣는다 — 부르는 쪽의 트랜잭션 안에서(그 쓰기와 함께 커밋되거나 함께 사라진다). 키가 있고 같은 키의 일이 살아 있으면 넣지 않는다.
 * 넣었으면 참.
 */
export async function enqueueJob(
  tx: Tx,
  job: { readonly kind: JobKind; readonly runAt: Date; readonly payload?: Readonly<Record<string, unknown>>; readonly dedupeKey?: string },
): Promise<boolean> {
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO scheduled_job (id, kind, run_at, payload, dedupe_key)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND dead_at IS NULL DO NOTHING
     RETURNING id`,
    [randomUUID(), job.kind, job.runAt, JSON.stringify(job.payload ?? {}), job.dedupeKey ?? null],
  )
  return inserted.length > 0
}

/** 주기 일을 넣어 본다 — 워커가 뜰 때. 이미 살아 있으면 그대로다. 새로 넣은 수. */
export async function ensureRecurringJobs(now: Date): Promise<number> {
  return withTransaction(async (tx) => {
    let added = 0
    for (const job of RECURRING) {
      if (await enqueueJob(tx, { kind: job.kind, runAt: now, dedupeKey: job.dedupeKey })) added += 1
    }
    return added
  })
}

type Claimed = {
  readonly id: string
  readonly kind: JobKind
  readonly payload: Record<string, unknown>
  readonly dedupe_key: string | null
  readonly attempts: number
  readonly locked_until: Date
}

/**
 * 때가 된 일을 돌린다 — 가져가기 · 일 · 끝내기(지우기 · 다음 실행) 또는 물러나기. 돌린 수와 실패한 수.
 *
 * @param input.now 이 판의 시각(검사가 정한다 · 워커는 지금)
 * @param input.limit 한 판에 가져갈 일의 수
 * @param input.handlers 일을 바꿔 끼운다 — 검사가 실패 · 물러남을 만든다(워커는 주지 않는다)
 */
export async function runDueJobs(
  input: { readonly now?: Date; readonly limit?: number; readonly handlers?: Partial<Record<JobKind, JobHandler>> } = {},
): Promise<{ readonly ran: number; readonly failed: number }> {
  const now = input.now ?? new Date()
  const handlers = { ...HANDLERS, ...input.handlers }
  const lease = new Date(now.getTime() + LEASE_MS)
  const claimed = await withTransaction(async (tx) => {
    const due = await tx.query<Omit<Claimed, 'locked_until'>>(
      `SELECT id, kind, payload, dedupe_key, attempts FROM scheduled_job
        WHERE dead_at IS NULL AND run_at <= $1 AND (locked_until IS NULL OR locked_until < $1)
        ORDER BY run_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [now, input.limit ?? 10],
    )
    if (due.length === 0) return []
    await tx.query(`UPDATE scheduled_job SET locked_until = $2 WHERE id = ANY($1::uuid[])`, [due.map((d) => d.id), lease])
    return due.map((d): Claimed => ({ ...d, locked_until: lease }))
  })

  let failed = 0
  for (const job of claimed) {
    try {
      const handler = handlers[job.kind]
      if (handler === undefined) throw new Error(`모르는 일: ${job.kind}`)
      const outcome = await handler(job.payload, now)
      await withTransaction(async (tx) => {
        // 내 임대일 때만 지운다 — 임대가 지나 다른 워커가 가져갔으면 그쪽이 끝낸다(일은 멱등이다)
        const removed = await tx.query<{ id: string }>(
          `DELETE FROM scheduled_job WHERE id = $1 AND locked_until = $2 RETURNING id`,
          [job.id, job.locked_until],
        )
        if (removed.length > 0 && outcome.again !== null) {
          await enqueueJob(tx, {
            kind: job.kind,
            runAt: outcome.again,
            payload: job.payload,
            ...(job.dedupe_key === null ? {} : { dedupeKey: job.dedupe_key }),
          })
        }
      })
    } catch (e) {
      failed += 1
      const attempts = job.attempts + 1
      await withTransaction((tx) =>
        tx.query(
          `UPDATE scheduled_job
              SET attempts = $3::int, last_error = $4, locked_until = NULL,
                  run_at = $5, dead_at = CASE WHEN $3::int >= $6::int THEN $7::timestamptz ELSE NULL END
            WHERE id = $1 AND locked_until = $2`,
          [
            job.id,
            job.locked_until,
            attempts,
            String(e instanceof Error ? e.message : e).slice(0, 2000),
            new Date(now.getTime() + backoffMs(attempts)),
            MAX_ATTEMPTS,
            now,
          ],
        ),
      )
    }
  }
  return { ran: claimed.length, failed }
}

/**
 * 다음 일의 시각 — 워커가 그때까지만 쉰다(5b-2 · DB automation 의 창이 3초인데 워커가 30초를 통째로 자면 창이 의미가 없다). 잡혀 있는
 * 일은 임대가 끝나는 때(그때 다시 가져갈 수 있다). 죽은 일은 보지 않는다. 일이 없으면 null.
 */
export async function nextDueAt(): Promise<Date | null> {
  const [row] = await query<{ at: Date | null }>(
    `SELECT min(GREATEST(run_at, coalesce(locked_until, run_at))) AS at FROM scheduled_job WHERE dead_at IS NULL`,
  )
  return row?.at ?? null
}
