/**
 * AI 블록 노드 뷰 — 얇은 껍데기 (AI-5 · F-10-04 · 정본 §3.10 [보강 AI-1] ⑩)
 *
 * 머리 줄(종류 · 지시 · 바뀜 표시 · 생성 단추 · 스트리밍 미리보기)은 지연 로드한다(`ai-block-view-impl.ts` — AI 블록이 없는 페이지의 첫 번들에
 * 싣지 않는다). 결과(자식)는 이 노드 뷰가 아니라 컨테이너의 자식 그룹이 그린다 — 보통의 블록이다. DOM 은 우리 것이다(`ignoreMutation`).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { AI_BLOCK_TYPE } from '../block/ai-block.ts'
import type { AiEntry } from '../ai/usage.ts'

/** 노드 뷰가 묻는 지금의 맥락 — 편집기가 준다. */
export type AiBlockHost = {
  readonly workspaceId: string
  readonly pageId: string
  /** AI 입구의 상태(`aiEntryFor`). */
  readonly ai: AiEntry
  /** 이 사람이 지금 고칠 수 있는가(잠금 · 권한 · 연결). */
  readonly editable: boolean
  /** 제안 모드다 — 결과는 서버가 바로 쓰므로 만들지 않는다. */
  readonly suggesting: boolean
  /** 데이터베이스 템플릿의 본문이다 — 만들지 않는다(그 템플릿으로 만든 페이지에서 만든다). */
  readonly template: boolean
}

export type AiBlockViewDeps = {
  /** 지금의 맥락 — 없으면(읽기 전용 미리보기) 생성 단추가 꺼진다. */
  readonly aiBlockHost?: () => AiBlockHost | null
  /** 맥락 · 문서가 바뀌면 부른다(머리 줄 · 바뀜 표시를 다시 그린다). 해제 함수를 돌려준다. */
  readonly subscribeAiBlock?: (listener: () => void) => () => void
  /** 방금 `/AI 블록`(직접 지시)으로 넣은 블록인가 — 처음 그릴 때 한 번 true(지시 입력칸에 포커스). */
  readonly takeAiBlockFocus?: (blockId: string) => boolean
}

/** 지연 로드한 머리 줄 — 노드가 바뀌면 다시 그리고, 안의 입력 · 단추의 사건은 편집기가 받지 않는다. */
export type MountedAiBlock = {
  update(node: PmNode): void
  stopEvent(event: Event): boolean
  destroy(): void
}

export function aiBlockNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: AiBlockViewDeps): NodeView {
  const dom = document.createElement('div')
  dom.className = `blk blk-${AI_BLOCK_TYPE}`
  dom.dataset.blockType = AI_BLOCK_TYPE
  dom.contentEditable = 'false'
  let latest = node
  let mounted: MountedAiBlock | null = null
  let gone = false
  void import('./ai-block-view-impl.ts').then((impl) => {
    if (!gone) mounted = impl.mountAiBlock(dom, latest, view, getPos, deps)
  })
  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== AI_BLOCK_TYPE) return false
      latest = updated
      mounted?.update(updated)
      return true
    },
    stopEvent: (event) => mounted?.stopEvent(event) ?? false,
    ignoreMutation: () => true,
    destroy: () => {
      gone = true
      mounted?.destroy()
    },
  }
}
