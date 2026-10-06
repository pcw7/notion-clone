/**
 * 심플 테이블의 편집 — `/표` · 셀 안의 키 (Phase 2 1d-1 · F-01-18 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 심플 테이블 · 01-block-editor.md F-01-18
 *
 * 표는 블록 하나다 — 행 · 셀은 그 내용 노드 안의 노드다(`schema.ts`). 그래서 캐럿이 셀 안이어도 `containerAt` 은 표의 컨테이너를
 * 돌려주고, 블록을 다루는 명령(병합 · 분할 · 들여쓰기 · 바꾸기)은 셀 안에서 아무것도 하지 않는다(`inTableCell` 으로 물러선다 —
 * `commands.ts`). 셀 안의 키는 이 파일이 먼저 받는다(키맵의 앞자리).
 *
 *   · `/표` — 쳐 둔 `/쿼리` 를 지우고, 지금 블록이 빈 문단(자식 없음)이면 그 자리를 표로 바꾸고(블록 id 그대로 — `/수식` 과 같다)
 *     아니면 그 뒤에 넣는다. 크기는 `NEW_TABLE_COLUMNS` × `NEW_TABLE_ROWS` · 캐럿은 첫 셀
 *   · Tab — 다음 셀. 마지막 셀이면 행을 더하고 그 첫 셀(F-01-18 시나리오 3 · 노션 같은 동작)
 *   · Shift+Tab — 앞 셀. 첫 셀이면 그대로(내어쓰기로 새지 않는다)
 *   · Enter — 아래 셀(노션: *"Return moves to the next row"*). 마지막 행이면 표를 나간다 — 바로 뒤가 빈 문단이면 그리로, 아니면
 *     빈 문단을 만들어 그리로
 *   · Shift+Enter — 셀 안의 줄바꿈(글자 `\n` — 문단의 Shift+Enter 와 같다)
 *   · 셀 맨 앞의 Backspace · 맨 끝의 Delete — 키를 삼킨다(셀 경계를 넘어 지우거나 병합하지 않는다)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'
import { addRowAfter, goToNextCell, isInTable, selectedRect, TableMap } from '@tiptap/pm/tables'

import { NEW_TABLE_COLUMNS, NEW_TABLE_ROWS } from '../block/table.ts'
import { newBlockId } from './pm-adapter.ts'
import { containerAt, findContainerById, inTableCell } from './pm-blocks.ts'
import { blockSchema, TABLE_CELL_NODE, TABLE_NODE, TABLE_ROW_NODE } from './schema.ts'
import { closeSlashMenu, slashMenuState } from './slash-menu.ts'

const { blockContainer: CONTAINER, paragraph: PARAGRAPH } = blockSchema.nodes
const { [TABLE_NODE]: TABLE, [TABLE_ROW_NODE]: ROW, [TABLE_CELL_NODE]: CELL } = blockSchema.nodes

/** 빈 표의 내용 노드 — `columns` × `rows` 의 빈 셀. 행 id 는 새로. */
export function emptyTableNode(columns: number, rows: number, newId: () => string = newBlockId): PmNode {
  return TABLE!.create(
    { props: {}, format: {} },
    Array.from({ length: rows }, () => ROW!.create({ rowId: newId(), props: {} }, Array.from({ length: columns }, () => CELL!.create()))),
  )
}

/** 표의 내용 노드가 `contentPos` 에 있을 때 (행, 열) 셀의 글자 자리(셀 안 첫 칸). */
function cellTextPos(table: PmNode, contentPos: number, row: number, column: number): number {
  const map = TableMap.get(table)
  return contentPos + 1 + map.map[row * map.width + column]! + 1
}

/**
 * 그 블록 자리에 표를 — 빈 문단(자식 없음)이면 그 블록을 표로 바꾸고(id 그대로), 아니면 그 뒤에 새 블록으로. 캐럿은 첫 셀. 블록이
 * 없으면 false.
 */
