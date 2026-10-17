/**
 * 기준점에 붙는 층의 자리 — 플랫폼 잔여 10j-3a (F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑥)
 *
 * 순수 — 기준점의 사각형 · 층의 크기 · 보이는 화면으로 층의 자리(화면 좌표 · `position: fixed`)를 정한다. 아래에 두고, 아래 자리가 모자라고
 * 위가 더 넓으면 위로 뒤집는다. 가로는 정렬(시작 = 기준점의 왼쪽 · 끝 = 기준점의 오른쪽 끝)에 맞추되 화면 안으로 민다. 고른 쪽의 자리보다
 * 층이 크면 그만큼만(최대 높이 — 층이 안에서 스크롤한다).
 */

export type Rect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export type Size = { readonly width: number; readonly height: number }
export type LayerAlign = 'start' | 'end'

export type LayerPlacement = {
  readonly top: number
  readonly left: number
  readonly side: 'below' | 'above'
  /** 고른 쪽에 쓸 수 있는 높이 — 층의 최대 높이로 쓴다. */
  readonly maxHeight: number
}

export function placeLayer(
  anchor: Rect,
  layer: Size,
  viewport: Size,
  options: { readonly align: LayerAlign; readonly gap: number; readonly margin: number },
): LayerPlacement {
  const { align, gap, margin } = options
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const above = Math.max(0, anchor.top - gap - margin)
  const side = layer.height <= below || below >= above ? 'below' : 'above'
  const maxHeight = side === 'below' ? below : above
  const height = Math.min(layer.height, maxHeight)
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height
  const wanted = align === 'start' ? anchor.left : anchor.right - layer.width
  const maxLeft = viewport.width - margin - layer.width
  const left = maxLeft < margin ? margin : Math.min(Math.max(wanted, margin), maxLeft)
  return { top, left, side, maxHeight }
}
