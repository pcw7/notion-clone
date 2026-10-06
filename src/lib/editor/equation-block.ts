/**
 * 블록 수식의 명령 — 식 쓰기 · 입력창 열기 (Phase 2 1a · F-01-20 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 블록 수식
 *
 * 코드 블록의 명령(`code-block.ts` 머리말)과 같은 규칙이다 — **블록 id 로 찾는다**(입력창은 편집기가 다시 만들어져도 산다) · **새 객체로
 * 바꾼다**(제자리에서 고치면 Y update 가 생기지 않는다) · **바뀐 것이 없으면 false** · 되돌리기는 **따로 한 단계** · 스크롤하지 않는다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { NodeSelection, type Command, type EditorState } from '@tiptap/pm/state'

import { EQUATION_TYPE, equationExpressionOf, withEquationExpression } from '../block/equation.ts'
import { sameJsonValue } from '../contracts/json-safe.ts'
import { isBlockSelection } from './block-selection.ts'
import { separateUndoStep } from './code-block.ts'
import { blockTypeOf, findContainerById } from './pm-blocks.ts'

/** 블록 수식 하나의 지금 값. */
export type EquationBlockInfo = {
  readonly blockId: string
  /** 내용 노드(`equation_block`)의 위치. */
  readonly pos: number
  readonly node: PmNode
  readonly expression: string
}

/** 이 블록이 블록 수식이면 그 지금 값, 아니면(없다 · 타입이 바뀌었다) null. */
export function equationBlockInfo(state: EditorState, blockId: string): EquationBlockInfo | null {
  const info = findContainerById(state.doc, blockId)
  if (!info || blockTypeOf(info.contentNode) !== EQUATION_TYPE) return null
  const props = (info.contentNode.attrs.props ?? {}) as Record<string, unknown>
  return { blockId, pos: info.contentPos, node: info.contentNode, expression: equationExpressionOf(props) }
}

/** 식을 쓴다 — 비면 키를 지운다(화면은 자리 표시) · 상한까지 자른다. 같은 식이면 쓰지 않는다. */
export function setEquationExpressionCommand(blockId: string, text: string): Command {
  return (state, dispatch) => {
    const current = equationBlockInfo(state, blockId)
    if (current === null) return false
    const props = (current.node.attrs.props ?? {}) as Record<string, unknown>
    const next = withEquationExpression(props, text)
    if (sameJsonValue(next, props)) return false
    let tr
    try {
      tr = state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, props: next })
    } catch {
      // 수선이 오기 전 스키마를 어긴 협업 문서 — 코드 블록의 명령과 같은 까닭으로 삼킨다.
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

/** 골라진 블록 수식의 id — 노드 선택(눌러서 고른 원자) 또는 블록 하나의 선택. 아니면 null. */
export function selectedEquationId(state: EditorState): string | null {
  const selection = state.selection
  if (selection instanceof NodeSelection) {
    if (blockTypeOf(selection.node) !== EQUATION_TYPE) return null
    const container = selection.$from.parent
    return container.type.name === 'blockContainer' ? String(container.attrs.blockId ?? '') || null : null
  }
  if (isBlockSelection(selection) && selection.rootPositions.length === 1) {
    const container = state.doc.nodeAt(selection.rootPositions[0]!)
    const content = container?.firstChild
    if (!container || !content || blockTypeOf(content) !== EQUATION_TYPE) return null
    return String(container.attrs.blockId ?? '') || null
  }
  return null
}

/** Enter — 골라진 블록 수식의 입력창을 연다(키보드만으로 고칠 수 있게). 아니면 false(다음 명령으로). */
export function openEquationCommand(open: (blockId: string) => void): Command {
  return (state, dispatch, view) => {
    const id = selectedEquationId(state)
    if (id === null || (view !== undefined && !view.editable)) return false
    if (dispatch) open(id)
    return true
  }
}
