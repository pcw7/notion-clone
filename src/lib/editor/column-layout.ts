/**
 * 컬럼의 폭 그리기 · 폭 조절 손잡이 (Phase 2 1c-2 · F-01-12)
 *
 * ⚠ 손잡이(위젯)는 브라우저에서만 만들어진다(`document`) — 데코레이션의 계산은 문서만 본다.
 *
 * 폭은 문서(`format.column_ratio`)에 있고 화면은 **노드 데코레이션**으로 컬럼 컨테이너에 `flex-grow` 를 단다 — 편집기 DOM 에 직접 쓰면
 * ProseMirror 가 다시 그리며 지운다(`collapse-plugin.ts` 머리말과 같은 까닭). 둘째 컬럼부터 그 왼쪽 경계에 **손잡이 위젯**을 둔다.
 *
 *   · 끄는 동안은 손잡이만 따라 움직인다(위젯 자신의 스타일 — PM 이 보지 않는다). 놓을 때 한 번 쓴다(`setColumnRatiosCommand` — 두
 *     컬럼의 합은 그대로, 나머지는 그대로). 끄는 동안 문서에 쓰지 않는다 — 협업 로그가 포인터 움직임만큼 자란다
 *   · 바닥은 `MIN_COLUMN_RATIO` — 컬럼이 사라질 만큼 좁히지 않는다
 *   · 읽기 전용이면 손잡이가 없다(F-01-12 *"권한 없음 — 리사이즈 핸들 미노출"*) · 좁은 화면(세로로 쌓임)도 CSS 가 숨긴다
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { COLUMN_RATIO_KEY, type BlockFormat } from '../block/types.ts'
import { columnListInfo, MIN_COLUMN_RATIO, resolvedRatios, setColumnRatiosCommand } from './column-edit.ts'

export const columnLayoutKey = new PluginKey<DecorationSet>('columnLayout')

/** 문서의 컬럼 데코레이션 — 폭(flex-grow)과 손잡이 자리. */
export function columnDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer' || node.firstChild?.type.name !== 'column_list' || node.childCount < 2) return true
    const listId = String(node.attrs.blockId ?? '')
    const columns: { pos: number; node: PmNode }[] = []
    let at = pos + 1 + node.firstChild.nodeSize + 1
    node.child(1).forEach((column) => {
      columns.push({ pos: at, node: column })
      at += column.nodeSize
    })
    const ratios = resolvedRatios(columns.map((c) => ((c.node.firstChild?.attrs.format ?? {}) as BlockFormat)[COLUMN_RATIO_KEY]))
    columns.forEach((column, i) => {
      decorations.push(Decoration.node(column.pos, column.pos + column.node.nodeSize, { style: `flex-grow: ${ratios[i]}` }))
      if (i > 0) {
        decorations.push(
          Decoration.widget(column.pos + 1, (view) => resizeHandle(view, listId, i), {
            key: `column-resize:${listId}:${i}`,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        )
      }
    })
    return true
  })
  return DecorationSet.create(doc, decorations)
}

export function columnLayoutPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: columnLayoutKey,
    state: {
      init: (_config, state) => columnDecorations(state.doc),
      apply: (tr, previous) => (tr.docChanged ? columnDecorations(tr.doc) : previous),
    },
    props: {
      decorations: (state) => columnLayoutKey.getState(state),
    },
  })
}

/** `index` 번째 컬럼의 왼쪽 경계 손잡이 — 끌어 바로 앞 컬럼과 폭을 나눈다. */
function resizeHandle(view: EditorView, listId: string, index: number): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'blk-column-resize'
  handle.contentEditable = 'false'
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', '컬럼 폭 조절')

  handle.addEventListener('pointerdown', (event) => {
    if (!view.editable || event.button !== 0) return
    const list = columnListInfo(view.state.doc, listId)
    const group = handle.parentElement?.parentElement
    if (list === null || !group) return
    const doms = [...group.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('blk-container'))
    const left = doms[index - 1]
    const right = doms[index]
    if (!left || !right) return
    event.preventDefault()
    event.stopPropagation()
    const ratios = resolvedRatios(list.columns.map((c) => c.ratio))
    const pair = ratios[index - 1]! + ratios[index]!
    const leftWidth = left.getBoundingClientRect().width
    const pairWidth = leftWidth + right.getBoundingClientRect().width
    const total = ratios.reduce((a, b) => a + b, 0)
    // 바닥(목록 전체에 대한 비율)을 두 컬럼의 폭(px)으로.
    const floorPx = (MIN_COLUMN_RATIO / total) * (pairWidth / pair)
    const startX = event.clientX
    let nextLeft = leftWidth
    handle.setPointerCapture(event.pointerId)
    handle.dataset.dragging = 'true'

    const move = (e: PointerEvent): void => {
      nextLeft = Math.min(Math.max(leftWidth + (e.clientX - startX), floorPx), pairWidth - floorPx)
      handle.style.transform = `translateX(${nextLeft - leftWidth}px)`
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.style.transform = ''
      delete handle.dataset.dragging
      if (Math.abs(nextLeft - leftWidth) < 1) return
      const next = [...ratios]
      next[index - 1] = (pair * nextLeft) / pairWidth
      next[index] = pair - next[index - 1]!
      setColumnRatiosCommand(listId, next)(view.state, view.dispatch.bind(view))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  })
  return handle
}
