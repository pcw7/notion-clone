/**
 * 그룹 · 보드 — 보드 4a조각 (F-04-11 Group by · F-04-03 Board 의 서버 쪽)
 *
 * 정본: 00-canonical-data-model.md §3.6 (`view.group_by` · `row_position`) · §3.5 불변식 R1
 *       04-database-views.md F-04-11 (버킷 규칙 · 2단계 질의) · F-04-03 (드롭 = 셀 값 + 순서)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 그룹 키는 문자열 하나다 — 빈 값 그룹은 ''
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-11 의 버킷 규칙 중 **select · status · checkbox** 셋이다(04 의 현실적 대안: *"MVP 는 select/status/checkbox
 * 3종 그룹만"*). 키는 select · status 가 **옵션 id**(셀의 사이드카가 그것이다 · §3.2-8 — status 는 "그룹이 강제되는
 * select" 라 같은 길을 탄다 · `property-types.ts` `OPTION_TYPES`), checkbox 가 `'true'` · `'false'`. 값이 빈 행은 `''` 그룹("No X")에 모인다 — 정본 `row_position.group_key
 * DEFAULT ''` 가 그 자리다. 없는 옵션을 가리키는 셀(옵션이 지워진 뒤)도 `''` 로 접는다 — SQL 의 키 식이
 * 그렇게 계산하므로 카운트 · 행 · 커서가 한 규칙을 본다.
 *
 * **빈 그룹과 "No X" 그룹은 다른 개념이다**(F-04-11): 빈 그룹 = 옵션은 있으나 행이 0개(`hide_empty` 가 거른다),
 * "No X" = 값이 없는 행의 수집처(`hidden` 으로 개별 숨김). 그래서 `''` 도 `hidden` 에 들어갈 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 두 단계로 읽는다 — 카운트, 그리고 보이는 그룹의 상위 N행
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-04-11: *"그룹 200개 × 각 5,000행 → 2단계 쿼리 필수 — (1) 그룹 키 + 카운트만, (2) 화면에 보이는 그룹만
 * 상위 N행."* 카운트는 GROUP BY 한 번, 행은 윈도 함수(`row_number() OVER (PARTITION BY 키)`)로 그룹마다
 * `load_limit + 1` 개까지 한 번에 읽는다. 그 뒤는 그룹마다 독립 커서(`queryGroupRows`)다 — 한 열의 "더 보기"가
 * 다른 열을 다시 읽지 않는다(F-04-15).
 *
 * 권한은 `queryRows` 와 같다 — data_source 단위 게이트가 질의 앞에 있고, 못 보면 카운트도 내주지 않는다
 * (F-04-11: *"볼 수 없는 행은 그룹 카운트에서도 제외 — 카운트만으로 비공개 행의 존재가 드러나는 대표 경로"*).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 열 안 순서: 정렬이 있으면 정렬이, 없으면 `row_position` 이 정한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정렬 키가 살아 있으면 `row_position` 을 **읽지 않는다.** 정렬된 열에서 카드를 끌어 놓은 자리는 어차피 다음
 * 읽기에서 정렬이 되돌린다 — 노션도 정렬이 걸린 보드에서는 열 안 이동을 막는다. 그때 드롭은 셀 값만 바꾼다.
 *
 * 수동 순서는 **자리 있는 행(`order_idx` 순) → 자리 없는 행(트리 순서)** 이다. 새 행 · 옮겨 온 적 없는 행은
 * 자리가 없고, 그것이 정상이다(마이그레이션 0022 머리말). 자리 없는 행 **앞**에 놓으려면 그 행까지의 자리 없는
 * 행들에 먼저 자리를 준다(`materializePositions`) — 그래야 새 키를 그 사이에 만들 수 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 드롭은 한 트랜잭션이다 — 셀 값과 순서
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 문서 §5.2 4번: *"드롭 = '셀 값 + 순서' 2 mutation 을 **서버 단일 API** 로."* 둘로 나누면 "값은 바뀌었는데
 * 자리가 옛 열에 남은 카드"가 생긴다. 셀은 `row.ts` 의 `updateCellsIn` 으로 쓴다 — 검증 · 사이드카 · 제목 투영 ·
 * 버전 올리기를 여기 복사하지 않는다. 값이 이미 같으면 셀을 건드리지 않는다(버전이 헛되이 오르지 않는다).
 *
 * 권한은 **`edit_content`** 다. F-04-03: *"`Can edit content` 사용자 — 카드 드래그는 허용(셀 값 변경 = 데이터
 * 편집), 그룹 프로퍼티 변경 · 그룹 숨김은 차단. 이 둘을 한 권한으로 묶으면 board 가 사실상 읽기 전용이 된다."*
 * 그룹 설정(`group_by`)은 `view.ts` 의 `updateView` 가 `edit_structure` 로 지킨다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween, orderKeysBetween } from '../block/order-key.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'
import {
  compileCursor,
  compileFilter,
  compileSorts,
  ParamBag,
  type CompiledSort,
  type FilterNode,
  type PropertyTypes,
  type SortKey,
} from './filter.ts'
import {
  isGroupableType,
  isMvpPropertyType,
  isOptionType,
  optionValue,
  type CellValue,
  type GroupableType,
  type SelectOption,
} from './property-types.ts'
import { readOptionsOf } from './options.ts'
import {
  decodeCursorValues,
  encodeCursorValues,
  readPropertyTypes,
  toQueriedRow,
  type QueriedRow,
  type RowRow,
} from './query.ts'
import { readRow, updateCellsIn, type RowFailure, type RowSummary } from './row.ts'
import { MAX_QUERY_LIMIT } from './limits.ts'

// ── 계약 ──────────────────────────────────────────────────────────────

/** 그룹으로 묶을 수 있는 타입. F-04-11 의 9종 중 셋(머리말). 정의는 클라이언트도 읽는 `property-types.ts` 에 있다. */
export { GROUPABLE_TYPES, isGroupableType, type GroupableType } from './property-types.ts'

