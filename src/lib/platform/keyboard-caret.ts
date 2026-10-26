/**
 * 소프트 키보드 — 캐럿이 보이는 영역 밖이면 얼마나 굴리나 (플랫폼 잔여 10j-4 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑪)
 *
 * 폰의 키보드는 화면 아래 절반을 가린다. 키보드가 레이아웃을 줄이는 브라우저(`interactive-widget=resizes-content` — 안드로이드의 Chrome · Firefox)는
 * 스스로 캐럿을 보이게 하지만, 그 머리표를 모르는 브라우저(iOS Safari)는 **보이는 영역(`visualViewport`)만** 줄여 캐럿이 키보드 아래에 남는다.
 * 그때 굴릴 양을 정하는 순수 함수다 — 화면의 좌표(레이아웃 뷰포트 기준 · `getBoundingClientRect` 와 같은 축)만 받는다.
 */

/** 위아래 여백 — 캐럿이 보이는 영역의 끝에 딱 붙지 않게. */
export const KEYBOARD_CARET_MARGIN = 16

export type VerticalSpan = { readonly top: number; readonly bottom: number }

/**
 * 캐럿(`caret`)이 보이는 영역(`view` — 여백을 뺀 안쪽)에 있으면 0, 아래로 벗어났으면 양수(그만큼 아래로 굴린다), 위로 벗어났으면 음수.
 * 영역이 여백보다 좁으면(키보드가 거의 다 가렸다) 0 — 어디로 굴려도 맞출 수 없다.
 */
export function caretScrollDelta(caret: VerticalSpan, view: VerticalSpan, margin: number = KEYBOARD_CARET_MARGIN): number {
  const top = view.top + margin
  const bottom = view.bottom - margin
  if (bottom - top < caret.bottom - caret.top) return 0
  if (caret.bottom > bottom) return caret.bottom - bottom
  if (caret.top < top) return caret.top - top
  return 0
}
