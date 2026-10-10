/**
 * 리마인더 — 데이터베이스 날짜 속성 (히스토리 · 활동 4c-1 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 `reminder` · [보강] 리마인더 ① ~ ⑥ · 마이그레이션 0072
 *       11-history-notifications.md F-11-10 *"DB: 행의 Date property 클릭 → 캘린더 팝오버 → Remind 옵션에서 리드타임 선택"*
 *
 *   · 칸마다 하나 — 리마인더는 날짜 값의 일부다(노션). 다시 걸면 바뀐다(리드 · 타임존 · 받는 사람 — 마지막 쓰기가 이긴다)
 *   · 누가 — 그 칸을 고칠 수 있는 사람(셀 쓰기와 같은 문: `edit_content` · 행 잠금). 받는 사람은 **건 사람**이다
 *   · 시각 — 날짜 값의 시작을 SQL 함수 하나(`reminder_target_at`)가 읽는다. 날짜만이면 그날 09:00. 셀이 바뀌면 트리거가 따라 맞춘다
 *     (0072 — 이 모듈은 거는 것 · 푸는 것만 한다)
 *   · 지난 시각에 걸면 울리지 않는다 — "지남"으로 둔다(`firedAt` 이 건 시각). 화면은 빨갛게 보인다
 *   · 리드는 값의 모양에 따라 고르는 목록이 다르다(`DATE_ONLY_LEADS` · `DATE_TIME_LEADS`) — 반복은 없다
 *
 * 울리는 것(공용 스케줄러의 소비자)은 4c-2 다. 화면(4c-3)은 보이는 행들의 리마인더를 따로 읽는다(`listDateReminders` — 정본 ⑨ ⓑ).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { isLocked } from '../permissions/lock.ts'
import { leadsFor } from './reminder-leads.ts'
import { isRowFailure, openDataSource } from './row.ts'

// 리드의 목록 · 말은 화면과 함께 쓴다(DOM · DB 없는 모듈) — 두 벌이면 화면이 고를 수 있는 것을 서버가 거부한다
export { DATE_ONLY_LEADS, DATE_TIME_LEADS, isDateOnlyStart, leadsFor } from './reminder-leads.ts'

/** 한 번에 읽는 행의 수 — 표의 한 쪽(200행)과 같다. */
export const MAX_REMINDER_ROWS = 200

export type DateReminder = {
  readonly propertyId: string
  readonly leadMinutes: number
  /** 건 사람의 타임존(IANA) — 값에 타임존이 없을 때 날짜를 읽는 기준. */
  readonly timeZone: string
  /** 날짜 값이 가리키는 시각(날짜만이면 그날 09:00). */
  readonly targetAt: Date
  /** 울릴 시각 = targetAt − 리드. */
  readonly fireAt: Date
  /** 울렸거나 지난 시각에 걸렸다. null 이면 기다린다. */
  readonly firedAt: Date | null
  readonly recipientIds: readonly string[]
  readonly createdBy: string
}

export type ReminderFailure =
  | 'not_found'
  | 'forbidden'
  /** 행 페이지가 잠겼다(7f-2) — 리마인더는 날짜 값의 일부다. */
  | 'locked'
  /** 날짜 속성이 아니다. */
  | 'not_date'
  /** 그 칸에 날짜가 없다 — 울릴 시각이 없다. */
  | 'no_date'
  /** 이 값의 모양(날짜만 · 시각)에 없는 리드다. */
  | 'invalid_lead'
  /** 모르는 타임존이다. */
  | 'invalid_time_zone'

export type ReminderResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ReminderFailure }

const fail = (reason: ReminderFailure) => ({ ok: false, reason }) as const

type ReminderRow = {
  property_id: string
  lead_minutes: number
  timezone: string
  target_at: Date
  fire_at: Date
  fired_at: Date | null
  recipient_ids: string[]
  created_by: string
}
const COLUMNS = `property_id, lead_minutes, timezone, target_at, fire_at, fired_at, recipient_ids, created_by`
const toReminder = (r: ReminderRow): DateReminder => ({
  propertyId: r.property_id,
  leadMinutes: r.lead_minutes,
  timeZone: r.timezone,
  targetAt: r.target_at,
  fireAt: r.fire_at,
  firedAt: r.fired_at,
  recipientIds: r.recipient_ids,
  createdBy: r.created_by,
})