/** 값이 없는 행의 그룹. 정본 `row_position.group_key DEFAULT ''`. */
export const NO_VALUE_KEY = ''
/** 숨긴 그룹 키 목록의 상한 — F-04-11 의 "그룹 200개" 규모. */
export const MAX_HIDDEN_GROUPS = 200

/**
 * `view.group_by` 의 모양. `SortKey` 처럼 snake_case 로 저장한다.
 *
 * 그룹 순서는 **옵션 순서(스키마 전역)** 다 — 뷰별 `group_order` 배열을 두지 않았다. F-04-11 동시편집 엣지의
 * 권고: *"그룹 순서를 select 옵션의 fractional index 로 옮기면 배열 LWW 자체가 사라진다 — 단 뷰별 그룹 순서를
 * 포기하게 된다."* 그 트레이드오프를 택했다. `hidden` 은 배열이라 LWW 지만, 죽은 키는 렌더에서 무시한다
 * (F-04-11: "지연 GC — 매 조회마다 정리 쿼리를 돌리면 쓰기 부하가 는다").
 */
export type GroupBy = {
  readonly property_id: string
  /** 숨긴 그룹 키. `''` 도 올 수 있다("No X" 숨김). */
  readonly hidden?: readonly string[]
  /** 행이 0개인 그룹을 그리지 않는다. `''` 그룹도 포함이다. */
  readonly hide_empty?: boolean
}

