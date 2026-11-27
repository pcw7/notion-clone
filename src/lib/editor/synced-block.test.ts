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
 *   ⑧ 수명(SB-4): 사본 하나의 해제(⑫ⓐ — 새 id · 내용이 없으면 거부) · 블록 복제는 원본을 사본으로(⑭) · 지우기 확인 · 잘라내기 알림의 원본 찾기
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

import { blockContentToApi, type BlockReadContext } from '../api/block-json.ts'
import { SYNCED_BLOCK_TYPE } from '../block/synced-block.ts'
import type { BlockType } from '../block/types.ts'
import { pageMentionRun, textRun } from '../contracts/rich-text.ts'
import { pageToMarkdown } from '../export/markdown.ts'
import { planDrop } from './block-handle.ts'
import { blockMenuItems } from './block-menu.ts'
import { BlockSelection, duplicateBlockSelectionCommand } from './block-selection.ts'
import { parseClipboardBlocks, pasteBlocksCommand, serializeBlocks, syncedCopyClipboard, CLIPBOARD_VERSION } from './block-clipboard.ts'
import { indentCommand, type CommandDeps } from './commands.ts'
import { validateDoc, type EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { filterSlashCommands, runSyncedBlockSlashCommand, slashMenuPlugin } from './slash-menu.ts'
import {
  canWrapInSyncedBlock,
  excludedAt,
  planSyncedPaste,
  syncedBlockPlugin,
  syncedOriginalsIn,
  type SyncedPasteContext,
  unsyncSyncedBlockCommand,
  unsyncSyncedCopyCommand,
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

describe('⑤ 클립보드 v2 · 붙여넣기 ⑪ⓑ~ⓔ (SB-2)', () => {
  const WS = '22222222-2222-4222-8222-000000000001'
  const PAGE = '22222222-2222-4222-8222-000000000002'
  const here = { workspaceId: WS, pageId: PAGE }
  const copyOf = (id: string, from: string): EditorBlock => blk(id, SYNCED_BLOCK_TYPE, '', [], { synced_from: from })
  const plan = (blocks: EditorBlock[], over: Partial<SyncedPasteContext> = {}) =>
    planSyncedPaste(blocks, { from: here, to: here, cut: false, insideSynced: false, hasBlock: () => false, ...over })
  /** 사본이면 `→원본`, 원본이면 `원본[자식]`, 아니면 타입. */
  const shape = (blocks: readonly EditorBlock[]): string[] =>
    blocks.map((b) =>
      b.type !== SYNCED_BLOCK_TYPE
        ? `${b.type}${(b.children?.length ?? 0) > 0 ? `[${shape(b.children!).join(',')}]` : ''}`
        : b.properties?.synced_from !== undefined
          ? `→${String(b.properties.synced_from)}`
          : `원본[${shape(b.children ?? []).join(',')}]`,
    )

  test('★ v2 모양 — 온 곳 · 잘라냄 표지를 싣고 읽는다 · v1 은 온 곳을 모르는 복사로 · 모르는 버전은 평문으로 · "복사" 단추는 사본 하나', () => {
    const [s, a] = [nextId(), nextId()]
    const state = stateOf([synced(s, [blk(a, 'paragraph', 'a')])])
    const out = serializeBlocks(state.doc, [findContainerById(state.doc, s)!.pos], here, true)
    assert.ok(out)
    const raw = JSON.parse(out.json) as Record<string, unknown>
    assert.deepEqual([raw.version, raw.workspaceId, raw.pageId, raw.cut], [2, WS, PAGE, true])
    const parsed = parseClipboardBlocks(out.json)
    assert.ok(parsed.ok)
    assert.deepEqual(parsed.origin, { workspaceId: WS, pageId: PAGE, cut: true })
    assert.deepEqual(shape(parsed.blocks), ['원본[paragraph]'], '읽기는 동기화 블록을 그대로 둔다 — 붙이는 자리가 정한다')

    const v1 = parseClipboardBlocks(JSON.stringify({ version: 1, blocks: [synced(s, [blk(a)])] }))
    assert.ok(v1.ok)
    assert.deepEqual(v1.origin, { workspaceId: null, pageId: null, cut: false }, '옛 모양은 온 곳을 모르는 복사다')
    assert.deepEqual(parseClipboardBlocks(JSON.stringify({ version: 3, blocks: [] })), { ok: false, reason: 'other_version' })
    assert.equal(CLIPBOARD_VERSION, 2)

    const button = parseClipboardBlocks(syncedCopyClipboard(s.toUpperCase(), here))
    assert.ok(button.ok)
    assert.deepEqual(shape(button.blocks), [`→${s}`], '원본의 "복사" 단추 — 소문자 uuid 의 사본 하나')
  })

  test('★ ⓑ 복사 → 붙이기 — 원본이든 사본이든 같은 원본의 새 사본(같은 페이지여도 · 깊이 상관없이) · 붙이면 새 id · 검증을 지난다', () => {
    const [s, a, s2, c, t, s3, b] = [nextId(), nextId(), nextId(), nextId(), nextId(), nextId(), nextId()]
    const planned = plan([synced(s, [blk(a, 'paragraph', 'a')]), copyOf(c, s2), blk(t, 'toggle', 't', [synced(s3, [blk(b)])])])
    assert.deepEqual(shape(planned.blocks), [`→${s}`, `→${s2}`, `toggle[→${s3}]`])
    assert.deepEqual([planned.keepIds.size, planned.unwrapped, planned.dropped], [0, 0, 0])
    // 다른 페이지 · v1(온 곳 모름)도 같다
    assert.deepEqual(shape(plan([synced(s, [blk(a)])], { from: { workspaceId: null, pageId: null } }).blocks), [`→${s}`])

    const [p] = [nextId()]
    const next = run(caretIn(stateOf([blk(p, 'paragraph', '')]), p, 0), pasteBlocksCommand(planned.blocks, { isCollapsed: () => false, newId: nextId }))
    assert.ok(next !== null)
    const doc = pmToDoc(next.doc)
    assert.deepEqual(validateDoc(doc), [])
    const copies = doc.blocks.filter((x) => x.type === SYNCED_BLOCK_TYPE)
    assert.deepEqual(copies.map((x) => x.properties?.synced_from), [s, s2])
    assert.ok(copies.every((x) => x.id !== s && x.id !== c && (x.children?.length ?? 0) === 0), '새 id · 자식 없음(SY1 · SY4)')
  })

  test('★ ⓒ 잘라 붙이기 — 같은 페이지 · 문서에 X 가 없으면 같은 id(사본이 이어진다) · 있으면 · 다른 페이지면 새 원본(새 id · 내용)', () => {
    const [s, a, c, s2] = [nextId(), nextId(), nextId(), nextId()]
    const cut = { cut: true }
    const restored = plan([synced(s, [blk(a, 'paragraph', 'a')]), copyOf(c, s2)], cut)
    assert.deepEqual(shape(restored.blocks), ['원본[paragraph]', `→${s2}`])
    assert.deepEqual([...restored.keepIds], [s])
    const p = nextId()
    const next = run(
      caretIn(stateOf([blk(p, 'paragraph', '')]), p, 0),
      pasteBlocksCommand(restored.blocks, { isCollapsed: () => false, newId: nextId }, restored.keepIds),
    )
    assert.ok(next !== null)
    const doc = pmToDoc(next.doc)
    const back = doc.blocks.find((x) => x.type === SYNCED_BLOCK_TYPE && x.properties?.synced_from === undefined)
    assert.equal(back?.id, s, '같은 id 로 되살렸다')
    assert.notEqual(back?.children?.[0]?.id, a, '자식은 새 id')
    assert.deepEqual(validateDoc(doc), [])

    assert.equal(plan([synced(s, [blk(a)])], { ...cut, hasBlock: (id) => id === s }).keepIds.size, 0, '이 문서에 아직 있으면 새 원본')
    const elsewhere = plan([synced(s, [blk(a)])], { ...cut, to: { workspaceId: WS, pageId: nextId() } })
    assert.deepEqual([shape(elsewhere.blocks), elsewhere.keepIds.size], [['원본[paragraph]'], 0], '다른 페이지 — 새 원본(새 id · 붙인 내용)')
  })

  test('★ ⓓ 동기화 블록 안 · ⓔ 다른 워크스페이스 — 원본은 내용만 펴고 사본은 뺀다 · 수를 센다', () => {
    const [s, a, c, s2, t, s3, b] = [nextId(), nextId(), nextId(), nextId(), nextId(), nextId(), nextId()]
    const blocks = [synced(s, [blk(a, 'paragraph', 'a')]), copyOf(c, s2), blk(t, 'toggle', 't', [synced(s3, [blk(b)])])]
    const inside = plan(blocks, { insideSynced: true })
    assert.deepEqual(shape(inside.blocks), ['paragraph', 'toggle[paragraph]'])
    assert.deepEqual([inside.unwrapped, inside.dropped], [2, 1])
    const other = plan(blocks, { from: { workspaceId: nextId(), pageId: nextId() }, cut: true })
    assert.deepEqual(shape(other.blocks), ['paragraph', 'toggle[paragraph]'], '다른 워크스페이스 — 잘라냈어도')
    assert.deepEqual([other.unwrapped, other.dropped, other.keepIds.size], [2, 1, 0])

    // 붙이는 자리가 동기화 블록 안인지는 조상이 배제하는 타입으로 본다(클립보드 플러그인이 쓰는 물음)
    const [o, x, q] = [nextId(), nextId(), nextId()]
    const state = stateOf([synced(o, [blk(x, 'paragraph', 'x')]), blk(q, 'paragraph', 'q')])
    assert.equal(excludedAt(caretIn(state, x, 0).selection.$from).has(SYNCED_BLOCK_TYPE), true)
    assert.equal(excludedAt(caretIn(state, q, 0).selection.$from).has(SYNCED_BLOCK_TYPE), false)
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

  test('★ 공개 API 읽기 — 원본은 synced_from: null · has_children · 사본은 block_id(SB-2) · 자식 없음', () => {
    const read: BlockReadContext = { links: {} as BlockReadContext['links'], refs: new Map(), fileNames: new Map(), columnWidths: new Map() }
    const [s, a, c] = [nextId(), nextId(), nextId()]
    assert.deepEqual(blockContentToApi(synced(s, [blk(a)]), read), { type: 'synced_block', payload: { synced_from: null }, hasChildren: true })
    assert.deepEqual(blockContentToApi(blk(c, SYNCED_BLOCK_TYPE, '', [], { synced_from: s }), read), {
      type: 'synced_block',
      payload: { synced_from: { type: 'block_id', block_id: s } },
      hasChildren: false,
    })
    // 모양이 틀린 사본(정규화가 빼므로 오지 않는다) — 거짓 id 를 싣지 않는다
    assert.equal(blockContentToApi(blk(c, SYNCED_BLOCK_TYPE, '', [], { synced_from: c }), read).type, 'unsupported')
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

describe('⑧ 수명 (SB-4 · ⑪ⓒ ⑫ⓐ ⑬ ⑭)', () => {
  const copyOf = (id: string, from: string): EditorBlock => blk(id, SYNCED_BLOCK_TYPE, '', [], { synced_from: from })
  const P = '33333333-3333-4333-8333-000000000001'
  /** 원본 X(글 둘 — 멘션 하나) · 사본(X) · 끝 줄. */
  function scene() {
    const [x, a1, a2, cp, end] = [nextId(), nextId(), nextId(), nextId(), nextId()]
    const state = stateOf([
      synced(x, [blk(a1, 'paragraph', '원본 글'), { ...blk(a2, 'toggle', ''), title: [textRun('보기 '), pageMentionRun(P)], children: [blk(nextId(), 'paragraph', '깊은 글')] }]),
      copyOf(cp, x),
      blk(end, 'paragraph', '끝'),
    ])
    return { state, x, a1, a2, cp, end }
  }
  /** X 의 그룹 — 사본의 중첩 편집기가 보이는 내용과 같은 노드들. */
  const groupOf = (state: EditorState, x: string) => {
    const nodes: import('@tiptap/pm/model').Node[] = []
    findContainerById(state.doc, x)!.groupNode!.forEach((n) => void nodes.push(n))
    return nodes
  }

  test('★ ⑫ⓐ 사본 하나의 해제 — 사본 자리를 X 의 내용으로(새 id · 멘션 그대로 · 깊이까지) · 한 트랜잭션 · 내용이 없으면(A 를 볼 수 없다) 거부', () => {
    const { state, x, a1, a2, cp } = scene()
    assert.ok(run(state, unsyncSyncedCopyCommand(cp, null, nextId)) === null, '내용이 없으면(자리) 거부한다')
    assert.ok(run(state, unsyncSyncedCopyCommand(x, groupOf(state, x), nextId)) === null, '원본은 이 명령이 아니다')
    const next = run(state, unsyncSyncedCopyCommand(cp, groupOf(state, x), nextId))
    assert.ok(next !== null)
    const blocks = pmToDoc(next.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), [SYNCED_BLOCK_TYPE, 'paragraph', 'toggle', 'paragraph'], '사본 자리에 X 의 블록 둘')
    const [, p, t] = blocks
    assert.ok(p.id !== a1 && t.id !== a2 && t.children![0].id !== findContainerById(state.doc, a2)!.groupNode!.child(0).attrs.blockId, '새 id — 어디서도 X 의 id 가 둘이 되지 않는다(SY1)')
    assert.equal(p.title[0].plain_text, '원본 글')
    assert.equal(t.title[1].type, 'mention', '페이지 멘션 그대로')
    assert.equal(t.children![0].title[0].plain_text, '깊은 글')
    assert.ok(findContainerById(next.doc, x) !== null && findContainerById(next.doc, cp) === null, '원본은 그대로 · 사본만 바뀐다')
    assert.equal(validateDoc(pmToDoc(next.doc)).length, 0)
  })

  test('★ ⑭ 블록 복제(Mod+D) — 원본 X 의 복제는 X 의 사본(자식 없음) · 토글 안의 원본도 · 사본의 복제는 같은 원본의 사본', () => {
    const { state, x, cp } = scene()
    const dup = (s: EditorState) => run(s, duplicateBlockSelectionCommand({ ...deps, newId: nextId }))
    const afterX = dup(select(state, x))
    assert.ok(afterX !== null)
    const top = pmToDoc(afterX.doc).blocks
    assert.deepEqual(top[1].properties, { synced_from: x }, 'X 바로 뒤에 X 의 사본')
    assert.deepEqual(top[1].children ?? [], [])
    assert.equal(top.filter((b) => b.type === SYNCED_BLOCK_TYPE && !b.properties?.synced_from).length, 1, '원본은 하나뿐이다')
    const afterCopy = dup(select(state, cp))
    assert.deepEqual(pmToDoc(afterCopy!.doc).blocks[2].properties, { synced_from: x })
    const [t, y, in1] = [nextId(), nextId(), nextId()]
    const nested = dup(select(stateOf([blk(t, 'toggle', '토글', [synced(y, [blk(in1, 'paragraph', '안')])])]), t))
    assert.deepEqual(pmToDoc(nested!.doc).blocks[1].children?.[0].properties, { synced_from: y }, '깊이 상관없이')
  })

  test('★ ⑬ ⑪ⓒ 원본 찾기 — 고른 블록의 서브트리(어느 깊이든)의 원본만 · 사본은 아니다 · 메뉴의 "동기화 해제" 는 사본에도 켜진다', () => {
    const { state, x, cp, end } = scene()
    const [t, y] = [nextId(), nextId()]
    const withToggle = stateOf([...pmToDoc(state.doc).blocks, blk(t, 'toggle', '토글', [synced(y, [blk(nextId(), 'paragraph', '안')])])])
    const roots = (s: EditorState, ids: string[]) => ids.map((id) => findContainerById(s.doc, id)!.pos)
    assert.deepEqual(syncedOriginalsIn(withToggle.doc, roots(withToggle, [x, cp, end, t])), [x, y])
    assert.deepEqual(syncedOriginalsIn(withToggle.doc, roots(withToggle, [cp, end])), [])
    assert.equal(blockMenuItems(select(state, cp), deps).find((i) => i.id === 'synced_unsync')?.enabled, true)
  })
})