/**
 * 행과 그 날짜 칸을 연다 — 셀을 고칠 때와 같은 문이다(행을 잠그고 · `edit_content` · 행 잠금). 칸의 날짜 시작을 준다(비었으면 null).
 */
async function openDateCell(
  tx: Tx,
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
): Promise<{ readonly start: string | null } | ReminderFailure> {
  const row = await tx.queryMaybe<{ data_source_id: string }>(
    `SELECT p.data_source_id
       FROM page p
       JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
      FOR UPDATE OF b`,
    [rowId, ctx.workspaceId],
  )
  if (row === null) return 'not_found'
  const gate = await openDataSource(tx, ctx, row.data_source_id, 'edit_content')
  if (isRowFailure(gate)) return gate.ok === false && gate.reason === 'forbidden' ? 'forbidden' : 'not_found'
  if (await isLocked(tx, rowId)) return 'locked'

  const property = await tx.queryMaybe<{ type: string }>(
    `SELECT type FROM property WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
    [propertyId, row.data_source_id],
  )
  if (property === null) return 'not_found'
  if (property.type !== 'date') return 'not_date'
  const cell = await tx.queryMaybe<{ start: string | null }>(
    `SELECT value -> 'date' ->> 'start' AS start FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [rowId, propertyId],
  )
  return { start: cell?.start ?? null }
}

/**
 * 날짜 칸에 리마인더를 건다(이미 있으면 바꾼다). 받는 사람은 건 사람이다.
 *
 * @param input.leadMinutes 값의 모양에 맞는 리드(`leadsFor`)
 * @param input.timeZone 건 사람의 타임존(브라우저의 IANA 이름) — 값에 타임존이 없을 때 날짜를 읽는 기준
 */
export async function setDateReminder(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  input: { readonly leadMinutes: unknown; readonly timeZone: unknown },
): Promise<ReminderResult<DateReminder>> {
  if (!isUuid(rowId) || propertyId.length === 0) return fail('not_found')
  return withCommandTransaction(async (tx): Promise<ReminderResult<DateReminder>> => {
    const cell = await openDateCell(tx, ctx, rowId, propertyId)
    if (typeof cell === 'string') return fail(cell)
    if (cell.start === null) return fail('no_date')
    if (typeof input.leadMinutes !== 'number' || !leadsFor(cell.start).includes(input.leadMinutes)) return fail('invalid_lead')
    const zone =
      typeof input.timeZone === 'string' && input.timeZone.length > 0 && input.timeZone.length <= 64
        ? await tx.queryMaybe<{ name: string }>(`SELECT name FROM pg_timezone_names WHERE name = $1`, [input.timeZone])
        : null
    if (zone === null) return fail('invalid_time_zone')

    // 시각은 SQL 함수 하나가 읽는다(트리거와 같은 셈) — 지난 시각이면 "지남"으로 둔다(울리지 않는다)
    const saved = await tx.queryOne<ReminderRow>(
      `INSERT INTO reminder (id, workspace_id, block_id, page_id, property_id, target_at, timezone, lead_minutes, fire_at,
                             recipient_ids, fired_at, created_by)
       SELECT $1, $2, $3, $3, $4, t.target, $5, $6, t.target - make_interval(mins => $6), ARRAY[$7::uuid],
              CASE WHEN t.target - make_interval(mins => $6) > now() THEN NULL ELSE now() END, $7
         FROM (SELECT reminder_target_at(v.value -> 'date' ->> 'start', v.value -> 'date' ->> 'time_zone', $5) AS target
                 FROM page_property_value v WHERE v.page_id = $3 AND v.property_id = $4) t
       ON CONFLICT (page_id, property_id) WHERE property_id IS NOT NULL DO UPDATE SET
         target_at = EXCLUDED.target_at, timezone = EXCLUDED.timezone, lead_minutes = EXCLUDED.lead_minutes,
         fire_at = EXCLUDED.fire_at, recipient_ids = EXCLUDED.recipient_ids, fired_at = EXCLUDED.fired_at,
         created_by = EXCLUDED.created_by
       RETURNING ${COLUMNS}`,
      [randomUUID(), ctx.workspaceId, rowId, propertyId, zone.name, input.leadMinutes, ctx.userId],
    )
    return { ok: true, value: toReminder(saved) }
  })
}

