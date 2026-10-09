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
import { isValidSpan, MAX_CALENDAR_ROWS } from './calendar.ts'
import { compileFilter, ParamBag, propertyIdsIn } from './filter.ts'
import { refreshDerivedValues } from './derived-values.ts'
import { compileTree, readPropertyTypes, toQueriedRow, type QueriedRow, type RowRow } from './query.ts'
import { compileSearch } from './search.ts'
import { getView } from './view.ts'
import { subItemPairOf } from './view-columns.ts'

export type CalendarPage = {
  readonly datePropertyId: string
  /** 기간에 걸친 행 — 날짜(시작)순. */
  readonly rows: readonly QueriedRow[]
  /** 조건을 지났지만 날짜가 없는 행의 수(달력에 없다). */
  readonly undated: number
  /** 상한에 걸려 더 있다. */
  readonly truncated: boolean
}

export type CalendarFailure =
  | 'not_found'
  /** 캘린더 뷰가 아니다. */
  | 'not_calendar'
  /** 날짜 속성이 지워졌다(저장값은 남는다) — 화면이 "날짜 속성을 고르라"를 그린다. */
  | 'no_date_property'
  /** 기간이 날짜가 아니거나 거꾸로거나 너무 길다. */
  | 'invalid_value'

export type CalendarResult =
  | { readonly ok: true; readonly value: CalendarPage }
  | { readonly ok: false; readonly reason: CalendarFailure }

const fail = (reason: CalendarFailure): CalendarResult => ({ ok: false, reason })

export async function queryCalendar(
  ctx: SessionContext,
  viewId: string,
  input: { readonly from: string; readonly to: string; readonly search?: string | null },
): Promise<CalendarResult> {
  if (!isValidSpan(input.from, input.to)) return fail('invalid_value')
  // 권한은 뷰를 여는 데서 본다(데이터베이스 단위 — 행 단위 권한이 없다 · `query.ts` 머리말).
  const view = await getView(ctx, viewId)
  if (!view.ok) return fail('not_found')
  if (view.value.type !== 'calendar') return fail('not_calendar')
  const dateProperty = view.value.calendar.date_property_id
  if (dateProperty === null) return fail('no_date_property')
  // 이 사람이 실제로 보는 필터(2h-1 — 개인 필터가 있으면 그것)
  const { dataSourceId, effectiveFilter: filter, columns } = view.value
  // 수식으로 거르면 그 캐시를 먼저 채운다(2j-2)
  await refreshDerivedValues(ctx, dataSourceId, propertyIdsIn(filter))

  return withReadTransaction(async (tx) => {
    const types = await readPropertyTypes(tx, dataSourceId)
    const params = new ParamBag(2)
    const filterSql = compileFilter(filter, types, params)
    const searchSql = input.search ? compileSearch(input.search, types, params) : null
    const pair = subItemPairOf(columns)
    const treeSql = pair === null ? null : compileTree({ parentPropertyId: pair.parentPropertyId, under: null }, params)
    const where = ['p.data_source_id = $1', 'p.is_template = false', "b.lifecycle = 'live'", filterSql, searchSql, treeSql]
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
    const limitParam = params.bind(MAX_CALENDAR_ROWS + 1)
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

    return {
      ok: true,
      value: {
        datePropertyId: dateProperty,
        rows: rows.slice(0, MAX_CALENDAR_ROWS).map(toQueriedRow),
        undated: undated.n,
        truncated: rows.length > MAX_CALENDAR_ROWS,
      },
    } as const
  })
}
