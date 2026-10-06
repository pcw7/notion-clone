/**
 * 컬럼 — 저장 모양 · 정규화 · 검증 · 만들기 · 경계 (Phase 2 1c · F-01-12 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 레지스트리 · 스키마 — 배치 타입은 본문 타입 목록 밖(`/` 블록 · 바꾸기 · 입력 규칙에 없다) · 내용 노드는 고를 수 없는 원자
 *   ② ★ 정규화 ④ — 컬럼 목록 밖의 컬럼은 푼다 · 컬럼 바로 안의 컬럼 목록은 편다 · 컬럼이 아닌 자식은 이웃 컬럼으로 · 컬럼 하나면 푼다 ·
 *      빈 컬럼은 빈 문단 · 올바른 문서는 고칠 것이 없다 · **두 번 돌려도 같다**(수선이 또 쓰지 않는다)
 *   ③ ★ 검증 — 같은 규칙을 저장 API 가 거부한다
 *   ④ ★ `/2열` · `/3열` — 지금 블록(id · 캐럿 그대로)이 첫 컬럼으로 · 나머지는 빈 문단 · 컬럼 안에서는 만들지 않는다 · 메뉴에 선다
 *   ⑤ ★ 경계 — 이웃 찾기는 틀을 건너뛴다 · 들여쓰기는 컬럼 목록 밑으로 가지 않는다 · 컬럼의 직속 블록은 내어쓰지 않는다 · 병합은
 *      컬럼 경계를 넘지 않는다(키는 삼킨다)
 *   ⑥ 내보내기 · 복사의 평문은 펼친다 · 끌어 놓기 후보는 차선(컬럼 · 본문)을 싣는다(1c-2)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import { BLOCK_TYPES, BODY_BLOCK_TYPES, LAYOUT_BLOCK_TYPES, type BlockType } from '../block/types.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { dropCandidates } from './block-handle.ts'
import { TURN_INTO_TYPES } from './block-menu.ts'
import { insertColumnsInto, runColumnsSlashCommand } from './columns.ts'
import { indentCommand, mergeBackwardCommand, mergeForwardCommand, outdentCommand } from './commands.ts'
import { validateDoc, type EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById, visibleNeighbors } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'
import { filterSlashCommands, slashMenuPlugin } from './slash-menu.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, text = '', children: EditorBlock[] = []): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children,
})
const p = (text: string, children: EditorBlock[] = []) => blk('paragraph', text, children)
const column = (...children: EditorBlock[]) => blk('column', '', children)
const columns = (...cols: EditorBlock[]) => blk('column_list', '', cols)

/** 블록의 모양 — 문단은 글자, 틀은 [타입, 자식]. */
type Shape = string | [string, Shape[]]
const shape = (blocks: readonly EditorBlock[]): Shape[] =>
  blocks.map((b) => (b.type === 'paragraph' && (b.children ?? []).length === 0 ? toPlainText(b.title) : [b.type === 'paragraph' ? toPlainText(b.title) : b.type, shape(b.children ?? [])]))

const normalize = (blocks: EditorBlock[]) => {
  const first = normalizeBody(docToPm({ blocks }), { seed: 'page' })
  const second = normalizeBody(first.doc, { seed: 'page' })
  return { fixes: first.fixes, shape: shape(pmToDoc(first.doc).blocks), again: second.fixes, blocks: pmToDoc(first.doc).blocks }
}

const stateOf = (blocks: EditorBlock[], plugins: EditorState['plugins'] = []) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })
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

