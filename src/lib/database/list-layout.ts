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

import { isEmptyValue, type CellValue, type MvpPropertyType, type RelationValue } from './property-types.ts'
import { rollupIsEmpty, type RollupCell } from './rollup-functions.ts'

export type TableVariant = 'table' | 'list' | 'record'

/**
 * 뷰 종류 → 표 컴포넌트의 모양. `board` 는 다른 컴포넌트가 그린다(`database-board.tsx`).
 *
 * `record` 는 뷰 종류가 아니다 — **한 행을 세로로 펼친 모양**이고 템플릿 편집 화면이 쓴다(6c-3 · F-08-02).
 * 화면이 직접 고르므로 여기서 나오지 않는다.
 */
export function variantOf(viewType: string): TableVariant {
  return viewType === 'list' ? 'list' : 'table'
}

/**
 * 이 모양이 그리는 컬럼 — 순서까지.
 *
 *   table   뷰 순서 그대로
 *   list    제목이 맨 앞, 나머지는 뷰 순서
 *   record  **제목과 rollup 을 뺀다**(아래), 나머지는 뷰 순서
 *
 * `record` 에서 제목을 빼는 이유: 그 화면은 제목을 `<h1>` 으로 세운다(페이지 화면과 같은 모양) — 속성 목록에 한 번
 * 더 세우면 같은 값을 고치는 자리가 둘이 된다.
 *
 * rollup 을 빼는 이유: rollup 은 **미리 채울 수 있는 값이 아니다.** 어디에도 저장하지 않고 읽을 때 계산하며
 * (§3.3-167) 서버는 템플릿 행의 rollup 을 아예 계산하지 않는다(집계는 `is_template = false` 만 본다). 남겨 두면
 * 영영 빈 칸이 서서 "값이 없다"로 읽힌다 — 그 속성이 템플릿의 일이 아니라고 말하는 쪽이 사실이다.
 */
export function listColumns<C extends { readonly type: string }>(
  variant: TableVariant,
  columns: readonly C[],
): C[] {
  if (variant === 'record') return columns.filter((c) => c.type !== 'title' && c.type !== 'rollup')
  if (variant !== 'list') return [...columns]
  return [...columns.filter((c) => c.type === 'title'), ...columns.filter((c) => c.type !== 'title')]
}

/**
 * 이 칸을 접는가(자리를 차지하지 않게 그린다). 표 · `record` 에서는 접지 않는다 — `record` 는 **채우는 화면**이라
 * 빈 속성이 보이지 않으면 채울 곳이 없다(List 가 선택된 칸만 세우는 것과 반대 방향이다).
 *
 * @param active 선택됐거나 편집 중인 칸인가.
 */
export function isCollapsed(variant: TableVariant, type: MvpPropertyType, value: CellValue, active: boolean): boolean {
  if (variant !== 'list' || active) return false
  // 제목은 비어도 "제목 없음"으로 선다 — 항목 자체가 사라지면 안 된다.
  if (type === 'title') return false
  return isEmptyValue(value)
}

/**
 * relation 칸을 접는가 — 연결이 하나도 없을 때만(`count` 가 0). 표에서는 접지 않는다.
 *
 * `count` 를 본다, 그릴 수 있는 칩의 수가 아니라. 볼 수 없는 연결만 있는 칸은 "볼 수 없는 연결 N개"를 말해야 한다 —
 * 접으면 연결이 있다는 사실 자체가 사라진다.
 */
export function isRelationCollapsed(variant: TableVariant, value: RelationValue, active: boolean): boolean {
  return variant === 'list' && !active && value.count === 0
}

/**
 * rollup 칸을 접는가 — 그릴 것이 없으면 접는다(`rollupIsEmpty`).
 *
 * **아직 받지 못한 칸도 접는다.** 값은 행에 없고 따로 물어 오므로(`use-rollup-values.ts`) 그 사이에 빈 자리를 세워 두면
 * 목록이 한 번 들썩인다. 받으면 그때 선다.
 */
export function isRollupCollapsed(variant: TableVariant, cell: RollupCell | undefined, active: boolean): boolean {
  return variant === 'list' && !active && rollupIsEmpty(cell)
}
