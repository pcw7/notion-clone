/**
 * 동기화 블록 — 편집기 · 검증 · 읽는 길 (SB-1 · F-01-11 · 정본 §3.4 [보강 SB-0] · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 바꾸기 → 동기화 블록(⑪ⓐ): 같은 부모의 이웃 블록들을 새 원본으로 감싼다 · 이미 동기화 블록 안이거나 고른 것에 하위 페이지 · 동기화
 *      블록이 있으면 서지 않는다
 *   ② `/동기화 블록`: 빈 원본 · 동기화 블록 안에서는 목록에 동기화 블록 · 페이지 · 데이터베이스 명령이 서지 않는다
 *   ③ 동기화 해제(⑫ⓒ): 껍데기를 벗겨 자식을 제자리에(id 그대로)
 *   ④ SY5 가드: 끌어 넣기 · 들여쓰기 · 아무 트랜잭션이든 동기화 블록 안에 동기화 블록 · 하위 페이지를 두면 거부 · 원격은 보지 않는다
 *   ⑤ 붙여넣기: 동기화 블록은 내용만 편다
 *   ⑥ 자식 없는 원본: 마지막 자식을 지우면 빈 문단이 선다
 *   ⑦ 검증(`validateDoc`)이 정규화 ⑥ 의 모양을 거부한다 · 공개 API 읽기 · 마크다운 펴기
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

import { blockContentToApi, type BlockReadContext } from '../api/block-json.ts'
import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import type { BlockType } from '../block/types.ts'
import { textRun } from '../contracts/rich-text.ts'
import { pageToMarkdown } from '../export/markdown.ts'
import { planDrop } from './block-handle.ts'
import { blockMenuItems } from './block-menu.ts'
import { BlockSelection } from './block-selection.ts'
import { parseClipboardBlocks, CLIPBOARD_VERSION } from './block-clipboard.ts'
import { indentCommand, type CommandDeps } from './commands.ts'
import { validateDoc, type EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { filterSlashCommands, runSyncedBlockSlashCommand, slashMenuPlugin } from './slash-menu.ts'
import {
  canWrapInSyncedBlock,
  excludedAt,
  syncedBlockPlugin,
  unsyncSyncedBlockCommand,
  wrapInSyncedBlockCommand,
} from './synced-block.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(id: string, type: BlockType = 'paragraph', text = '', children: EditorBlock[] = [], properties: Record<string, unknown> = {}): EditorBlock {
  return { id, type, title: text === '' ? [] : [textRun(text)], properties, format: {}, children }
}
const synced = (id: string, children: EditorBlock[]): EditorBlock => blk(id, SYNCED_BLOCK_TYPE, '', children)

const notices: string[] = []
function stateOf(blocks: EditorBlock[], remote?: (tr: Transaction) => boolean): EditorState {
  return EditorState.create({
    schema: blockSchema,
    doc: docToPm({ blocks }),
    plugins: [slashMenuPlugin(), syncedBlockPlugin({ isRemoteChange: remote, onNotice: (m) => notices.push(m), newId: nextId })],
  })
}

function select(state: EditorState, anchorId: string, headId = anchorId): EditorState {
  const a = findContainerById(state.doc, anchorId)
  const h = findContainerById(state.doc, headId)
  assert.ok(a && h)
  return state.apply(state.tr.setSelection(BlockSelection.create(state.doc, a.pos, h.pos)))
}

function caretIn(state: EditorState, id: string, offset = 0): EditorState {
  const info = findContainerById(state.doc, id)
  assert.ok(info)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1 + offset)))
}

/** 명령을 돌린 다음 상태 — 거부(false)면 null. 결과는 `assert.ok(x === null)` 로 본다(EditorState 를 inspect 하면 멈춘다). */
function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

/** `A[원본](B C) D` 꼴. 동기화 블록은 `[원본]`, 하위 페이지는 `[페이지]`. */
function shape(state: EditorState, names: Record<string, string>): string {
  const walk = (list: readonly EditorBlock[]): string =>
    list
      .map((b) => {
        const kind = b.type === SYNCED_BLOCK_TYPE ? '[원본]' : b.type === 'page' ? '[페이지]' : ''
        const kids = b.children?.length ? `(${walk(b.children)})` : ''
        return `${names[b.id] ?? '?'}${kind}${kids}`
      })
      .join(' ')
  return walk(pmToDoc(state.doc).blocks)
}

const deps: CommandDeps = { isCollapsed: () => false, newId: nextId }

