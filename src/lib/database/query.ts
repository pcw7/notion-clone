/**
 * 행 질의 — W8-b (F-04-09 필터 · F-04-10 정렬 · F-04-15 커서)
 *
 * 정본: 00-canonical-data-model.md §3.5 불변식 R1 · §3.6
 *       03-database-core.md F-03-17 (권한 술어 · 페이지네이션 규칙)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한이 필터보다 먼저다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17 엣지 케이스: *"권한 없는 행이 필터 결과에 포함 → **건수조차 노출하면
 * 안 된다** → 권한 술어를 필터보다 먼저 적용."*
 *
 * 데이터베이스를 볼 수 있으면 모든 행이다 — 행의 `perm_scope_id` 는 컨테이너 블록에서 물려받는다. 게이트가 질의 앞에 있고,
 * 통과하지 못하면 SQL 을 아예 돌리지 않는다.
 *
 * "만들기만"(6f-2b-1 — `create_child` 는 있고 `view` 는 없다)인 사람은 표를 열지만 **자기가 열 수 있는 행만** 본다 — 행 술어
 * (`row-access.ts` 의 `restrictedRowsSql` — 행에 따로 준 부여 · 만든 사람 규칙)가 필터와 같은 WHERE 에 들어간다. 보드 · 캘린더 ·
 * 열 집계도 같은 술어다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * OFFSET 을 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17: *"페이지네이션은 … 커서 기반이다. 2026-04-20 부터 누적 페이지네이션
 * 깊이가 10,000건으로 제한되며 … **'전부 훑는' 클라이언트 로직은 반드시 깨진다.**
 * 클론도 무한 스크롤 대신 상한 + 필터 유도 UX 를 설계하라."*
 *
 * 그래서 keyset 커서이고(`filter.ts` 의 `compileCursor`), 상한은
 * `MAX_QUERY_PAGINATION`(정본 §3.5 의 10,000)이다. 상한에 닿으면 `incomplete` 를
 * 실어 보낸다 — `pagination.ts` 의 계약이 이미 그 필드를 갖고 있다(W2).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { plainTitleOf } from '../block/page.ts'
import { readPageIcon, type PageIcon } from '../block/page-icon.ts'
import {
  compileCursor,
  compileFilter,
  compileManualOrder,
  compileSorts,
  formulaTypeKey,
  propertyIdsIn,
  ParamBag,
  type FilterNode,
  type PropertyTypes,
  type SortKey,
} from './filter.ts'
import { todayOrUtc } from './relative-date.ts'
import { refreshDerivedValues } from './derived-values.ts'
import { compileSearch } from './search.ts'
import { restrictedRowsSql, rowsAccessIn } from './row-access.ts'
import type { SubItemFilterScope } from './sub-item-scope.ts'
// 상수는 화면과 나눠 쓴다(`limits.ts` 머리말). 기존 import 경로를 깨지 않게 다시 내보낸다.
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_PAGINATION } from './limits.ts'

export { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_PAGINATION }

export type QueriedRow = {
  readonly id: string
  readonly title: string
  /** 행 페이지의 아이콘(8c-3a · `format.page_icon`) — 셀이 아니다. 없으면 null. */
  readonly icon: PageIcon | null
  readonly orderKey: string
  readonly properties: Readonly<Record<string, unknown>>
  /** 고유 ID 의 번호(`page.unique_seq` · 2a-1 — `RowSummary.uniqueSeq` 와 같은 뜻). */
  readonly uniqueSeq: number | null
  readonly createdAt: Date
  readonly lastEditedAt: Date
  readonly version: string
  /** 하위 항목 트리의 맞춤(H-1 · P-1)이 걸린 질의에서만 — 스스로 맞았는가 · 아래에 맞은 행이 있는가. 그 밖의 질의에는 없다. */
  readonly treeMatch?: TreeMatch
}

/**
 * 하위 항목 트리의 맞춤 표시(H-1 · P-1 — 정본 §3.6 [보강] 뷰 검색 ⑧ · §3.5 [보강 P-1] ③). `matched` 가 false 면 맥락 행(맞은 자손
 * 때문에 선 조상)이다 — 그때 `below` 는 늘 true 다.
 */
