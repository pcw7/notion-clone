/**
 * 심플 테이블 — 저장 모양 · 정규화 · 검증 · 편집 (Phase 2 1d-1 · F-01-18 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 어댑터 — 저장 트리(표 → 행 · `properties.cells`)와 편집기(표 > 행 > 셀)가 왕복한다 · 행 id · 셀의 서식 · 멘션 · 수식 · 셀 밖의
 *        행 속성이 남는다 · 표 컨테이너에는 자식 그룹이 없다
 *   ② ★ 정규화 ⑤ — 멀쩡한 표는 고칠 것이 없다 · 모자란 행을 채운다(열을 버리지 않는다) · 행 없는 표 · 행이 아닌 것 · 병합 칸 · 행 id
 *        (빈 · 중복 · 표 id 와 같음) · 그룹에 온 자식은 뒤로 · 두 번 돌려도 같다
 *   ③ ★ 검증 · 투영 — 행 없는 표 · 셀 수가 다른 행 · 행이 아닌 자식 · 표 밖의 행 · 셀 모양 · 셀의 런 계약 / 셀은 정규형으로 행에
 *   ④ ★ `/표` — 빈 줄은 그 자리(id 그대로) · 글이 있으면 뒤에 · 3열 × 2행 · 캐럿은 첫 셀
 *   ⑤ ★ 셀 안의 키 — Tab(마지막 셀이면 행을 더한다) · Shift+Tab · Enter(아래 셀 · 마지막 행이면 표 뒤의 빈 문단) · Shift+Enter ·
 *        셀 끝의 Backspace · Delete 는 삼킨다 · 블록 명령(병합 · 분할 · 들여쓰기 · 바꾸기)은 물러선다 · `/` 는 열리지 않는다 · Mod+A
 *   ⑥ 행 id 찍기 — 빈 · 중복(복사한 행) · 블록 id 와 같은 이름 공간
 *   ⑦ 셀 안의 인라인 수식을 찾는다
 *   ⑧ ★ 내보내기 · 평문 — GFM 표(첫 행이 머리) · `|` · 줄바꿈 / 탭과 줄
 *   ⑨ ★ 동시 편집 — 다른 셀의 글자는 둘 다 남는다 · 한쪽이 열을 더하는 동안 다른 쪽이 행을 더하면 모자란 행을 채운다
 *   ⑩ ★ 행 · 열 · 머리(1d-2) — 자리에 넣기(새 행은 곧바로 id) · 지우기(마지막 행 · 열 · 자리 밖은 아니다) · 머리 플래그(끄면 키를
 *        지운다) · 캐럿이 있던 행을 지워도 문서가 맞다 · 고친 뒤 정규화가 고칠 것이 없다 · 마지막 셀의 Tab 이 만든 행의 id
 *   ⑪ ★ 메뉴 — 블록 메뉴의 '표'(표 하나일 때 · 머리 플래그의 체크 · 끝에 더하기) · 손잡이 메뉴(넣기 · 지우기 — 마지막이면 꺼진다)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import { addColumnAfter, addRowAfter } from '@tiptap/pm/tables'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import * as Y from 'yjs'

import { sanitizeBlockAttrs } from '../block/props.ts'
import { TABLE_CELLS_KEY } from '../block/table.ts'
import type { BlockType } from '../block/types.ts'
import { textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc } from '../collab/ydoc.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { pageToMarkdown } from '../export/markdown.ts'
import { bind, exchange, peer } from '../testing/collab-peers.ts'
import { findBlockIdFixes } from './block-id-plugin.ts'
import { BlockSelection, isBlockSelection, selectAllBlocksCommand } from './block-selection.ts'
import { blockMenuItems, tableAxisMenuItems } from './block-menu.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { applyTurnInto, indentCommand, mergeBackwardCommand, mergeForwardCommand, splitBlockCommand } from './commands.ts'
import { projectDocument, validateDoc, type EditorBlock } from './document.ts'
import { findInlineEquation, inlineEquationRefAt } from './inline-equation.ts'
import { createEditorKeymap } from './keymap.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema, EQUATION_NODE, TABLE_CELL_NODE, TABLE_NODE, TABLE_ROW_NODE } from './schema.ts'
import { slashMenuPlugin, slashMenuState } from './slash-menu.ts'
import { editTableCommand, runTableSlashCommand, tableEnterCommand, tableTabCommand, type TableEdit } from './table.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, text = '', children: EditorBlock[] = [], properties: Record<string, unknown> = {}): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title: text === '' ? [] : [textRun(text)],
  properties,
  format: {},
  children,
})
const p = (text: string) => blk('paragraph', text)
const cellOf = (text: string): RichTextRun[] => (text === '' ? [] : [textRun(text)])
const row = (...cells: (string | RichTextRun[])[]) =>
  blk('table_row', '', [], { [TABLE_CELLS_KEY]: cells.map((c) => (typeof c === 'string' ? cellOf(c) : c)) })
const table = (...rows: EditorBlock[]) => blk('table', '', rows)

/** 표의 글자 격자 — 행마다 셀의 평문. */
const gridOf = (block: EditorBlock): string[][] =>
  (block.children ?? []).map((r) => ((r.properties?.[TABLE_CELLS_KEY] ?? []) as RichTextRun[][]).map((c) => toPlainText(c)))
