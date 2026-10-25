/**
 * 콜아웃의 노드 뷰 — 아이콘 칸 + 글 (디자인 트랙 4c · F-01-02)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   aside.blk.blk-callout[data-block-type=callout]
 *     button.blk-callout-icon      ← 저장된 이모지, 없으면 💡 (contenteditable=false)
 *     div.blk-text                 ← 글(contentDOM)
 *
 *   · 아이콘을 누르면(편집할 수 있을 때) 이모지 고르개를 연다 — 고르개는 편집기 밖의 오버레이다(`body-editor.tsx` · 블록 수식의 입력창과
 *     같은 까닭). 읽기 전용이면 그리기만 한다
 *   · 모양은 노션 실측(아이콘 칸 24×24 · 이모지 21.6px · 글은 아이콘 옆 — `editor.css`)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { calloutGlyph } from '../block/callout.ts'
import { paintBlockColor } from './paint-block-color.ts'

export type CalloutViewDeps = {
  /** 콜아웃 아이콘의 고르개를 연다 — 편집기 밖의 오버레이(머리말). */
  openCalloutIcon: (blockId: string) => void
}

/** 컨테이너의 blockId — 노드 뷰는 내용 노드만 받으므로 위로 올라간다. */
function containerIdAt(view: EditorView, getPos: () => number | undefined): string {
  const pos = getPos()
  if (pos === undefined) return ''
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockContainer') return String(node.attrs.blockId ?? '')
  }
  return ''
}

export function calloutNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: CalloutViewDeps): NodeView {
  const dom = document.createElement('aside')
  dom.className = 'blk blk-callout'
  dom.dataset.blockType = 'callout'
  paintBlockColor(dom, node)

  const icon = document.createElement('button')
  icon.type = 'button'
  icon.className = 'blk-callout-icon'
  icon.contentEditable = 'false'
  icon.setAttribute('aria-label', '콜아웃 아이콘 바꾸기')
  icon.setAttribute('aria-haspopup', 'dialog')
  icon.textContent = calloutGlyph(node.attrs.props)

  const content = document.createElement('div')
  content.className = 'blk-text'

  // mousedown 을 막지 않으면 누르기가 캐럿을 옮긴다(토글 화살표와 같다).
  icon.addEventListener('mousedown', (event) => event.preventDefault())
  icon.addEventListener('click', () => {
    // 읽기 전용이면 열지 않는다 — 노드 뷰는 편집 가능 여부가 바뀌어도 다시 만들어지지 않으므로 누르는 순간에 묻는다.
    if (!view.editable) return
    const id = containerIdAt(view, getPos)
    if (id !== '') deps.openCalloutIcon(id)
  })

  dom.append(icon, content)

  return {
    dom,
    contentDOM: content,
    update: (updated) => {
      if (updated.type.name !== 'callout') return false
      const glyph = calloutGlyph(updated.attrs.props)
      if (icon.textContent !== glyph) icon.textContent = glyph
      paintBlockColor(dom, updated)
      return true
    },
    // 아이콘 누르기는 ProseMirror 가 아니라 우리가 처리한다.
    stopEvent: (event) => event.target instanceof Node && icon.contains(event.target),
    ignoreMutation: (mutation) => mutation.target === icon || icon.contains(mutation.target),
  }
}
