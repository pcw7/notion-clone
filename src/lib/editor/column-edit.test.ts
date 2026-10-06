/**
 * 컬럼 편집 — 폭 · 빈 컬럼 지우기 · 비게 된 컬럼 정리 · 차선 · 데코레이션 (Phase 2 1c-2 · F-01-12 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 폭의 계산 — 저장된 폭이 다 있으면 합으로 나누고 하나라도 없으면 같은 폭 · 쓸 폭은 합 1 · 바닥 · 넷째 자리
 *   ② ★ 폭 쓰기 — 컬럼마다 `format.column_ratio` 를 한 번에 · 길이가 다르면 · 같으면 쓰지 않는다 · 정화(컬럼의 올바른 수만)
 *   ③ ★ 빈 컬럼 지우기(Backspace) — 유일한 빈 블록의 맨 앞에서만 · 셋이면 지우고 폭을 다시 나눈다 · 둘이면 풀어 제자리에 · 캐럿
 *   ④ ★ 비게 된 컬럼 정리 — 마지막 블록을 끌어낸 컬럼 · 블록 선택으로 지운 컬럼은 지운다(하나 남으면 푼다)
 *   ⑤ 끌어 놓기 — 컬럼 목록을 컬럼 바로 안으로는 놓지 않는다
 *   ⑥ ★ 데코레이션 — 컬럼마다 flex-grow · 둘째 컬럼부터 손잡이
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { normalizeFormat, type BlockType } from '../block/types.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc } from '../collab/ydoc.ts'
import { repairBodyYDoc } from '../collab/repair.ts'
import { contentElementOf } from '../testing/collab-peers.ts'
import { dropBlocksCommand, planDrop } from './block-handle.ts'
import { BlockSelection, deleteBlockSelectionCommand } from './block-selection.ts'
import { balancedRatios, MIN_COLUMN_RATIO, removeEmptyColumnCommand, resolvedRatios, setColumnRatiosCommand } from './column-edit.ts'
import { columnDecorations } from './column-layout.ts'
import { createEditorKeymap } from './keymap.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, text = '', children: EditorBlock[] = [], format: Record<string, unknown> = {}): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format,
  children,
})
const p = (text: string) => blk('paragraph', text)
const column = (children: EditorBlock[], ratio?: number) => blk('column', '', children, ratio === undefined ? {} : { column_ratio: ratio })
const columns = (...cols: EditorBlock[]) => blk('column_list', '', cols)

type Shape = string | [string, Shape[]]
const shape = (blocks: readonly EditorBlock[]): Shape[] =>
  blocks.map((b) => (b.type === 'paragraph' ? toPlainText(b.title) : [b.type, shape(b.children ?? [])]))
const ratiosOf = (state: EditorState, listIndex = 0) =>
  pmToDoc(state.doc).blocks.filter((b) => b.type === 'column_list')[listIndex]!.children!.map((c) => c.format?.column_ratio)

const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })
function caret(state: EditorState, blockId: string, offset = 0): EditorState {
  const info = findContainerById(state.doc, blockId)!
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)))
}
function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { handled, state: next }
}
const deps = { isCollapsed: () => false, newId: nextId }

describe('① 폭의 계산', () => {
  test('★ 다 있으면 합으로 나누고 · 하나라도 없거나 틀리면 같은 폭', () => {
    assert.deepEqual(resolvedRatios([0.25, 0.75]), [0.25, 0.75])
    assert.deepEqual(resolvedRatios([0.2, 0.2]), [0.5, 0.5])
    assert.deepEqual(resolvedRatios([0.3, undefined, 0.3]), [1 / 3, 1 / 3, 1 / 3])
    assert.deepEqual(resolvedRatios([0.5, 2]), [0.5, 0.5])
    assert.deepEqual(resolvedRatios([]), [])
  })

  test('★ 쓸 폭은 합 1 · 바닥 · 넷째 자리', () => {
    const sum = (r: number[]) => Math.round(r.reduce((a, b) => a + b, 0) * 10000) / 10000
    assert.deepEqual(balancedRatios([1, 3]), [0.25, 0.75])
    const floored = balancedRatios([0.01, 0.99])
    assert.ok(floored[0]! >= MIN_COLUMN_RATIO - 1e-9, JSON.stringify(floored))
    assert.equal(sum(floored), 1)
    const three = balancedRatios([1, 1, 1])
    assert.equal(sum(three), 1)
    assert.ok(three.every((r) => String(r).replace(/^0\./, '').length <= 4))
  })
})

describe('② 폭 쓰기 · 정화', () => {
  test('★ 컬럼마다 한 번에 · 길이가 다르면 · 같으면 쓰지 않는다', () => {
    const list = columns(column([p('a')]), column([p('b')]))
    const state = stateOf([list])
    const written = run(state, setColumnRatiosCommand(list.id, [3, 1]))
    assert.ok(written.handled)
    assert.deepEqual(ratiosOf(written.state), [0.75, 0.25])
    assert.equal(run(written.state, setColumnRatiosCommand(list.id, [0.75, 0.25])).handled, false)
    assert.equal(run(state, setColumnRatiosCommand(list.id, [0.5])).handled, false)
    assert.equal(run(state, setColumnRatiosCommand(nextId(), [0.5, 0.5])).handled, false)
  })

  test('★ 정화 — 컬럼의 올바른 수만 남는다', () => {
    assert.deepEqual(normalizeFormat('column', { column_ratio: 0.4 }), { column_ratio: 0.4 })
    assert.deepEqual(normalizeFormat('column', { column_ratio: 0 }), {})
    assert.deepEqual(normalizeFormat('column', { column_ratio: 1.5 }), {})
    assert.deepEqual(normalizeFormat('column', { column_ratio: '0.5' }), {})
    assert.deepEqual(normalizeFormat('paragraph', { column_ratio: 0.5 }), {})
    // 참여자가 쓴 틀린 폭 — 수선이 지운다
    const left = column([p('a')])
    const ydoc = createBodyYDoc({ blocks: [columns(left, column([p('b')]))] })
    contentElementOf(ydoc, left.id).setAttribute('format', { column_ratio: -3 } as never)
    const page = nextId()
    assert.ok(readBodyYDoc(ydoc, page).fixes.includes('invalid_props_dropped'))
    assert.equal(repairBodyYDoc(ydoc, page).kind, 'repaired')
    assert.deepEqual(readBodyYDoc(ydoc, page).doc.blocks[0]!.children![0]!.format ?? {}, {})
  })
})

describe('③ 빈 컬럼 지우기', () => {
  test('★ 셋 중 빈 컬럼 — 지우고 폭을 다시 나눈다 · 캐럿은 앞 컬럼의 끝', () => {
    const empty = p('')
    const list = columns(column([p('왼쪽')], 0.5), column([empty], 0.25), column([p('오른쪽')], 0.25))
    const removed = run(caret(stateOf([list]), empty.id), removeEmptyColumnCommand())
    assert.ok(removed.handled)
    assert.deepEqual(shape(pmToDoc(removed.state.doc).blocks), [['column_list', [['column', ['왼쪽']], ['column', ['오른쪽']]]]])
    assert.deepEqual(ratiosOf(removed.state), [0.6667, 0.3333])
    const $caret = removed.state.selection.$from
    assert.equal($caret.parent.textContent, '왼쪽')
    assert.equal($caret.parentOffset, 2)
  })

  test('★ 둘 중 빈 컬럼 — 컬럼 목록을 풀어 남은 블록을 제자리에', () => {
    const empty = p('')
    const removed = run(caret(stateOf([p('앞'), columns(column([empty]), column([p('x'), p('y')])), p('뒤')]), empty.id), removeEmptyColumnCommand())
    assert.ok(removed.handled)
    assert.deepEqual(shape(pmToDoc(removed.state.doc).blocks), ['앞', 'x', 'y', '뒤'])
    assert.equal(removed.state.selection.$from.parent.textContent, 'x', '캐럿이 뒤 컬럼의 처음이 아니다')
  })

  test('★ 키맵의 Backspace 가 빈 컬럼을 지운다(병합보다 먼저 — 병합은 컬럼 경계에서 키를 삼킨다)', () => {
    const empty = p('')
    const state = caret(stateOf([columns(column([p('a')]), column([empty]), column([p('c')]))]), empty.id)
    const backspace = createEditorKeymap({ isCollapsed: () => false }).Backspace!
    const done = run(state, backspace)
    assert.ok(done.handled)
    assert.deepEqual(shape(pmToDoc(done.state.doc).blocks), [['column_list', [['column', ['a']], ['column', ['c']]]]])
  })

  test('유일한 빈 블록의 맨 앞에서만 — 글이 있거나 · 블록이 둘이거나 · 컬럼 밖이면 아니다', () => {
    const text = p('글')
    const two = p('')
    const outside = p('')
    const state = stateOf([outside, columns(column([text]), column([two, p('또')]))])
    assert.equal(run(caret(state, text.id), removeEmptyColumnCommand()).handled, false)
    assert.equal(run(caret(state, two.id), removeEmptyColumnCommand()).handled, false)
    assert.equal(run(caret(state, outside.id), removeEmptyColumnCommand()).handled, false)
  })
})

describe('④ 비게 된 컬럼 정리', () => {
  test('★ 마지막 블록을 끌어낸 컬럼은 지운다 — 하나 남으면 푼다', () => {
    const only = p('끌 것')
    const outside = p('밖')
    const state = stateOf([outside, columns(column([p('a')]), column([only]))])
    const dropped = run(state, dropBlocksCommand([only.id], { kind: 'after', blockId: outside.id }, deps))
    assert.ok(dropped.handled)
    assert.deepEqual(shape(pmToDoc(dropped.state.doc).blocks), ['밖', '끌 것', 'a'])
    // 셋 중 하나를 비우면 그 컬럼만
    const one = p('하나')
    const three = stateOf([outside, columns(column([p('a')]), column([one]), column([p('c')]))])
    const moved = run(three, dropBlocksCommand([one.id], { kind: 'after', blockId: outside.id }, deps))
    assert.deepEqual(shape(pmToDoc(moved.state.doc).blocks), ['밖', '하나', ['column_list', [['column', ['a']], ['column', ['c']]]]])
  })

  test('★ 블록 선택으로 컬럼의 블록을 다 지우면 그 컬럼을 지운다 · 컬럼 안으로 끌어 넣기는 그 컬럼에', () => {
    const only = p('지울 것')
    const state = stateOf([columns(column([p('a')]), column([only]))])
    const info = findContainerById(state.doc, only.id)!
    const selected = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, info.pos)))
    const deleted = run(selected, deleteBlockSelectionCommand(deps))
    assert.ok(deleted.handled)
    assert.deepEqual(shape(pmToDoc(deleted.state.doc).blocks), ['a'])

    const into = p('넣을 것')
    const target = p('t')
    const two = stateOf([into, columns(column([target]), column([p('b')]))])
    const inserted = run(two, dropBlocksCommand([into.id], { kind: 'after', blockId: target.id }, deps))
    assert.deepEqual(shape(pmToDoc(inserted.state.doc).blocks), [['column_list', [['column', ['t', '넣을 것']], ['column', ['b']]]]])
  })
})

describe('⑤ 끌어 놓기 가드', () => {
  test('컬럼 목록을 컬럼 바로 안으로는 놓지 않는다', () => {
    const target = p('t')
    const inner = columns(column([p('x')]), column([p('y')]))
    const state = stateOf([inner, columns(column([target]), column([p('b')]))])
    assert.deepEqual(planDrop(state.doc, [inner.id], { kind: 'after', blockId: target.id }, () => false), { kind: 'invalid_target' })
  })
})

describe('⑥ 데코레이션', () => {
  test('★ 컬럼마다 flex-grow · 둘째 컬럼부터 손잡이', () => {
    const state = stateOf([columns(column([p('a')], 0.25), column([p('b')], 0.25), column([p('c')], 0.5))])
    const set = columnDecorations(state.doc)
    const all = set.find()
    const styles = all.map((d) => (d.spec as { key?: string }).key ?? (d as unknown as { type: { attrs?: { style?: string } } }).type.attrs?.style).filter(Boolean)
    assert.deepEqual(styles.filter((s) => String(s).startsWith('flex-grow')), ['flex-grow: 0.25', 'flex-grow: 0.25', 'flex-grow: 0.5'])
    assert.equal(styles.filter((s) => String(s).startsWith('column-resize:')).length, 2)
    const equal = columnDecorations(stateOf([columns(column([p('a')]), column([p('b')]))]).doc).find()
    assert.deepEqual(
      equal.map((d) => (d as unknown as { type: { attrs?: { style?: string } } }).type.attrs?.style).filter(Boolean),
      ['flex-grow: 0.5', 'flex-grow: 0.5'],
    )
  })
})
