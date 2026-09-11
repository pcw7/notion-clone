/**
 * 블록 메뉴 — F-01-08 · F-12-01 · F-12-13
 *
 * 메뉴의 **모양**(어떤 항목이 켜져 있는가)과 **키보드 조작**을 DOM 없이 고정한다.
 * 화면이 제대로 그리는지는 `npm run e2e` 가 본다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { textRun } from '../contracts/rich-text.ts'
import type { BlockType } from '../block/types.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { BlockSelection, isBlockSelection } from './block-selection.ts'
import {
  blockIdFromHash,
  blockLinkPath,
  blockMenuItems,
  colorLabel,
  firstEnabled,
  navigateMenu,
  openBlockMenuCommand,
  revealBlockCommand,
  setBlockColorCommand,
  type MenuItem,
} from './block-menu.ts'
import { findContainerById } from './pm-blocks.ts'
import type { CommandDeps } from './commands.ts'
import type { EditorBlock } from './document.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type: BlockType = 'paragraph', text = '', children: EditorBlock[] = []): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children }
}

function stateOf(blocks: EditorBlock[]): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })
}

function select(state: EditorState, anchorId: string, headId = anchorId): EditorState {
  const a = findContainerById(state.doc, anchorId)
  const h = findContainerById(state.doc, headId)
  assert.ok(a && h)
  return state.apply(state.tr.setSelection(BlockSelection.create(state.doc, a.pos, h.pos)))
}

/** 결과는 `assert.ok(x === null)` 로 본다 — EditorState 를 inspect 하면 멈춘다(HANDOFF §5). */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

const deps = (extra: Partial<CommandDeps> = {}): CommandDeps => ({ isCollapsed: () => false, ...extra })
const item = (items: readonly MenuItem[], id: string): MenuItem => {
  const found = items.find((i) => i.id === id)
  assert.ok(found, `항목이 없다: ${id}`)
  return found
}

// ── 모양 ──────────────────────────────────────────────────────────────

describe('blockMenuItems — 무엇이 켜져 있는가', () => {
  test('항목은 늘 같은 자리에 있다 — 꺼질 뿐 사라지지 않는다', () => {
    const [a, p] = [nextId(), nextId()]
    const plain = blockMenuItems(select(stateOf([blk(a, 'paragraph', 'A')]), a), deps()).map((i) => i.id)
    const page = blockMenuItems(select(stateOf([blk(p, 'page', '하위')]), p), deps()).map((i) => i.id)
    assert.deepEqual(plain, ['turn_into', 'color', 'duplicate', 'copy_link', 'delete'])
    assert.deepEqual(page, plain, '손이 기억한 위치가 선택에 따라 틀어지면 안 된다')
  })

  test('변환 — 지금 타입은 체크, 바꿀 수 없는 타입은 꺼진다', () => {
    const [a, a1] = [nextId(), nextId()]
    // 자식이 있는 문단은 heading 으로 못 바꾼다(자식을 가질 수 없는 타입).
    const items = blockMenuItems(select(stateOf([blk(a, 'paragraph', 'A', [blk(a1)])]), a), deps())
    const children = item(items, 'turn_into').children ?? []
    assert.equal(item(children, 'turn_into:paragraph').checked, true)
    assert.equal(item(children, 'turn_into:paragraph').enabled, false, '이미 그 타입이다')
    assert.equal(item(children, 'turn_into:heading_1').enabled, false, '자식이 있어 거부된다')
    assert.equal(item(children, 'turn_into:toggle').enabled, true)
  })

  test('변환 목록에 구분선·이미지는 없다 — 텍스트가 사라지는 변환이다', () => {
    const a = nextId()
    const items = blockMenuItems(select(stateOf([blk(a, 'paragraph', 'A')]), a), deps())
    const ids = (item(items, 'turn_into').children ?? []).map((i) => i.id)
    assert.ok(!ids.includes('turn_into:divider') && !ids.includes('turn_into:image'))
  })

  test('색 — 19값, 지금 색이 체크된다', () => {
    const a = nextId()
    let state = select(stateOf([blk(a, 'paragraph', 'A')]), a)
    state = run(state, setBlockColorCommand('blue_background')) ?? state
    const colors = item(blockMenuItems(state, deps()), 'color').children ?? []
    assert.equal(colors.length, 19)
    assert.equal(item(colors, 'color:blue_background').checked, true)
    assert.equal(item(colors, 'color:default').checked, false)
  })

  test('색을 못 가지는 블록만 고르면 색이 꺼진다 — 구분선·하위 페이지', () => {
    const [d, p] = [nextId(), nextId()]
    const items = blockMenuItems(select(stateOf([blk(d, 'divider'), blk(p, 'page', '하위')]), d, p), deps())
    assert.equal(item(items, 'color').enabled, false)
  })

  test('하위 페이지가 섞이면 복제·삭제가 꺼진다 — 커맨드도 거부하지만 먼저 보여준다', () => {
    const [a, p] = [nextId(), nextId()]
    const items = blockMenuItems(select(stateOf([blk(a, 'paragraph', 'A'), blk(p, 'page', '하위')]), a, p), deps())
    assert.equal(item(items, 'duplicate').enabled, false)
    assert.equal(item(items, 'delete').enabled, false)
    assert.equal(item(items, 'copy_link').enabled, true)
  })

  test('블록 선택이 아니면 동작 항목이 꺼진다', () => {
    const a = nextId()
    let state = stateOf([blk(a, 'paragraph', 'A')])
    const info = findContainerById(state.doc, a)
    assert.ok(info)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    assert.ok(blockMenuItems(state, deps()).every((i) => !i.enabled))
  })
})

