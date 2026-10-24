/**
 * 묶지 않는 뷰의 행 차례 바꾸기 — §7 정리 10n-59 (F-04-01 *"행 드래그 재정렬"*)
 *
 * 정본: 00-canonical-data-model.md §3.6 `row_position` [보강 10n-59]
 *
 * 표 · 목록 · 갤러리 뷰에서 "이 행을 `before` 앞에"(null 이면 맨 뒤). 자리는 `row_position(view, '*', row)` 에 둔다 — `'*'` 는 어떤 버킷
 * 키도 될 수 없어 보드의 "값 없음" 열(`''`)과 섞이지 않는다(`filter.ts` `UNGROUPED_ORDER_KEY`). 읽기는 `query.ts` 가 살아 있는 정렬이
 * 없을 때 그 키로 줄을 세운다(`compileManualOrder`).
 *
 * 보드의 `moveRow`(`group.ts`)와 같은 규칙을 따르되 셀이 없다 — 그래서 **살아 있는 정렬이 있으면 거부한다**(`sorted`). 보드는 정렬된
 * 열에서도 셀을 바꾸는 일이 남지만 여기에는 할 일이 없고, 조용히 받으면 화면은 옮긴 줄이 제자리로 튀는 것을 본다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween, orderKeysBetween } from '../block/order-key.ts'
import { compileSorts, ParamBag, UNGROUPED_ORDER_KEY, type SortKey } from './filter.ts'
import { readPropertyTypes } from './query.ts'
import { canViewOwnerDatabase } from './source-access.ts'
import { rowsAccessIn } from './row-access.ts'

/** 수동 순서로 줄을 세우는 뷰 — 보드는 열마다의 자리(`group.ts`) · 캘린더는 날짜 · 폼은 줄이 없다. */
export const MANUAL_ORDER_VIEW_TYPES: readonly string[] = ['table', 'list', 'gallery']

export type MoveViewRowInput = {
  readonly rowId: string
  /** 이 행 **앞**에 놓는다. null 이면 맨 뒤. */
  readonly beforeRowId: string | null
}

export type MoveViewRowFailure = 'not_found' | 'forbidden' | 'invalid_value' | 'sorted'

export type MoveViewRowResult =
  | { readonly ok: true; readonly value: { readonly rowId: string; readonly beforeRowId: string | null } }
  | { readonly ok: false; readonly reason: MoveViewRowFailure }

const fail = (reason: MoveViewRowFailure): MoveViewRowResult => ({ ok: false, reason })

/**
 * 행의 차례를 바꾼다. 뷰의 행을 잠근 뒤 자리를 계산한다 — 같은 뷰에서 둘이 동시에 옮겨도 자리 없는 행에 자리를 겹쳐 주지 않는다.
 * `FOR NO KEY UPDATE` — 옮기기끼리는 줄을 세우되, 같은 뷰를 가리키는 다른 쓰기(보드의 자리 · 열 설정)의 FK 검사는 막지 않는다.
 */
export async function moveViewRow(ctx: SessionContext, viewId: string, input: MoveViewRowInput): Promise<MoveViewRowResult> {
  return withCommandTransaction(async (tx) => {
    // 정렬은 이 사람이 실제로 보는 것 — 개인 것이 있으면 그것(2h-1 · `group.ts` `openBoard` 와 같다)
    const view = await tx.queryMaybe<{ type: string; database_id: string; data_source_id: string; owner: string; sorts: unknown }>(
      `SELECT v.type, v.database_id, v.data_source_id, ds.owner_database_id AS owner, coalesce(o.sorts, v.sorts) AS sorts
         FROM view v
         JOIN block b ON b.id = v.database_id
         JOIN data_source ds ON ds.id = v.data_source_id
         LEFT JOIN view_user_override o ON o.view_id = v.id AND o.user_id = $3
        WHERE v.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'
          AND v.owner_kind = 'database_view'
          FOR NO KEY UPDATE OF v`,
      [viewId, ctx.workspaceId, ctx.userId],
    )
    if (view === null) return fail('not_found')

    const caps = await effectiveCaps(tx, ctx, view.database_id)
    if ((await rowsAccessIn(tx, ctx, caps)) === null) return fail('not_found')
    // 붙인 소스(2l-2) — 원본을 못 보면 없는 것과 같다(`openBoard` 와 같은 규칙)
    if (view.owner !== view.database_id && !(await canViewOwnerDatabase(tx, ctx, view.owner))) return fail('not_found')
    // 이 뷰 안의 자리 — 보드의 자리와 같은 권한이다
    if (!can(caps, 'edit_content')) return fail('forbidden')

    if (!MANUAL_ORDER_VIEW_TYPES.includes(view.type)) return fail('invalid_value')
    if (input.beforeRowId === input.rowId) return fail('invalid_value')
    const sorts = Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : []
    if (compileSorts(sorts, await readPropertyTypes(tx, view.data_source_id), new ParamBag(1)).keys.length > 0) return fail('sorted')

    if (!(await isLiveRow(tx, view.data_source_id, input.rowId))) return fail('not_found')
    if (input.beforeRowId !== null && !(await isLiveRow(tx, view.data_source_id, input.beforeRowId))) return fail('not_found')

    await tx.query(`DELETE FROM row_position WHERE view_id = $1 AND group_key = $2 AND row_id = $3`, [viewId, UNGROUPED_ORDER_KEY, input.rowId])
    await materializePositions(tx, viewId, view.data_source_id, input.rowId, input.beforeRowId)
    const orderIdx = await keyBefore(tx, viewId, input.beforeRowId)
    await tx.query(`INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, $4)`, [
      viewId,
      UNGROUPED_ORDER_KEY,
      input.rowId,
      orderIdx,
    ])
    return { ok: true, value: { rowId: input.rowId, beforeRowId: input.beforeRowId } } as const
  })
}