export type TreeMatch = { readonly matched: boolean; readonly below: boolean }

export type QueryRowsInput = {
  readonly filter?: FilterNode | null
  readonly sorts?: readonly SortKey[]
  readonly limit?: number
  /** 이전 응답의 `nextCursor`. */
  readonly cursor?: string | null
  /**
   * 하위 항목의 트리(2b-2 · 정본 §3.5 [보강] 하위 항목). `under` 가 null 이면 **최상위 행**(살아 있는 부모가 없는 행 — 부모가 휴지통이면
   * 최상위로 보인다 · ⑥), 행 id 면 **그 행의 자식**만. 부모는 상위 항목 프로퍼티의 엣지에서 묻는다(계층의 정본 · E2).
   */
  readonly tree?: { readonly parentPropertyId: string; readonly under: string | null }
  /**
   * 뷰 검색어(2e-1 · F-04-27) — 필터와 AND 로 붙는다(`search.ts`). `normalizeSearch` 를 지난 값만. 뷰에 저장하지 않는다.
   */
  readonly search?: string | null
  /**
   * 하위 항목 트리의 맞춤(H-1 · P-1 — 정본 §3.5 [보강 P-1]) — 상위 항목 프로퍼티와 표시 범위. 주면 필터가 범위의 층에만 걸리고(②),
   * 맞은 행뿐 아니라 **맞은 자손을 가진 행**(맥락 행)도 싣고 행마다 `treeMatch` 를 단다(③). 조상의 사슬은 읽을 수 있는 살아 있는 행으로
   * 잇는다(볼 수 없는 부모 · 휴지통 부모에서 멈춘다 · 부모만의 최상위는 필터를 지나야 한다). 하위 항목을 펴는 표 · 목록만 준다 — 부모만
   * 그리는 뷰(보드 · 갤러리 · 캘린더)는 주지 않는다(필터 · 검색어를 모든 행에 — 예전 그대로).
   */
  readonly treeScope?: { readonly parentPropertyId: string; readonly scope: SubItemFilterScope }
  /**
   * 평평한 목록의 포함(P-3 · 정본 §3.5 [보강 P-1] ⑦) — 하위 항목이 켜진 표 · 목록을 트리 없이 그릴 때, 표시 범위가 어떤 행이 들어오는지를
   * 정한다(부모만: 최상위 행만 · 하위만: 최상위가 아닌 행만 · 부모와 하위: 모든 행). 필터 · 검색어는 들어온 행에 그대로 건다. `tree` ·
   * `treeScope` 와 함께 주지 않는다.
   */
  readonly flatScope?: { readonly parentPropertyId: string; readonly scope: SubItemFilterScope }
  /**
   * 이 행들로만 좁힌다(10n-16 — "고친 행이 아직 이 뷰에 서는가" · `row-in-view.ts`). 다른 술어(권한 · 필터 · 검색어)는 그대로 건다.
   */
  readonly onlyRowIds?: readonly string[]
  /**
   * 이 뷰의 수동 순서(10n-59 · 정본 §3.6 [보강 10n-59]) — 살아 있는 정렬이 없을 때만 쓴다(자리 있는 행 → 자리 없는 행의 트리 순서).
   * 주지 않으면 트리 순서뿐이다. 보드는 자기 질의(`group.ts`)가 열마다의 자리를 읽는다.
   */
  readonly manualOrderViewId?: string
  /**
   * 보는 사람의 오늘(R-1 · `YYYY-MM-DD` — `readViewerToday`) — 상대 날짜 필터가 이것으로 범위를 편다. 주지 않으면 UTC 의 오늘.
   */
  readonly today?: string | null
}

export type QueryPage = {
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
  /**
   * 커서 순회가 상한에 걸려 끊겼는지.
   *
   * `hasMore: false` 만 보고 "끝까지 읽었다"고 판단하면 안 된다는 것이
   * `pagination.ts` 계약의 핵심이다.
   */
  readonly complete: boolean
}

