/**
 * 컬럼 — 옆에 놓아 만들기 · 경계를 넘는 블록 선택 (Phase 2 1c-3 · F-01-12 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 옆 구역 — 포인터가 그 줄 안이고 오른쪽 끝 구역이면 옆이다 · 줄 사이 틈 · 옆에 놓을 수 없는 줄 · 끈 화면은 아니다 · 세로 가이드
 *   ② ★ 옆에 놓을 수 있는 줄 — 컬럼 밖(깊어도) · 컬럼의 직속 블록. 컬럼 안의 더 깊은 블록은 아니다
 *   ③ ★ 감싸기 — 컬럼 밖의 블록 옆에 놓으면 컬럼 목록(그 블록 | 끈 블록) · 자식째 · 토글 안에서도 · 정규화가 고칠 것이 없다
 *   ④ ★ 더하기 — 컬럼의 직속 블록 옆에 놓으면 그 컬럼 오른쪽에 새 컬럼 · 폭이 다 있으면 새 컬럼이 1/(n+1) · 없으면 쓰지 않는다
 *   ⑤ ★ 같은 목록 안에서 · 끌어낸 컬럼은 정리된다
 *   ⑥ 막는 것 — 깊은 블록 옆 · 컬럼 목록을 끌어 옆에
 *   ⑦ ★ 경계를 넘는 블록 선택 — 컬럼은 뿌리가 아니다 · 컬럼 목록은 통째로 덮일 때만 · 한 점짜리 컬럼은 던지지 않는다
 *   ⑧ ★ Shift+↓↑ 가 컬럼 목록을 지나간다(멈추지 않는다) · 선택 지우기 뒤 정리
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, type Command } from '@tiptap/pm/state'

import type { BlockType } from '../block/types.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc } from '../collab/ydoc.ts'
import {
  dropBlocksCommand,
  dropCandidates,
  dropGuide,
  planDrop,
  resolveDrop,
  SIDE_ZONE_PX,
  type BlockLine,
} from './block-handle.ts'
import {
  BlockSelection,
  deleteBlockSelectionCommand,
  extendBlockSelectionCommand,
  isBlockSelection,
  rootsBetween,
} from './block-selection.ts'
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
const p = (text: string, children: EditorBlock[] = []) => blk('paragraph', text, children)
const toggle = (text: string, children: EditorBlock[]) => blk('toggle', text, children)
const column = (children: EditorBlock[], ratio?: number) => blk('column', '', children, ratio === undefined ? {} : { column_ratio: ratio })
const columns = (...cols: EditorBlock[]) => blk('column_list', '', cols)

type Shape = string | [string, Shape[]]
const shape = (blocks: readonly EditorBlock[]): Shape[] =>
  blocks.map((b) => (b.type === 'paragraph' || b.type === 'toggle' ? toPlainText(b.title) : [b.type, shape(b.children ?? [])]))
const shapeOf = (state: EditorState) => shape(pmToDoc(state.doc).blocks)
const ratiosOf = (state: EditorState) =>
  pmToDoc(state.doc).blocks.find((b) => b.type === 'column_list')!.children!.map((c) => c.format?.column_ratio)
/** 정규화가 고칠 것이 없다 — 편집기가 만든 모양이 저장 모양 그대로다. */
const fixesOf = (state: EditorState) => readBodyYDoc(createBodyYDoc(pmToDoc(state.doc)), nextId()).fixes

const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })
function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { handled, state: next }
}
const deps = { isCollapsed: () => false, newId: nextId }
const side = (blockId: string) => ({ kind: 'side' as const, blockId })
const posOf = (state: EditorState, id: string) => findContainerById(state.doc, id)!.pos
const textOf = (state: EditorState, pos: number) => {
  const node = state.doc.nodeAt(pos)!
  return node.firstChild!.type.name === 'paragraph' ? node.firstChild!.textContent : node.firstChild!.type.name
}
const selectedOf = (state: EditorState) => {
  assert.ok(isBlockSelection(state.selection))
  return state.selection.rootPositions.map((pos) => textOf(state, pos))
}

/** 한 줄 — 위 0 · 아래 20 · 내용 48~720. */
const line = (over: Partial<BlockLine> = {}): BlockLine => ({
  blockId: 'x',
  pos: 0,
  canNest: true,
  hasVisibleChildren: false,
  lane: null,
  canSide: true,
  top: 0,
  bottom: 20,
  contentLeft: 48,
  contentRight: 720,
  ...over,
})