async function isLiveRow(tx: Tx, dataSourceId: string, rowId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM page p JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template = false AND b.lifecycle = 'live'`,
    [rowId, dataSourceId],
  )
  return row !== null
}

/**
 * 자리 없는 행에 트리 순서대로 자리를 준다 — `upTo` 까지(포함), null 이면 전부. 화면 순서를 바꾸지 않는다(자리 없는 행은 자리 있는 행
 * 뒤에 트리 순서로 보였고, 마지막 자리 뒤에 그 순서로 키를 준다). 필터는 보지 않는다 — 자리는 뷰의 것이다. 한 문장으로 넣는다.
 */
async function materializePositions(tx: Tx, viewId: string, dataSourceId: string, movingRowId: string, upTo: string | null): Promise<void> {
  const unpositioned = await tx.query<{ id: string }>(
    `SELECT p.id
       FROM page p
       JOIN block b ON b.id = p.id
       LEFT JOIN row_position rp ON rp.view_id = $1 AND rp.group_key = $2 AND rp.row_id = p.id
      WHERE p.data_source_id = $3 AND p.is_template = false AND b.lifecycle = 'live'
        AND rp.row_id IS NULL AND p.id <> $4
      ORDER BY b.order_key COLLATE "C", p.id`,
    [viewId, UNGROUPED_ORDER_KEY, dataSourceId, movingRowId],
  )
  const stop = upTo === null ? unpositioned.length : unpositioned.findIndex((r) => r.id === upTo) + 1
  const targets = unpositioned.slice(0, Math.max(0, stop))
  if (targets.length === 0) return
  const keys = orderKeysBetween(await lastKey(tx, viewId), null, targets.length)
  await tx.query(
    `INSERT INTO row_position (view_id, group_key, row_id, order_idx)
     SELECT $1, $2, t.row_id, t.order_idx FROM unnest($3::uuid[], $4::text[]) AS t(row_id, order_idx)`,
    [viewId, UNGROUPED_ORDER_KEY, targets.map((r) => r.id), keys],
  )
}

async function lastKey(tx: Tx, viewId: string): Promise<string | null> {
  const last = await tx.queryOne<{ max: string | null }>(`SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2`, [
    viewId,
    UNGROUPED_ORDER_KEY,
  ])
  return last.max
}

/** 새 자리 키 — `before` 의 자리 앞(그 바로 앞 자리와의 사이) · null 이면 맨 뒤. `before` 는 이미 자리가 있다(`materializePositions`). */
async function keyBefore(tx: Tx, viewId: string, before: string | null): Promise<string> {
  if (before === null) return orderKeyBetween(await lastKey(tx, viewId), null)
  const after = await tx.queryOne<{ order_idx: string }>(
    `SELECT order_idx FROM row_position WHERE view_id = $1 AND group_key = $2 AND row_id = $3`,
    [viewId, UNGROUPED_ORDER_KEY, before],
  )
  const prev = await tx.queryOne<{ max: string | null }>(
    `SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2 AND order_idx < $3`,
    [viewId, UNGROUPED_ORDER_KEY, after.order_idx],
  )
  return orderKeyBetween(prev.max, after.order_idx)
}