export type QueryFailure = 'not_found' | 'forbidden'

export type QueryResult =
  | { readonly ok: true; readonly value: QueryPage }
  | { readonly ok: false; readonly reason: QueryFailure }

export type RowRow = {
  id: string
  order_key: string
  properties_cache: Record<string, unknown> | null
  properties: { title?: unknown } | null
  page_icon: unknown
  /** bigint 라 pg 가 문자열로 준다. */
  unique_seq: string | null
  created_at: Date
  last_edited_at: Date
  version: string
  /** 하위 항목 트리의 맞춤(H-1 · P-1)에서만 — 스스로 맞았는가 · 아래에 맞은 행이 있는가. */
  tree_matched?: boolean
  tree_below?: boolean
  /** 커서를 만들기 위한 정렬 값들. `sort_0`, `sort_1`, … */
  [k: string]: unknown
}

/**
 * 살아있는 프로퍼티의 `id → type` 맵.
 *
 * **살아있는 것만** 담는다. 지워진 프로퍼티를 참조하는 필터 규칙은 컴파일러가
 * 건너뛰어야 하고(F-03-17: 결과 0건으로 만들면 데이터 소실로 오인된다), 그
 * 판단의 근거가 이 맵에 없다는 사실이다.
 */
export async function readPropertyTypes(tx: Tx, dataSourceId: string): Promise<PropertyTypes> {
  const rows = await tx.query<{ id: string; type: string; result_type: string | null }>(
    `SELECT id, type, config ->> 'result_type' AS result_type FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId],
  )
  // 수식은 결과 타입과 함께 싣는다(2j-2) — 컴파일러가 그 칸 타입의 연산자로 캐시(`derived_value`)를 거른다(`filterTypeOf`)
  return new Map(rows.map((r) => [r.id, r.type === 'formula' ? formulaTypeKey(r.result_type ?? '') : r.type]))
}

/**
 * 필터·정렬·커서로 행을 읽는다.
 *
 * 불변식 R1: *"모든 뷰/API 쿼리는 기본 조건으로 `is_template=false` 를 강제한다."*
 */
export async function queryRows(
  ctx: SessionContext,
  dataSourceId: string,
  input: QueryRowsInput = {},
): Promise<QueryResult> {
  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_QUERY_LIMIT)),
    MAX_QUERY_LIMIT,
  )
  const sorts = (input.sorts ?? []).slice()

  // 수식으로 거르거나 정렬하면 그 캐시를 먼저 채운다(2j-2 — 읽기는 READ ONLY 다 · `derived-values.ts`). 수식이 없으면 질의 하나로 끝난다.
  await refreshDerivedValues(ctx, dataSourceId, propertyIdsIn(input.filter ?? null, sorts))

  return withReadTransaction(async (tx) => {
    // ── ① 권한. 필터보다 먼저다 ──
    const ds = await tx.queryMaybe<{ container_id: string }>(
      `SELECT ds.owner_database_id AS container_id
         FROM data_source ds
         JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null) return { ok: false, reason: 'not_found' } as const
    // 못 보는 사람에게는 존재를 알리지 않는다. "만들기만" 이면 자기가 열 수 있는 행만(6f-2b-1).
    const access = await rowsAccessIn(tx, ctx, await effectiveCaps(tx, ctx, ds.container_id))
    if (access === null) return { ok: false, reason: 'not_found' } as const

    const types = await readPropertyTypes(tx, dataSourceId)

    // ── ② 컴파일. `$1` 은 dataSourceId 가 쓰므로 2번부터 발급한다 ──
    const params = new ParamBag(2)
    const accessSql = restrictedRowsSql(access, params)
    // "나"(6g-2c)는 이 세션의 사람이다
    const filterSql = compileFilter(input.filter ?? null, types, params, { me: ctx.userId, today: todayOrUtc(input.today) })
    const sorted = compileSorts(sorts, types, params)
    // 살아 있는 정렬이 없으면 이 뷰의 수동 순서(10n-59) — 지워진 속성의 정렬 키는 `compileSorts` 가 이미 뺐다
    const compiledSort =
      sorted.keys.length === 0 && input.manualOrderViewId !== undefined ? compileManualOrder(params.bind(input.manualOrderViewId)) : sorted

    // 커서는 정렬 키 값 + order_key 를 담는다. 정렬 구성이 바뀌면 길이가 달라져
    // `compileCursor` 가 `null` 을 주고, 그때는 처음부터 읽는다 —
    // 손상된 커서를 던지지 않는 `pagination.ts` 의 태도와 같다.
    const cursorValues = decodeCursorValues(input.cursor)
    const cursorSql =
      cursorValues === null ? null : compileCursor(compiledSort, cursorValues, params)

    const treeSql = input.tree === undefined ? null : compileTree(input.tree, params)
    // relation 의 제목(V-2)은 보는 사람이 읽을 수 있는 대상만 — 검색어가 있을 때만 범위를 묻는다
    const searchSql =
      input.search === undefined || input.search === null ? null : compileSearch(input.search, types, params, await readableScopes(tx, ctx))
    const onlySql = input.onlyRowIds === undefined ? null : `p.id = ANY(${params.bind([...input.onlyRowIds])}::uuid[])`

    // 행의 바탕 — 같은 표 · 템플릿 아님 · 살아 있음 · 권한
    const base = [
      'p.data_source_id = $1',
      'p.is_template = false', // 불변식 R1
      "b.lifecycle = 'live'",
      accessSql, // 권한이 필터보다 먼저다(F-03-17)
    ].filter((s): s is string => s !== null)

    // 하위 항목 트리의 맞춤(H-1 · P-1) — 범위가 필터를 거는 층을 정한다: 문(gate — 설 수 있는가)과 맞음(match — 결과인가). 맞음이 있으면
    // 맞은 행(sx_hit)과 그 위로 설 수 있는 조상(sx_up)을 먼저 모으고, 층의 질의는 둘 중 하나에 든 행을 고르며 어느 쪽인지 싣는다.
    // 맞춤 밖이면 예전 그대로 — 필터 · 검색어를 모든 행에.
    const scoped = input.treeScope === undefined ? null : compileTreeScope(input.treeScope, filterSql, searchSql, params)
    const visible = scoped === null ? [...base, ...(filterSql === null ? [] : [filterSql])] : [...base, ...(scoped.gate === null ? [] : [scoped.gate])]
    const matchSql = scoped === null ? null : scoped.match
    const withSql =
      scoped === null || matchSql === null
        ? ''
        : `WITH RECURSIVE sx_hit AS (
             SELECT p.id FROM page p JOIN block b ON b.id = p.id WHERE ${[...visible, matchSql].join(' AND ')}
           ), sx_up AS (
             SELECT p.id FROM sx_hit sh
               JOIN relation_edge se ON se.from_page_id = sh.id AND se.property_id = ${scoped.parent}
               JOIN page p ON p.id = se.to_page_id JOIN block b ON b.id = p.id
              WHERE ${visible.join(' AND ')}
             UNION
             SELECT p.id FROM sx_up su
               JOIN relation_edge se ON se.from_page_id = su.id AND se.property_id = ${scoped.parent}
               JOIN page p ON p.id = se.to_page_id JOIN block b ON b.id = p.id
              WHERE ${visible.join(' AND ')}
           ) `
    const hitColumns =
      withSql === '' ? '' : ', p.id IN (SELECT id FROM sx_hit) AS tree_matched, p.id IN (SELECT id FROM sx_up) AS tree_below'

    // 평평한 목록의 포함(P-3) — 범위의 층에 든 행만
    const flatSql = input.flatScope === undefined ? null : levelSql(input.flatScope, params)

    const where = [
      ...visible,
      scoped === null ? searchSql : withSql === '' ? null : '(p.id IN (SELECT id FROM sx_hit) OR p.id IN (SELECT id FROM sx_up))',
      treeSql,
      flatSql,
      onlySql,
      cursorSql,
    ].filter((s): s is string => s !== null)

    // 정렬 값을 함께 꺼낸다 — 다음 커서를 만들려면 마지막 행의 정렬 값이 필요하고,
    // 애플리케이션이 다시 계산할 수 없다(EAV 의 값이기 때문이다).
    const sortColumns = compiledSort.keys
      .map((k, i) => `, ${k.expr} AS sort_${i}`)
      .join('')

    const limitParam = params.bind(limit + 1)

    const rows = await tx.query<RowRow>(
      `${withSql}SELECT b.id, b.order_key, p.properties_cache, b.properties, b.format -> 'page_icon' AS page_icon,
              p.unique_seq, b.created_at, b.last_edited_at, b.version${sortColumns}${hitColumns}
         FROM page p
         JOIN block b ON b.id = p.id
        WHERE ${where.join(' AND ')}
        ORDER BY ${compiledSort.orderBy}
        LIMIT ${limitParam}`,
      [dataSourceId, ...params.values],
    )

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]

    return {
      ok: true,
      value: {
        rows: page.map(toQueriedRow),
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursorValues([
                ...compiledSort.keys.map((_, i) => last[`sort_${i}`]),
                last.order_key,
              ])
            : null,
        // 한 페이지만 보고는 누적 깊이를 알 수 없다. 호출자가 `limit` 합계를
        // 세어 상한에 닿았는지 판단하도록 이 값을 준다 — 지금은 한 페이지가
        // 상한보다 작으므로 항상 complete 다. 누적 추적은 호출자의 일이다.
        complete: true,
      },
    } as const
  })
}

