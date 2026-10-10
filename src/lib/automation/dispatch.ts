/**
 * DB automation 실행 — 공용 스케줄러의 일곱 번째 소비자 (자동화 5b-2 · F-08-09 · F-08-10)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 받기 · 실행 ⓑ ⓓ ⓔ ⓕ · 마이그레이션 0080
 *
 * 창(3초)이 끝난 묶음을 잡아(`dispatching` · 임대) 하나씩 판정하고 실행한 뒤 지운다.
 *
 *   ① 위임 — 만든 사람으로(`resolveDelegatedContext`). 떠났거나 지워졌으면 automation 을 끈다(`creator_left`).
 *   ② 다시 보기 — automation 이 켜져 있다 · 행이 살아 있고 템플릿이 아니다 · 데이터베이스가 잠기지 않았다(08 *"잠겨 있으면 트리거하지 않는다"*).
 *      트리거의 속성이 사라졌으면 automation 을 끈다(`trigger_broken`).
 *   ③ 판정(`any`) — `page_added` 는 묶음이 행 추가를 담았으면. `property_edited` 는 그 속성이 묶음에 있고(창 안에서 건드렸다) **창 전 값과
 *      지금 값이 다르고**(되돌렸으면 아니다) 조건이 지금 값에 맞으면 — 조건은 보기와 같은 필터 컴파일러가 그 행 하나에 묻는다.
 *   ④ 실행 — 엔진(`kind: 'db_automation'` — origin `automation` · depth 1 · 쓰기는 다른 automation 을 깨우지 않는다). 멱등 키는 `event:{묶음}`.
 *   ⑤ 실패가 이어지면 끈다 — 최근 실행 셋이 모두 `failed`(정본 ⓔ · `partial` 은 실패가 아니다).
 *
 * 세션 없는 시스템 주체가 묶음을 잡고, 판정 · 실행은 위임 컨텍스트로 한다(권한은 그 사람의 지금 권한 — 액션이 부르는 명령이 묻는다).
 */

import { asWorkspaceId } from '../ids.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { resolveDelegatedContext } from '../auth/session-context.ts'
import { compileFilter, ParamBag, type FilterLeaf } from '../database/filter.ts'
import { isEmptyValue, type CellValue } from '../database/property-types.ts'
import { isLocked } from '../permissions/lock.ts'
import { readActions } from './action-check.ts'
import { runAutomation } from './engine.ts'
import type { DisabledReason } from './db-automation.ts'

/** 한 판에 잡는 묶음(정본 ⓕ). */
export const DISPATCH_BATCH = 50
/** 최근 실행이 이만큼 모두 실패하면 끈다(정본 ⓔ). */
export const FAILURES_TO_DISABLE = 3
/** 잡은 묶음의 임대. */
const LEASE_MS = 2 * 60_000

export type DispatchOutcome = { readonly ran: number; readonly skipped: number; readonly dropped: number; readonly more: boolean }

type Claimed = {
  id: string
  automation_id: string
  workspace_id: string
  page_id: string
  page_added: boolean
  before: Record<string, unknown>
}

/**
 * @param options.workspaces 이 워크스페이스들의 묶음만 — 검사가 다른 검사의 묶음을 돌리지 않게(워커는 주지 않는다)
 */
export async function runAutomationDispatch(
  now: Date,
  options: { readonly workspaces?: readonly string[]; readonly batch?: number } = {},
): Promise<DispatchOutcome> {
  const batch = options.batch ?? DISPATCH_BATCH
  const lease = new Date(now.getTime() + LEASE_MS)
  const claimed = await withTransaction(async (tx) => {
    const due = await tx.query<Claimed>(
      `SELECT e.id, e.automation_id, a.workspace_id, e.page_id, e.page_added, e.before
         FROM automation_event e
         JOIN automation a ON a.id = e.automation_id
        WHERE ((e.status = 'collecting' AND e.window_end <= $1) OR (e.status = 'dispatching' AND e.locked_until < $1))
          AND ($3::uuid[] IS NULL OR a.workspace_id = ANY($3::uuid[]))
        ORDER BY e.window_end, e.id
        LIMIT $2
        FOR UPDATE OF e SKIP LOCKED`,
      [now, batch, options.workspaces ?? null],
    )
    if (due.length === 0) return []
    await tx.query(`UPDATE automation_event SET status = 'dispatching', locked_until = $2 WHERE id = ANY($1::uuid[])`, [due.map((d) => d.id), lease])
    return due
  })

  let ran = 0
  let skipped = 0
  let dropped = 0
  for (const event of claimed) {
    try {
      const outcome = await dispatchOne(event)
      if (outcome === 'ran') ran += 1
      else if (outcome === 'no_match') skipped += 1
      else dropped += 1
    } finally {
      // 끝나면 지운다 — 기록은 실행 기록이 남는다(정본 ⓓ). 내 임대일 때만.
      await query(`DELETE FROM automation_event WHERE id = $1 AND locked_until = $2`, [event.id, lease])
    }
  }
  return { ran, skipped, dropped, more: claimed.length === batch }
}

