/**
 * 콜아웃 아이콘의 명령 — 아이콘 쓰기 (디자인 트랙 4c · F-01-02 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 콜아웃 아이콘
 *
 * 블록 수식의 명령(`equation-block.ts` 머리말)과 같은 규칙이다 — **블록 id 로 찾는다**(고르개는 편집기가 다시 만들어져도 산다) · **새 객체로
 * 바꾼다**(제자리에서 고치면 Y update 가 생기지 않는다) · **바뀐 것이 없으면 false** · 되돌리기는 **따로 한 단계** · 스크롤하지 않는다.
 */

import type { Command, EditorState } from '@tiptap/pm/state'

import { CALLOUT_TYPE, calloutEmojiOf, withCalloutIcon } from '../block/callout.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

/** 이 블록이 콜아웃이면 저장된 아이콘의 이모지(없으면 null)와 내용 노드의 위치, 아니면(없다 · 타입이 바뀌었다) undefined. */
export function calloutIconAt(state: EditorState, blockId: string): { readonly pos: number; readonly emoji: string | null } | undefined {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== CALLOUT_TYPE) return undefined
  return { pos: info.contentPos, emoji: calloutEmojiOf(info.contentNode.attrs.props) }
}

/** 아이콘을 쓴다 — `null` 이면 키를 지운다(화면은 💡). 같은 값이면 쓰지 않는다. */
export function setCalloutIconCommand(blockId: string, emoji: string | null): Command {
  return (state, dispatch) => {
    const info = findContainerById(state.doc, blockId)
    if (!info || blockTypeOf(info.contentNode) !== CALLOUT_TYPE) return false
    const props = (info.contentNode.attrs.props ?? {}) as Record<string, unknown>
    let next: Readonly<Record<string, unknown>>
    try {
      next = withCalloutIcon(props, emoji)
    } catch {
      return false
    }
    if (next === props) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(info.contentPos, undefined, { ...info.contentNode.attrs, props: next })
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