describe('① 바꾸기 → 동기화 블록', () => {
  test('★ 이웃 블록 둘을 새 원본으로 감싼다 — 한 트랜잭션 · 원본이 블록 선택으로 남는다 · 검증을 지난다', () => {
    const [a, b, c] = [nextId(), nextId(), nextId()]
    const state = select(stateOf([blk(a, 'paragraph', 'a'), blk(b, 'toggle', 'b'), blk(c, 'paragraph', 'c')]), a, b)
    assert.equal(canWrapInSyncedBlock(state), true)
    const menu = blockMenuItems(state, deps).find((i) => i.id === 'turn_into')?.children?.find((i) => i.id === 'turn_into:synced_block')
    assert.equal(menu?.enabled, true)
    const next = run(state, wrapInSyncedBlockCommand(nextId))
    assert.ok(next !== null)
    assert.equal(shape(next, { [a]: 'A', [b]: 'B', [c]: 'C' }), '?[원본](A B) C')
    assert.deepEqual(validateDoc(pmToDoc(next.doc)), [])
    assert.equal(pmToDoc(next.doc).blocks[0]!.properties && Object.keys(pmToDoc(next.doc).blocks[0]!.properties!).length, 0, '원본은 속성이 비었다')
  })

  test('★ 이미 동기화 블록 안 · 고른 것에 하위 페이지 · 동기화 블록이 있으면 서지 않는다(SY5)', () => {
    const [s, a, p, s2, x] = [nextId(), nextId(), nextId(), nextId(), nextId()]
    const inside = select(stateOf([synced(s, [blk(a, 'paragraph', 'a')])]), a)
    assert.equal(canWrapInSyncedBlock(inside), false, '이미 동기화 블록 안')
    const withPage = select(stateOf([blk(x, 'toggle', 'x', [blk(p, 'page')])]), x)
    assert.equal(canWrapInSyncedBlock(withPage), false, '서브트리에 하위 페이지')
    const withSynced = select(stateOf([synced(s2, [blk(a, 'paragraph', 'a')])]), s2)
    assert.equal(canWrapInSyncedBlock(withSynced), false, '동기화 블록째')
    assert.ok(run(withPage, wrapInSyncedBlockCommand(nextId)) === null)
  })

  test('블록 선택이 아니면 서지 않는다 — 메뉴는 블록 선택에서 열린다', () => {
    const a = nextId()
    assert.equal(canWrapInSyncedBlock(caretIn(stateOf([blk(a, 'paragraph', 'a')]), a)), false)
  })
})

describe('② /동기화 블록', () => {
  test('★ 빈 줄에서 — 그 줄이 새 원본의 첫 자식(id 그대로)이 되고 캐럿이 그 안에', () => {
    const a = nextId()
    let state = caretIn(stateOf([blk(a, 'paragraph', '')]), a)
    state = state.apply(state.tr.insertText('/'))
    state = state.apply(state.tr.insertText('동기화'))
    let inserted: string | null = null
    const next = run(state, (s, dispatch) => (inserted = runSyncedBlockSlashCommand(s, dispatch, nextId)) !== null)
    assert.ok(next !== null && inserted !== null)
    assert.equal(shape(next, { [a]: 'A', [inserted]: 'S' }), 'S[원본](A)')
    const caretBlock = findContainerById(next.doc, a)
    assert.ok(caretBlock && next.selection.from === caretBlock.contentPos + 1, '캐럿이 원본 안의 문단에')
  })

  test('★ 동기화 블록 안에서는 동기화 블록 · 페이지 · 데이터베이스 명령이 목록에 서지 않는다', () => {
    const [s, a] = [nextId(), nextId()]
    const state = caretIn(stateOf([synced(s, [blk(a, 'paragraph', '')])]), a)
    const excluded = excludedAt(state.selection.$from)
    const kinds = new Set(filterSlashCommands('', excluded).map((c) => c.kind))
    for (const kind of ['synced_block', 'page', 'database', 'linked_database', 'wiki']) assert.ok(!kinds.has(kind as never), kind)
    assert.ok(kinds.has('block') && kinds.has('columns'), '보통의 블록 · 컬럼은 선다(01 F-01-12)')
    assert.equal(filterSlashCommands('동기화', excluded).length, 0)
    assert.equal(filterSlashCommands('동기화').length, 1, '밖에서는 선다')
  })
})