const tablesOf = (state: EditorState) => pmToDoc(state.doc).blocks.filter((b) => b.type === 'table')

const stateOf = (blocks: EditorBlock[], plugins = [slashMenuPlugin()]) =>
  EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })
function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { handled, state: next }
}
const deps = { isCollapsed: () => false, newId: nextId }
const keymap = createEditorKeymap(deps)

/** 표 블록 `tableId` 의 (행, 열) 셀 안 `offset` 에 캐럿. */
function caretInCell(state: EditorState, tableId: string, rowIndex: number, column: number, offset = 0): EditorState {
  const info = findContainerById(state.doc, tableId)!
  let pos = info.contentPos + 1
  for (let r = 0; r < rowIndex; r += 1) pos += info.contentNode.child(r).nodeSize
  const rowNode = info.contentNode.child(rowIndex)
  pos += 1
  for (let c = 0; c < column; c += 1) pos += rowNode.child(c).nodeSize
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + offset)))
}
/** 캐럿이 있는 셀의 (행, 열) — 셀 밖이면 null. */
function cellAtCaret(state: EditorState): [number, number] | null {
  const $from = state.selection.$from
  if ($from.parent.type.name !== TABLE_CELL_NODE) return null
  return [$from.index($from.depth - 2), $from.index($from.depth - 1)]
}

describe('① 어댑터', () => {
  test('★ 저장 트리 ↔ 편집기 — 행 id · 셀(서식 · 멘션 · 수식) · 셀 밖의 행 속성 · 머리 플래그가 왕복한다', () => {
    const bold: RichTextRun[] = [{ ...textRun('굵게'), annotations: { ...textRun('').annotations, bold: true } }]
    const equation: RichTextRun[] = [{ type: 'equation', annotations: textRun('').annotations, plain_text: 'x^2', href: null, equation: { expression: 'x^2' } }]
    const r1 = row('a', bold)
    const r2 = { ...row('', equation), properties: { [TABLE_CELLS_KEY]: [[], equation], future: 1 } }
    const t = { ...table(r1, r2), properties: { has_column_header: true } }
    const doc = docToPm({ blocks: [t] })
    doc.check()
    const container = doc.child(0).child(0)
    assert.equal(container.childCount, 1, '표 컨테이너에는 자식 그룹이 없다')
    assert.equal(container.child(0).type.name, TABLE_NODE)
    assert.deepEqual(
      [...Array(container.child(0).childCount).keys()].map((i) => container.child(0).child(i).attrs.rowId),
      [r1.id, r2.id],
    )
    const back = pmToDoc(doc).blocks[0]!
    assert.equal(back.id, t.id)
    assert.deepEqual(back.properties, { has_column_header: true })
    assert.deepEqual(gridOf(back), [['a', '굵게'], ['', 'x^2']])
    assert.deepEqual(back.children!.map((r) => r.id), [r1.id, r2.id])
    assert.equal(back.children![1]!.properties!.future, 1, '셀 밖의 행 속성이 남는다')
    assert.equal(((back.children![0]!.properties![TABLE_CELLS_KEY] as RichTextRun[][])[1]![0]!.annotations.bold), true)
    assert.equal(((back.children![1]!.properties![TABLE_CELLS_KEY] as RichTextRun[][])[1]![0]!.type), 'equation')
  })

  test('셀 수가 다른 행은 가장 긴 행에 맞춰 빈 셀로 — 노드가 스키마에 맞는다', () => {
    const doc = docToPm({ blocks: [table(row('a', 'b', 'c'), row('d'))] })
    doc.check()
    assert.deepEqual(gridOf(pmToDoc(doc).blocks[0]!), [['a', 'b', 'c'], ['d', '', '']])
  })
})

