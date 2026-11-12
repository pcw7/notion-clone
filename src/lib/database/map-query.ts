/**
 * 지도 뷰의 핀 — 필터 · 정렬을 지난 행 가운데 장소 칸에 값이 있는 처음 100개 (MP-2 · F-04-19)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑥
 *
 * 행을 고르는 조건은 표와 같다(필터 · 뷰 검색 · 권한 · 템플릿 · 휴지통) — `queryRows` 를 그대로 쓰고 "장소 칸이 비지 않음" 규칙만 AND 로 붙인다.
 * 상한(100)은 질의의 `limit` 이고 `hasMore` 가 곧 "100개까지 보입니다"다. 하위 항목이 켜진 표면 부모만 그린다(캘린더와 같다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { FilterNode } from './filter.ts'
import { MAX_MAP_PINS, resolveMapBy, selectPins, type MapPin } from './map.ts'
import { queryRows } from './query.ts'
import { getView } from './view.ts'
import { cardParentsOnlyPair } from './view-columns.ts'

export type MapPage = {
  /** 쓴 장소 속성 — 없으면 null(핀 없음 · 화면이 "장소 속성을 먼저 만드세요"). */
  readonly mapBy: string | null
  readonly pins: readonly MapPin[]
  /** 100개 너머에 더 있다. */
  readonly truncated: boolean
}

export type MapFailure = 'not_found' | 'not_map'

export type MapResult =
  | { readonly ok: true; readonly value: MapPage }
  | { readonly ok: false; readonly reason: MapFailure }

export async function queryMapPins(
  ctx: SessionContext,
  viewId: string,
  input: { readonly search?: string | null; readonly today?: string | null } = {},
): Promise<MapResult> {
  const view = await getView(ctx, viewId)
  if (!view.ok) return { ok: false, reason: 'not_found' }
  if (view.value.type !== 'map') return { ok: false, reason: 'not_map' }
  const mapBy = resolveMapBy(
    view.value.map.map_by,
    view.value.columns.filter((c) => c.type === 'place').map((c) => c.propertyId),
  )
  if (mapBy === null) return { ok: true, value: { mapBy: null, pins: [], truncated: false } }

  const hasValue: FilterNode = { property_id: mapBy, operator: 'is_not_empty' }
  const stored = view.value.effectiveFilter
  const filter: FilterNode = stored === null ? hasValue : { op: 'and', children: [stored, hasValue] }
  const pair = cardParentsOnlyPair(view.value.columns, view.value.subItemDisplay)
  const page = await queryRows(ctx, view.value.dataSourceId, {
    filter,
    sorts: view.value.effectiveSorts,
    manualOrderViewId: view.value.id,
    limit: MAX_MAP_PINS,
    search: input.search ?? null,
    today: input.today ?? null,
    ...(pair === null ? {} : { tree: { parentPropertyId: pair.parentPropertyId, under: null } }),
  })
  if (!page.ok) return { ok: false, reason: 'not_found' }
  const { pins, truncated } = selectPins(page.value.rows, mapBy, page.value.hasMore)
  return { ok: true, value: { mapBy, pins, truncated } }
}
