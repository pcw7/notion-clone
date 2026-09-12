/**
 * 이미지 드롭 · 붙여넣기 — F-01-15
 *
 * 이 파일이 지키는 것 셋.
 *
 *   ① **이미지가 아닌 파일은 받지 않되 조용히 버리지 않는다.** 사용자가 끌어다
 *      놓은 파일이 어디로 갔는지 모르는 상태를 만들지 않는다.
 *   ② **자식이 있는 블록 위에 놓아도 자식이 딸려가지 않는다** (§7-4 최빈 버그).
 *      그리고 **줄을 쪼개지 않는다** — 원자 블록을 `replaceSelection` 에 맡기면
 *      캐럿 자리에서 문단이 갈라져 빈 줄이 남는다(이 파일이 실제로 잡았다).
 *   ③ **파일은 블록보다 먼저 큐에 들어간다.** 노드 뷰는 dispatch 하는 그 순간
 *      만들어지므로, 순서가 뒤집히면 놓은 이미지가 영영 올라가지 않는다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { blockSchema } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { BlockSelection } from './block-selection.ts'
import { readImageSource } from '../block/image.ts'
import type { EditorBlock } from './document.ts'
import type { CommandDeps } from './commands.ts'
import type { BlockType } from '../block/types.ts'
import {
  emptyImageBlock,
  insertImageBlocksCommand,
  partitionImageFiles,
  queueUpload,
  rejectionNotice,
  takeQueuedUpload,
} from './image-drop.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type: BlockType = 'paragraph', text = '', children: EditorBlock[] = []): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties: {}, format: {}, children }
}

const stateOf = (blocks: EditorBlock[]): EditorState =>
  EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })

function caretIn(state: EditorState, blockId: string): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
}

/** 실패해도 멈추지 않게 `assert.ok(x === null)` 로 본다(HANDOFF §5). */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

function shape(state: EditorState): string {
  const parts: string[] = []
  const walk = (blocks: readonly EditorBlock[], prefix: string): void => {
    for (const b of blocks) {
      const name = b.type === 'image' ? '[이미지]' : toPlainText(b.title ?? []) || '·'
      parts.push(prefix + name)
      if (b.children?.length) walk(b.children, `${prefix}${name} > `)
    }
  }
  walk(pmToDoc(state.doc).blocks, '')
  return parts.join(' | ')
}

const deps = (extra: Partial<CommandDeps> = {}): CommandDeps => ({ isCollapsed: () => false, ...extra })