export function validateGroupBy(raw: unknown, types: PropertyTypes): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [{ path: 'groupBy', message: '객체여야 합니다' }]
  }
  const g = raw as Record<string, unknown>
  const issues: ValidationIssue[] = []
  if (typeof g.property_id !== 'string' || !types.has(g.property_id)) {
    issues.push({ path: 'groupBy.property_id', message: '없는 프로퍼티입니다' })
  } else if (!isGroupableType(types.get(g.property_id))) {
    issues.push({ path: 'groupBy.property_id', message: 'select · status · checkbox 프로퍼티만 그룹으로 묶을 수 있습니다' })
  }
  if (g.hidden !== undefined) {
    if (!Array.isArray(g.hidden) || g.hidden.some((k) => typeof k !== 'string')) {
      issues.push({ path: 'groupBy.hidden', message: '문자열 배열이어야 합니다' })
    } else if (g.hidden.length > MAX_HIDDEN_GROUPS) {
      issues.push({ path: 'groupBy.hidden', message: `숨긴 그룹이 ${MAX_HIDDEN_GROUPS}개를 넘습니다` })
    }
  }
  if (g.hide_empty !== undefined && typeof g.hide_empty !== 'boolean') {
    issues.push({ path: 'groupBy.hide_empty', message: 'boolean 이어야 합니다' })
  }
  return issues
}

/** 저장할 모양으로 정리한다 — 모르는 키를 버리고 중복 hidden 을 접는다. `validateGroupBy` 를 지난 값만. */
export function normalizeGroupBy(raw: GroupBy): GroupBy {
  const hidden = [...new Set(raw.hidden ?? [])]
  return {
    property_id: raw.property_id,
    ...(hidden.length > 0 ? { hidden } : {}),
    ...(raw.hide_empty ? { hide_empty: true } : {}),
  }
}

// ── 결과 모양 ─────────────────────────────────────────────────────────

export type BoardGroup = {
  readonly key: string
  /** select · status 그룹의 옵션. `''` 그룹 · checkbox 그룹은 null. */
  readonly option: SelectOption | null
  /** 필터를 지난 행 수. 숨긴 그룹도 센다(숨긴 그룹 목록에 개수를 보여 준다). */
  readonly count: number
  readonly hidden: boolean
  /** 숨긴 그룹은 비어 있다. */
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type GroupsPage = {
  readonly propertyId: string
  readonly propertyType: GroupableType
  /** 정렬 키가 없어 `row_position` 이 순서를 정한다 — 화면은 이때만 열 안 이동을 허용한다. */
  readonly manualOrder: boolean
  readonly groups: readonly BoardGroup[]
}

export type GroupRowsPage = {
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
}

export type MoveRowInput = {
  readonly rowId: string
  /** 놓을 그룹. 옵션 id · `'true'`/`'false'` · `''`. */
  readonly groupKey: string
  /** 이 행 **앞**에 놓는다. `null` 이면 열의 맨 뒤. 정렬이 걸린 뷰에서는 무시된다. */
  readonly beforeRowId?: string | null
}

export type MoveOutcome = {
  readonly row: RowSummary
  readonly groupKey: string
  /** 순서를 저장했는가. 정렬이 걸린 뷰면 false — 셀 값만 바뀌었다. */
  readonly positioned: boolean
}

export type GroupFailure = RowFailure | 'not_grouped'

export type GroupResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: GroupFailure
      readonly issues?: readonly ValidationIssue[]
      readonly currentVersion?: string
    }

const fail = (reason: GroupFailure): GroupResult<never> => ({ ok: false, reason })

function isFailure<T>(v: T | GroupResult<never>): v is GroupResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

// ── 뷰 열기 ───────────────────────────────────────────────────────────

type Board = {
  readonly viewId: string
  readonly dataSourceId: string
  readonly filter: FilterNode | null
  readonly sorts: readonly SortKey[]
  readonly loadLimit: number
  readonly groupBy: GroupBy
  readonly propertyType: GroupableType
  readonly options: readonly SelectOption[]
  readonly types: PropertyTypes
}

/**
 * 그룹이 걸린 뷰를 열고 권한 · 그룹 프로퍼티를 읽는다.
 *
 * 그룹 프로퍼티가 지워졌으면 `not_grouped` 다 — `view.ts` 의 `readView` 가 그런 뷰의 `groupBy` 를 null 로
 * 주는 것과 같은 규칙(죽은 참조는 읽기에서 무시한다). 복원하면 그대로 돌아온다.
 */
