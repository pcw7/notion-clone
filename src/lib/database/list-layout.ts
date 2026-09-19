/**
 * List 뷰의 배치 규칙 — 보드 4c-2조각 (F-04-04 List view, DOM 없음)
 *
 * 정본: 04-database-views.md F-04-04
 *   *"제목은 좌측, 표시 프로퍼티는 우측 정렬 배지."*
 *   *"table view 렌더러에 `variant='list'` 를 두어 **셀 컴포넌트를 재사용**하고 그리드 레이아웃만 교체한다. 별도
 *    컴포넌트 트리를 만들면 셀 에디터를 두 벌 유지하게 되므로 피한다."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * List 는 같은 격자다 — 모양만 다르다 (HANDOFF §3.2-30)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행이 항목이고 열이 보이는 속성이다. 그래서 선택 · 편집 · 키보드 이동(`grid-nav.ts`) · 셀 저장이 표와 **한 벌**이다.
 * F-04-04 는 List 의 키보드 규칙을 말하지 않는다 — 새 규칙을 지어내지 않고 표의 것을 그대로 쓴다.
 *
 * 다른 것은 둘뿐이다.
 *
 *   ① 제목이 맨 앞이다 — 뷰의 컬럼 순서와 무관하게(`listColumns`)
 *   ② **빈 칸은 자리를 차지하지 않는다**(`isCollapsed`). 값이 있는 속성만 오른쪽에 배지로 선다 — F-04-04: *"빈 배지
 *      렌더 금지."* 단 **선택됐거나 편집 중인 칸은 비어 있어도 보인다** — 안 그러면 키보드로 옮겨 간 자리가 화면에
 *      없고, 빈 속성을 List 에서 채울 길이 없다(행 페이지 · side peek 이 아직 없다).
 *
 * 체크박스는 접지 않는다. `false` 는 "비어 있음"이 아니라 값이다(`property-types.ts` `isEmptyValue`) — 접으면 체크 안 된
 * 항목에서 체크박스가 사라져 누를 곳이 없다.
 */

import { isEmptyValue, type CellValue, type MvpPropertyType } from './property-types.ts'

export type TableVariant = 'table' | 'list'

/** 뷰 종류 → 표 컴포넌트의 모양. `board` 는 다른 컴포넌트가 그린다(`database-board.tsx`). */
export function variantOf(viewType: string): TableVariant {
  return viewType === 'list' ? 'list' : 'table'
}

/** List 의 컬럼 순서 — 제목이 맨 앞, 나머지는 뷰 순서 그대로. 표는 건드리지 않는다. */
export function listColumns<C extends { readonly type: MvpPropertyType }>(
  variant: TableVariant,
  columns: readonly C[],
): C[] {
  if (variant !== 'list') return [...columns]
  return [...columns.filter((c) => c.type === 'title'), ...columns.filter((c) => c.type !== 'title')]
}

/**
 * 이 칸을 접는가(자리를 차지하지 않게 그린다). 표에서는 접지 않는다.
 *
 * @param active 선택됐거나 편집 중인 칸인가.
 */
export function isCollapsed(variant: TableVariant, type: MvpPropertyType, value: CellValue, active: boolean): boolean {
  if (variant !== 'list' || active) return false
  // 제목은 비어도 "제목 없음"으로 선다 — 항목 자체가 사라지면 안 된다.
  if (type === 'title') return false
  return isEmptyValue(value)
}