describe('③ 동기화 해제 (사본 없는 원본)', () => {
  test('★ 껍데기를 벗겨 자식을 제자리에 — id 그대로 · 메뉴 항목은 원본 하나일 때만 켜진다', () => {
    const [s, a, b, c] = [nextId(), nextId(), nextId(), nextId()]
    const state = select(stateOf([synced(s, [blk(a, 'paragraph', 'a'), blk(b, 'toggle', 'b')]), blk(c, 'paragraph', 'c')]), s)
    assert.equal(blockMenuItems(state, deps).find((i) => i.id === 'synced_unsync')?.enabled, true)
    assert.equal(blockMenuItems(select(state, c), deps).find((i) => i.id === 'synced_unsync')?.enabled, false)
    const next = run(state, unsyncSyncedBlockCommand(s, nextId))
    assert.ok(next !== null)
    assert.equal(shape(next, { [a]: 'A', [b]: 'B', [c]: 'C' }), 'A B C')
    assert.ok(run(next, unsyncSyncedBlockCommand(a, nextId)) === null, '원본이 아니면 거부')
  })
})

describe('④ 중첩 가드 (SY5)', () => {
  test('★ 동기화 블록을 다른 동기화 블록 안으로 끌어 넣지 못한다 · 하위 페이지도 — 계획이 거부한다', () => {
    const [s1, a, s2, b, p] = [nextId(), nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([synced(s1, [blk(a, 'paragraph', 'a')]), synced(s2, [blk(b, 'paragraph', 'b')]), blk(p, 'page')])
    const none = () => false
    assert.equal(planDrop(state.doc, [s2], { kind: 'child', blockId: s1 }, none).kind, 'invalid_target', '원본의 자식 자리')
    assert.equal(planDrop(state.doc, [s2], { kind: 'after', blockId: a }, none).kind, 'invalid_target', '원본 안의 블록 뒤')
    assert.equal(planDrop(state.doc, [p], { kind: 'before', blockId: a }, none).kind, 'invalid_target', '하위 페이지')
    assert.equal(planDrop(state.doc, [s2], { kind: 'after', blockId: s1 }, none).kind, 'drop', '동기화 블록의 형제 자리는 된다')
  })

  test('★ 가드 — 어떤 트랜잭션이든 동기화 블록 안에 하위 페이지를 두면 문서가 그대로다(알린다) · 원격은 보지 않는다', () => {
    const [s, a, p] = [nextId(), nextId(), nextId()]
    const blocks = [synced(s, [blk(a, 'paragraph', 'a')]), blk(p, 'page')]
    const move = (state: EditorState): Transaction => {
      const ref = findContainerById(state.doc, p)!
      const inner = findContainerById(state.doc, a)!
      const node = ref.node
      return state.tr.delete(ref.pos, ref.pos + node.nodeSize).insert(inner.pos + inner.node.nodeSize, node)
    }
    const local = stateOf(blocks)
    const before = notices.length
    const after = local.apply(move(local))
    assert.ok(after.doc.eq(local.doc), '로컬 편집은 거부된다')
    assert.equal(notices.length, before + 1)
    const remote = stateOf(blocks, () => true)
    assert.ok(!remote.apply(move(remote)).doc.eq(remote.doc), '원격(Y.Doc 에서 온 것)은 정규화가 고친다 — 가드는 보지 않는다')
  })

  test('★ 들여쓰기(Tab)로 하위 페이지가 든 토글을 동기화 블록 밑으로 넣지 못한다', () => {
    const [s, a, t, p] = [nextId(), nextId(), nextId(), nextId()]
    const state = caretIn(stateOf([synced(s, [blk(a, 'paragraph', 'a')]), blk(t, 'toggle', '토글', [blk(p, 'page')])]), t)
    const next = run(state, indentCommand(deps))
    assert.ok(next === null || next.doc.eq(state.doc), '문서가 그대로다')
    // 하위 페이지가 없는 토글은 들어간다 — 가드가 보통의 편집을 막지 않는다
    const [s2, a2, t2] = [nextId(), nextId(), nextId()]
    const plain = caretIn(stateOf([synced(s2, [blk(a2, 'paragraph', 'a')]), blk(t2, 'toggle', '토글')]), t2)
    const moved = run(plain, indentCommand(deps))
    assert.ok(moved !== null && !moved.doc.eq(plain.doc))
  })

  test('동기화 블록 안의 타이핑은 막지 않는다', () => {
    const [s, a] = [nextId(), nextId()]
    const state = caretIn(stateOf([synced(s, [blk(a, 'paragraph', 'a')])]), a, 1)
    const next = state.apply(state.tr.insertText('bc'))
    assert.equal(pmToDoc(next.doc).blocks[0]!.children![0]!.title.map((r) => r.plain_text).join(''), 'abc')
  })
})

describe('⑤ 붙여넣기', () => {
  test('★ 붙이는 동기화 블록은 내용만 편다 — 원본은 자식을, 사본은 뺀다', () => {
    const [s, a, b] = [nextId(), nextId(), nextId()]
    const json = JSON.stringify({
      version: CLIPBOARD_VERSION,
      blocks: [synced(s, [blk(a, 'paragraph', 'a')]), blk(b, SYNCED_BLOCK_TYPE, '', [], { synced_from: nextId() })],
    })
    const parsed = parseClipboardBlocks(json)
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.blocks.map((x) => x.id), [a])
    assert.equal(parsed.unwrapped, 2)
  })
})