async function openBoard(
  tx: Tx,
  ctx: SessionContext,
  viewId: string,
  need: 'view' | 'edit_content',
): Promise<Board | GroupResult<never>> {
  const view = await tx.queryMaybe<{
    database_id: string
    data_source_id: string
    filter: unknown
    sorts: unknown
    group_by: unknown
    load_limit: number
  }>(
    `SELECT v.database_id, v.data_source_id, v.filter, v.sorts, v.group_by, v.load_limit
       FROM view v
       JOIN block b ON b.id = v.database_id
      WHERE v.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
        AND v.owner_kind = 'database_view'`,
    [viewId, ctx.workspaceId],
  )
  if (view === null) return fail('not_found')

  const caps = await effectiveCaps(tx, ctx, view.database_id)
  if (!can(caps, 'view')) return fail('not_found')
  if (need === 'edit_content' && !can(caps, 'edit_content')) return fail('forbidden')

  const groupBy = view.group_by as GroupBy | null
  if (groupBy === null || typeof groupBy !== 'object' || typeof groupBy.property_id !== 'string') {
    return fail('not_grouped')
  }
  const types = await readPropertyTypes(tx, view.data_source_id)
  const propertyType = types.get(groupBy.property_id)
  if (!isGroupableType(propertyType)) return fail('not_grouped')

  return {
    viewId,
    dataSourceId: view.data_source_id,
    filter: (view.filter as FilterNode | null) ?? null,
    sorts: Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : [],
    loadLimit: view.load_limit,
    groupBy,
    propertyType,
    options: isOptionType(propertyType) ? await readOptions(tx, groupBy.property_id) : [],
    types,
  }
}

/** 열의 순서가 곧 이 순서다. status 옵션은 그룹 순서가 먼저다(`options.ts` 머리말). */
async function readOptions(tx: Tx, propertyId: string): Promise<SelectOption[]> {
  return (await readOptionsOf(tx, [propertyId])).get(propertyId) ?? []
}

/**
 * 그룹 목록(순서대로). `''` 가 **맨 앞**이다 — 노션 보드의 "No X" 열이 왼쪽 끝에 있다.
 * checkbox 는 안 된 것 → 된 것(할 일 보드의 자연스러운 순서).
 */
function catalogOf(board: Board): { key: string; option: SelectOption | null }[] {
  if (board.propertyType === 'checkbox') {
    return [
      { key: 'false', option: null },
      { key: 'true', option: null },
    ]
  }
  return [{ key: NO_VALUE_KEY, option: null }, ...board.options.map((o) => ({ key: o.id, option: o }))]
}

// ── SQL 조각 ──────────────────────────────────────────────────────────

/**
 * 행의 그룹 키를 계산하는 식. `gv` 는 그룹 프로퍼티의 셀(LEFT JOIN — 없으면 NULL).
 *
 * select: 살아 있는 옵션 id 면 그것, 아니면(빈 셀 · 지워진 옵션) `''`.
 * checkbox: NULL(셀 없음)은 false 다 — `checkbox` 의 빈 값이 false 이기 때문(`emptyValue`).
 */
function keyExprOf(board: Board, params: ParamBag): string {
  if (board.propertyType === 'checkbox') {
    return `(CASE WHEN gv.bool_value THEN 'true' ELSE 'false' END)`
  }
  const ids = params.bind(board.options.map((o) => o.id))
  return `(CASE WHEN gv.text_value = ANY(${ids}::text[]) THEN gv.text_value ELSE '' END)`
}

/** 수동 순서. `rp` 는 이 (뷰, 그룹)의 자리(LEFT JOIN — 없으면 NULL → 맨 뒤). */
const MANUAL_ORDER: CompiledSort = {
  orderBy: 'rp.order_idx COLLATE "C" ASC NULLS LAST, b.order_key COLLATE "C" ASC',
  keys: [{ expr: 'rp.order_idx COLLATE "C"', direction: 'asc', cast: '::text' }],
}

