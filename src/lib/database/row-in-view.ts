/**
 * 고친 행이 아직 이 뷰에 서는가 — §7 정리 10n-16 (F-04-24 · F-04-03)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 고친 카드가 뷰의 조건 밖으로 나가면 ①
 *
 * 셀 쓰기(`PATCH /rows/{id}`)가 뷰를 받으면 쓰기 뒤에 이것을 묻는다. 판정은 행 질의(`queryRows`)를 그 행 하나로 좁혀 부른다 — 그 사람이
 * 실제로 보는 필터(개인 필터가 있으면 그것) · 권한 · 검색어. 수식 · rollup 의 파생 값도 그 질의가 먼저 채운다. 하위 항목의 트리 자리는
 * 보지 않는다 — 자식은 부모 밑에 서므로 "최상위인가" 를 물으면 틀린다. 다만 하위 항목이 켜진 표 · 목록은 트리와 같은 규칙이다 — 표시
 * 범위가 필터를 거는 층(P-1)과, 맞은 자손을 가진 행(맥락 행)은 스스로 맞지 않아도 선다는 것(H-1 · 정본 §3.5 [보강 P-1] ⑤).
 *
 * 쓰기와 따로다(②) — 쓰기는 이미 커밋했다. 그래서 판정을 내지 못하면(볼 수 없는 뷰 · 그 행의 data source 의 뷰가 아님) null 이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { query } from '../db/pool.ts'
import { queryRows } from './query.ts'
import { normalizeSearch } from './search.ts'
import { getView } from './view.ts'
import { nestsSubItems, subItemPairOf } from './view-columns.ts'

/** 이 사람이 보는 그 뷰에 그 행이 서는가. 판정할 수 없으면 null(뷰를 볼 수 없다 · 다른 data source 의 뷰다). */
export async function rowStandsInView(
  ctx: SessionContext,
  viewId: string,
  rowId: string,
  rawSearch: unknown = null,
  /** 보는 사람의 오늘(R-1) — 화면이 그 오늘로 거른다(상대 날짜 필터). */
  today: string | null = null,
): Promise<boolean | null> {
  const view = await getView(ctx, viewId)
  if (!view.ok) return null
  // 그 뷰가 보는 data source 의 행인가 — 아니면 "서지 않는다" 가 아니라 물을 수 없는 것이다
  const owner = await query<{ data_source_id: string }>(`SELECT data_source_id FROM page WHERE id = $1`, [rowId])
  if (owner[0]?.data_source_id !== view.value.dataSourceId) return null
  const pair = nestsSubItems(view.value.type) ? subItemPairOf(view.value.columns) : null
  const page = await queryRows(ctx, view.value.dataSourceId, {
    filter: view.value.effectiveFilter,
    search: normalizeSearch(rawSearch),
    ...(pair === null ? {} : { treeScope: { parentPropertyId: pair.parentPropertyId, scope: view.value.subItemFilterScope } }),
    onlyRowIds: [rowId],
    limit: 1,
    today,
  })
  return page.ok ? page.value.rows.length > 0 : null
}
