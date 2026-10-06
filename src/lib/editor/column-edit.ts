/**
 * 컬럼 편집 — 폭 · 빈 컬럼 지우기 (Phase 2 1c-2 · F-01-12 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 컬럼 ⑥⑦
 *
 *   · **폭**은 컬럼마다 `format.column_ratio`(0 초과 1 이하 · 한 컬럼 목록의 합이 1 — 공개 API 의 `width_ratio`). 하나라도 없거나
 *     틀리면 모두 같은 폭으로 읽는다(`resolvedRatios`). 쓰기는 컬럼 목록 전체를 한 트랜잭션에(합이 1 이 되게) — 둘이 동시에 고치면 컬럼마다
 *     LWW 라 합이 1 이 아닐 수 있다. 그래서 읽을 때 합으로 나눈다(그리는 쪽은 비율만 쓴다)
 *   · **빈 컬럼 지우기** — 컬럼의 유일한 블록이 빈 문단이고 그 맨 앞에서 Backspace 를 치면 그 컬럼을 지운다(노션의 "빈 컬럼은 ⋮⋮ →
 *     Delete" 를 키 하나로). 남은 컬럼이 하나면 컬럼 목록을 풀어 그 블록들을 제자리에 둔다(정규화 ④ 와 같은 결과를 편집기가 먼저).
 *     남은 컬럼들의 폭은 합이 1 이 되게 다시 나눈다. 캐럿은 앞 컬럼의 끝(없으면 뒤 컬럼의 처음)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'

import { COLUMN_RATIO_KEY, isColumnRatio, MIN_COLUMNS, type BlockFormat } from '../block/types.ts'
import { separateUndoStep } from './code-block.ts'
import { containerAt, findContainerById } from './pm-blocks.ts'

/** 폭을 줄일 수 있는 바닥 — 컬럼 하나가 이것보다 좁아지지 않는다. */
export const MIN_COLUMN_RATIO = 0.1

/** 컬럼 목록 하나 — 위치 · 컬럼들(위치 · 노드 · 저장된 폭). */
export type ColumnListInfo = {
  readonly id: string
  readonly pos: number
  readonly node: PmNode
  readonly columns: readonly { readonly id: string; readonly pos: number; readonly node: PmNode; readonly ratio: unknown }[]
}

/** 이 블록이 컬럼 목록이면 그 정보 — 아니면 null. */
export function columnListInfo(doc: PmNode, listId: string): ColumnListInfo | null {
  const info = findContainerById(doc, listId)
  if (!info || info.contentNode.type.name !== 'column_list' || info.groupNode === null || info.groupPos === null) return null
  const columns: { id: string; pos: number; node: PmNode; ratio: unknown }[] = []
  let pos = info.groupPos + 1
  info.groupNode.forEach((column) => {
    const format = (column.firstChild?.attrs.format ?? {}) as BlockFormat
    columns.push({ id: String(column.attrs.blockId ?? ''), pos, node: column, ratio: format[COLUMN_RATIO_KEY] })
    pos += column.nodeSize
  })
  return { id: listId, pos: info.pos, node: info.node, columns }
}

/** 저장된 폭들 → 그릴 폭들(합 1). 하나라도 없거나 틀리면 모두 같은 폭. */
export function resolvedRatios(stored: readonly unknown[]): number[] {
  if (stored.length === 0) return []
  if (!stored.every(isColumnRatio)) return stored.map(() => 1 / stored.length)
  const sum = (stored as number[]).reduce((a, b) => a + b, 0)
  return (stored as number[]).map((r) => r / sum)
}

/** 폭들을 합 1 로 — 바닥(`MIN_COLUMN_RATIO`)보다 좁은 것은 바닥으로 올리고 나머지에서 덜어 낸다. 소수 넷째 자리까지. */
export function balancedRatios(ratios: readonly number[]): number[] {
  const n = ratios.length
  if (n === 0) return []
  const floor = Math.min(MIN_COLUMN_RATIO, 1 / n)
  const clean = ratios.map((r) => (Number.isFinite(r) && r > 0 ? r : floor))
  const sum = clean.reduce((a, b) => a + b, 0)
  let out = clean.map((r) => Math.max(floor, r / sum))
  const over = out.reduce((a, b) => a + b, 0) - 1
  if (over > 0) {
    const room = out.map((r) => r - floor)
    const total = room.reduce((a, b) => a + b, 0)
    out = out.map((r, i) => (total > 0 ? r - (over * room[i]!) / total : 1 / n))
  }
  const rounded = out.map((r) => Math.round(r * 10000) / 10000)
  // 반올림의 나머지는 마지막 컬럼이 갖는다 — 합이 정확히 1.
  rounded[n - 1] = Math.round((1 - rounded.slice(0, -1).reduce((a, b) => a + b, 0)) * 10000) / 10000
  return rounded
}

function writeRatios(tr: Transaction, list: ColumnListInfo, ratios: readonly number[]): void {
  list.columns.forEach((column, i) => {
    const content = tr.doc.nodeAt(column.pos + 1)
    if (!content) return
    const format = { ...((content.attrs.format ?? {}) as BlockFormat), [COLUMN_RATIO_KEY]: ratios[i] }
    tr.setNodeMarkup(column.pos + 1, undefined, { ...content.attrs, format })
  })
}