type Compiled = {
  readonly keyExpr: string
  readonly from: string
  readonly where: string
  readonly order: CompiledSort
  readonly manual: boolean
  readonly sortColumns: string
}

/** 살아 있는 정렬 키가 있는가. 없으면(전부 지워진 프로퍼티) 수동 순서다 — 사용자에게는 정렬이 없는 것과 같다. */
function hasLiveSort(board: Board): boolean {
  return board.sorts.some((s) => isMvpPropertyType(board.types.get(s.property_id)))
}

/**
 * 질의의 공통 부분. `$1` 은 dataSourceId, 나머지는 `params` 가 발급한다.
 *
 * `withOrder: false` 면 정렬 파라미터를 **바인딩하지 않는다** — 카운트 질의는 ORDER BY 가 없고, 쓰지 않는 파라미터를
 * 바인딩하면 pg 가 "bind message supplies N parameters" 로 거부한다(테스트가 잡았다).
 */
function compileBoard(board: Board, params: ParamBag, withOrder = true): Compiled {
  const gp = params.bind(board.groupBy.property_id)
  const keyExpr = keyExprOf(board, params)
  const viewParam = params.bind(board.viewId)
  const manual = !hasLiveSort(board)
  const order = manual ? MANUAL_ORDER : withOrder ? compileSorts(board.sorts, board.types, params) : MANUAL_ORDER
  const filterSql = compileFilter(board.filter, board.types, params)
  return {
    keyExpr,
    from: `FROM page p
       JOIN block b ON b.id = p.id
       LEFT JOIN page_property_value gv ON gv.page_id = p.id AND gv.property_id = ${gp}
       LEFT JOIN row_position rp ON rp.view_id = ${viewParam} AND rp.row_id = p.id AND rp.group_key = ${keyExpr}`,
    where: ['p.data_source_id = $1', 'p.is_template = false', "b.lifecycle = 'live'", filterSql]
      .filter((s): s is string => s !== null)
      .join(' AND '),
    order,
    manual,
    sortColumns: order.keys.map((k, i) => `, ${k.expr} AS sort_${i}`).join(''),
  }
}

const ROW_COLUMNS = 'b.id, b.order_key, p.properties_cache, b.properties, b.created_at, b.last_edited_at, b.version'

function nextCursorOf(order: CompiledSort, last: RowRow | undefined, hasMore: boolean): string | null {
  if (!hasMore || last === undefined) return null
  return encodeCursorValues([...order.keys.map((_, i) => last[`sort_${i}`]), last.order_key])
}

// ── 읽기 ──────────────────────────────────────────────────────────────

/**
 * 보드의 그룹 전부와, 보이는 그룹의 첫 페이지 행.
 */