describe('② 정규화 ⑤', () => {
  const read = (blocks: EditorBlock[]) => readBodyYDoc(createBodyYDoc({ blocks }), nextId())

  test('★ 멀쩡한 표는 고칠 것이 없다', () => {
    const r = read([p('위'), table(row('a', 'b'), row('c', 'd')), p('아래')])
    assert.deepEqual(r.fixes, [])
    assert.deepEqual(gridOf(r.doc.blocks[1]!), [['a', 'b'], ['c', 'd']])
  })

  const T = blockSchema.nodes[TABLE_NODE]!
  const R = blockSchema.nodes[TABLE_ROW_NODE]!
  const C = blockSchema.nodes[TABLE_CELL_NODE]!
  const { blockContainer: CONTAINER, blockGroup: GROUP, doc: DOC, paragraph: PARAGRAPH } = blockSchema.nodes
  const cell = (text = '', attrs: Record<string, unknown> | null = null) => C.create(attrs, text === '' ? [] : [blockSchema.text(text)])
  const tableDoc = (tableId: string, rows: ReturnType<typeof R.create>[] | ReturnType<typeof C.create>[], group: ReturnType<typeof CONTAINER.create>[] = []) =>
    DOC.create(null, [GROUP.create(null, [CONTAINER.create({ blockId: tableId }, [T.create({ props: {}, format: {} }, rows), ...(group.length ? [GROUP.create(null, group)] : [])])])])

  test('★ 모자란 행은 가장 긴 행에 맞춰 빈 셀로 — 열을 버리지 않는다', () => {
    const [t, a, b] = [nextId(), nextId(), nextId()]
    const out = normalizeBody(tableDoc(t, [R.create({ rowId: a }, [cell('a1'), cell('a2'), cell('a3')]), R.create({ rowId: b }, [cell('b1')])]), { seed: 's' })
    assert.ok(out.fixes.includes('table_cells_padded'))
    out.doc.check()
    assert.deepEqual(gridOf(pmToDoc(out.doc).blocks[0]!), [['a1', 'a2', 'a3'], ['b1', '', '']])
  })

  test('★ 행 없는 표는 빈 셀 하나의 행 하나 · 행이 아닌 것은 버린다 · 병합 칸은 1', () => {
    const t = nextId()
    const empty = normalizeBody(tableDoc(t, []), { seed: 's' })
    assert.ok(empty.fixes.includes('table_filled'))
    empty.doc.check()
    assert.deepEqual(gridOf(pmToDoc(empty.doc).blocks[0]!), [['']])

    const stray = normalizeBody(tableDoc(nextId(), [cell('떠돌이') as never, R.create({ rowId: nextId() }, [cell('x', { colspan: 2, rowspan: 1, colwidth: null })])]), { seed: 's' })
    assert.ok(stray.fixes.includes('invalid_content_dropped'))
    assert.ok(stray.fixes.includes('table_cell_reset'))
    stray.doc.check()
    const node = stray.doc.child(0).child(0).child(0)
    assert.equal(node.childCount, 1)
    assert.equal(node.child(0).child(0).attrs.colspan, 1)
  })

  test('★ 행 id — 빈 id · 중복 · 표 id 와 같은 id 는 결정론적 새 id(표가 먼저 갖는다)', () => {
    const t = nextId()
    const dup = nextId()
    const input = tableDoc(t, [R.create({ rowId: '' }, [cell('a')]), R.create({ rowId: dup }, [cell('b')]), R.create({ rowId: dup }, [cell('c')]), R.create({ rowId: t }, [cell('d')])])
    const once = normalizeBody(input, { seed: 's' })
    const twice = normalizeBody(input, { seed: 's' })
    assert.ok(once.doc.eq(twice.doc), '결정론')
    assert.ok(once.fixes.includes('blank_id') && once.fixes.includes('duplicate_id'))
    const back = pmToDoc(once.doc).blocks[0]!
    assert.equal(back.id, t, '표 컨테이너가 자기 id 를 지킨다')
    const ids = back.children!.map((r) => r.id)
    assert.equal(ids[1], dup)
    assert.equal(new Set([t, ...ids]).size, 5, JSON.stringify(ids))
    assert.deepEqual(normalizeBody(once.doc, { seed: 's' }).fixes, [], '두 번 돌려도 같다')
  })

  test('표 컨테이너의 그룹에 온 자식은 뒤 형제로 올린다(행은 내용 노드 안에만)', () => {
    const t = nextId()
    const child = CONTAINER.create({ blockId: nextId() }, [PARAGRAPH.create({ props: {}, format: {} }, [blockSchema.text('밑')])])
    const out = normalizeBody(tableDoc(t, [R.create({ rowId: nextId() }, [cell('a')])], [child]), { seed: 's' })
    assert.ok(out.fixes.includes('children_lifted'))
    const blocks = pmToDoc(out.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), ['table', 'paragraph'])
  })
})

