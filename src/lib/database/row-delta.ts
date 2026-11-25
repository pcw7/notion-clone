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
 *
 * **자리(RT-2 · `place`)** — 화면이 바뀐 행만 합치려면 정렬된 뷰에서 그 행이 **어디에** 서는지 알아야 한다. 화면이 정렬을 다시 평가하지
 * 않게(평가기 두 벌 — 정본 X-5 [보강] ①) 서버가 행 읽기와 같은 질의로 줄 세워 뷰에 서는 행마다 바로 앞 · 바로 뒤 행(`before` · `after`)과
 * 화면이 아직 읽지 않은 범위인가(`beyond` — 화면의 "더 보기" 커서 `page` 뒤)를 준다(`queryRowNeighbors`). 평평한 목록만이다 — 하위 항목을
 * 펴는 트리 · 카드의 부모만(갤러리)은 `placed: false`(화면은 다시 읽는다). 열 집계(`calc`)는 바뀐 행이 있을 때만 싣는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { computeCalculations, type Calculations } from './calculate.ts'
import {
  changedRowIds,
  currentChangeHorizon,
  decideDelta,
  decodeChangeCursor,
  encodeChangeCursor,
  personalChangedInWindow,
  readChangeWindow,
  type ResetReason,
} from './change-log.ts'
import { ParamBag } from './filter.ts'
import { rowJson, type RowJson } from './http.ts'
import { queryRowNeighbors, queryRows, type QueryRowsInput, type RowNeighbors } from './query.ts'
import { restrictedRowsSql, rowsAccessForDataSource, type RowsAccess } from './row-access.ts'
import { rowsStandingInView } from './row-in-view.ts'
import { normalizeSearch } from './search.ts'
import { getView, type ViewDetail } from './view.ts'
import { cardParentsOnlyPair, nestsSubItems, showsParentsOnly, subItemPairOf } from './view-columns.ts'

export type DeltaRow =
  | (RowJson & { readonly kind: 'row_upsert'; readonly inView: boolean; readonly place?: RowNeighbors })
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
  /**
   * **묻는 사람의** 이 뷰 개인 필터 · 정렬이 바뀌었다(RT-3 — 다른 탭 · 기기에서 · 신호를 놓쳤다). 화면은 도구줄까지 새로 그린다. 남의 것은
   * 싣지 않는다(개인 설정은 변경 기록에 쓰지 않는다 — `view_personal_change`).
   */
  readonly personalChanged: boolean
  /**
   * 자리를 물었을 때(`place`)만 — 뷰에 서는 행마다 `place` 를 실었다. 거짓이면 이 뷰는 자리를 줄 수 없다(하위 항목 트리 · 카드의 부모만 ·
   * 화면의 "더 보기" 커서가 이 정렬에 맞지 않는다) — 화면은 처음부터 다시 읽는다.
   */
  readonly placed?: boolean
  /** 열 집계를 물었고(`calc`) 바뀐 행이 있을 때만 — 행 읽기의 첫 페이지가 싣는 것과 같다. */
  readonly calculations?: Calculations
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
  options: {
    readonly search?: unknown
    readonly today?: string | null
    /** 뷰에 서는 행마다 자리를 싣는다(RT-2 — 머리말). */
    readonly place?: boolean
    /** 화면이 "더 보기"로 이어 읽을 커서 — 주면 `place.beyond` 를 판정한다. 없으면 화면이 목록을 끝까지 들고 있다. */
    readonly page?: string | null
    /** 바뀐 행이 있으면 열 집계를 싣는다. */
    readonly calculations?: boolean
  } = {},
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
  if (decision.reset) {
    // 처음부터 다시 읽는 화면도 도구줄(내 필터)은 따로 그린다 — 그 사이 내 개인 설정이 바뀌었으면 알린다(지운 기록 아래의 커서는 모른다 = 바뀌었다)
    const personal = decision.reason === 'expired' || (await personalChangedInWindow(viewId, ctx.userId, after, window.horizon))
    return { ok: true, value: resetDelta(window.horizon, decision.reason, personal) }
  }

  const schemaChanged = window.entries.some((e) => e.kind === 'schema')
  const viewChanged = window.entries.some((e) => e.kind === 'view' && e.viewId === viewId)
  const orderChanged = window.entries.some((e) => e.kind === 'position' && e.viewId === viewId)
  // 내 개인 설정 — 같은 창(after ≤ xid < 지평)으로 묻는다(한 번만 알린다)
  const personalChanged = await personalChangedInWindow(viewId, ctx.userId, after, window.horizon)
  const base = {
    cursor: encodeChangeCursor(window.horizon),
    reset: false,
    behind: window.behind,
    schemaChanged,
    viewChanged,
    orderChanged,
    personalChanged,
  }
  if (ids.length === 0) return { ok: true, value: { ...base, rows: [], ...(options.place === true ? { placed: true } : {}) } }

  // 살아 있고 볼 수 있는 행 — 값(필터 없이) · 그 가운데 뷰에 서는 것(필터 · 검색어 · 범위)
  const live = await queryRows(ctx, dataSourceId, { onlyRowIds: ids, limit: ids.length })
  if (!live.ok) return { ok: false, reason: live.reason === 'forbidden' ? 'forbidden' : 'not_found' }
  const liveIds = live.value.rows.map((r) => r.id)
  const standing = (await rowsStandingInView(ctx, view.value, liveIds, options.search ?? null, options.today ?? null)) ?? new Set<string>()
  // 빠진 행 — 볼 수 있는 것만
  const liveSet = new Set(liveIds)
  const left = new Set(await visibleLeftRows(ctx, access, dataSourceId, ids.filter((id) => !liveSet.has(id))))

  // 자리(RT-2) — 뷰에 서는 행의 이웃. 줄 수 없으면 `placed: false`
  let places: ReadonlyMap<string, RowNeighbors> | null = null
  if (options.place === true) {
    const listing = flatListInput(view.value)
    const standingIds = liveIds.filter((id) => standing.has(id))
    if (listing !== null) {
      const neighbors = await queryRowNeighbors(
        ctx,
        dataSourceId,
        { ...listing, search: normalizeSearch(options.search ?? null), today: options.today ?? null },
        standingIds,
        typeof options.page === 'string' && options.page !== '' ? options.page : null,
      )
      // 뷰에 서는 행은 모두 이웃이 있어야 한다 — 두 질의 사이에 바뀌었으면(다른 스냅샷) 자리를 주지 않는다
      if (neighbors.ok && standingIds.every((id) => neighbors.value.has(id))) places = neighbors.value
    }
  }

  const byId = new Map(live.value.rows.map((r) => [r.id, r]))
  const rows: DeltaRow[] = []
  for (const id of ids) {
    const row = byId.get(id)
    const inView = standing.has(id)
    const place = inView ? places?.get(id) : undefined
    if (row !== undefined) rows.push({ ...rowJson(row), kind: 'row_upsert', inView, ...(place === undefined ? {} : { place }) })
    else if (left.has(id)) rows.push({ id, kind: 'row_delete', inView: false })
  }
  const calculations =
    options.calculations === true && rows.length > 0 ? await deltaCalculations(ctx, view.value, options.search ?? null, options.today ?? null) : undefined
  return {
    ok: true,
    value: {
      ...base,
      rows,
      ...(options.place === true ? { placed: places !== null } : {}),
      ...(calculations === undefined ? {} : { calculations }),
    },
  }
}