export async function queryGroups(ctx: SessionContext, viewId: string): Promise<GroupResult<GroupsPage>> {
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view')
    if (isFailure(board)) return board

    // ── ① 카운트 ──
    const countParams = new ParamBag(2)
    const c = compileBoard(board, countParams, false)
    const counted = await tx.query<{ key: string; n: number }>(
      `SELECT ${c.keyExpr} AS key, count(*)::int AS n ${c.from} WHERE ${c.where} GROUP BY 1`,
      [board.dataSourceId, ...countParams.values],
    )
    const countOf = new Map(counted.map((r) => [r.key, r.n]))

    const hidden = new Set(board.groupBy.hidden ?? [])
    const catalog = catalogOf(board)
      .map((g) => ({ ...g, count: countOf.get(g.key) ?? 0, hidden: hidden.has(g.key) }))
      // 빈 그룹 숨김은 옵션 단위의 개념이다 — `''` 그룹도 행이 0개면 빠진다.
      .filter((g) => !(board.groupBy.hide_empty && g.count === 0))

    // ── ② 보이는 그룹의 상위 N행 — 그룹마다 load_limit + 1 ──
    const visibleKeys = catalog.filter((g) => !g.hidden && g.count > 0).map((g) => g.key)
    const rowsByKey = new Map<string, RowRow[]>()
    const params = new ParamBag(2)
    const q = compileBoard(board, params)
    if (visibleKeys.length > 0) {
      const keysParam = params.bind(visibleKeys)
      const limitParam = params.bind(board.loadLimit + 1)
      const rows = await tx.query<RowRow & { group_key: string; rn: string }>(
        `SELECT t.* FROM (
           SELECT ${ROW_COLUMNS}, ${q.keyExpr} AS group_key${q.sortColumns},
                  row_number() OVER (PARTITION BY ${q.keyExpr} ORDER BY ${q.order.orderBy}) AS rn
             ${q.from}
            WHERE ${q.where} AND ${q.keyExpr} = ANY(${keysParam}::text[])
         ) t
         WHERE t.rn <= ${limitParam}
         ORDER BY t.group_key, t.rn`,
        [board.dataSourceId, ...params.values],
      )
      for (const row of rows) {
        const list = rowsByKey.get(row.group_key) ?? []
        list.push(row)
        rowsByKey.set(row.group_key, list)
      }
    }

    const groups: BoardGroup[] = catalog.map((g) => {
      const fetched = rowsByKey.get(g.key) ?? []
      const hasMore = fetched.length > board.loadLimit
      const page = fetched.slice(0, board.loadLimit)
      return {
        key: g.key,
        option: g.option,
        count: g.count,
        hidden: g.hidden,
        rows: page.map(toQueriedRow),
        hasMore,
        nextCursor: nextCursorOf(q.order, page[page.length - 1], hasMore),
      }
    })

    return {
      ok: true,
      value: { propertyId: board.groupBy.property_id, propertyType: board.propertyType, manualOrder: q.manual, groups },
    } as const
  })
}

/**
 * 한 그룹의 다음 페이지 — 그룹별 독립 커서(F-04-15).
 *
 * 숨긴 그룹도 읽을 수 있다(숨김은 화면의 일이고 권한이 아니다). 정렬 구성이 바뀌어 커서 길이가 맞지 않으면
 * 처음부터 읽는다(`queryRows` 와 같은 태도).
 */
export async function queryGroupRows(
  ctx: SessionContext,
  viewId: string,
  groupKey: string,
  input: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<GroupResult<GroupRowsPage>> {
  return withReadTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'view')
    if (isFailure(board)) return board
    if (!catalogOf(board).some((g) => g.key === groupKey)) return fail('invalid_value')

    const limit = Math.min(Math.max(1, Math.floor(input.limit ?? board.loadLimit)), MAX_QUERY_LIMIT)
    const params = new ParamBag(2)
    const q = compileBoard(board, params)
    const keyParam = params.bind(groupKey)
    const cursorValues = decodeCursorValues(input.cursor)
    const cursorSql = cursorValues === null ? null : compileCursor(q.order, cursorValues, params)
    const limitParam = params.bind(limit + 1)

    const rows = await tx.query<RowRow>(
      `SELECT ${ROW_COLUMNS}${q.sortColumns}
         ${q.from}
        WHERE ${q.where} AND ${q.keyExpr} = ${keyParam}${cursorSql === null ? '' : ` AND ${cursorSql}`}
        ORDER BY ${q.order.orderBy}
        LIMIT ${limitParam}`,
      [board.dataSourceId, ...params.values],
    )
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    return {
      ok: true,
      value: { rows: page.map(toQueriedRow), hasMore, nextCursor: nextCursorOf(q.order, page[page.length - 1], hasMore) },
    } as const
  })
}

// ── 이동 ──────────────────────────────────────────────────────────────

function cellValueFor(board: Board, groupKey: string): CellValue {
  if (board.propertyType === 'checkbox') return { type: 'checkbox', checkbox: groupKey === 'true' }
  return optionValue(board.propertyType, groupKey === NO_VALUE_KEY ? null : groupKey)
}

/**
 * 카드를 옮긴다 — 그룹(= 셀 값)과 열 안 자리를 **한 트랜잭션**으로.
 */