// ── 키보드 ────────────────────────────────────────────────────────────

describe('navigateMenu — WAI-ARIA 메뉴 패턴 (F-12-13)', () => {
  const leaf = (id: string, enabled = true): MenuItem => ({ id, label: id, enabled, action: { kind: 'delete' } })
  const items: MenuItem[] = [
    { id: 'turn', label: 'turn', enabled: true, children: [leaf('t1'), leaf('t2', false), leaf('t3')] },
    leaf('off', false),
    leaf('dup'),
    leaf('del'),
  ]

  test('↓↑ 는 꺼진 항목을 건너뛰고 끝에서 돈다', () => {
    assert.deepEqual(navigateMenu(items, { index: 0, sub: null }, 'ArrowDown'), { kind: 'move', cursor: { index: 2, sub: null } })
    assert.deepEqual(navigateMenu(items, { index: 3, sub: null }, 'ArrowDown'), { kind: 'move', cursor: { index: 0, sub: null } })
    assert.deepEqual(navigateMenu(items, { index: 0, sub: null }, 'ArrowUp'), { kind: 'move', cursor: { index: 3, sub: null } })
  })

  test('→ · Enter 는 하위 메뉴를 열고 첫 켜진 항목에 선다', () => {
    assert.deepEqual(navigateMenu(items, { index: 0, sub: null }, 'ArrowRight'), { kind: 'move', cursor: { index: 0, sub: 0 } })
    assert.deepEqual(navigateMenu(items, { index: 0, sub: null }, 'Enter'), { kind: 'move', cursor: { index: 0, sub: 0 } })
  })

  test('하위 메뉴 안에서도 꺼진 항목을 건너뛴다', () => {
    assert.deepEqual(navigateMenu(items, { index: 0, sub: 0 }, 'ArrowDown'), { kind: 'move', cursor: { index: 0, sub: 2 } })
  })

  test('← 와 Esc 는 하위 메뉴에서 한 단계만 나온다', () => {
    assert.deepEqual(navigateMenu(items, { index: 0, sub: 2 }, 'ArrowLeft'), { kind: 'move', cursor: { index: 0, sub: null } })
    assert.deepEqual(navigateMenu(items, { index: 0, sub: 2 }, 'Escape'), { kind: 'move', cursor: { index: 0, sub: null } })
  })

  test('최상위의 Esc 와 Tab 은 메뉴를 닫는다', () => {
    assert.equal(navigateMenu(items, { index: 2, sub: null }, 'Escape').kind, 'close')
    assert.equal(navigateMenu(items, { index: 2, sub: null }, 'Tab').kind, 'close')
    assert.equal(navigateMenu(items, { index: 0, sub: 1 }, 'Tab').kind, 'close')
  })

  test('Enter 는 동작 항목을 실행한다 — 꺼진 항목은 아무 일도 없다', () => {
    const r = navigateMenu(items, { index: 2, sub: null }, 'Enter')
    assert.equal(r.kind, 'activate')
    assert.equal(r.kind === 'activate' && r.item.id, 'dup')
    assert.equal(navigateMenu(items, { index: 0, sub: 1 }, 'Enter').kind, 'none')
  })

  test('처음 커서는 첫 켜진 항목', () => {
    assert.equal(firstEnabled([leaf('a', false), leaf('b')]), 1)
  })
})

// ── 블록 색 ───────────────────────────────────────────────────────────