describe('③ 검증 · 투영', () => {
  test('★ 저장 API 가 거부한다 — 행 없는 표 · 셀 수가 다른 행 · 행이 아닌 자식 · 표 밖의 행 · 셀 모양 · 셀의 런', () => {
    const messages = (blocks: EditorBlock[]) => validateDoc({ blocks }).map((i) => i.message).join(' / ')
    assert.equal(validateDoc({ blocks: [table(row('a', 'b'), row('c', 'd'))] }).length, 0)
    assert.match(messages([table()]), /행이 하나 이상/)
    assert.match(messages([table(row('a', 'b'), row('c'))]), /셀 수가 같아야/)
    assert.match(messages([table(row('a'), p('문단'))]), /table 의 자식은 table_row/)
    assert.match(messages([row('a')]), /table_row 은 table 안에만/)
    assert.match(messages([table({ ...row('a'), properties: { [TABLE_CELLS_KEY]: 'x' } })]), /셀의 배열/)
    assert.match(messages([table({ ...row('a'), properties: { [TABLE_CELLS_KEY]: [] } })]), /셀이 하나 이상/)
    assert.ok(validateDoc({ blocks: [table({ ...row('a'), properties: { [TABLE_CELLS_KEY]: [[{ type: 'text' }]] } })] }).length > 0, '런 계약')
  })

  test('머리 플래그는 참 거짓만 남는다 — 정화', () => {
    const out = sanitizeBlockAttrs('table', { has_column_header: 'yes', has_row_header: true, other: 1 }, {})
    assert.deepEqual(out.props, { has_row_header: true, other: 1 })
    assert.ok(out.changed)
    assert.equal(sanitizeBlockAttrs('table', { has_column_header: false }, {}).changed, false)
  })

  test('★ 투영 — 행은 표의 자식 행(블록)이고 셀은 정규형 · 글(title)은 없다', () => {
    const r = row([textRun('a'), textRun('b')])
    const t = table(r)
    const projection = projectDocument(nextId(), [], { blocks: [t] })
    const projectedRow = projection.blocks.find((b) => b.id === r.id)!
    assert.equal(projectedRow.parentId, t.id)
    assert.equal(projectedRow.type, 'table_row')
    assert.equal('title' in projectedRow.properties, false)
    assert.deepEqual((projectedRow.properties[TABLE_CELLS_KEY] as RichTextRun[][])[0]!.map((run) => run.plain_text), ['ab'], '인접 런을 합친다')
  })
})

describe('④ /표', () => {
  const typeSlash = (state: EditorState, blockId: string): EditorState => {
    const info = findContainerById(state.doc, blockId)!
    const end = info.contentPos + 1 + info.contentNode.content.size
    let s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)))
    s = s.apply(s.tr.insertText('/'))
    s = s.apply(s.tr.insertText('표'))
    assert.ok(slashMenuState(s).active)
    return s
  }

  test('★ 빈 줄 — 그 자리가 표(블록 id 그대로) · 3열 × 2행 · 캐럿은 첫 셀', () => {
    const line = p('')
    const after = p('아래')
    const { handled, state } = run(typeSlash(stateOf([line, after]), line.id), (s, d) => runTableSlashCommand(s, d, nextId))
    assert.ok(handled)
    state.doc.check()
    const blocks = pmToDoc(state.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), ['table', 'paragraph'])
    assert.equal(blocks[0]!.id, line.id)
    assert.deepEqual(gridOf(blocks[0]!), [['', '', ''], ['', '', '']])
    assert.deepEqual(cellAtCaret(state), [0, 0])
    assert.equal(slashMenuState(state).active, false)
  })

  test('★ 글이 있는 줄 — 그 뒤에 표 · 줄의 글은 그대로(쳐 둔 /쿼리만 지운다)', () => {
    const line = p('글 ')
    const { state } = run(typeSlash(stateOf([line]), line.id), (s, d) => runTableSlashCommand(s, d, nextId))
    const blocks = pmToDoc(state.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'table'])
    assert.equal(toPlainText(blocks[0]!.title), '글 ')
    assert.deepEqual(cellAtCaret(state), [0, 0])
  })
})