export async function moveRow(
  ctx: SessionContext,
  viewId: string,
  input: MoveRowInput,
): Promise<GroupResult<MoveOutcome>> {
  // 거부를 돌려주면 롤백된다(`withCommandTransaction` 머리말) — 아래의 "쓰기 전에 검사"가 깨져도 반쯤 옮긴 카드는 없다.
  return withCommandTransaction(async (tx) => {
    const board = await openBoard(tx, ctx, viewId, 'edit_content')
    if (isFailure(board)) return board
    if (!catalogOf(board).some((g) => g.key === input.groupKey)) return fail('invalid_value')
    if (input.beforeRowId === input.rowId) return fail('invalid_value')

    // 행을 잠근다 — 같은 카드를 두 사람이 끌면 순서가 정해진다(셀은 LWW, 자리는 나중 것).
    const row = await tx.queryMaybe<{ id: string }>(
      `SELECT p.id FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template = false AND b.lifecycle = 'live'
        FOR UPDATE OF b`,
      [input.rowId, board.dataSourceId],
    )
    if (row === null) return fail('not_found')

    // ★ **쓰기 전에** 놓을 자리를 검사한다. 화면이 낡아 `beforeRowId` 의 카드가 그사이 다른 열로 갔을 수 있다 — 셀을 쓴
    //   뒤에 알면 "값은 바뀌었는데 거부된" 이동이 된다(#103).
    const manual = !hasLiveSort(board)
    if (manual && !(await isInGroup(tx, board, input.beforeRowId ?? null, input.groupKey))) return fail('not_found')

    // ── ① 셀 값. 이미 그 그룹이면 건드리지 않는다 ──
    const current = await currentKeyOf(tx, board, input.rowId)
    if (current !== input.groupKey) {
      const written = await updateCellsIn(tx, ctx, input.rowId, {
        cells: [{ propertyId: board.groupBy.property_id, value: cellValueFor(board, input.groupKey) }],
      })
      if (!written.ok) return written
    }

    // ── ② 자리. 옛 그룹의 자리는 지운다 — PK 가 (뷰, 그룹, 행)이라 두 열에 남을 수 있다 ──
    await tx.query(`DELETE FROM row_position WHERE view_id = $1 AND row_id = $2`, [viewId, input.rowId])

    if (manual) {
      const orderIdx = await placeIn(tx, board, input)
      await tx.query(
        `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, $4)`,
        [viewId, input.groupKey, input.rowId, orderIdx],
      )
    }

    const summary = await readRow(tx, input.rowId)
    if (summary === null) return fail('not_found')
    return { ok: true, value: { row: summary, groupKey: input.groupKey, positioned: manual } } as const
  })
}

async function currentKeyOf(tx: Tx, board: Board, rowId: string): Promise<string> {
  const params = new ParamBag(3)
  const gp = params.bind(board.groupBy.property_id)
  const keyExpr = keyExprOf(board, params)
  const row = await tx.queryOne<{ key: string }>(
    `SELECT ${keyExpr} AS key
       FROM page p
       LEFT JOIN page_property_value gv ON gv.page_id = p.id AND gv.property_id = ${gp}
      WHERE p.id = $1 AND p.data_source_id = $2`,
    [rowId, board.dataSourceId, ...params.values],
  )
  return row.key
}

/**
 * 새 자리 키를 계산한다. 옮기는 행의 자리는 이미 지워져 있다.
 *
 *   beforeRowId 있음 → 그 행의 자리 앞. 그 행에 자리가 없으면 거기까지 자리를 먼저 준다
 *   null            → 열의 맨 뒤. 자리 없는 행이 있으면 그것들에 먼저 자리를 준다 —
 *                     안 그러면 "맨 뒤"로 놓은 카드가 자리 없는 행들 **앞**에 그려진다
 */