describe('① 옆 구역', () => {
  test('★ 그 줄 안 · 오른쪽 끝 구역(밖까지)이면 옆 — 안쪽이면 위아래', () => {
    const lines = [line({ blockId: 'a' }), line({ blockId: 'b', top: 24, bottom: 44 })]
    assert.deepEqual(resolveDrop(lines, 720 - SIDE_ZONE_PX, 10, 24)?.target, side('a'))
    assert.deepEqual(resolveDrop(lines, 900, 30, 24)?.target, side('b'), '오른쪽 여백(줄 밖)도 옆이다')
    assert.equal(resolveDrop(lines, 720 - SIDE_ZONE_PX - 1, 15, 24)?.target.kind, 'child', '구역 밖 — 아래 절반의 오른쪽은 그대로 자식 자리')
    assert.equal(resolveDrop(lines, 100, 5, 24)?.target.kind, 'before')
  })

  test('★ 줄 사이 틈 · 옆에 놓을 수 없는 줄 · 옆을 끈 화면은 옆이 아니다', () => {
    const lines = [line({ blockId: 'a' }), line({ blockId: 'b', top: 24, bottom: 44 })]
    assert.notEqual(resolveDrop(lines, 710, 22, 24)?.target.kind, 'side', '틈')
    assert.notEqual(resolveDrop([line({ canSide: false })], 710, 10, 24)?.target.kind, 'side', '옆에 놓을 수 없는 줄')
    assert.notEqual(resolveDrop(lines, 710, 10, 24, false)?.target.kind, 'side', '좁은 화면')
  })

  test('★ 세로 가이드 — 그 줄의 오른쪽 끝 · 줄의 높이', () => {
    const l = line({ top: 30, bottom: 54, contentRight: 400 })
    assert.deepEqual(dropGuide({ target: side('x'), line: l }, 24), { top: 30, left: 398, height: 24 })
    assert.equal(dropGuide({ target: { kind: 'after', blockId: 'x' }, line: l }, 24).height, undefined)
  })
})

describe('② 옆에 놓을 수 있는 줄', () => {
  test('★ 컬럼 밖(토글 안이어도) · 컬럼의 직속 블록은 된다 — 컬럼 안의 더 깊은 블록은 아니다', () => {
    const top = p('위')
    const inToggle = p('토글 안')
    const direct = p('컬럼 직속')
    const deep = p('컬럼 안 토글 안')
    const state = stateOf([top, toggle('토글', [inToggle]), columns(column([direct, toggle('안 토글', [deep])]), column([p('오른쪽')]))])
    const canSide = new Map(dropCandidates(state.doc, () => false, []).map((l) => [l.blockId, l.canSide]))
    assert.equal(canSide.get(top.id), true)
    assert.equal(canSide.get(inToggle.id), true)
    assert.equal(canSide.get(direct.id), true)
    assert.equal(canSide.get(deep.id), false)
  })
})

describe('③ 감싸기', () => {
  test('★ 컬럼 밖의 블록 옆에 놓으면 컬럼 목록(그 블록 | 끈 블록) — id 는 그대로 · 끈 블록이 골라진다', () => {
    const [a, b, c] = [p('a'), p('b'), p('c')]
    const { handled, state } = run(stateOf([a, b, c]), dropBlocksCommand([c.id], side(a.id), deps))
    assert.ok(handled)
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['a']], ['column', ['c']]]], 'b'])
    state.doc.check()
    assert.ok(findContainerById(state.doc, a.id) && findContainerById(state.doc, c.id))
    assert.deepEqual(selectedOf(state), ['c'])
    assert.deepEqual(fixesOf(state), [])
    assert.deepEqual(ratiosOf(state), [undefined, undefined], '감쌀 때는 폭을 쓰지 않는다 — 같은 폭')
  })

  test('★ 자식째 옮겨진다 · 끈 블록도 자식째', () => {
    const a = toggle('a', [p('a1')])
    const c = p('c', [p('c1')])
    const { state } = run(stateOf([a, c]), dropBlocksCommand([c.id], side(a.id), deps))
    const list = pmToDoc(state.doc).blocks[0]!
    assert.equal(list.type, 'column_list')
    assert.deepEqual(list.children!.map((col) => col.children!.map((b) => [toPlainText(b.title), (b.children ?? []).map((k) => toPlainText(k.title))])), [
      [['a', ['a1']]],
      [['c', ['c1']]],
    ])
    assert.deepEqual(fixesOf(state), [])
  })

  test('토글 안의 블록 옆 — 컬럼 목록이 그 토글 안에 선다', () => {
    const x = p('x')
    const y = p('y')
    const { state } = run(stateOf([toggle('t', [x]), y]), dropBlocksCommand([y.id], side(x.id), deps))
    assert.deepEqual(shapeOf(state)[0], 't')
    const t = pmToDoc(state.doc).blocks[0]!
    assert.deepEqual(shape(t.children ?? []), [['column_list', [['column', ['x']], ['column', ['y']]]]])
    assert.deepEqual(fixesOf(state), [])
  })
})