/** 응답의 모양 — 시각은 ISO 문자열(라우트 · 화면이 같은 모양을 쓴다). */
export function reminderJson(r: DateReminder) {
  return {
    propertyId: r.propertyId,
    leadMinutes: r.leadMinutes,
    timeZone: r.timeZone,
    targetAt: r.targetAt.toISOString(),
    fireAt: r.fireAt.toISOString(),
    firedAt: r.firedAt === null ? null : r.firedAt.toISOString(),
    recipientIds: r.recipientIds,
  }
}
export type DateReminderJson = ReturnType<typeof reminderJson>

/** 날짜 칸의 리마인더를 푼다 — 없어도 성공이다(이미 풀렸다). */
export async function clearDateReminder(ctx: SessionContext, rowId: string, propertyId: string): Promise<ReminderResult<null>> {
  if (!isUuid(rowId) || propertyId.length === 0) return fail('not_found')
  return withCommandTransaction(async (tx): Promise<ReminderResult<null>> => {
    const cell = await openDateCell(tx, ctx, rowId, propertyId)
    if (typeof cell === 'string') return fail(cell)
    await tx.query(`DELETE FROM reminder WHERE page_id = $1 AND property_id = $2`, [rowId, propertyId])
    return { ok: true, value: null }
  })
}

/**
 * 화면이 보이는 행들의 리마인더를 읽는다(정본 ⑨ ⓑ) — 그 표를 볼 수 있는 사람이면 누구나(리마인더는 날짜 값의 일부다). 그 표의 살아 있는
 * 행 것만 · 한 번에 `MAX_REMINDER_ROWS` 행. 행 → 속성 → 리마인더.
 */
export async function listDateReminders(
  ctx: SessionContext,
  dataSourceId: string,
  rowIds: readonly string[],
): Promise<ReminderResult<Map<string, Map<string, DateReminder>>>> {
  if (!isUuid(dataSourceId)) return fail('not_found')
  const ids = [...new Set(rowIds.filter(isUuid))].slice(0, MAX_REMINDER_ROWS)
  return withReadTransaction(async (tx): Promise<ReminderResult<Map<string, Map<string, DateReminder>>>> => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'view')
    if (isRowFailure(gate)) return fail(gate.ok === false && gate.reason === 'forbidden' ? 'forbidden' : 'not_found')
    if (ids.length === 0) return { ok: true, value: new Map() }
    const live = await tx.query<{ id: string }>(
      `SELECT p.id FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.id = ANY($2::uuid[]) AND b.lifecycle = 'live'`,
      [dataSourceId, ids],
    )
    return { ok: true, value: await readDateReminders(tx, live.map((r) => r.id)) }
  })
}

/** 행들의 날짜 리마인더 — 행 → 속성 → 리마인더. 권한은 부르는 쪽이 이미 봤다(행을 읽은 그 질의). */
export async function readDateReminders(tx: Tx, rowIds: readonly string[]): Promise<Map<string, Map<string, DateReminder>>> {
  const rows = await tx.query<ReminderRow & { page_id: string }>(
    `SELECT page_id, ${COLUMNS} FROM reminder WHERE page_id = ANY($1::uuid[]) AND property_id IS NOT NULL`,
    [rowIds],
  )
  const out = new Map<string, Map<string, DateReminder>>()
  for (const r of rows) {
    const byProperty = out.get(r.page_id) ?? new Map<string, DateReminder>()
    byProperty.set(r.property_id, toReminder(r))
    out.set(r.page_id, byProperty)
  }
  return out
}