describe('① 레지스트리 · 스키마', () => {
  test('★ 배치 타입은 본문 타입 목록 밖 — / 블록 · 바꾸기에 없다 · 내용 노드는 고를 수 없는 원자', () => {
    for (const type of LAYOUT_BLOCK_TYPES) {
      assert.ok(!(BODY_BLOCK_TYPES as readonly string[]).includes(type), type)
      assert.ok(!(TURN_INTO_TYPES as readonly string[]).includes(type), type)
      assert.equal(BLOCK_TYPES[type].layout, true)
      assert.equal(BLOCK_TYPES[type].hasRichText, false)
      assert.equal(BLOCK_TYPES[type].supportsColor, false)
      const node = blockSchema.nodes[type]!
      assert.equal(node.spec.atom, true)
      assert.equal(node.spec.selectable, false)
      assert.ok(!filterSlashCommands(type).some((c) => c.kind === 'block' && c.id === (type as never)))
    }
    assert.deepEqual(BLOCK_TYPES.column_list.childTypes, ['column'])
    assert.deepEqual(BLOCK_TYPES.column.parentTypes, ['column_list'])
  })
})

describe('② 정규화', () => {
  test('★ 올바른 컬럼은 고칠 것이 없다', () => {
    const result = normalize([columns(column(p('a'), p('b')), column(p('c')))])
    assert.deepEqual(result.fixes, [])
    assert.deepEqual(result.shape, [['column_list', [['column', ['a', 'b']], ['column', ['c']]]]])
  })

  test('★ 컬럼 목록 밖의 컬럼은 풀어 자식을 그 자리에', () => {
    const result = normalize([p('앞'), column(p('a'), p('b')), p('뒤')])
    assert.ok(result.fixes.includes('column_unwrapped'), JSON.stringify(result.fixes))
    assert.deepEqual(result.shape, ['앞', 'a', 'b', '뒤'])
    assert.deepEqual(result.again, [])
  })

  test('★ 컬럼 바로 안의 컬럼 목록은 편다 · 토글 안은 그대로', () => {
    const nested = normalize([columns(column(p('a'), columns(column(p('x')), column(p('y')))), column(p('b')))])
    assert.ok(nested.fixes.includes('nested_columns_flattened'), JSON.stringify(nested.fixes))
    assert.deepEqual(nested.shape, [['column_list', [['column', ['a', 'x', 'y']], ['column', ['b']]]]])
    assert.deepEqual(nested.again, [])
  })

  test('★ 컬럼이 아닌 자식은 이웃 컬럼으로 — 앞 컬럼의 끝 · 앞이 없으면 뒤 컬럼의 처음', () => {
    const result = normalize([columns(p('맨 앞'), column(p('a')), p('사이'), column(p('b')), p('맨 뒤'))])
    assert.ok(result.fixes.includes('column_misplaced_moved'), JSON.stringify(result.fixes))
    assert.deepEqual(result.shape, [['column_list', [['column', ['맨 앞', 'a', '사이']], ['column', ['b', '맨 뒤']]]]])
    assert.deepEqual(result.again, [])
  })

  test('★ 컬럼이 하나면 풀고 · 하나도 없으면 컬럼 목록을 뺀다(자식은 잃지 않는다)', () => {
    const single = normalize([p('앞'), columns(column(p('a'), p('b'))), p('뒤')])
    assert.ok(single.fixes.includes('single_column_unwrapped'), JSON.stringify(single.fixes))
    assert.deepEqual(single.shape, ['앞', 'a', 'b', '뒤'])
    const none = normalize([columns(p('x'), p('y'))])
    assert.deepEqual(none.shape, ['x', 'y'])
    assert.deepEqual(single.again, [])
    assert.deepEqual(none.again, [])
  })

  test('★ 빈 컬럼은 빈 문단 — 같은 문서면 같은 id(결정론)', () => {
    const doc = [columns(column(p('a')), column())]
    const result = normalize(doc)
    assert.ok(result.fixes.includes('empty_column_filled'), JSON.stringify(result.fixes))
    assert.deepEqual(result.shape, [['column_list', [['column', ['a']], ['column', ['']]]]])
    assert.deepEqual(result.again, [])
    const filled = (r: typeof result) => r.blocks[0]!.children![1]!.children![0]!.id
    assert.equal(filled(result), filled(normalize(doc)))
  })
})

