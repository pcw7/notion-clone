/**
 * 하위 항목의 표시 범위 — 필터를 거는 층 (23번 트랙 P-1 · F-04-22 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 P-1] 하위 항목의 표시 범위
 *
 * 노션의 *Filter options* 셋 — 부모만(최상위 행에만 필터) · 부모와 하위(모든 층 — 기본) · 하위만(최상위가 아닌 행에만). 저장은
 * `view.sub_item_filter_scope` 이고 기본은 NULL 하나다(CHECK 0119 — `both` 를 따로 적지 않는다). 서버(질의 · 뷰)와 브라우저(고르개)가
 * 함께 쓴다 — DB 모듈을 가져오지 않는다.
 */

export const SUB_ITEM_FILTER_SCOPES = ['both', 'parents', 'sub_items'] as const
export type SubItemFilterScope = (typeof SUB_ITEM_FILTER_SCOPES)[number]
export const DEFAULT_SUB_ITEM_FILTER_SCOPE: SubItemFilterScope = 'both'

export function isSubItemFilterScope(value: unknown): value is SubItemFilterScope {
  return typeof value === 'string' && (SUB_ITEM_FILTER_SCOPES as readonly string[]).includes(value)
}

/** 저장값 → 범위. NULL · 모르는 값은 기본(부모와 하위). */
export function readSubItemFilterScope(stored: unknown): SubItemFilterScope {
  return stored === 'parents' || stored === 'sub_items' ? stored : DEFAULT_SUB_ITEM_FILTER_SCOPE
}

/** 범위 → 저장값. 기본은 NULL(같은 뜻의 표기를 둘 두지 않는다). */
export function storedSubItemFilterScope(scope: SubItemFilterScope): string | null {
  return scope === DEFAULT_SUB_ITEM_FILTER_SCOPE ? null : scope
}