export function insertTableAt(tr: Transaction, blockId: string, newId: () => string = newBlockId): boolean {
  const info = findContainerById(tr.doc, blockId)
  if (!info) return false
  const table = emptyTableNode(NEW_TABLE_COLUMNS, NEW_TABLE_ROWS, newId)
  const blank = info.contentNode.type === PARAGRAPH && info.contentNode.content.size === 0 && info.groupNode === null
  let contentPos: number
  if (blank) {
    tr.replaceWith(info.contentPos, info.contentPos + info.contentNode.nodeSize, table)
    contentPos = info.contentPos
  } else {
    const at = info.pos + info.node.nodeSize
    tr.insert(at, CONTAINER!.create({ blockId: newId() }, [table]))
    contentPos = at + 1
  }
  tr.setSelection(TextSelection.create(tr.doc, cellTextPos(table, contentPos, 0, 0)))
  return true
}

/** `/표` — 쳐 둔 `/쿼리` 를 지우고 표를. 메뉴가 닫혀 있으면 false. */
export function runTableSlashCommand(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  newId: () => string = newBlockId,
): boolean {
  const menu = slashMenuState(state)
  if (!menu.active) return false
  const info = containerAt(state.selection.$from)
  if (!info) return false
  if (!dispatch) return true
  const tr = state.tr.delete(menu.from, state.selection.head)
  closeSlashMenu(tr)
  if (!insertTableAt(tr, info.id, newId)) return false
  dispatch(tr.scrollIntoView())
  return true
}

/** Tab · Shift+Tab — 옆 셀. 마지막 셀의 Tab 은 행을 더하고 그 첫 셀, 첫 셀의 Shift+Tab 은 키만 삼킨다. 표 밖이면 false. */
export function tableTabCommand(direction: 1 | -1): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    if (goToNextCell(direction)(state, dispatch)) return true
    if (direction === -1) return true
    if (!dispatch) return true
    const rect = selectedRect(state)
    let added: Transaction | null = null
    addRowAfter(state, (tr) => {
      added = tr
    })
    if (added === null) return true
    const tr = added as Transaction
    const table = tr.doc.nodeAt(rect.tableStart - 1)
    if (table === null) return true
    tr.setSelection(TextSelection.create(tr.doc, cellTextPos(table, rect.tableStart - 1, rect.bottom, 0)))
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Enter — 아래 셀의 끝. 마지막 행이면 표 뒤의 빈 문단으로(없으면 만든다). 셀 밖이면 false. */
export function tableEnterCommand(newId: () => string = newBlockId): Command {
  return (state, dispatch) => {
    if (!inTableCell(state.selection.$from) || !state.selection.$from.sameParent(state.selection.$to)) return false
    if (!dispatch) return true
    const rect = selectedRect(state)
    const tr = state.tr
    if (!state.selection.empty) tr.deleteSelection()
    if (rect.bottom < rect.map.height) {
      const below = tr.mapping.map(rect.tableStart + rect.map.map[rect.bottom * rect.map.width + rect.left]!)
      const cell = tr.doc.nodeAt(below)
      if (cell === null) return true
      tr.setSelection(TextSelection.create(tr.doc, below + cell.nodeSize - 1))
      dispatch(tr.scrollIntoView())
      return true
    }
    const info = containerAt(tr.selection.$from)
    if (!info) return true
    const after = info.pos + info.node.nodeSize
    const next = tr.doc.nodeAt(after)
    const nextIsBlank = next?.type === CONTAINER && next.childCount === 1 && next.firstChild?.type === PARAGRAPH && next.firstChild.content.size === 0
    if (!nextIsBlank) tr.insert(after, CONTAINER!.create({ blockId: newId() }, [PARAGRAPH!.create({ props: {}, format: {} })]))
    tr.setSelection(TextSelection.create(tr.doc, after + 2))
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Shift+Enter — 셀 안의 줄바꿈. 셀 밖이면 false. */
export function tableSoftBreakCommand(): Command {
  return (state, dispatch) => {
    if (!inTableCell(state.selection.$from) || !state.selection.$from.sameParent(state.selection.$to)) return false
    if (dispatch) dispatch(state.tr.insertText('\n').scrollIntoView())
    return true
  }
}

/** 셀 맨 앞의 Backspace(`-1`) · 맨 끝의 Delete(`1`) — 키를 삼킨다. 그 밖(셀 안의 글자 지우기)은 false — 기본 동작으로. */
export function tableEdgeDeleteCommand(direction: 1 | -1): Command {
  return (state) => {
    const { $from, empty } = state.selection
    if (!empty || !inTableCell($from)) return false
    return direction === -1 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size
  }
}