describe('④ 더하기', () => {
  test('★ 컬럼의 직속 블록 옆 — 그 컬럼 오른쪽에 새 컬럼 · 폭이 다 있으면 새 컬럼이 1/(n+1) · 나머지는 비율대로', () => {
    const a = p('a')
    const c = p('c')
    const { state } = run(stateOf([columns(column([a], 0.25), column([p('b')], 0.75)), c]), dropBlocksCommand([c.id], side(a.id), deps))
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['a']], ['column', ['c']], ['column', ['b']]]]])
    const ratios = ratiosOf(state) as number[]
    assert.deepEqual(ratios, [0.1667, 0.3333, 0.5])
    assert.equal(Math.round(ratios.reduce((x, y) => x + y, 0) * 10000) / 10000, 1)
    assert.deepEqual(fixesOf(state), [])
  })

  test('폭이 없던 목록에 더하면 폭을 쓰지 않는다 — 모두 같은 폭으로 읽힌다', () => {
    const b = p('b')
    const c = p('c')
    const { state } = run(stateOf([columns(column([p('a')]), column([b])), c]), dropBlocksCommand([c.id], side(b.id), deps))
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['a']], ['column', ['b']], ['column', ['c']]]]])
    assert.deepEqual(ratiosOf(state), [undefined, undefined, undefined])
  })
})

describe('⑤ 같은 목록 안 · 정리', () => {
  test('★ 한 컬럼의 유일한 블록을 옆 컬럼의 블록 옆에 — 끌어낸 컬럼은 사라진다(자리 바꿈)', () => {
    const a = p('a')
    const b = p('b')
    const { state } = run(stateOf([columns(column([a], 0.3), column([b], 0.7))]), dropBlocksCommand([a.id], side(b.id), deps))
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['b']], ['column', ['a']]]]])
    const ratios = ratiosOf(state) as number[]
    assert.equal(ratios.length, 2)
    assert.equal(Math.round((ratios[0]! + ratios[1]!) * 10000) / 10000, 1)
    assert.deepEqual(fixesOf(state), [])
  })

  test('★ 두 컬럼 목록의 한쪽을 밖의 블록 옆에 — 남은 목록은 풀리고 밖의 블록이 새 목록이 된다', () => {
    const a = p('a')
    const c = p('c')
    const { state } = run(stateOf([columns(column([a]), column([p('b')])), c]), dropBlocksCommand([a.id], side(c.id), deps))
    assert.deepEqual(shapeOf(state), ['b', ['column_list', [['column', ['c']], ['column', ['a']]]]])
    assert.deepEqual(fixesOf(state), [])
  })

  test('한 컬럼의 둘째 블록을 같은 컬럼의 첫 블록 옆에 — 그 컬럼 오른쪽에 새 컬럼', () => {
    const a = p('a')
    const a2 = p('a2')
    const { state } = run(stateOf([columns(column([a, a2]), column([p('b')]))]), dropBlocksCommand([a2.id], side(a.id), deps))
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['a']], ['column', ['a2']], ['column', ['b']]]]])
  })
})

describe('⑥ 막는 것', () => {
  test('★ 컬럼 안의 깊은 블록 옆 · 컬럼 목록을 끌어 옆에 · 자기 자신 옆은 놓지 않는다', () => {
    const deep = p('deep')
    const list = columns(column([toggle('t', [deep])]), column([p('b')]))
    const c = p('c')
    const state = stateOf([list, c])
    assert.equal(planDrop(state.doc, [c.id], side(deep.id), () => false).kind, 'invalid_target')
    assert.equal(planDrop(state.doc, [list.id], side(c.id), () => false).kind, 'invalid_target')
    assert.equal(planDrop(state.doc, [c.id], side(c.id), () => false).kind, 'invalid_target')
    assert.equal(run(state, dropBlocksCommand([list.id], side(c.id), deps)).handled, false)
  })
})