describe('③ 검증', () => {
  test('★ 저장 API 가 같은 규칙을 거부한다', () => {
    assert.deepEqual(validateDoc({ blocks: [columns(column(p('a')), column(p('b')))] }), [])
    const reasons = (blocks: EditorBlock[]) => validateDoc({ blocks }).map((i) => i.message).join(' / ')
    assert.match(reasons([column(p('a'))]), /column_list 안에만/)
    assert.match(reasons([columns(column(p('a')), p('b'))]), /자식은 column/)
    assert.match(reasons([columns(column(p('a')))]), /2개 이상/)
    assert.match(reasons([columns(column(p('a')), column())]), /하나 이상/)
    assert.match(reasons([columns(column(columns(column(p('x')), column(p('y')))), column(p('b')))]), /바로 안에는 column_list/)
  })
})

describe('④ /2열 · /3열', () => {
  const typeSlash = (state: EditorState, query: string) => {
    let next = state
    for (const char of `/${query}`) next = next.apply(next.tr.insertText(char, next.selection.from))
    return next
  }

  test('★ 지금 블록이 첫 컬럼으로(id · 캐럿 그대로) · 나머지는 빈 문단', () => {
    // `/` 는 줄 처음이나 공백 뒤에서만 메뉴를 연다(`https://` 를 막는 규칙) — 글 뒤에 공백을 두고 친다.
    const a = p('안녕 ')
    const b = p('뒤')
    const state = typeSlash(caret(stateOf([a, b], [slashMenuPlugin()]), a.id, 3), '2열')
    const { handled, state: next } = run(state, (s, d) => runColumnsSlashCommand(s, d, 2, nextId))
    assert.ok(handled)
    assert.deepEqual(shape(pmToDoc(next.doc).blocks), [['column_list', [['column', ['안녕 ']], ['column', ['']]]], '뒤'])
    const moved = pmToDoc(next.doc).blocks[0]!.children![0]!.children![0]!
    assert.equal(moved.id, a.id)
    const info = findContainerById(next.doc, a.id)!
    assert.equal(next.selection.from, info.contentPos + 1 + 3, '캐럿이 친 자리가 아니다')
    assert.deepEqual(validateDoc({ blocks: pmToDoc(next.doc).blocks }), [])
  })

  test('★ 3열 · 컬럼 안에서는 만들지 않는다 · 메뉴에 선다', () => {
    const a = p('')
    const three = run(typeSlash(caret(stateOf([a], [slashMenuPlugin()]), a.id, 0), '3열'), (s, d) => runColumnsSlashCommand(s, d, 3, nextId))
    assert.ok(three.handled)
    assert.deepEqual(shape(pmToDoc(three.state.doc).blocks), [['column_list', [['column', ['']], ['column', ['']], ['column', ['']]]]])
    const inner = p('')
    const inColumn = typeSlash(caret(stateOf([columns(column(inner), column(p('b')))], [slashMenuPlugin()]), inner.id, 0), '2열')
    assert.equal(run(inColumn, (s, d) => runColumnsSlashCommand(s, d, 2, nextId)).handled, false)
    // 만드는 함수 자체도 거절한다 — 끌어 놓기(1c-2)가 슬래시 메뉴를 거치지 않고 부른다
    const tr = stateOf([columns(column(inner), column(p('b')))]).tr
    assert.equal(insertColumnsInto(tr, inner.id, 2, nextId), false)
    assert.equal(tr.docChanged, false)
    assert.deepEqual(filterSlashCommands('열').filter((c) => c.kind === 'columns').map((c) => c.label), ['2열', '3열'])
    assert.deepEqual(filterSlashCommands('columns').filter((c) => c.kind === 'columns').map((c) => c.label), ['2열', '3열'])
  })
})