describe('setBlockColorCommand — 블록 색은 글자색과 다른 계층이다 (F-01-21)', () => {
  test('선택된 블록 전부의 format.block_color 가 바뀐다', () => {
    const [a, b] = [nextId(), nextId()]
    const next = run(select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'heading_1', 'B')]), a, b), setBlockColorCommand('red'))
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].format?.block_color, 'red')
    assert.equal(doc.blocks[1].format?.block_color, 'red')
    // 인라인 색(annotations.color)은 건드리지 않는다.
    assert.equal(doc.blocks[0].title[0]?.annotations.color, 'default')
  })

  test('default 는 색을 지운다 — "기본"은 색이 아니라 색이 없는 상태다', () => {
    const a = nextId()
    let state = select(stateOf([blk(a, 'paragraph', 'A')]), a)
    state = run(state, setBlockColorCommand('green')) ?? state
    const cleared = run(state, setBlockColorCommand('default'))
    assert.ok(cleared)
    assert.equal(pmToDoc(cleared.doc).blocks[0].format?.block_color, undefined)
  })

  test('색을 못 가지는 블록은 건너뛴다 — 구분선·하위 페이지', () => {
    const [a, d, p] = [nextId(), nextId(), nextId()]
    const next = run(
      select(stateOf([blk(a, 'paragraph', 'A'), blk(d, 'divider'), blk(p, 'page', '하위')]), a, p),
      setBlockColorCommand('blue'),
    )
    assert.ok(next)
    const doc = pmToDoc(next.doc)
    assert.equal(doc.blocks[0].format?.block_color, 'blue')
    assert.equal(doc.blocks[1].format?.block_color, undefined)
    assert.equal(doc.blocks[2].format?.block_color, undefined, '프로젝터가 자식 페이지의 format 을 쓰지 않는다')
  })

  test('블록 선택이 유지된다 — 이어서 다른 조작을 할 수 있게', () => {
    const [a, b] = [nextId(), nextId()]
    const next = run(select(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a, b), setBlockColorCommand('red'))
    assert.ok(next)
    assert.ok(isBlockSelection(next.selection))
    assert.deepEqual(next.selection.blockIds, [a, b])
  })

  test('트랜잭션 하나 — undo 1회', () => {
    const [a, b] = [nextId(), nextId()]
    let count = 0
    setBlockColorCommand('red')(select(stateOf([blk(a), blk(b)]), a, b), () => {
      count += 1
    })
    assert.equal(count, 1)
  })

  test('색 이름 — 배경은 "… 배경", default 는 "기본"', () => {
    assert.equal(colorLabel('default'), '기본')
    assert.equal(colorLabel('red'), '빨강')
    assert.equal(colorLabel('red_background'), '빨강 배경')
  })
})

// ── 블록 링크 ─────────────────────────────────────────────────────────

describe('블록 링크 — 복사하는 쪽과 받는 쪽', () => {
  test('정본의 형태: /{pageId}#{blockId}', () => {
    assert.equal(blockLinkPath('w1', 'p1', 'b1'), '/w/w1/p1#b1')
  })

  test('해시가 uuid 가 아니면 무시한다 — 사용자가 아무거나 넣을 수 있다', () => {
    const id = nextId()
    assert.equal(blockIdFromHash(`#${id}`), id)
    assert.equal(blockIdFromHash('#top'), null)
    assert.equal(blockIdFromHash(''), null)
  })

  test('링크로 들어오면 그 블록이 블록 선택된다', () => {
    const [a, b] = [nextId(), nextId()]
    const next = run(stateOf([blk(a), blk(b)]), revealBlockCommand(b, deps()))
    assert.ok(next)
    assert.ok(isBlockSelection(next.selection))
    assert.deepEqual(next.selection.blockIds, [b])
  })

  test('접힌 조상 안에 있으면 조상을 펼친다 — dispatch 뒤에', () => {
    const [outer, inner, target] = [nextId(), nextId(), nextId()]
    const collapsed = new Set([outer, inner])
    const events: string[] = []
    const state = stateOf([blk(outer, 'toggle', 'O', [blk(inner, 'toggle', 'I', [blk(target)])])])
    revealBlockCommand(target, deps({
      isCollapsed: (id) => collapsed.has(id),
      expand: (id) => events.push(`expand:${id === outer ? 'O' : 'I'}`),
    }))(state, () => events.push('dispatch'))
    assert.deepEqual(events, ['dispatch', 'expand:I', 'expand:O'])
  })

  test('없는 블록이면 아무 일도 없다 — 지워진 블록의 링크', () => {
    const state = stateOf([blk(nextId())])
    assert.ok(run(state, revealBlockCommand(nextId(), deps())) === null)
  })
})

// ── Mod+/ ─────────────────────────────────────────────────────────────

describe('openBlockMenuCommand — Mod+/', () => {
  test('편집 모드면 그 블록을 먼저 블록 선택으로 만들고 연다', () => {
    const a = nextId()
    let state = stateOf([blk(a, 'paragraph', 'A')])
    const info = findContainerById(state.doc, a)
    assert.ok(info)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    let opened = 0
    const next = run(state, openBlockMenuCommand(() => {
      opened += 1
    }))
    assert.ok(next)
    assert.ok(isBlockSelection(next.selection))
    assert.equal(opened, 1)
  })

  test('dispatch 없이 물으면(가능 여부 확인) 열지 않는다', () => {
    const a = nextId()
    let opened = 0
    const handled = openBlockMenuCommand(() => {
      opened += 1
    })(select(stateOf([blk(a)]), a))
    assert.equal(handled, true)
    assert.equal(opened, 0)
  })
})
