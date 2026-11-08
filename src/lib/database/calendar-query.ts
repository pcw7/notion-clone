/**
 * 캘린더의 행 — 보이는 기간에 걸친 행만 (DB 심화 2g-1조각 · F-04-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 · 04-database-views.md F-04-06
 *
 * 04: *"대용량: 5년치 수만 행 → 화면에 보이는 기간만 범위 쿼리(`start <= range_end AND COALESCE(end,start) >= range_start`). 전체 로드
 * 금지."* 그래서 기간(`from` · `to` — 날짜 글자 · 62일 이하)을 받고, 그 기간에 **걸치는** 행을 날짜순으로 상한(`MAX_CALENDAR_ROWS`)까지
 * 읽는다. 커서가 없다 — 한 달은 한 번에 그린다(넘으면 `truncated`).
 *
 * 행을 고르는 조건은 표와 같다(필터 · 뷰 검색 · 템플릿 · 휴지통) — 같은 컴파일러를 끼운다. 하위 항목이 켜진 표면 **부모만**(03 F-03-18 ·
 * 04 *"트리를 달력에 그리려 하지 말 것"*). 기간은 사이드카(`date_start` · `date_end` — 순간)로 묻되 양끝을 하루씩 넓힌다 — 시각이 있는 값은
 * 시간대에 따라 UTC 날짜가 하루 어긋날 수 있고, 칸에 놓는 것은 화면이 칸 값의 날짜 글자로 다시 가른다(`calendar.ts` 머리말).
 *
 * **날짜 없는 행은 세기만 한다**(`undated`) — 04 *"달력에서 행이 조용히 사라지는 것이 가장 흔한 사용자 혼란 지점 → `날짜 없음 N개` 칩"*.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { daysBetween, isYmd, MAX_CALENDAR_ROWS, MAX_CALENDAR_SPAN_DAYS } from './calendar.ts'
import { MAX_TIMELINE_ROWS, MAX_TIMELINE_SPAN_DAYS } from './timeline.ts'
import { compileFilter, ParamBag, propertyIdsIn, type FilterNode } from './filter.ts'
import { todayOrUtc } from './relative-date.ts'
import { refreshDerivedValues } from './derived-values.ts'
import { compileTree, queryRows, readPropertyTypes, toQueriedRow, type QueryPage, type QueriedRow, type RowRow } from './query.ts'
import { compileSearch } from './search.ts'
import { restrictedRowsSql, rowsAccessForDataSource } from './row-access.ts'
import { readableScopes } from '../permissions/effective.ts'
import { getView } from './view.ts'
import { cardParentsOnlyPair } from './view-columns.ts'
import { readDependencyPair } from './dependencies.ts'

export type CalendarPage = {
  readonly datePropertyId: string
  /** 기간에 걸친 행 — 날짜(시작)순. */
  readonly rows: readonly QueriedRow[]
  /** 조건을 지났지만 날짜가 없는 행의 수(달력에 없다). */
  readonly undated: number
  /** 상한에 걸려 더 있다. */
  readonly truncated: boolean
  /**
   * 종속 관계 간선(TL-4 · 타임라인만) — `from` = 막는 행, `to` = 막힌 행. 종속 관계가 켜져 있고 둘 다 `rows` 에 있을 때만. 캘린더는 늘 빈 배열.
   */
  readonly dependencies: readonly { readonly from: string; readonly to: string }[]
}

export type CalendarFailure =
  | 'not_found'
  /** 캘린더 뷰가 아니다. */
  | 'not_calendar'
  /** 타임라인 뷰가 아니다(TL-1 — `queryTimeline` 의 실패). */
  | 'not_timeline'
  /** 날짜 속성이 지워졌다(저장값은 남는다) — 화면이 "날짜 속성을 고르라"를 그린다. */
  | 'no_date_property'
  /** 기간이 날짜가 아니거나 거꾸로거나 너무 길다. */
  | 'invalid_value'

export type CalendarResult =
  | { readonly ok: true; readonly value: CalendarPage }
  | { readonly ok: false; readonly reason: CalendarFailure }

const fail = (reason: CalendarFailure): CalendarResult => ({ ok: false, reason })

/** 날짜 없는 행을 한 번에 읽는 수(C-2). */
export const UNDATED_PAGE_SIZE = 50

export type UndatedResult =
  | { readonly ok: true; readonly value: QueryPage }
  | { readonly ok: false; readonly reason: Exclude<CalendarFailure, 'invalid_value' | 'not_timeline'> }