/**
 * 하위 항목 트리의 술어(2b-2) — 바깥 질의에 `page p` 가 있다고 전제한다. 표의 행 질의와 보드(`group.ts`)가 같은 함수를 쓴다.
 *
 * 최상위(`under` null)는 "살아 있는 부모가 없는 행"이다 — 부모가 휴지통이면 자식이 최상위로 보인다(정본 [보강] 하위 항목 ⑥).
 */
export function compileTree(tree: NonNullable<QueryRowsInput['tree']>, params: ParamBag): string {
  const property = params.bind(tree.parentPropertyId)
  if (tree.under === null) return rootSql(property)
  return `EXISTS (SELECT 1 FROM relation_edge te
                   WHERE te.property_id = ${property} AND te.from_page_id = p.id AND te.to_page_id = ${params.bind(tree.under)}::uuid)`
}

/**
 * 최상위 행인가 — 살아 있는 부모가 없다(부모가 휴지통이면 최상위 · 정본 [보강] 하위 항목 ⑥). `property` 는 상위 항목 프로퍼티의 자리표.
 * 바깥 질의에 `page p` 가 있다고 전제한다. 트리의 최상위 층 · 표시 범위의 층(P-1) · 열 집계의 층이 같은 술어를 쓴다.
 */
export function rootSql(property: string): string {
  return `NOT EXISTS (SELECT 1 FROM relation_edge te JOIN block tb ON tb.id = te.to_page_id
                       WHERE te.property_id = ${property} AND te.from_page_id = p.id AND tb.lifecycle = 'live')`
}