describe('⑤ 경계', () => {
  const a1 = p('a1')
  const a2 = p('a2')
  const b1 = p('b1')
  const after = p('뒤')
  // 틀(앞 · 컬럼 목록 · 컬럼)의 id 도 고정한다 — 부를 때마다 새로 만들면 같은 문서를 다르다고 본다.
  const blocks = [p('앞'), columns(column(a1, a2), column(b1)), after]
  const base = stateOf(blocks)
  const doc = () => base

  test('★ 이웃 찾기는 틀을 건너뛴다 — 둘째 컬럼의 첫 블록 앞은 첫 컬럼의 끝 블록', () => {
    const state = doc()
    assert.deepEqual(visibleNeighbors(state.doc, b1.id, () => false), { previous: a2.id, next: after.id })
    assert.equal(visibleNeighbors(state.doc, a1.id, () => false).previous, pmToDoc(state.doc).blocks[0]!.id)
  })

  test('★ 들여쓰기는 컬럼 목록 밑으로 가지 않는다 · 컬럼 안에서는 된다', () => {
    assert.equal(run(caret(doc(), after.id), indentCommand()).handled, false)
    const inside = run(caret(doc(), a2.id), indentCommand())
    assert.ok(inside.handled)
    assert.deepEqual(shape(pmToDoc(inside.state.doc).blocks)[1], ['column_list', [['column', [['a1', ['a2']]]], ['column', ['b1']]]])
  })

  test('★ 컬럼의 직속 블록은 내어쓰지 않는다(키는 삼킨다) · 컬럼 안의 더 깊은 블록은 된다', () => {
    const swallowed = run(caret(doc(), a1.id), outdentCommand())
    assert.equal(swallowed.handled, true)
    assert.ok(swallowed.state.doc.eq(doc().doc), '문서가 바뀌었다')
    const deep = p('깊은')
    const nested = stateOf([columns(column(p('a', [deep])), column(p('b')))])
    const lifted = run(caret(nested, deep.id), outdentCommand())
    assert.ok(lifted.handled)
    assert.deepEqual(shape(pmToDoc(lifted.state.doc).blocks), [['column_list', [['column', ['a', '깊은']], ['column', ['b']]]]])
  })

  test('★ 병합은 컬럼 경계를 넘지 않는다 — Backspace · Delete 를 삼킨다', () => {
    const back = run(caret(doc(), b1.id, 0), mergeBackwardCommand())
    assert.equal(back.handled, true)
    assert.ok(back.state.doc.eq(doc().doc))
    const firstOfColumn = run(caret(doc(), a1.id, 0), mergeBackwardCommand())
    assert.equal(firstOfColumn.handled, true)
    assert.ok(firstOfColumn.state.doc.eq(doc().doc), '첫 컬럼의 첫 블록이 위 블록과 합쳐졌다')
    const forward = run(caret(doc(), a2.id, 2), mergeForwardCommand())
    assert.equal(forward.handled, true)
    assert.ok(forward.state.doc.eq(doc().doc))
    // 같은 컬럼 안의 병합은 그대로 된다
    const within = run(caret(doc(), a2.id, 0), mergeBackwardCommand())
    assert.deepEqual(shape(pmToDoc(within.state.doc).blocks)[1], ['column_list', [['column', ['a1a2']], ['column', ['b1']]]])
  })
})

describe('⑥ 내보내기 · 복사 · 끌어 놓기', () => {
  const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }
  test('내보내기 · 복사의 평문은 컬럼을 차례로 편다', () => {
    const blocks = [p('앞'), columns(column(p('왼쪽 1'), p('왼쪽 2')), column(p('오른쪽'))), p('뒤')]
    const { markdown } = pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, NO_LINKS, { untitled: 'x' })
    const body = markdown.slice(markdown.indexOf('앞'))
    assert.ok(/앞\n\n왼쪽 1\n\n왼쪽 2\n\n오른쪽\n\n뒤/.test(body), body)
    assert.equal(plainTextForBlocks(blocks), '앞\n왼쪽 1\n왼쪽 2\n오른쪽\n뒤')
  })

  test('끌어 놓기 후보는 차선을 싣는다 — 컬럼 안이면 그 컬럼 · 아니면 null(1c-2)', () => {
    const inner = p('안')
    const outer = p('밖')
    const left = column(inner)
    const state = stateOf([outer, columns(left, column(p('b')))])
    const lanes = new Map(dropCandidates(state.doc, () => false, []).map((c) => [c.blockId, c.lane]))
    assert.equal(lanes.get(outer.id), null)
    assert.equal(lanes.get(inner.id), left.id)
  })
})
