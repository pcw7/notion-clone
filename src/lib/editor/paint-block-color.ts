/**
 * 노드 뷰가 그리는 블록의 색 — `data-color` (Phase 2 1e · F-01-21 · 10n-53)
 *
 * 스키마의 `toDOM` 은 `format.block_color` 를 `data-color` 로 단다(`schema.ts`). 노드 뷰가 그리는 블록(할 일 · 토글 · 목차 …)은 `toDOM` 을
 * 거치지 않으므로 같은 속성을 **직접** 단다 — 만들 때와 노드가 바뀔 때마다. 색 팔레트 CSS 는 `[data-color=…]` 로 걸려 있다(`editor.css`).
 * 할 일 · 토글은 이것을 빠뜨려 색이 저장만 되고 보이지 않았다(HANDOFF §7 · 10n-53 이 고쳤다).
 */
import type { Node as PmNode } from '@tiptap/pm/model'

/** 노드의 블록 색을 그 DOM 에 단다 — 없으면 뗀다. 같은 값이면 건드리지 않는다(변이 관찰을 깨우지 않게). */
export function paintBlockColor(dom: HTMLElement, node: PmNode): void {
  const color = (node.attrs.format as { block_color?: unknown } | null | undefined)?.block_color
  if (typeof color === 'string' && color !== '') {
    if (dom.dataset.color !== color) dom.dataset.color = color
  } else if (dom.dataset.color !== undefined) {
    delete dom.dataset.color
  }
}
