/**
 * 동기화 블록의 노드 뷰 — 머리 줄 (SB-1 · F-01-11 · 정본 [보강 SB-0] ⑪ⓐ ⑫ⓒ · ㉑)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   div.blk.blk-synced_block[data-block-type=synced_block][data-synced=original|copy]   (contenteditable=false)
 *     span.blk-synced-badge     ← 동기화 그림 + `원본`(사본이면 `사본`)
 *     button.blk-synced-unsync  ← "동기화 해제"(원본 · 고칠 수 있을 때)
 *
 *   · 틀(테두리)은 **컨테이너**에 그린다 — 내용(= 자식 그룹)이 틀 안에 선다(`editor.css` · AI 블록 · 콜아웃과 같은 짜임)
 *   · 원본의 내용은 보통의 블록이다 — 이 노드 뷰가 아니라 컨테이너의 자식 그룹이 그린다
 *   · 사본은 SB-2 가 이 자리에 원본 페이지의 내용(중첩 편집기)을 그린다 — 그 전에는 자리 표시만
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { isSyncedCopyProps, SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import { unsyncSyncedBlockCommand } from './synced-block.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

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

/** 동기화 그림(두 화살표가 도는 고리) — 단순한 도형이다. */
function syncGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'blk-synced-glyph')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M13 5.5A5.5 5.5 0 0 0 3.2 4.2M3 2v2.5h2.5M3 10.5a5.5 5.5 0 0 0 9.8 1.3M13 14v-2.5h-2.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.5')
  path.setAttribute('stroke-linecap', 'round')
  svg.append(path)
  return svg
}

export function syncedBlockNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('div')
  dom.className = `blk blk-${SYNCED_BLOCK_TYPE}`
  dom.dataset.blockType = SYNCED_BLOCK_TYPE
  dom.contentEditable = 'false'

  const badge = document.createElement('span')
  badge.className = 'blk-synced-badge'
  const label = document.createElement('span')
  badge.append(syncGlyph(), label)

  const unsync = document.createElement('button')
  unsync.type = 'button'
  unsync.className = 'blk-synced-unsync'
  unsync.textContent = '동기화 해제'
  unsync.addEventListener('mousedown', (event) => event.preventDefault())
  unsync.addEventListener('click', () => {
    // 읽기 전용이면 하지 않는다 — 노드 뷰는 편집 가능 여부가 바뀌어도 다시 만들어지지 않으므로 누르는 순간에 묻는다
    if (!view.editable) return
    const id = containerIdAt(view, getPos)
    if (id !== '') unsyncSyncedBlockCommand(id)(view.state, view.dispatch.bind(view))
  })

  const paint = (current: PmNode): void => {
    const copy = isSyncedCopyProps(current.attrs.props)
    dom.dataset.synced = copy ? 'copy' : 'original'
    label.textContent = copy ? '사본' : '원본'
    badge.title = copy ? '동기화 블록의 사본 — 원본 페이지의 내용을 보여 줍니다' : '동기화 블록의 원본 — 여기서 고친 내용이 사본에도 보입니다'
    unsync.hidden = copy
  }
  paint(node)
  dom.append(badge, unsync)

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== SYNCED_BLOCK_TYPE) return false
      paint(updated)
      return true
    },
    // 단추 누르기는 ProseMirror 가 아니라 우리가 처리한다
    stopEvent: (event) => event.target instanceof Node && unsync.contains(event.target),
    ignoreMutation: () => true,
  }
}