/**
 * 평평한 목록의 행 질의 입력 — 행 읽기(`/views/[id]/rows`)와 같은 필터 · 정렬 · 수동 순서 · 표시 범위(P-3). 하위 항목을 펴는 트리 ·
 * 카드의 부모만(갤러리)은 null — 그 차례는 층마다라 한 줄의 이웃으로 말할 수 없다(화면은 다시 읽는다).
 */
function flatListInput(view: ViewDetail): Pick<QueryRowsInput, 'filter' | 'sorts' | 'manualOrderViewId' | 'flatScope'> | null {
  const nest = nestsSubItems(view.type) ? subItemPairOf(view.columns) : null
  if (nest !== null && view.subItemDisplay === 'nested') return null
  if (showsParentsOnly(view.type) && cardParentsOnlyPair(view.columns, view.subItemDisplay) !== null) return null
  return {
    filter: view.effectiveFilter,
    sorts: view.effectiveSorts,
    manualOrderViewId: view.id,
    ...(nest === null ? {} : { flatScope: { parentPropertyId: nest.parentPropertyId, scope: view.subItemFilterScope } }),
  }
}

/** 열 집계 — 행 읽기의 첫 페이지와 같은 입력(트리면 표시 범위의 층 · P-1 ⑤). */
function deltaCalculations(ctx: SessionContext, view: ViewDetail, search: unknown, today: string | null): Promise<Calculations> {
  const nest = nestsSubItems(view.type) ? subItemPairOf(view.columns) : null
  return computeCalculations(ctx, view.dataSourceId, view.effectiveFilter, view.columns, normalizeSearch(search), today,
    nest === null ? null : { parentPropertyId: nest.parentPropertyId, scope: view.subItemFilterScope })
}

function resetDelta(horizon: bigint, reason: ResetReason, personalChanged = false): RowDelta {
  return {
    cursor: encodeChangeCursor(horizon),
    reset: true,
    resetReason: reason,
    behind: false,
    rows: [],
    schemaChanged: false,
    viewChanged: false,
    orderChanged: false,
    personalChanged,
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
