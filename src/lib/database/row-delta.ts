/**
 * 표의 델타 — 커서 뒤로 바뀐 행만 지금 상태로 (X-5 1단계 서버 · DB 실시간 동기화 RT-1조각 · F-05-16 · F-05-06)
 *
 * 정본: 00-canonical-data-model.md §3.7 `data_source_change` · [보강] X-5 의 단계 — 1단계(RT-1)
 *       05-collaboration-sync.md F-05-16 *"전체 재조회 금지 → 행 단위 델타 · 변경 행이 필터를 벗어나면 목록에서 제거"*
 *
 * 기록(`change-log.ts`)은 "어느 행이 바뀌었나"만 안다. 값과 멤버십은 **지금의 것을 서버의 질의로** 다시 읽는다 — 기록이 값을 싣지 않으므로
 * 기록 줄의 순서에 기대지 않고, 필터 평가기를 두 벌 만들지 않는다(정본 X-5 [보강] ①).
 *
 *   row_upsert   이 표에 살아 있고 이 사람이 볼 수 있는 행 — 표의 다시 읽기와 같은 모양(`rowJson`) + `inView`(그 뷰의 필터 · 검색어 ·
 *                하위 항목 범위에 서는가 — `rowsStandingInView` · 행 질의를 그 행들로 좁혀 부른다)
 *   row_delete   이 표에서 빠진 행(휴지통 · 다른 표로 옮김) — **이 사람이 볼 수 있는 것만** id 하나로. 보지 못하는 행 · 완전히 지워져
 *                판정할 수 없는 행은 싣지 않는다(id 도 새지 않는다 · 완전 삭제는 휴지통을 거친 뒤라 화면은 이미 그 행을 뺐다)
 *
 * 템플릿은 어느 쪽에도 없다(R1 — 뷰에 선 적이 없다). 볼 수 없는 행은 기록에 있어도 없는 것과 같다(권한이 필터보다 먼저다 · F-03-17).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import {
  changedRowIds,
  currentChangeHorizon,
  decideDelta,
  decodeChangeCursor,
  encodeChangeCursor,
  readChangeWindow,
  type ResetReason,
} from './change-log.ts'
import { ParamBag } from './filter.ts'
import { rowJson, type RowJson } from './http.ts'
import { queryRows } from './query.ts'
import { restrictedRowsSql, rowsAccessForDataSource, type RowsAccess } from './row-access.ts'
import { rowsStandingInView } from './row-in-view.ts'
import { getView } from './view.ts'

export type DeltaRow =
  | (RowJson & { readonly kind: 'row_upsert'; readonly inView: boolean })
  | { readonly id: string; readonly kind: 'row_delete'; readonly inView: false }

export type RowDelta = {
  /** 다음에 물을 커서 — reset 이면 처음부터 다시 읽은 뒤 이것부터 이어 묻는다(다시 읽기보다 먼저 받은 커서다). */
  readonly cursor: string
  /** 델타를 줄 수 없다 — 처음부터 다시 읽어라(F-05-06 *"보존기간 초과 · 델타가 수천 op → snapshot"*). */
  readonly reset: boolean
  /** reset 의 까닭(진단 · 검사용). */
  readonly resetReason?: ResetReason
  /** 커서 뒤에 이미 커밋된 기록이 더 있다 — 더 오래된 쓰기 트랜잭션이 끝나지 않아 지평이 거기 묶였다. 곧 다시 물어라. */
  readonly behind: boolean
  readonly rows: readonly DeltaRow[]
  /** 속성 · 옵션이 바뀌었다 — 컬럼을 다시 세워야 한다. */
  readonly schemaChanged: boolean
  /** 이 뷰(필터 · 정렬 · 컬럼)가 바뀌었다. */
  readonly viewChanged: boolean
  /** 이 뷰의 손으로 둔 순서(보드 · 수동 정렬)가 바뀌었다. 그 행들은 `rows` 에도 있다. */
  readonly orderChanged: boolean
}

export type RowDeltaResult =
  | { readonly ok: true; readonly value: RowDelta }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' }

/**
 * 커서(`after`) 뒤로 이 표에서 바뀐 것 — 그 뷰(`viewId`)의 눈으로. 권한은 변경 알림(`…/changes`)과 같다(표를 열 수 있다 — "만들기만"
 * 포함) + 행마다 행 질의의 술어(`restrictedRowsSql`).
 */