/**
 * 표시 범위의 층(P-1 ⑤ · P-3 ⑦) — 부모만이면 최상위 행, 하위만이면 최상위가 아닌 행, 부모와 하위면 null(모든 행). 열 집계의 결과 행과
 * 평평한 목록의 포함이 같은 술어를 쓴다. 바깥 질의에 `page p` 가 있다고 전제한다.
 */
export function levelSql(
  level: { readonly parentPropertyId: string; readonly scope: SubItemFilterScope },
  params: ParamBag,
): string | null {
  if (level.scope === 'both') return null
  return `${level.scope === 'sub_items' ? 'NOT ' : ''}${rootSql(params.bind(level.parentPropertyId))}`
}

/**
 * 표시 범위의 문 · 맞음(P-1 · 정본 §3.5 [보강 P-1] ② ③) — 바깥 질의에 `page p` 가 있다고 전제한다.
 *
 *   부모만      문 = 최상위면 필터   맞음 = 검색어
 *   부모와 하위  문 = 없음           맞음 = 필터 ∧ 검색어
 *   하위만      문 = 없음           맞음 = (최상위거나 필터) ∧ 검색어
 *
 * 맞음이 늘 참이면(검색어가 없고 범위의 층에 필터가 걸리지 않는다) `match` 는 null — 맥락 행이 생기지 않는다.
 */