/**
 * 날짜 없는 행(C-2 · 정본 §3.6 [보강] 캘린더 ⑥) — 머리의 "날짜 없음 N개" 가 여는 목록. 행 질의(`queryRows`)에 날짜 칸의 "비어 있음" 규칙을
 * AND 로 붙인다 — 수(`undated`)와 같은 조건(필터 · 뷰 검색 · 권한 · 템플릿 · 휴지통 · 하위 항목은 부모만). 차례는 표와 같다(정렬 · 없으면 그
 * 뷰의 수동 순서) · 커서로 이어 읽는다.
 */
export async function queryUndatedRows(
  ctx: SessionContext,
  viewId: string,
  input: { readonly search?: string | null; readonly today?: string | null; readonly cursor?: string | null } = {},
): Promise<UndatedResult> {
  const view = await getView(ctx, viewId)
  if (!view.ok) return { ok: false, reason: 'not_found' }
  // 타임라인 뷰에도 연다(TL-1 · 정본 [보강 TL-1] ③) — 날짜 속성만 그 뷰의 설정에서 읽는다
  if (view.value.type !== 'calendar' && view.value.type !== 'timeline') return { ok: false, reason: 'not_calendar' }
  const dateProperty = view.value.type === 'timeline' ? view.value.timeline.date_property_id : view.value.calendar.date_property_id
  if (dateProperty === null) return { ok: false, reason: 'no_date_property' }
  // 수와 같은 조건 — 날짜 칸이 비어 있다(필터의 "비어 있음" 과 같은 술어 · 사이드카의 `date_start` 가 없다)
  const undated: FilterNode = { property_id: dateProperty, operator: 'is_empty' }
  const filter: FilterNode = view.value.effectiveFilter === null ? undated : { op: 'and', children: [view.value.effectiveFilter, undated] }
  // 카드 속성이면 부모만 · 평평한 목록이면 모든 행(K-1)
  const pair = cardParentsOnlyPair(view.value.columns, view.value.subItemDisplay)
  const page = await queryRows(ctx, view.value.dataSourceId, {
    filter,
    sorts: view.value.effectiveSorts,
    manualOrderViewId: view.value.id,
    limit: UNDATED_PAGE_SIZE,
    cursor: input.cursor ?? null,
    search: input.search ?? null,
    today: input.today ?? null,
    // 달력과 같이 부모만(③)
    ...(pair === null ? {} : { tree: { parentPropertyId: pair.parentPropertyId, under: null } }),
  })
  return page.ok ? page : { ok: false, reason: 'not_found' }
}

/** `today` — 보는 사람의 오늘(R-1 · 상대 날짜 필터 · 없으면 UTC). */
export type WindowInput = { readonly from: string; readonly to: string; readonly search?: string | null; readonly today?: string | null }

export function queryCalendar(ctx: SessionContext, viewId: string, input: WindowInput): Promise<CalendarResult> {
  return queryWindow(ctx, viewId, input, 'calendar')
}

/** 타임라인의 행(TL-1) — 캘린더와 같은 질의를 넓은 창(732일)으로. 정본 [보강 TL-1] ③. */
export function queryTimeline(ctx: SessionContext, viewId: string, input: WindowInput): Promise<CalendarResult> {
  return queryWindow(ctx, viewId, input, 'timeline')
}

const WINDOW_LIMITS = {
  calendar: { maxSpan: MAX_CALENDAR_SPAN_DAYS, maxRows: MAX_CALENDAR_ROWS, wrong: 'not_calendar' },
  timeline: { maxSpan: MAX_TIMELINE_SPAN_DAYS, maxRows: MAX_TIMELINE_ROWS, wrong: 'not_timeline' },
} as const