const png = (name = 'a.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const other = (name: string, type: string) => new File([new Uint8Array([1])], name, { type })

describe('★ 무엇을 받는가', () => {
  test('허용 목록의 이미지만 받는다', () => {
    const result = partitionImageFiles([png(), other('a.pdf', 'application/pdf'), png('b.png')])
    assert.equal(result.images.length, 2)
    assert.equal(result.rejected, 1)
  })

  test('SVG 는 이미지처럼 보이지만 받지 않는다 — 스크립트를 품을 수 있다', () => {
    const result = partitionImageFiles([other('a.svg', 'image/svg+xml')])
    assert.equal(result.images.length, 0)
    assert.equal(result.rejected, 1)
  })

  test('MIME 이 비어 있으면 받지 않는다 — 확장자로 추측하지 않는다', () => {
    assert.equal(partitionImageFiles([other('사진.png', '')]).images.length, 0)
  })

  test('파일이 없으면 아무것도 아니다 — 평범한 붙여넣기로 넘어간다', () => {
    assert.deepEqual(partitionImageFiles(null), { images: [], rejected: 0 })
    assert.deepEqual(partitionImageFiles([]), { images: [], rejected: 0 })
  })

  test('★ 거부한 것은 조용히 버리지 않고 개수를 말한다', () => {
    assert.ok(rejectionNotice(2).includes('2개'))
  })
})

describe('놓을 자리 — 붙여넣기와 같은 규칙', () => {
  test('빈 이미지 블록이 만들어진다 — 아직 아무것도 가리키지 않는다', () => {
    const block = emptyImageBlock(nextId())
    assert.equal(block.type, 'image')
    assert.equal(readImageSource(block.properties), null)
  })

  test('캐럿이 있는 블록 다음 줄에 들어간다', () => {
    const [a, b] = [nextId(), nextId()]
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')]), a)
    const next = run(state, insertImageBlocksCommand([nextId()], deps()))
    assert.ok(next !== null, '커맨드가 거부됐다')
    assert.equal(shape(next), 'A | [이미지] | B')
  })

  test('★ 자식이 있는 블록에 놓아도 자식이 딸려가지 않는다 (§7-4 최빈 버그)', () => {
    const [t, c] = [nextId(), nextId()]
    const state = caretIn(stateOf([blk(t, 'toggle', 'T', [blk(c, 'paragraph', 'c1')])]), t)
    const next = run(state, insertImageBlocksCommand([nextId()], deps()))
    assert.ok(next !== null)
    // 펼쳐진 자식이 있으면 **첫 자식** 자리다 — 화면에서 바로 다음 줄.
    assert.equal(shape(next), 'T | T > [이미지] | T > c1')
  })

  test('접힌 토글에 놓으면 그 블록 뒤로 간다 — 접힌 안쪽에 숨지 않는다', () => {
    const [t, c] = [nextId(), nextId()]
    const state = caretIn(stateOf([blk(t, 'toggle', 'T', [blk(c, 'paragraph', 'c1')])]), t)
    const next = run(state, insertImageBlocksCommand([nextId()], deps({ isCollapsed: () => true })))
    assert.ok(next !== null)
    assert.equal(shape(next), 'T | T > c1 | [이미지]')
  })

  test('여러 장을 한꺼번에 놓으면 순서대로 들어간다', () => {
    const a = nextId()
    const ids = [nextId(), nextId(), nextId()]
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A')]), a)
    const next = run(state, insertImageBlocksCommand(ids, deps()))
    assert.ok(next !== null)
    assert.equal(shape(next), 'A | [이미지] | [이미지] | [이미지]')
  })

  test('★ 준 id 를 그대로 쓴다 — 그래야 올릴 파일과 짝지을 수 있다', () => {
    const a = nextId()
    const ids = [nextId(), nextId()]
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A')]), a)
    const next = run(state, insertImageBlocksCommand(ids, deps()))
    assert.ok(next !== null)
    for (const id of ids) assert.ok(findContainerById(next.doc, id), `${id} 를 찾지 못했다`)
  })

  test('★ 비워 둔 줄에 놓으면 그 줄을 대체한다 — 빈 줄이 하나 더 생기지 않게', () => {
    const [a, empty] = [nextId(), nextId()]
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A'), blk(empty)]), empty)
    const next = run(state, insertImageBlocksCommand([nextId()], deps()))
    assert.ok(next !== null)
    assert.equal(shape(next), 'A | [이미지]')
  })

  test('★ 줄 맨 앞에 캐럿이 있어도 그 줄을 쪼개지 않는다', () => {
    // 닫힌 슬라이스를 `replaceSelection` 에 넘기면 여기서 `· | [이미지] | A` 가
    // 된다 — 원자 블록이라 양끝을 열 수 없기 때문이다. 그래서 넣기만 한다.
    const a = nextId()
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A')]), a)
    const next = run(state, insertImageBlocksCommand([nextId()], deps()))
    assert.ok(next !== null)
    assert.equal(shape(next), 'A | [이미지]')
  })

  test('블록 선택 위에 놓으면 고른 블록을 대체한다 — 붙여넣기와 같다', () => {
    const [a, b] = [nextId(), nextId()]
    const base = stateOf([blk(a, 'paragraph', 'A'), blk(b, 'paragraph', 'B')])
    const infoA = findContainerById(base.doc, a)
    const infoB = findContainerById(base.doc, b)
    assert.ok(infoA && infoB)
    const state = base.apply(base.tr.setSelection(BlockSelection.create(base.doc, infoA.pos, infoB.pos)))
    const next = run(state, insertImageBlocksCommand([nextId()], deps()))
    assert.ok(next !== null)
    assert.equal(shape(next), '[이미지]')
  })

  test('파일이 없으면 아무 일도 하지 않는다', () => {
    const a = nextId()
    const state = caretIn(stateOf([blk(a, 'paragraph', 'A')]), a)
    assert.ok(run(state, insertImageBlocksCommand([], deps())) === null)
  })
})

describe('올릴 파일 큐 — 에디터마다 따로', () => {
  // 큐는 view 를 **열쇠로만** 쓴다(WeakMap). 그래서 진짜 EditorView 가 필요 없다.
  const fakeView = () => ({}) as EditorView

  test('넣은 것을 그 블록이 가져간다', () => {
    const view = fakeView()
    const file = png()
    queueUpload(view, 'b1', file)
    assert.equal(takeQueuedUpload(view, 'b1'), file)
  })

  test('★ 한 번만 가져간다 — 두 번 올리지 않는다', () => {
    const view = fakeView()
    queueUpload(view, 'b1', png())
    takeQueuedUpload(view, 'b1')
    assert.equal(takeQueuedUpload(view, 'b1'), null)
  })

  test('다른 에디터의 큐를 보지 않는다', () => {
    const [one, two] = [fakeView(), fakeView()]
    queueUpload(one, 'b1', png())
    assert.equal(takeQueuedUpload(two, 'b1'), null)
    assert.ok(takeQueuedUpload(one, 'b1'))
  })

  test('큐에 없는 블록은 null — 평범한 빈 이미지 블록이다', () => {
    assert.equal(takeQueuedUpload(fakeView(), '없는블록'), null)
  })
})