describe('⑤ 셀 안의 키', () => {
  const setup = () => {
    const t = table(row('a', 'b'), row('c', 'd'))
    const after = p('뒤')
    return { t, after, state: stateOf([p('앞'), t, after]) }
  }

  test('★ Tab · Shift+Tab — 옆 셀 · 마지막 셀의 Tab 은 행을 더하고 그 첫 셀 · 첫 셀의 Shift+Tab 은 삼킨다', () => {
    const { t, state } = setup()
    const next = run(caretInCell(state, t.id, 0, 0), keymap.Tab!)
    assert.ok(next.handled)
    assert.deepEqual(cellAtCaret(next.state), [0, 1])
    const wrap = run(caretInCell(state, t.id, 0, 1), keymap.Tab!)
    assert.deepEqual(cellAtCaret(wrap.state), [1, 0])
    const grown = run(caretInCell(state, t.id, 1, 1), keymap.Tab!)
    assert.deepEqual(gridOf(tablesOf(grown.state)[0]!), [['a', 'b'], ['c', 'd'], ['', '']])
    assert.deepEqual(cellAtCaret(grown.state), [2, 0])
    const back = run(caretInCell(state, t.id, 1, 0), keymap['Shift-Tab']!)
    assert.deepEqual(cellAtCaret(back.state), [0, 1])
    const first = run(caretInCell(state, t.id, 0, 0), keymap['Shift-Tab']!)
    assert.ok(first.handled, '키를 삼킨다 — 내어쓰기로 새지 않는다')
    assert.ok(first.state.doc.eq(state.doc))
    assert.equal(run(caretInCell(state, t.id, 0, 0), tableTabCommand(1)).handled, true)
  })

  test('★ Enter — 아래 셀 · 마지막 행이면 표 뒤의 빈 문단(바로 뒤가 빈 문단이면 그리로)', () => {
    const { t, state } = setup()
    const down = run(caretInCell(state, t.id, 0, 1, 1), keymap.Enter!)
    assert.deepEqual(cellAtCaret(down.state), [1, 1])
    assert.ok(down.state.doc.eq(state.doc), 'Enter 가 셀 · 블록을 쪼개지 않는다')
    const out = run(caretInCell(state, t.id, 1, 0), keymap.Enter!)
    const blocks = pmToDoc(out.state.doc).blocks
    assert.deepEqual(blocks.map((b) => [b.type, toPlainText(b.title)]), [['paragraph', '앞'], ['table', ''], ['paragraph', ''], ['paragraph', '뒤']])
    assert.equal(cellAtCaret(out.state), null)
    assert.equal(out.state.selection.$from.parent.type.name, 'paragraph')
    // 이미 빈 문단이 뒤에 있으면 새로 만들지 않는다.
    const again = run(caretInCell(out.state, t.id, 1, 0), tableEnterCommand(nextId))
    assert.equal(pmToDoc(again.state.doc).blocks.length, 4)
  })

  test('★ Shift+Enter — 셀 안의 줄바꿈 · 셀 끝의 Backspace · Delete 는 삼킨다 · 셀 안의 글자 지우기는 기본 동작', () => {
    const { t, state } = setup()
    const soft = run(caretInCell(state, t.id, 0, 0, 1), keymap['Shift-Enter']!)
    assert.deepEqual(gridOf(tablesOf(soft.state)[0]!)[0], ['a\n', 'b'])
    const start = run(caretInCell(state, t.id, 1, 0), keymap.Backspace!)
    assert.ok(start.handled && start.state.doc.eq(state.doc), '셀 맨 앞의 Backspace 는 아무것도 지우지 않는다')
    const end = run(caretInCell(state, t.id, 0, 0, 1), keymap.Delete!)
    assert.ok(end.handled && end.state.doc.eq(state.doc), '셀 맨 끝의 Delete 는 아무것도 지우지 않는다')
    assert.equal(run(caretInCell(state, t.id, 0, 0, 1), keymap.Backspace!).handled, false, '글자 지우기는 브라우저 · 기본 동작으로')
  })

  test('★ 블록 명령은 셀 안에서 물러선다 — 병합 · 분할 · 들여쓰기 · 표를 다른 타입으로 바꾸기', () => {
    const { t, state } = setup()
    const inCell = caretInCell(state, t.id, 0, 1, 1)
    for (const command of [mergeBackwardCommand(deps), mergeForwardCommand(deps), splitBlockCommand(deps), indentCommand(deps)]) {
      assert.equal(run(inCell, command).handled, false)
    }
    const tr = inCell.tr
    assert.equal(applyTurnInto(tr, t.id, 'paragraph', deps), false)
    assert.equal(tr.docChanged, false)
  })

  test('★ 표 밑으로는 들여쓰지 않는다 — 표 뒤 블록의 Tab 은 아무것도 하지 않는다(행은 내용 노드 안에만)', () => {
    const { after, state } = setup()
    const info = findContainerById(state.doc, after.id)!
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    const r = run(s, keymap.Tab!)
    assert.ok(r.state.doc.eq(state.doc), JSON.stringify(pmToDoc(r.state.doc).blocks.map((b) => b.type)))
  })

  test('`/` 는 셀 안에서 열리지 않는다(셀의 글자다)', () => {
    const { t, state } = setup()
    const s = caretInCell(state, t.id, 0, 0)
    const typed = s.apply(s.tr.insertText('/'))
    assert.equal(slashMenuState(typed).active, false)
  })

  test('Mod+A — 셀의 글자 먼저 · 다 골랐으면 표 블록', () => {
    const { t, state } = setup()
    const once = run(caretInCell(state, t.id, 0, 1, 0), selectAllBlocksCommand()).state
    assert.equal(once.selection.from, once.selection.$from.start())
    assert.equal(once.doc.textBetween(once.selection.from, once.selection.to), 'b')
    const twice = run(once, selectAllBlocksCommand()).state
    assert.ok(isBlockSelection(twice.selection))
    assert.deepEqual(twice.selection.blockIds, [t.id])
  })
})

