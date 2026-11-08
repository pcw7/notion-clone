/**
 * 임베드 블록 노드 뷰 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1] ③ ④)
 *
 * 얇은 껍데기다 — 서비스 규칙 · 판 그리기(`embed-view-impl.ts`)는 지연 로드한다. 임베드 블록이 없는 페이지의 첫 번들에 싣지 않는다(번들 예산).
 * 처음 임베드 블록을 그릴 때 한 번 받고, 그 전의 갱신은 받아 두었다가 마운트할 때 쓴다. DOM 은 우리 것이다(`ignoreMutation`).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { EMBED_TYPE } from '../block/embed-block.ts'

export type EmbedViewDeps = {
  /** 캡션 입력을 연다 — 편집기 밖의 입력칸. 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openEmbedCaption: (blockId: string) => void
}

export function embedNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: EmbedViewDeps): NodeView {
  const dom = document.createElement('figure')
  dom.className = 'blk blk-embed'
  dom.contentEditable = 'false'
  dom.dataset.state = 'loading'
  let latest = node
  let mounted: Omit<NodeView, 'dom'> | null = null
  let gone = false
  void import('./embed-view-impl.ts').then((impl) => {
    if (!gone) mounted = impl.mountEmbed(dom, latest, view, getPos, deps)
  })
  return {
    dom,
    update: (updated, decorations, innerDecorations) => {
      if (updated.type.name !== EMBED_TYPE) return false
      latest = updated
      mounted?.update?.(updated, decorations, innerDecorations)
      return true
    },
    stopEvent: (event) => mounted?.stopEvent?.(event) ?? false,
    ignoreMutation: () => true,
    destroy: () => {
      gone = true
    },
  }
}