export async function readRowDelta(
  ctx: SessionContext,
  dataSourceId: string,
  viewId: string,
  afterRaw: unknown,
  options: { readonly search?: unknown; readonly today?: string | null } = {},
): Promise<RowDeltaResult> {
  const access = await withReadTransaction((tx) => rowsAccessForDataSource(tx, ctx, dataSourceId))
  if (access === null) return { ok: false, reason: 'not_found' }
  const view = await getView(ctx, viewId)
  if (!view.ok) return { ok: false, reason: view.reason === 'forbidden' ? 'forbidden' : 'not_found' }
  // 그 표의 뷰여야 한다 · 대시보드는 행을 그리지 않는다(DB-1)
  if (view.value.dataSourceId !== dataSourceId || view.value.type === 'dashboard') return { ok: false, reason: 'not_found' }

  const after = decodeChangeCursor(afterRaw)
  if (after === null) return { ok: true, value: resetDelta(await currentChangeHorizon(), 'no_cursor') }

  const window = await readChangeWindow(dataSourceId, after)
  const ids = changedRowIds(window.entries)
  const decision = decideDelta(after, { horizon: window.horizon, floor: window.floor, entryCount: window.entries.length, rowCount: ids.length })
  if (decision.reset) return { ok: true, value: resetDelta(window.horizon, decision.reason) }

  const schemaChanged = window.entries.some((e) => e.kind === 'schema')
  const viewChanged = window.entries.some((e) => e.kind === 'view' && e.viewId === viewId)
  const orderChanged = window.entries.some((e) => e.kind === 'position' && e.viewId === viewId)
  const base = { cursor: encodeChangeCursor(window.horizon), reset: false, behind: window.behind, schemaChanged, viewChanged, orderChanged }
  if (ids.length === 0) return { ok: true, value: { ...base, rows: [] } }

  // 살아 있고 볼 수 있는 행 — 값(필터 없이) · 그 가운데 뷰에 서는 것(필터 · 검색어 · 범위)
  const live = await queryRows(ctx, dataSourceId, { onlyRowIds: ids, limit: ids.length })
  if (!live.ok) return { ok: false, reason: live.reason === 'forbidden' ? 'forbidden' : 'not_found' }
  const liveIds = live.value.rows.map((r) => r.id)
  const standing = (await rowsStandingInView(ctx, view.value, liveIds, options.search ?? null, options.today ?? null)) ?? new Set<string>()
  // 빠진 행 — 볼 수 있는 것만
  const liveSet = new Set(liveIds)
  const left = new Set(await visibleLeftRows(ctx, access, dataSourceId, ids.filter((id) => !liveSet.has(id))))

  const byId = new Map(live.value.rows.map((r) => [r.id, r]))
  const rows: DeltaRow[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (row !== undefined) rows.push({ ...rowJson(row), kind: 'row_upsert', inView: standing.has(id) })
    else if (left.has(id)) rows.push({ id, kind: 'row_delete', inView: false })
  }
  return { ok: true, value: { ...base, rows } }
}

function resetDelta(horizon: bigint, reason: ResetReason): RowDelta {
  return {
    cursor: encodeChangeCursor(horizon),
    reset: true,
    resetReason: reason,
    behind: false,
    rows: [],
    schemaChanged: false,
    viewChanged: false,
    orderChanged: false,
  }
}

/**
 * 이 표에 살아 있지 않게 된 행 가운데 이 사람이 볼 수 있는 것 — 휴지통에 든 행 · 다른 곳으로 옮긴 행. 술어는 행 질의와 같다
 * (`restrictedRowsSql` — 행의 스코프 · 규칙). 블록이 없어진 행(완전 삭제)은 판정할 수 없어 싣지 않는다. 템플릿은 뷰에 선 적이 없다.
 */
async function visibleLeftRows(ctx: SessionContext, access: RowsAccess, dataSourceId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  return withReadTransaction(async (tx) => {
    const params = new ParamBag(4)
    const accessSql = restrictedRowsSql(access, params)
    const rows = await tx.query<{ id: string }>(
      `SELECT b.id FROM block b LEFT JOIN page p ON p.id = b.id
        WHERE b.id = ANY($1::uuid[]) AND b.workspace_id = $2 AND b.type = 'page'
          AND NOT (p.data_source_id IS NOT DISTINCT FROM $3::uuid AND b.lifecycle = 'live')
          AND COALESCE(p.is_template, false) = false
          AND ${accessSql}`,
      [ids, ctx.workspaceId, dataSourceId, ...params.values],
    )
    return rows.map((r) => r.id)
  })
}