describe('⑥ 자식 없는 원본', () => {
  test('★ 마지막 자식을 지우면 빈 문단이 선다 — 원본이 남는다', () => {
    const [s, a] = [nextId(), nextId()]
    const state = stateOf([synced(s, [blk(a, 'paragraph', 'a')])])
    const info = findContainerById(state.doc, s)!
    const next = state.apply(state.tr.delete(info.groupPos!, info.groupPos! + info.groupNode!.nodeSize))
    const [top] = pmToDoc(next.doc).blocks
    assert.equal(top!.type, SYNCED_BLOCK_TYPE)
    assert.equal(top!.children?.length, 1)
    assert.equal(top!.children![0]!.type, 'paragraph')
    assert.deepEqual(validateDoc(pmToDoc(next.doc)), [])
  })
})

describe('⑦ 검증 · 읽는 길', () => {
  test('★ 검증은 정규화 ⑥ 이 고치는 모양을 거부한다 — 중첩(어느 깊이든) · 자식 없는 원본 · 자식 있는 사본 · 모양이 틀린 synced_from · 다른 키', () => {
    const issues = (blocks: EditorBlock[]): string => validateDoc({ blocks }).map((i) => i.message).join(' | ')
    const [s, s2, a, p, t] = [nextId(), nextId(), nextId(), nextId(), nextId()]
    assert.match(issues([synced(s, [blk(t, 'toggle', 't', [synced(s2, [blk(a)])])])]), /동기화 블록 안에는 synced_block/)
    assert.match(issues([synced(s, [blk(t, 'toggle', 't', [blk(p, 'page')])])]), /동기화 블록 안에는 page/)
    assert.match(issues([synced(s, [])]), /하나 이상/)
    assert.match(issues([blk(s, SYNCED_BLOCK_TYPE, '', [blk(a)], { synced_from: nextId() })]), /사본은 자식을/)
    assert.match(issues([blk(s, SYNCED_BLOCK_TYPE, '', [], { synced_from: 'x' })]), /uuid/)
    assert.match(issues([blk(s, SYNCED_BLOCK_TYPE, '', [], { synced_from: s })]), /uuid/)
    assert.match(issues([blk(s, SYNCED_BLOCK_TYPE, '', [blk(a)], { stray: 1 })]), /하나뿐/)
    assert.equal(issues([synced(s, [blk(a)]), blk(p, 'page')]), '', '형제 자리의 하위 페이지는 된다')
  })

  test('★ 공개 API 읽기 — 원본은 synced_from: null · has_children · 사본은 SB-2 전까지 unsupported', () => {
    const read: BlockReadContext = { links: {} as BlockReadContext['links'], refs: new Map(), fileNames: new Map(), columnWidths: new Map() }
    const [s, a, c] = [nextId(), nextId(), nextId()]
    assert.deepEqual(blockContentToApi(synced(s, [blk(a)]), read), { type: 'synced_block', payload: { synced_from: null }, hasChildren: true })
    assert.equal(blockContentToApi(blk(c, SYNCED_BLOCK_TYPE, '', [], { synced_from: s }), read).type, 'unsupported')
  })

  test('★ 마크다운 — 원본은 감싸개 없이 내용을 편다(잃은 것이 아니다)', () => {
    const [s, a, b] = [nextId(), nextId(), nextId()]
    const { markdown, losses } = pageToMarkdown(
      { title: [textRun('T')], doc: { blocks: [blk(b, 'paragraph', '앞'), synced(s, [blk(a, 'paragraph', '동기화 내용')])] } },
      { page: () => null, image: () => null },
      { untitled: '제목 없음' },
    )
    assert.equal(markdown, '# T\n\n앞\n\n동기화 내용\n')
    assert.equal(losses.unsupported, 0)
  })
})
