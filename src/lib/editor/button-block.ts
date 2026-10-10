/**
 * 버튼 블록의 편집 명령 — 지금 값 · 라벨 쓰기 (자동화 5e-1 · F-08-06)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰
 *
 * 라벨은 본문의 것이다(`properties.label`) — 설정 창이 저장할 때 이 명령으로 Y.Doc 에 쓴다(블록 수식의 식과 같은 길 · `equation-block.ts`).
 * 액션은 본문이 아니라 서버의 automation 에 있다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { BUTTON_TYPE, buttonLabelOf, withButtonLabel } from '../block/button.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

/** 버튼 블록 하나의 지금 값. */
export type ButtonBlockInfo = { readonly blockId: string; readonly pos: number; readonly node: PmNode; readonly label: string }

/** 이 블록이 버튼 블록이면 그 지금 값, 아니면(없다 · 타입이 바뀌었다) null. */
export function buttonBlockInfo(state: EditorState, blockId: string): ButtonBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== BUTTON_TYPE) return null
  const props = (info.contentNode.attrs.props ?? {}) as Record<string, unknown>
  return { blockId, pos: info.contentPos, node: info.contentNode, label: buttonLabelOf(props) }
}

/** 라벨을 쓴다 — 비면 키를 지운다(그릴 때 "버튼") · 상한까지 자른다. 같은 라벨이면 쓰지 않는다. */
export function setButtonLabelCommand(blockId: string, label: string): Command {
  return (state, dispatch) => {
    const current = buttonBlockInfo(state, blockId)
    if (current === null) return false
    const props = (current.node.attrs.props ?? {}) as Record<string, unknown>
    const next = withButtonLabel(props, label)
    if (sameJsonValue(next, props)) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, props: next })
    } catch {
      // 수선이 오기 전 스키마를 어긴 협업 문서 — 블록 수식의 명령과 같은 까닭으로 삼킨다.
      return false
    }
    if (dispatch) {
      separateUndoStep(state)
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}
