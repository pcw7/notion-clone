/**
 * 블록 색의 나머지 — 색 슬래시 명령 · 마지막 색 다시 쓰기 (Phase 2 1e-1 · F-01-21 · DOM 없음)
 *
 * 정본: 01-block-editor.md F-01-21 시나리오 2 · 4 · 00-canonical-data-model.md §3.4(`format.block_color`)
 *
 *   · `/빨강` · `/빨강배경` · `/red` · `/redbackground` … — 쳐 둔 `/쿼리` 를 지우고 **그 블록 전체**의 색(`format.block_color`). 두 낱말
 *     이름은 붙여 친다(메뉴가 쿼리의 공백에서 닫힌다 — `color-names.ts`).
 *     색을 받지 않는 타입(코드 · 이미지 · 표 …)이면 쿼리만 지운다. `/기본` 은 색을 지운다
 *   · Ctrl/Cmd+Shift+H — 마지막으로 쓴 색을 다시. 블록 선택이면 그 블록들의 블록 색, 글자를 골랐으면 그 글자의 색(인라인 —
 *     F-01-03 의 계층), 캐럿만이면 그 블록의 블록 색. 마지막 색이 없으면 아무것도 하지 않는다(키를 넘긴다)
 *   · 블록 색과 인라인 색은 다른 계층이다(F-01-21 *"별개의 두 번째 색상 계층"*) — 이 파일은 블록 색만 쓰고 인라인은 `marks.ts` 에 맡긴다
 */

import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import { normalizeFormat, PAGE_TYPE, specOf, type BlockFormat, type BlockType } from '../block/types.ts'
import { isColor, type Color } from '../contracts/rich-text.ts'
import { isBlockSelection } from './block-selection.ts'
import { setTextColor } from './marks.ts'
import { blockTypeOf, containerAt, findContainerById } from './pm-blocks.ts'
import { closeSlashMenu, slashMenuState } from './slash-menu.ts'

/**
 * 블록 색을 칠할 수 있는 타입인가 — 레지스트리의 `supportsColor` 에서 **하위 페이지 참조를 뺀다**. `page` 는 레지스트리상 색을 받지만
 * (페이지 자체의 속성) 본문의 참조 노드에 칠한 색은 프로젝터가 쓰지 않는다 — 칠해진 것처럼 보이다가 새로고침하면 사라진다.
 */
export function colorable(type: BlockType): boolean {
  return type !== PAGE_TYPE && specOf(type).supportsColor
}

/** 그 블록의 블록 색을 트랜잭션에 — 없는 블록 · 색을 받지 않는 타입 · 같은 값이면 false(쓰지 않는다). `default` 는 지운다. */
export function setBlockColorAt(tr: Transaction, blockId: string, color: Color): boolean {
  const info = findContainerById(tr.doc, blockId)
  if (!info) return false
  const type = blockTypeOf(info.contentNode)
  if (!colorable(type)) return false
  const current = (info.contentNode.attrs.format ?? {}) as BlockFormat
  const format: BlockFormat = { ...current }
  if (color === 'default') delete format.block_color
  else format.block_color = color
  const next = normalizeFormat(type, format)
  if (current.block_color === next.block_color) return false
  tr.setNodeMarkup(info.contentPos, undefined, { ...info.contentNode.attrs, format: next })
  return true
}

/** `/빨강` … — 쳐 둔 `/쿼리` 를 지우고 그 블록의 색. 메뉴가 닫혀 있으면 false. */
export function runColorSlashCommand(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  color: Color,
): boolean {
  const menu = slashMenuState(state)
  if (!menu.active) return false
  const info = containerAt(state.selection.$from)
  if (!info) return false
  if (!dispatch) return true
  const tr = state.tr.delete(menu.from, state.selection.head)
  closeSlashMenu(tr)
  setBlockColorAt(tr, info.id, color)
  dispatch(tr.scrollIntoView())
  return true
}

/** Ctrl/Cmd+Shift+H — 마지막으로 쓴 색을 다시(머리말). 마지막 색이 없으면 false. */
export function reapplyColorCommand(last: () => Color | null): Command {
  return (state, dispatch) => {
    const color = last()
    if (color === null || !isColor(color)) return false
    const sel = state.selection
    if (!isBlockSelection(sel) && !sel.empty) return setTextColor(color)(state, dispatch)
    const ids = isBlockSelection(sel) ? sel.blockIds : [containerAt(sel.$from)?.id ?? '']
    const tr = state.tr
    for (const id of ids) setBlockColorAt(tr, id, color)
    // 바뀐 것이 없어도 키는 삼킨다 — 같은 색을 다시 누른 것이다.
    if (dispatch && tr.docChanged) dispatch(tr)
    return true
  }
}