async function disable(automationId: string, reason: DisabledReason): Promise<void> {
  await query(
    `UPDATE automation SET enabled = false, disabled_reason = $2, updated_at = now() WHERE id = $1 AND enabled`,
    [automationId, reason],
  )
}

type Trigger = { type: string; property_id: string | null; condition: FilterLeaf | null }

/**
 * 셀 값의 비교용 모양 — 셀이 없는 것과 빈 값의 셀(숫자 null · 빈 글 · 체크 안 함 …)은 같은 상태다. 그대로 비교하면 값을 비웠다가
 * 되돌린 것이 "바뀌었다"가 된다.
 */
function comparable(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object' && 'type' in value && isEmptyValue(value as CellValue)) return 'null'
  return JSON.stringify(value)
}

/** 묶음 하나 — 실행했나(`ran`) · 맞는 트리거가 없었나(`no_match`) · 버렸나(`dropped`). */
async function dispatchOne(event: Claimed): Promise<'ran' | 'no_match' | 'dropped'> {
  // ① 위임
  const delegated = await resolveDelegatedContext(asWorkspaceId(event.workspace_id), event.automation_id)
  if (!delegated.ok) {
    if (delegated.reason === 'creator_left') await disable(event.automation_id, 'creator_left')
    return 'dropped'
  }
  const ctx = delegated.context

  // ② 다시 보기 · ③ 판정 — 한 읽기 트랜잭션에서
  const judged = await withReadTransaction(async (tx) => {
    const automation = await tx.queryMaybe<{ enabled: boolean }>(`SELECT enabled FROM automation WHERE id = $1`, [event.automation_id])
    if (automation === null || !automation.enabled) return 'dropped' as const
    const row = await tx.queryMaybe<{ data_source_id: string; is_template: boolean; lifecycle: string; container_id: string }>(
      `SELECT p.data_source_id, p.is_template, b.lifecycle, ds.owner_database_id AS container_id
         FROM page p
         JOIN block b ON b.id = p.id
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE p.id = $1`,
      [event.page_id],
    )
    if (row === null || row.lifecycle !== 'live' || row.is_template) return 'dropped' as const
    if (await isLocked(tx, row.container_id)) return 'dropped' as const

    const triggers = await tx.query<Trigger>(`SELECT type, property_id, condition FROM automation_trigger WHERE automation_id = $1`, [
      event.automation_id,
    ])
    const live = new Map(
      (
        await tx.query<{ id: string; type: string }>(`SELECT id, type FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`, [
          row.data_source_id,
        ])
      ).map((p) => [p.id, p.type]),
    )
    // 트리거의 속성이 사라졌으면 정의가 깨졌다 — 끈다
    if (triggers.some((t) => t.type === 'property_edited' && (t.property_id === null || !live.has(t.property_id)))) return 'broken' as const

    for (const trigger of triggers) {
      if (trigger.type === 'page_added' && event.page_added) return 'match' as const
      if (trigger.type !== 'property_edited' || trigger.property_id === null) continue
      const propertyId = trigger.property_id
      if (!(propertyId in event.before)) continue // 창 안에서 건드리지 않았다
      const now = await tx.queryMaybe<{ value: unknown }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [
        event.page_id,
        propertyId,
      ])
      // 순변화 — 창 전 값과 지금 값이 같으면(되돌렸으면) 아니다
      if (comparable(now?.value) === comparable(event.before[propertyId])) continue
      if (trigger.condition === null) return 'match' as const
      // 조건 — 보기와 같은 필터 컴파일러가 그 행 하나에 묻는다
      const params = new ParamBag(2)
      const predicate = compileFilter(trigger.condition, live, params)
      if (predicate === null) continue
      const hit = await tx.queryMaybe<{ one: number }>(`SELECT 1 AS one FROM page p WHERE p.id = $1 AND ${predicate}`, [event.page_id, ...params.values])
      if (hit !== null) return 'match' as const
    }
    return 'no_match' as const
  })
  if (judged === 'broken') {
    await disable(event.automation_id, 'trigger_broken')
    return 'dropped'
  }
  if (judged !== 'match') return judged

  // ④ 실행
  const actions = await withReadTransaction((tx) => readActions(tx, event.automation_id))
  const outcome = await runAutomation(ctx, {
    automationId: event.automation_id,
    idempotencyKey: `event:${event.id}`,
    context: { triggerPageId: event.page_id },
    actions,
    kind: 'db_automation',
  })
  // ⑤ 실패가 이어지면 끈다
  if (outcome?.status === 'failed') {
    const recent = await query<{ status: string }>(
      `SELECT status FROM automation_run WHERE automation_id = $1 ORDER BY started_at DESC, id DESC LIMIT $2`,
      [event.automation_id, FAILURES_TO_DISABLE],
    )
    if (recent.length === FAILURES_TO_DISABLE && recent.every((r) => r.status === 'failed')) await disable(event.automation_id, 'failures')
  }
  return 'ran'
}
