/**
 * 검색 결과의 정렬 — 잔여 묶음 8l-2 (F-07-02 · 순수 · 서버와 화면이 같이 쓴다)
 *
 * 정본: 07-search-navigation.md F-07-02 *"정렬 옵션(공식 명시, verbatim): `Best Matches`(기본), `Last Edited: Newest First`,
 *       `Last Edited: Oldest First`, `Created: Newest First`, `Created: Oldest First`"*
 */

export const SEARCH_SORTS = ['best', 'edited_desc', 'edited_asc', 'created_desc', 'created_asc'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export const DEFAULT_SEARCH_SORT: SearchSort = 'best'

export const isSearchSort = (value: unknown): value is SearchSort =>
  typeof value === 'string' && (SEARCH_SORTS as readonly string[]).includes(value)

/** 모르는 값은 기본(가장 잘 맞는 순)으로 — 400 을 내지 않는다(쿼리 길이 · 한도와 같은 태도). */
export const normalizeSearchSort = (value: unknown): SearchSort => (isSearchSort(value) ? value : DEFAULT_SEARCH_SORT)

/** 오름차순인가 — 커서의 비교 방향이 이것으로 갈린다. */
export const isAscending = (sort: SearchSort): boolean => sort.endsWith('_asc')