/** 컬럼 목록의 폭을 쓴다 — 컬럼 수와 같은 길이 · 합 1 로 맞춘다 · 같으면 쓰지 않는다. */
export function setColumnRatiosCommand(listId: string, ratios: readonly number[]): Command {
  return (state, dispatch) => {
    const list = columnListInfo(state.doc, listId)
    if (list === null || ratios.length !== list.columns.length) return false
    const next = balancedRatios(ratios)
    if (list.columns.every((c, i) => c.ratio === next[i])) return false
    if (dispatch) {
      const tr = state.tr
      writeRatios(tr, list, next)
      separateUndoStep(state)
      dispatch(tr)
      separateUndoStep(state)
    }
    return true
  }
}

/**
 * 비게 된 컬럼을 정리한다 — 트랜잭션에. 블록을 끌어내거나 지워 블록이 없는 컬럼은 지우고, 남은 컬럼이 하나면 컬럼 목록을 풀어 그 블록들을
 * 제자리에(없으면 컬럼 목록째 뺀다). 남은 컬럼들의 폭은 합이 1 이 되게 다시 나눈다. 고친 것이 있으면 true.
 *
 * 정규화(④)는 빈 컬럼을 **채운다**(동시 편집이 남긴 것 — 지우면 남이 쓰던 자리가 사라진다). 편집기는 지금 이 사람이 비운 컬럼이라 지운다
 * — 노션이 마지막 블록을 끌어낸 컬럼을 지우는 것과 같다.
 */
export function tidyColumns(tr: Transaction): boolean {
  const lists: string[] = []
  tr.doc.descendants((node) => {
    if (node.type.name === 'blockContainer' && node.firstChild?.type.name === 'column_list') lists.push(String(node.attrs.blockId ?? ''))
    return true
  })
  let changed = false
  // 뒤에서부터 — 앞의 것을 고쳐도 뒤의 위치가 그대로다. 위치는 매번 id 로 다시 찾는다.
  for (const id of lists.reverse()) {
    const list = columnListInfo(tr.doc, id)
    if (list === null) continue
    const empty = list.columns.filter((c) => c.node.childCount < 2)
    if (empty.length === 0) continue
    changed = true
    const rest = list.columns.filter((c) => c.node.childCount >= 2)
    if (rest.length < MIN_COLUMNS) {
      const blocks: PmNode[] = []
      rest[0]?.node.child(1).forEach((child) => blocks.push(child))
      if (blocks.length > 0) tr.replaceWith(list.pos, list.pos + list.node.nodeSize, blocks)
      else tr.delete(list.pos, list.pos + list.node.nodeSize)
      continue
    }
    for (const column of [...empty].reverse()) tr.delete(column.pos, column.pos + column.node.nodeSize)
    const after = columnListInfo(tr.doc, id)
    if (after !== null && rest.every((c) => isColumnRatio(c.ratio))) writeRatios(tr, after, balancedRatios(rest.map((c) => c.ratio as number)))
  }
  return changed
}

/** 캐럿을 그 컨테이너의 글 끝(`atEnd`) 또는 처음에 — 그 안의 마지막 · 첫 글자 자리. */
function caretIn(tr: Transaction, container: { pos: number; node: PmNode }, atEnd: boolean): void {
  const $pos = tr.doc.resolve(atEnd ? container.pos + container.node.nodeSize - 1 : container.pos + 1)
  tr.setSelection(Selection.near($pos, atEnd ? -1 : 1))
}

/**
 * Backspace — 빈 컬럼을 지운다(머리말). 캐럿이 컬럼의 유일한 블록(빈 문단 · 자식 없음)의 맨 앞에 있을 때만. 아니면 false(다음 명령으로).
 */
export function removeEmptyColumnCommand(): Command {
  return (state: EditorState, dispatch) => {
    const { selection } = state
    if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0) return false
    const block = containerAt(selection.$from)
    if (!block || block.contentNode.type.name !== 'paragraph' || block.contentNode.content.size !== 0 || block.groupNode !== null) return false
    const $block = state.doc.resolve(block.pos)
    // 블록 → 그룹 → 컬럼 컨테이너 → 그룹 → 컬럼 목록 컨테이너
    if ($block.depth < 4) return false
    const column = $block.node($block.depth - 1)
    if (column.type.name !== 'blockContainer' || column.firstChild?.type.name !== 'column' || column.child(1).childCount !== 1) return false
    const listContainer = $block.node($block.depth - 3)
    const list = columnListInfo(state.doc, String(listContainer.attrs.blockId ?? ''))
    const columnId = String(column.attrs.blockId ?? '')
    const index = list?.columns.findIndex((c) => c.id === columnId) ?? -1
    if (list === null || index < 0) return false
    if (!dispatch) return true

    const tr = state.tr
    const rest = list.columns.filter((_, i) => i !== index)
    if (rest.length < MIN_COLUMNS) {
      // 하나 남는다 — 컬럼 목록을 풀어 남은 컬럼의 블록들을 제자리에.
      const keep = rest[0]!
      const blocks: PmNode[] = []
      keep.node.child(1).forEach((child) => blocks.push(child))
      tr.replaceWith(list.pos, list.pos + list.node.nodeSize, blocks)
      const lastOrFirst = index > 0 ? blocks[blocks.length - 1]! : blocks[0]!
      const at = findContainerById(tr.doc, String(lastOrFirst.attrs.blockId ?? ''))
      if (at) caretIn(tr, at, index > 0)
    } else {
      const removed = list.columns[index]!
      tr.delete(removed.pos, removed.pos + removed.node.nodeSize)
      const after = columnListInfo(tr.doc, list.id)
      if (after !== null && rest.every((c) => isColumnRatio(c.ratio))) writeRatios(tr, after, balancedRatios(rest.map((c) => c.ratio as number)))
      const neighbor = after?.columns[index > 0 ? index - 1 : 0]
      if (neighbor) caretIn(tr, neighbor, index > 0)
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}