describe('⑥ 행 id 찍기', () => {
  test('빈 행 id · 복사해 겹친 행 id 를 찾는다 — 블록 id 와 같은 이름 공간', () => {
    const t = table(row('a'), row('b'))
    const state = stateOf([t])
    const info = findContainerById(state.doc, t.id)!
    const rowPos = info.contentPos + 1
    const blank = state.apply(state.tr.setNodeMarkup(rowPos, undefined, { ...info.contentNode.child(0).attrs, rowId: '' }))
    assert.deepEqual(findBlockIdFixes(blank.doc).map((f) => f.attr), ['rowId'])
    const clash = state.apply(state.tr.setNodeMarkup(rowPos, undefined, { ...info.contentNode.child(0).attrs, rowId: t.id }))
    assert.deepEqual(findBlockIdFixes(clash.doc).map((f) => [f.pos, f.attr]), [[rowPos, 'rowId']])
    // 행 추가(prosemirror-tables)가 만든 행은 빈 id — 찍을 자리로 잡힌다.
    let grown = caretInCell(state, t.id, 1, 0)
    addRowAfter(grown, (tr) => {
      grown = grown.apply(tr)
    })
    assert.equal(findBlockIdFixes(grown.doc).length, 1)
  })
})

describe('⑦ 셀 안의 인라인 수식', () => {
  test('셀 안의 수식을 (표 id, 순번)으로 가리키고 다시 찾는다', () => {
    const eq = (e: string): RichTextRun[] => [{ type: 'equation', annotations: textRun('').annotations, plain_text: e, href: null, equation: { expression: e } }]
    const t = table(row(eq('a'), 'x'), row('y', eq('b')))
    const state = stateOf([t])
    const positions: number[] = []
    state.doc.descendants((node, pos) => {
      if (node.type.name === EQUATION_NODE) positions.push(pos)
    })
    const ref = inlineEquationRefAt(state, positions[1]!)
    assert.deepEqual(ref, { blockId: t.id, index: 1 })
    assert.equal(findInlineEquation(state, ref!)?.expression, 'b')
  })
})

describe('⑧ 내보내기 · 평문', () => {
  const render = (markdown: string) => micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })

  test('★ GFM 표 — 첫 행이 머리 · `|` 는 이스케이프 · 줄바꿈은 <br> · 코드 안의 `|` 도', () => {
    const code: RichTextRun[] = [{ ...textRun('a|b'), annotations: { ...textRun('').annotations, code: true } }]
    const t = table(row('이름', '값'), row('파이프 | 하나', code), row('두\n줄', ''))
    const { markdown, losses } = pageToMarkdown({ title: [textRun('T')], doc: { blocks: [p('앞'), t, p('뒤')] } }, { page: () => null, image: () => null }, { untitled: 'x' })
    assert.match(markdown, /\| 이름 \| 값 \|\n\| --- \| --- \|\n\| 파이프 \\\| 하나 \| `a\\\|b` \|\n\| 두<br>줄 \|  \|/)
    const html = render(markdown)
    assert.match(html, /<table>/)
    assert.match(html, /<th>이름<\/th>/)
    assert.match(html, /<td>파이프 \| 하나<\/td>/)
    assert.match(html, /<code>a\|b<\/code>/)
    assert.equal(losses.flattened, 0, '행을 표 밖으로 펴지 않는다')
  })

  test('★ 평문 — 행마다 한 줄 · 셀은 탭', () => {
    assert.equal(plainTextForBlocks([table(row('a', 'b'), row('c\nd', ''))]), 'a\tb\nc d\t')
  })
})

describe('⑨ 동시 편집', () => {
  test('★ 두 사람이 다른 셀에 쓰면 둘 다 남는다', () => {
    const t = table(row('', ''), row('', ''))
    const base = createBodyYDoc({ blocks: [t] })
    const [a, b] = [peer(base, 1), peer(base, 2)]
    const ea = bind(a)
    const eb = bind(b)
    const typeAt = (editor: ReturnType<typeof bind>, r: number, c: number, text: string) => {
      const s = caretInCell(editor.state, t.id, r, c)
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, s.selection.from)).insertText(text))
    }
    typeAt(ea, 0, 0, '가')
    typeAt(eb, 1, 1, '나')
    exchange(a, b)
    const ra = readBodyYDoc(a, 'p')
    const rb = readBodyYDoc(b, 'p')
    assert.deepEqual(ra.fixes, [])
    assert.deepEqual(gridOf(ra.doc.blocks[0]!), [['가', ''], ['', '나']])
    assert.deepEqual(rb.doc, ra.doc)
  })

  test('★ 한쪽이 열을 더하는 동안 다른 쪽이 행을 더하면 — 모자란 행을 채운다(열을 버리지 않는다)', () => {
    const t = table(row('a', 'b'))
    const base = createBodyYDoc({ blocks: [t] })
    const [a, b] = [peer(base, 1), peer(base, 2)]
    const ea = bind(a)
    const eb = bind(b)
    const sa = caretInCell(ea.state, t.id, 0, 1)
    addColumnAfter(sa, (tr) => ea.dispatch(ea.state.tr.setSelection(TextSelection.create(ea.state.doc, sa.selection.from)).step(tr.steps[0]!)))
    const sb = caretInCell(eb.state, t.id, 0, 0)
    addRowAfter(sb, (tr) => eb.dispatch(eb.state.tr.setSelection(TextSelection.create(eb.state.doc, sb.selection.from)).step(tr.steps[0]!)))
    exchange(a, b)
    const read = readBodyYDoc(a, 'p')
    const grid = gridOf(read.doc.blocks[0]!)
    assert.equal(grid.length, 2)
    assert.ok(grid.every((cells) => cells.length === 3), JSON.stringify(grid))
    assert.ok(read.fixes.includes('table_cells_padded'), JSON.stringify(read.fixes))
    assert.deepEqual(readBodyYDoc(b, 'p').doc, read.doc)
    void Y
  })
})