/** 창에 걸친 행 — 캘린더와 타임라인이 나눠 쓰는 한 질의(창의 상한 · 뷰 종류만 다르다). */
async function queryWindow(ctx: SessionContext, viewId: string, input: WindowInput, kind: 'calendar' | 'timeline'): Promise<CalendarResult> {
  const { maxSpan, maxRows, wrong } = WINDOW_LIMITS[kind]
  const spanOk = isYmd(input.from) && isYmd(input.to) && daysBetween(input.from, input.to) >= 0 && daysBetween(input.from, input.to) <= maxSpan
  if (!spanOk) return fail('invalid_value')
  // 뷰를 여는 것은 데이터베이스 단위다 — 행의 범위("만들기만" 이면 자기가 열 수 있는 행만 · 6f-2b-1)는 아래 트랜잭션에서 정한다.
  const view = await getView(ctx, viewId)
  if (!view.ok) return fail('not_found')
  if (view.value.type !== kind) return fail(wrong)
  const dateProperty = kind === 'timeline' ? view.value.timeline.date_property_id : view.value.calendar.date_property_id
  if (dateProperty === null) return fail('no_date_property')
  // 이 사람이 실제로 보는 필터(2h-1 — 개인 필터가 있으면 그것)
  const { dataSourceId, effectiveFilter: filter, columns } = view.value
  // 수식으로 거르면 그 캐시를 먼저 채운다(2j-2)
  await refreshDerivedValues(ctx, dataSourceId, propertyIdsIn(filter))

  return withReadTransaction(async (tx) => {
    const access = await rowsAccessForDataSource(tx, ctx, dataSourceId)
    if (access === null) return fail('not_found')
    const types = await readPropertyTypes(tx, dataSourceId)
    const params = new ParamBag(2)
    // 권한이 필터보다 먼저다(F-03-17) — 달력의 행과 "날짜 없음" 의 수가 같은 WHERE 를 쓴다
    const accessSql = restrictedRowsSql(access, params)
    const filterSql = compileFilter(filter, types, params, { me: ctx.userId, today: todayOrUtc(input.today) })
    const searchSql = input.search ? compileSearch(input.search, types, params, await readableScopes(tx, ctx)) : null
    // 카드 속성이면 부모만 · 평평한 목록이면 모든 행(K-1 — "날짜 없음" 과 같은 조건)
    const pair = cardParentsOnlyPair(columns, view.value.subItemDisplay)
    const treeSql = pair === null ? null : compileTree({ parentPropertyId: pair.parentPropertyId, under: null }, params)
    const where = ['p.data_source_id = $1', 'p.is_template = false', "b.lifecycle = 'live'", accessSql, filterSql, searchSql, treeSql]
      .filter((s): s is string => s !== null)
      .join(' AND ')
    const dateParam = params.bind(dateProperty)
    const countValues = [dataSourceId, ...params.values]

    // 날짜 없는 행 — 같은 조건 · 날짜 칸이 없다
    const undated = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM page p JOIN block b ON b.id = p.id
        WHERE ${where}
          AND NOT EXISTS (SELECT 1 FROM page_property_value dv
                           WHERE dv.page_id = p.id AND dv.property_id = ${dateParam} AND dv.date_start IS NOT NULL)`,
      countValues,
    )

    // 기간에 걸친 행 — 양끝을 하루씩 넓혀 묻는다(머리말)
    const fromParam = params.bind(input.from)
    const toParam = params.bind(input.to)
    const limitParam = params.bind(maxRows + 1)
    const rows = await tx.query<RowRow>(
      `SELECT b.id, b.order_key, p.properties_cache, b.properties, b.format -> 'page_icon' AS page_icon,
              p.unique_seq, b.created_at, b.last_edited_at, b.version
         FROM page p
         JOIN block b ON b.id = p.id
         JOIN page_property_value dv ON dv.page_id = p.id AND dv.property_id = ${dateParam} AND dv.date_start IS NOT NULL
        WHERE ${where}
          AND dv.date_start < ((${toParam}::date + 2)::timestamp AT TIME ZONE 'UTC')
          AND coalesce(dv.date_end, dv.date_start) >= ((${fromParam}::date - 1)::timestamp AT TIME ZONE 'UTC')
        ORDER BY dv.date_start, b.order_key COLLATE "C", p.id
        LIMIT ${limitParam}`,
      [dataSourceId, ...params.values],
    )

    const shown = rows.slice(0, maxRows)
    // 종속 관계 간선(TL-4 ①②) — 켜져 있을 때만 · 간선 질의 하나 · 둘 다 이 응답의 행인 것만. 엣지는 막힌 행(from) → 막는 행(to)이다(0052)
    let dependencies: { from: string; to: string }[] = []
    if (kind === 'timeline' && shown.length > 1 && (await readDependencyPair(tx, dataSourceId)) !== null) {
      const ids = shown.map((r) => r.id)
      const edges = await tx.query<{ blocked: string; blocker: string }>(
        `SELECT from_page_id AS blocked, to_page_id AS blocker FROM relation_edge
          WHERE role = 'dependency' AND from_page_id = ANY($1::uuid[]) AND to_page_id = ANY($1::uuid[])
          ORDER BY from_page_id, to_page_id`,
        [ids],
      )
      dependencies = edges.map((e) => ({ from: e.blocker, to: e.blocked }))
    }

    return {
      ok: true,
      value: {
        datePropertyId: dateProperty,
        rows: shown.map(toQueriedRow),
        dependencies,
        undated: undated.n,
        truncated: rows.length > maxRows,
      },
    } as const
  })
}