describe('⑦ 경계를 넘는 블록 선택', () => {
  const build = () => {
    const ids = { top: p('top'), a: p('a'), a2: p('a2'), b1: p('b1'), b: p('b'), end: p('end') }
    const left = column([ids.a, ids.a2])
    const right = column([ids.b1, ids.b])
    const list = columns(left, right)
    const state = stateOf([ids.top, list, ids.end])
    return { ids, left, right, list, state }
  }

  test('★ 한 컬럼의 블록에서 옆 컬럼의 블록까지 — 컬럼이 아니라 그 사이의 블록들(옆 컬럼의 뒤쪽은 아니다)', () => {
    const { ids, state } = build()
    const roots = rootsBetween(state.doc, posOf(state, ids.a.id), posOf(state, ids.b1.id))
    assert.deepEqual(roots.map((pos) => textOf(state, pos)), ['a', 'a2', 'b1'])
  })

  test('★ 위에서 컬럼 안까지는 그 블록까지 — 컬럼 목록이 통째로 덮이면 목록째', () => {
    const { ids, state } = build()
    assert.deepEqual(rootsBetween(state.doc, posOf(state, ids.top.id), posOf(state, ids.a.id)).map((pos) => textOf(state, pos)), ['top', 'a'])
    assert.deepEqual(rootsBetween(state.doc, posOf(state, ids.top.id), posOf(state, ids.end.id)).map((pos) => textOf(state, pos)), [
      'top',
      'column_list',
      'end',
    ])
  })

  test('컬럼 목록이 경계 자신이면 목록째 · 한 점짜리 컬럼은 그 컬럼(빈 선택으로 던지지 않는다)', () => {
    const { list, left, state } = build()
    assert.deepEqual(rootsBetween(state.doc, posOf(state, list.id), posOf(state, list.id)).map((pos) => textOf(state, pos)), ['column_list'])
    assert.doesNotThrow(() => BlockSelection.create(state.doc, posOf(state, left.id)))
  })
})

describe('⑧ Shift+↓↑ · 지우기', () => {
  test('★ Shift+↓ 가 컬럼 안을 한 줄씩 지나 컬럼 목록 뒤까지 간다 — 멈추지 않는다', () => {
    const top = p('top')
    const end = p('end')
    let state = stateOf([top, columns(column([p('a')]), column([p('b')])), end])
    state = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, posOf(state, top.id))))
    const seen: string[][] = []
    for (let i = 0; i < 3; i += 1) {
      const r = run(state, extendBlockSelectionCommand(1, deps))
      assert.ok(r.handled)
      state = r.state
      seen.push(selectedOf(state))
    }
    assert.deepEqual(seen, [['top', 'a'], ['top', 'a', 'b'], ['top', 'column_list', 'end']])
  })

  test('★ 컬럼 목록째 고른 뒤의 Shift+↓ 는 목록 뒤의 블록으로 — 목록 안으로 되돌아가지 않는다', () => {
    const top = p('top')
    const list = columns(column([p('a')]), column([p('b')]))
    const end = p('end')
    let state = stateOf([top, list, end])
    state = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, posOf(state, top.id), posOf(state, list.id))))
    assert.deepEqual(selectedOf(state), ['top', 'column_list'])
    state = run(state, extendBlockSelectionCommand(1, deps)).state
    assert.deepEqual(selectedOf(state), ['top', 'column_list', 'end'])
  })

  test('★ Shift+↑ 로 줄이면 컬럼 목록 안으로 돌아온다', () => {
    const top = p('top')
    const end = p('end')
    let state = stateOf([top, columns(column([p('a')]), column([p('b')])), end])
    state = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, posOf(state, top.id), posOf(state, end.id))))
    state = run(state, extendBlockSelectionCommand(-1, deps)).state
    assert.deepEqual(selectedOf(state), ['top', 'a', 'b'])
  })

  test('★ 위로 넓히기 — 컬럼 목록 뒤에서 위로 가면 컬럼 안의 마지막 블록부터', () => {
    const end = p('end')
    let state = stateOf([p('top'), columns(column([p('a')]), column([p('b')])), end])
    state = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, posOf(state, end.id))))
    state = run(state, extendBlockSelectionCommand(-1, deps)).state
    assert.deepEqual(selectedOf(state), ['b', 'end'])
  })

  test('★ 두 컬럼에 걸친 선택을 지우면 그 블록들만 — 비게 된 컬럼은 정리된다', () => {
    const a2 = p('a2')
    const b1 = p('b1')
    let state = stateOf([columns(column([p('a'), a2]), column([b1, p('b')]))])
    state = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, posOf(state, a2.id), posOf(state, b1.id))))
    state = run(state, deleteBlockSelectionCommand(deps)).state
    assert.deepEqual(shapeOf(state), [['column_list', [['column', ['a']], ['column', ['b']]]]])
    assert.deepEqual(fixesOf(state), [])
  })
})
