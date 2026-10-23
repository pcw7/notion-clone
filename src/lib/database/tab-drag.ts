/**
 * 뷰 탭 끌기의 규칙 — §7 정리 10n-19 (F-04-01 *"탭 드래그 재정렬"*, DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 뷰 탭 순서 바꾸기 ⑤
 *
 * 화면은 탭의 가로 자리(왼쪽 · 폭)와 포인터의 x 만 넘긴다. 이 함수가 놓을 자리를 정한다 — 서버의 명령(`moveView`)이 받는 모양 그대로
 * ("이 뷰를 `before` 앞에" · null 이면 맨 뒤).
 */

/** 탭 하나의 가로 자리 — 화면의 `getBoundingClientRect` 에서. */
export type TabBox = { readonly id: string; readonly left: number; readonly width: number }

/** 이만큼 움직여야 끌기다 — 그 전에 놓으면 탭을 여는 클릭이다. */
export const TAB_DRAG_THRESHOLD = 4

/**
 * 놓을 자리 — 끌고 있는 탭을 뺀 나머지에서 가운데가 포인터보다 오른쪽인 첫 탭의 앞(없으면 맨 뒤 = null). **제자리면 undefined** — 보내지
 * 않는다. `tabs` 는 화면의 차례(왼쪽부터)다.
 */
export function tabDropBefore(tabs: readonly TabBox[], draggedId: string, pointerX: number): string | null | undefined {
  const from = tabs.findIndex((t) => t.id === draggedId)
  if (from < 0) return undefined
  const others = tabs.filter((t) => t.id !== draggedId)
  const at = others.findIndex((t) => t.left + t.width / 2 > pointerX)
  const index = at < 0 ? others.length : at
  // 제자리 — 끌고 있는 탭이 원래 있던 칸(나머지의 같은 자리)
  if (index === from) return undefined
  return others[index]?.id ?? null
}

/**
 * 끄는 동안 세로 줄을 그릴 x — 놓일 자리의 왼쪽 경계(맨 뒤면 마지막 탭의 오른쪽 경계). 제자리면 null(줄을 그리지 않는다).
 */
export function tabDropLineX(tabs: readonly TabBox[], draggedId: string, pointerX: number): number | null {
  const before = tabDropBefore(tabs, draggedId, pointerX)
  if (before === undefined) return null
  if (before === null) {
    const last = tabs.filter((t) => t.id !== draggedId).at(-1)
    return last === undefined ? null : last.left + last.width
  }
  return tabs.find((t) => t.id === before)!.left
}
