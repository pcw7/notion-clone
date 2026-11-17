/**
 * AI 의 답을 본문에 넣는다 — 마크다운 → 블록 · 한 번에 되돌리는 한 트랜잭션 (AI-2 · F-10-01)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑥ *"AI 가 쓴 글은 사람이 받아들일 때 그 사람의 편집으로 본문에 든다(편집기 · 출처
 *       `editor`)"* · 10-ai-features.md F-10-01 *"Accept → 생성 블록이 일반 블록으로 확정 · ghost 블록은 클라이언트 로컬"*
 *
 * 스트리밍하는 동안 답은 편집기 밖의 미리보기에만 있다(Y.Doc 에 들지 않는다 · 다른 사람에게 보이지 않는다). 받아들이면 그때 한 번:
 *
 *   · 변환은 가져오기와 같은 것(`import/markdown.ts`) — 첫 `#` 도 헤딩 블록으로 둔다(제목으로 빼지 않는다)
 *   · `replace` — 넣을 자리가 아직 빈 문단이면 그 줄을 블록들로 바꾼다. 그 사이에 누가 글을 썼으면 지우지 않고 아래에 넣는다
 *   · `below` — 그 줄을 두고 바로 아래에(자식이 있어도 형제로)
 *   · 넣을 자리가 사라졌으면(다른 사람이 지웠다) 넣지 않는다 — false(화면이 말한다)
 *   · 트랜잭션 하나다 — 협업 되돌리기(y-prosemirror)는 한 번에 다 뺀다. 캐럿은 넣은 마지막 블록의 끝
 *
 * 이 파일은 입력창과 함께 지연 로드된다(페이지가 처음 받는 JS 에 들지 않는다).
 */

import { Selection, type Command } from '@tiptap/pm/state'

import { markdownToDoc } from '../import/markdown.ts'
import { withFreshBlockIds } from './block-clipboard.ts'
import type { EditorBlock } from './document.ts'
import { containerFor, newBlockId } from './pm-adapter.ts'
import { findContainerById, isBlankLeaf } from './pm-blocks.ts'

export type AiInsertMode = 'replace' | 'below'

/** 답(마크다운) → 블록. 빈 답이면 []. */
export function aiAnswerBlocks(markdown: string): readonly EditorBlock[] {
  if (markdown.trim() === '') return []
  return markdownToDoc(markdown, null, { keepTitle: true }).doc.blocks
}

/** 넣는다(머리말). 넣을 블록이 없거나 자리가 사라졌으면 false. */
export function insertAiBlocksCommand(anchorId: string, blocks: readonly EditorBlock[], mode: AiInsertMode, newId: () => string = newBlockId): Command {
  return (state, dispatch) => {
    if (blocks.length === 0) return false
    const info = findContainerById(state.doc, anchorId)
    if (info === null) return false
    if (!dispatch) return true
    const containers = withFreshBlockIds(blocks, newId).map(containerFor)
    const size = containers.reduce((n, c) => n + c.nodeSize, 0)
    const replace = mode === 'replace' && isBlankLeaf(info) && info.contentNode.type.name === 'paragraph'
    const from = replace ? info.pos : info.pos + info.node.nodeSize
    const tr = replace ? state.tr.replaceWith(info.pos, info.pos + info.node.nodeSize, containers) : state.tr.insert(from, containers)
    tr.setSelection(Selection.near(tr.doc.resolve(from + size), -1))
    dispatch(tr.scrollIntoView())
    return true
  }
}