describe('⑩ 행 · 열 · 머리(1d-2)', () => {
  const setup = () => {
    const t = table(row('a', 'b'), row('c', 'd'))
    return { t, state: stateOf([p('앞'), t]) }
  }
  const apply = (state: EditorState, id: string, change: TableEdit) => run(state, editTableCommand(id, change, nextId))

  test('★ 행 넣기 — 위 · 사이 · 끝 · 새 행은 빈 셀(열 수만큼)과 곧바로 id 를 받는다', () => {
    const { t, state } = setup()
    for (const [at, grid] of [
      [0, [['', ''], ['a', 'b'], ['c', 'd']]],
      [1, [['a', 'b'], ['', ''], ['c', 'd']]],
      [2, [['a', 'b'], ['c', 'd'], ['', '']]],
    ] as const) {
      const r = apply(state, t.id, { kind: 'add_row', at })
      assert.ok(r.handled)
      r.state.doc.check()
      const back = tablesOf(r.state)[0]!
      assert.deepEqual(gridOf(back), grid)
      const fresh = back.children![at]!.id
      assert.ok(findBlockIdFixes(r.state.doc).length === 0, '찍을 것이 없다 — 새 행이 이미 id 를 받았다')
      assert.ok(!t.children!.some((old) => old.id === fresh))
    }
  })

  test('★ 열 넣기 — 왼쪽 끝 · 사이 · 오른쪽 끝(행마다 그 자리에 빈 셀)', () => {
    const { t, state } = setup()
    assert.deepEqual(gridOf(tablesOf(apply(state, t.id, { kind: 'add_column', at: 0 }).state)[0]!), [['', 'a', 'b'], ['', 'c', 'd']])
    assert.deepEqual(gridOf(tablesOf(apply(state, t.id, { kind: 'add_column', at: 1 }).state)[0]!), [['a', '', 'b'], ['c', '', 'd']])
    assert.deepEqual(gridOf(tablesOf(apply(state, t.id, { kind: 'add_column', at: 2 }).state)[0]!), [['a', 'b', ''], ['c', 'd', '']])
  })

  test('★ 지우기 — 행 · 열 · 마지막 남은 행 · 열과 자리 밖은 하지 않는다', () => {
    const { t, state } = setup()
    assert.deepEqual(gridOf(tablesOf(apply(state, t.id, { kind: 'remove_row', index: 0 }).state)[0]!), [['c', 'd']])
    assert.deepEqual(gridOf(tablesOf(apply(state, t.id, { kind: 'remove_column', index: 1 }).state)[0]!), [['a'], ['c']])
    const one = apply(apply(state, t.id, { kind: 'remove_row', index: 0 }).state, t.id, { kind: 'remove_row', index: 0 })
    assert.equal(one.handled, false, '마지막 행')
    const narrow = apply(apply(state, t.id, { kind: 'remove_column', index: 0 }).state, t.id, { kind: 'remove_column', index: 0 })
    assert.equal(narrow.handled, false, '마지막 열')
    for (const change of [{ kind: 'remove_row', index: 2 }, { kind: 'add_row', at: 3 }, { kind: 'add_column', at: -1 }, { kind: 'remove_column', index: 5 }] as const) {
      assert.equal(apply(state, t.id, change).handled, false, JSON.stringify(change))
    }
    const notTable = state.doc.child(0).child(0).attrs.blockId as string
    assert.equal(apply(state, notTable, { kind: 'add_row', at: 0 }).handled, false, '표가 아닌 블록')
  })

  test('★ 머리 플래그 — 켜면 true · 끄면 키를 지운다 · 같은 값이면 하지 않는다', () => {
    const { t, state } = setup()
    const on = apply(state, t.id, { kind: 'header', key: 'has_column_header', on: true })
    assert.deepEqual(tablesOf(on.state)[0]!.properties, { has_column_header: true })
    assert.equal(apply(on.state, t.id, { kind: 'header', key: 'has_column_header', on: true }).handled, false)
    const off = apply(on.state, t.id, { kind: 'header', key: 'has_column_header', on: false })
    assert.deepEqual(tablesOf(off.state)[0]!.properties, {})
    const rowHeader = apply(state, t.id, { kind: 'header', key: 'has_row_header', on: true })
    assert.deepEqual(tablesOf(rowHeader.state)[0]!.properties, { has_row_header: true })
  })

  test('캐럿이 있던 행을 지워도 문서 · 선택이 맞다 · 고친 표는 정규화가 고칠 것이 없다', () => {
    const { t, state } = setup()
    const inCell = caretInCell(state, t.id, 1, 1, 1)
    const removed = apply(inCell, t.id, { kind: 'remove_row', index: 1 })
    removed.state.doc.check()
    assert.ok(removed.state.selection.from <= removed.state.doc.content.size)
    let s = removed.state
    for (const change of [{ kind: 'add_column', at: 1 }, { kind: 'add_row', at: 0 }, { kind: 'header', key: 'has_row_header', on: true }] as const) {
      s = apply(s, t.id, change).state
    }
    assert.deepEqual(readBodyYDoc(createBodyYDoc(pmToDoc(s.doc)), nextId()).fixes, [])
    assert.deepEqual(validateDoc(pmToDoc(s.doc)), [])
  })

  test('마지막 셀의 Tab 이 만든 행도 곧바로 id 를 받는다(찍기를 기다리지 않는다)', () => {
    const { t, state } = setup()
    const grown = run(caretInCell(state, t.id, 1, 1), keymap.Tab!)
    assert.deepEqual(findBlockIdFixes(grown.state.doc), [])
    assert.equal(tablesOf(grown.state)[0]!.children!.length, 3)
  })
})

