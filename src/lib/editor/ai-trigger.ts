/**
 * AI 에게 묻기의 입구 — 빈 줄의 스페이스 · 빈 줄의 안내 (AI-2 · F-10-01)
 *
 * 정본: 10-ai-features.md F-10-01 *"빈 줄에서 스페이스바를 누르거나 `/ai` 입력 → 프롬프트 입력창이 해당 줄에 인라인으로 열림"*
 *
 * 페이지가 처음 받는 JS 에 드는 것은 이것뿐이다 — 입력창 · 스트리밍 · 넣기는 처음 열 때 받는다(`ai-ask-bar.tsx` · `ai-insert.ts`).
 *
 *   · 스페이스 — 캐럿이 **빈 문단**에 있으면 `open(블록 id)` 를 묻는다. 열 수 없으면(AI 가 꺼졌다 · 고칠 수 없다) false — 스페이스는
 *     여느 때처럼 글자다. 목록 · 헤딩 · 코드 · 표의 칸에서는 묻지 않는다(노션도 빈 텍스트 줄만)
 *   · 안내 — AI 를 쓸 수 있을 때만 캐럿이 있는 빈 문단에 `data-ai-hint` 를 단다(글자는 CSS — 문서에 들지 않는다 · 포커스가 있을 때만 보인다)
 *   · Ctrl/Cmd+J — 글을 골랐으면 AI 로 고치기의 메뉴를 연다(AI-3 · F-10-02 · 서식 툴바의 AI 단추와 같다). 고른 글이 없으면 키를 넘긴다
 */

import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { containerAt } from './pm-blocks.ts'

/** 캐럿이 빈 문단에 있으면 그 블록의 id — 아니면 null. */
export function emptyParagraphAt(state: EditorState): string | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return null
  const info = containerAt($from)
  return info !== null && info.contentNode === $from.parent ? info.id : null
}

/** 빈 문단의 스페이스 — `open` 이 열었으면 키를 먹는다. */
export function aiSpaceCommand(open: (blockId: string) => boolean): Command {
  return (state) => {
    const id = emptyParagraphAt(state)
    return id !== null && open(id)
  }
}

/** 글을 고른 Ctrl/Cmd+J — `open` 이 열었으면 키를 먹는다(AI-3). */
export function aiEditCommand(open: () => boolean): Command {
  return (state) => state.selection instanceof TextSelection && !state.selection.empty && open()
}

export const aiHintKey = new PluginKey('aiHint')

/** 빈 줄의 안내 — `show()` 가 참일 때만(AI 를 쓸 수 있고 고칠 수 있다). */
export function aiHintPlugin(show: () => boolean): Plugin {
  return new Plugin({
    key: aiHintKey,
    props: {
      decorations(state) {
        if (!show() || emptyParagraphAt(state) === null) return null
        const $from = state.selection.$from
        const at = $from.before()
        return DecorationSet.create(state.doc, [Decoration.node(at, at + $from.parent.nodeSize, { 'data-ai-hint': 'true' })])
      },
    },
  })
}