/** `before` 가 그 그룹의 살아 있는 카드인가. null(맨 뒤)이면 언제나 참이다. `moveRow` 가 **쓰기 전에** 묻는다. */
async function isInGroup(tx: Tx, board: Board, before: string | null, groupKey: string): Promise<boolean> {
  if (before === null) return true
  const target = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM page p JOIN block b ON b.id = p.id
      WHERE p.id = $1 AND p.data_source_id = $2 AND p.is_template = false AND b.lifecycle = 'live'`,
    [before, board.dataSourceId],
  )
  return target !== null && (await currentKeyOf(tx, board, before)) === groupKey
}

/** 그 그룹에서의 새 자리 키. `beforeRowId` 는 `moveRow` 가 이미 검사했다(`isInGroup`). */
async function placeIn(tx: Tx, board: Board, input: MoveRowInput): Promise<string> {
  const { groupKey, rowId } = input
  const before = input.beforeRowId ?? null

  await materializePositions(tx, board, groupKey, rowId, before)

  if (before === null) {
    const last = await tx.queryOne<{ max: string | null }>(
      `SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2`,
      [board.viewId, groupKey],
    )
    return orderKeyBetween(last.max, null)
  }

  const after = await tx.queryOne<{ order_idx: string }>(
    `SELECT order_idx FROM row_position WHERE view_id = $1 AND group_key = $2 AND row_id = $3`,
    [board.viewId, groupKey, before],
  )
  const prev = await tx.queryOne<{ max: string | null }>(
    `SELECT max(order_idx) AS max FROM row_position
      WHERE view_id = $1 AND group_key = $2 AND order_idx < $3`,
    [board.viewId, groupKey, after.order_idx],
  )
  return orderKeyBetween(prev.max, after.order_idx)
}

/**
 * 그룹의 자리 없는 행들에 트리 순서대로 자리를 준다 — `upTo` 까지(포함), null 이면 전부.
 *
 * 화면 순서를 바꾸지 않는다: 자리 없는 행은 자리 있는 행 **뒤에 트리 순서**로 보였고, 마지막 자리 뒤에 그 순서로
 * 키를 주니 그대로다. 필터는 보지 않는다 — 자리는 (뷰, 그룹)의 것이고 필터에 가린 행도 그 열의 행이다.
 */
async function materializePositions(
  tx: Tx,
  board: Board,
  groupKey: string,
  movingRowId: string,
  upTo: string | null,
): Promise<void> {
  const params = new ParamBag(4)
  const gp = params.bind(board.groupBy.property_id)
  const keyExpr = keyExprOf(board, params)
  const unpositioned = await tx.query<{ id: string }>(
    `SELECT p.id
       FROM page p
       JOIN block b ON b.id = p.id
       LEFT JOIN page_property_value gv ON gv.page_id = p.id AND gv.property_id = ${gp}
       LEFT JOIN row_position rp ON rp.view_id = $1 AND rp.row_id = p.id AND rp.group_key = $2
      WHERE p.data_source_id = $3 AND p.is_template = false AND b.lifecycle = 'live'
        AND ${keyExpr} = $2 AND rp.row_id IS NULL AND p.id <> ${params.bind(movingRowId)}
      ORDER BY b.order_key COLLATE "C"`,
    [board.viewId, groupKey, board.dataSourceId, ...params.values],
  )
  const stop = upTo === null ? unpositioned.length : unpositioned.findIndex((r) => r.id === upTo) + 1
  const targets = unpositioned.slice(0, Math.max(0, stop))
  if (targets.length === 0) return

  const last = await tx.queryOne<{ max: string | null }>(
    `SELECT max(order_idx) AS max FROM row_position WHERE view_id = $1 AND group_key = $2`,
    [board.viewId, groupKey],
  )
  const keys = orderKeysBetween(last.max, null, targets.length)
  for (const [i, r] of targets.entries()) {
    await tx.query(
      `INSERT INTO row_position (view_id, group_key, row_id, order_idx) VALUES ($1, $2, $3, $4)`,
      [board.viewId, groupKey, r.id, keys[i]],
    )
  }
}