describe('⑪ 메뉴', () => {
  const select = (state: EditorState, id: string) => state.apply(state.tr.setSelection(BlockSelection.create(state.doc, findContainerById(state.doc, id)!.pos)))

  test('★ 블록 메뉴의 \'표\' — 표 하나일 때 켜진다 · 머리 플래그의 체크 · 끝에 더하기의 자리', () => {
    const t = { ...table(row('a', 'b'), row('c', 'd')), properties: { has_row_header: true } }
    const other = p('글')
    const state = stateOf([other, t])
    const tableItem = (s: EditorState) => blockMenuItems(s, deps).find((i) => i.id === 'table')!
    assert.equal(tableItem(select(state, other.id)).enabled, false)
    const item = tableItem(select(state, t.id))
    assert.equal(item.enabled, true)
    const byId = new Map(item.children!.map((c) => [c.id, c]))
    assert.equal(byId.get('table:column_header')!.checked, false)
    assert.equal(byId.get('table:row_header')!.checked, true)
    assert.deepEqual(byId.get('table:row_header')!.action, { kind: 'table_edit', blockId: t.id, change: { kind: 'header', key: 'has_row_header', on: false } })
    assert.deepEqual(byId.get('table:add_row')!.action, { kind: 'table_edit', blockId: t.id, change: { kind: 'add_row', at: 2 } })
    assert.deepEqual(byId.get('table:add_column')!.action, { kind: 'table_edit', blockId: t.id, change: { kind: 'add_column', at: 2 } })
    // 둘을 고르면 꺼진다 — 어느 표인지 모른다.
    const both = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, findContainerById(state.doc, other.id)!.pos, findContainerById(state.doc, t.id)!.pos)))
    assert.equal(tableItem(both).enabled, false)
  })

  test('★ 손잡이 메뉴 — 행은 위 · 아래 · 지우기, 열은 왼쪽 · 오른쪽 · 지우기 · 마지막이면 지우기가 꺼진다', () => {
    const t = table(row('a', 'b'))
    const state = stateOf([t])
    const rows = tableAxisMenuItems(state, t.id, 'row', 0)
    assert.deepEqual(rows.map((i) => [i.id, i.enabled]), [['row:above', true], ['row:below', true], ['row:remove', false]])
    assert.deepEqual(rows[1]!.action, { kind: 'table_edit', blockId: t.id, change: { kind: 'add_row', at: 1 } })
    const columns = tableAxisMenuItems(state, t.id, 'column', 1)
    assert.deepEqual(columns.map((i) => [i.id, i.enabled]), [['column:left', true], ['column:right', true], ['column:remove', true]])
    assert.deepEqual(columns[2]!.action, { kind: 'table_edit', blockId: t.id, change: { kind: 'remove_column', index: 1 } })
    assert.deepEqual(tableAxisMenuItems(state, 'not-a-table', 'row', 0), [])
  })
})