export function compileTreeScope(
  treeScope: NonNullable<QueryRowsInput['treeScope']>,
  filterSql: string | null,
  searchSql: string | null,
  params: ParamBag,
): { readonly parent: string; readonly gate: string | null; readonly match: string | null } {
  // 자리표는 쓸 때만 묶는다 — 묶고 SQL 에 쓰지 않으면 Postgres 가 그 타입을 정하지 못해 질의가 죽는다(필터 · 검색어가 없는 트리)
  let bound: string | null = null
  const parent = (): string => (bound ??= params.bind(treeScope.parentPropertyId))
  const gate = treeScope.scope === 'parents' && filterSql !== null ? `(NOT ${rootSql(parent())} OR ${filterSql})` : null
  const filterPart =
    filterSql === null || treeScope.scope === 'parents'
      ? null
      : treeScope.scope === 'sub_items'
        ? `(${rootSql(parent())} OR ${filterSql})`
        : filterSql
  const parts = [filterPart, searchSql].filter((s): s is string => s !== null)
  const match = parts.length === 0 ? null : parts.join(' AND ')
  // 맞음이 있으면 조상 사슬(sx_up)이 상위 항목 프로퍼티를 쓴다
  if (match !== null) parent()
  return { parent: bound ?? '', gate, match }
}

export function toQueriedRow(row: RowRow): QueriedRow {
  return {
    id: row.id,
    title: plainTitleOf(row.properties),
    icon: readPageIcon(row.page_icon),
    orderKey: row.order_key,
    properties: row.properties_cache ?? {},
    uniqueSeq: row.unique_seq === null || row.unique_seq === undefined ? null : Number(row.unique_seq),
    createdAt: row.created_at,
    lastEditedAt: row.last_edited_at,
    version: row.version,
    ...(typeof row.tree_matched === 'boolean' ? { treeMatch: { matched: row.tree_matched, below: row.tree_below === true } } : {}),
  }
}

// ── 커서 직렬화 ───────────────────────────────────────────────────────
//
// `pagination.ts` 의 `Cursor` 는 `{sortKey, id}` 두 문자열이다. 여기는 정렬 값이
// **여러 개**이고 타입이 섞여 있으므로(숫자·날짜·불리언·NULL) 그 계약을 그대로
// 쓸 수 없다. 같은 불투명·base64url 규칙을 따르되 배열을 담는다.
//
// ⚠ 커서에 정렬 값이 들어간다는 것은 **그 값이 클라이언트에 노출된다**는 뜻이다.
//   이미 그 행을 보여 줬으므로 새로 새는 정보는 없다 — 마지막 행의 값이다.

export function encodeCursorValues(values: readonly unknown[]): string {
  const normalized = values.map((v) => (v instanceof Date ? v.toISOString() : v))
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url')
}

export function decodeCursorValues(raw: string | null | undefined): unknown[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    // 손상된 커서는 던지지 않고 처음부터 읽는다(`pagination.ts` 와 같은 태도).
    return null
  }
}

// // `pagination.ts` 의 커서 헬퍼를 쓰지 않는 이유를 남겨 둔다.
//
// 그 계약(`{sortKey, id}`)은 정렬 축이 **하나**일 때의 모양이다. 검색(W7)이 두 축을
// 고정 폭 문자열로 합쳐 쓸 수 있었던 것은 축이 "제목 일치 + 시각" 둘로 정해져
// 있었기 때문이다. 여기는 사용자가 정렬 키를 고르고 타입이 섞이므로 합칠 수 없다.
//
// 규칙(불투명 · base64url · 손상 시 처음부터)은 같게 유지한다.
