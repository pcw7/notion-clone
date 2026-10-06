/**
 * 인라인 수식 — 찾기 · 쓰기 · 만들기 · 입력 규칙 · 가져오기 (Phase 2 1b · F-01-20 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 찾기 — (블록 id, 순번)으로 가리킨다 · 앞에 글자를 넣어도 같은 수식이다 · 없으면 null
 *   ② ★ 쓰기 — 같으면 쓰지 않는다 · 비우면 그 수식을 지운다 · 상한까지 자른다 · 서식(마크와 거울 attr)을 지킨다
 *   ③ 빈 수식 지우기 — 빈 것만
 *   ④ ★ Ctrl/Cmd+Shift+E — 고른 글자가 식이 된다(서식 이어받기 · 캐럿은 뒤) · 고른 것이 없으면 빈 수식 + 입력창 · 코드 블록 · 여러
 *      블록은 아니다 · 골라진 인라인 수식의 Enter 는 입력창
 *   ⑤ ★ `$$식$$` 입력 규칙 — 닫는 순간 수식 · 빈 식 · 코드 블록은 아니다
 *   ⑥ ★ 가져오기 — 우리 내보내기의 `` `$식$` `` · 노션의 `$식$` · `$$식$$` 는 수식, `$5 와 $10` · `\$x\$` 는 글자 · 식 안의 `*` `_` 는
 *      강조가 아니다 · 내보내기 → 가져오기 왕복
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, NodeSelection, TextSelection, type Command } from '@tiptap/pm/state'

import { equationRun, pageMentionRun, textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { markdownToDoc } from '../import/markdown.ts'
import type { EditorBlock } from './document.ts'
import {
  findInlineEquation,
  inlineEquationRefAt,
  insertInlineEquationCommand,
  openSelectedInlineEquationCommand,
  removeEmptyInlineEquationCommand,
  setInlineEquationCommand,
  type InlineEquationRef,
} from './inline-equation.ts'
import { inputRulesPlugin } from './input-rules.ts'
import { createEditorKeymap } from './keymap.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, title: RichTextRun[] = []): EditorBlock => ({ id: nextId(), type: type as EditorBlock['type'], title, properties: {}, format: {}, children: [] })
const stateOf = (blocks: EditorBlock[], plugins: EditorState['plugins'] = []) =>
  EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

/** 블록 안의 글자 위치(0부터)에 캐럿 · 범위. */
function select(state: EditorState, blockId: string, from: number, to = from): EditorState {
  const info = findContainerById(state.doc, blockId)!
  const base = info.contentPos + 1
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, base + from, base + to)))
}

/** 한 글자씩 — 입력 규칙 플러그인을 거친다. */
function type(state: EditorState, text: string): EditorState {
  let current = state
  for (const char of text) {
    const { from, to } = current.selection
    const plugin = current.plugins.find((p) => p.props.handleTextInput)
    const view = { state: current, dispatch: (tr: never) => (current = current.apply(tr)), composing: false }
    const handled = plugin?.props.handleTextInput?.call(plugin, view as never, from, to, char, () => null)
    if (!handled) current = current.apply(current.tr.insertText(char, from, to))
  }
  return current
}

const titleOf = (state: EditorState, index = 0) => pmToDoc(state.doc).blocks[index]?.title ?? []
/** 조각의 모양 — 수식은 `⟦식⟧`, 글자는 그대로. 수식을 `$식$` 로 적으면 글자 `$식$` 과 가를 수 없다(반사실이 살아남았다). */
const kinds = (runs: readonly RichTextRun[]) => runs.map((r) => (r.type === 'equation' ? `⟦${r.equation?.expression}⟧` : toPlainText([r])))

describe('① ② ③ 찾기 · 쓰기', () => {
  test('★ (블록 id, 순번)으로 가리킨다 · 앞에 글자를 넣어도 같은 수식', () => {
    // 순번은 수식끼리만 센다 — 사이의 멘션(다른 인라인 원자)은 세지 않는다
    const p = blk('paragraph', [textRun('a '), equationRun('x'), textRun(' b '), pageMentionRun(nextId()), equationRun('y')])
    let state = stateOf([p])
    const ref: InlineEquationRef = { blockId: p.id, index: 1 }
    assert.equal(findInlineEquation(state, ref)?.expression, 'y')
    assert.deepEqual(inlineEquationRefAt(state, findInlineEquation(state, ref)!.pos), ref)
    state = state.apply(state.tr.insertText('앞에 넣은 글 ', findContainerById(state.doc, p.id)!.contentPos + 1))
    assert.equal(findInlineEquation(state, ref)?.expression, 'y')
    assert.equal(findInlineEquation(state, { blockId: p.id, index: 2 }), null)
    assert.equal(findInlineEquation(state, { blockId: nextId(), index: 0 }), null)
  })

  test('★ 쓰기 — 같으면 쓰지 않는다 · 비우면 지운다 · 자른다 · 서식을 지킨다', () => {
    const p = blk('paragraph', [textRun('a '), equationRun('x', { bold: true, color: 'red' }), textRun(' b')])
    const state = stateOf([p])
    const ref = { blockId: p.id, index: 0 }
    const written = run(state, setInlineEquationCommand(ref, 'x^2'))
    assert.ok(written)
    const run0 = titleOf(written).find((r) => r.type === 'equation')
    assert.equal(run0?.equation?.expression, 'x^2')
    assert.equal(run0?.annotations.bold, true)
    assert.equal(run0?.annotations.color, 'red')
    assert.equal(run(written, setInlineEquationCommand(ref, 'x^2')), null, '같은 식을 다시 썼다')
    const long = run(state, setInlineEquationCommand(ref, 'z'.repeat(1500)))!
    assert.equal(findInlineEquation(long, ref)?.expression.length, 1000)
    const cleared = run(state, setInlineEquationCommand(ref, '  '))!
    assert.deepEqual(kinds(titleOf(cleared)), ['a  b'])
    assert.equal(run(state, setInlineEquationCommand({ blockId: p.id, index: 3 }, 'q')), null)
  })

  test('빈 수식 지우기 — 빈 것만', () => {
    const p = blk('paragraph', [equationRun(''), textRun(' 사이 '), equationRun('x')])
    const state = stateOf([p])
    assert.equal(run(state, removeEmptyInlineEquationCommand({ blockId: p.id, index: 1 })), null)
    const removed = run(state, removeEmptyInlineEquationCommand({ blockId: p.id, index: 0 }))!
    assert.deepEqual(kinds(titleOf(removed)), [' 사이 ', '⟦x⟧'])
  })
})

describe('④ Ctrl/Cmd+Shift+E · Enter', () => {
  test('★ 고른 글자가 식이 된다 — 서식 이어받기 · 캐럿은 뒤 · 입력창은 열지 않는다', () => {
    const p = blk('paragraph', [textRun('값은 '), { ...textRun('a+b'), annotations: { ...textRun('').annotations, italic: true } }, textRun(' 다')])
    const opened: InlineEquationRef[] = []
    const next = run(select(stateOf([p]), p.id, 3, 6), insertInlineEquationCommand((ref) => opened.push(ref)))!
    const runs = titleOf(next)
    assert.deepEqual(kinds(runs), ['값은 ', '⟦a+b⟧', ' 다'])
    assert.equal(runs[1]?.annotations.italic, true)
    const eq = findInlineEquation(next, { blockId: p.id, index: 0 })!
    assert.equal(next.selection.from, eq.pos + 1, '캐럿이 수식 뒤가 아니다')
    assert.deepEqual(opened, [])
  })

  test('★ 고른 것이 없으면 빈 수식을 넣고 입력창을 연다', () => {
    const p = blk('paragraph', [textRun('ab')])
    const opened: InlineEquationRef[] = []
    let current = select(stateOf([p]), p.id, 1)
    const view = { state: current, editable: true, dispatch: (tr: never) => { current = current.apply(tr); view.state = current } }
    assert.ok(insertInlineEquationCommand((ref) => opened.push(ref))(current, view.dispatch, view as never))
    assert.deepEqual(kinds(titleOf(current)), ['a', '⟦⟧', 'b'])
    assert.deepEqual(opened, [{ blockId: p.id, index: 0 }])
  })

  test('코드 블록 · 여러 블록에 걸친 선택은 아니다', () => {
    const c = blk('code', [textRun('x')])
    const a = blk('paragraph', [textRun('a')])
    const b = blk('paragraph', [textRun('b')])
    const state = stateOf([c, a, b])
    assert.equal(run(select(state, c.id, 0, 1), insertInlineEquationCommand(() => undefined)), null)
    const aInfo = findContainerById(state.doc, a.id)!
    const bInfo = findContainerById(state.doc, b.id)!
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, aInfo.contentPos + 1, bInfo.contentPos + 2)))
    assert.equal(run(across, insertInlineEquationCommand(() => undefined)), null)
  })

  test('★ 골라진 인라인 수식의 Enter 는 입력창 · 키맵에 Mod-Shift-e 가 선다', () => {
    const p = blk('paragraph', [textRun('a'), equationRun('x')])
    const state = stateOf([p])
    const eq = findInlineEquation(state, { blockId: p.id, index: 0 })!
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, eq.pos)))
    const opened: InlineEquationRef[] = []
    assert.ok(openSelectedInlineEquationCommand((ref) => opened.push(ref))(selected, () => undefined))
    assert.deepEqual(opened, [{ blockId: p.id, index: 0 }])
    assert.equal(openSelectedInlineEquationCommand(() => undefined)(select(state, p.id, 1), () => undefined), false)
    const bindings = createEditorKeymap({ isCollapsed: () => false, openInlineEquation: () => undefined })
    assert.equal(typeof bindings['Mod-Shift-e'], 'function')
    assert.equal(createEditorKeymap({ isCollapsed: () => false })['Mod-Shift-e'], undefined)
  })
})

describe('⑤ $$식$$ 입력 규칙', () => {
  test('★ 닫는 순간 수식이 된다 · 빈 식 · 코드 블록은 아니다', () => {
    const p = blk('paragraph')
    const typed = type(select(stateOf([p], [inputRulesPlugin()]), p.id, 0), '넓이 $$\\pi r^2$$ 다')
    assert.deepEqual(kinds(titleOf(typed)), ['넓이 ', '⟦\\pi r^2⟧', ' 다'])
    const blank = type(select(stateOf([p], [inputRulesPlugin()]), p.id, 0), '$$  $$')
    assert.deepEqual(kinds(titleOf(blank)), ['$$  $$'])
    const c = blk('code')
    const inCode = type(select(stateOf([c], [inputRulesPlugin()]), c.id, 0), '$$x$$')
    assert.deepEqual(kinds(titleOf(inCode)), ['$$x$$'])
  })
})

describe('⑥ 가져오기', () => {
  const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }
  const runsOf = (md: string) => markdownToDoc(md).doc.blocks[0]?.title ?? []

  test('★ 코드 스팬의 $식$ · 노션의 $식$ · $$식$$ 는 수식', () => {
    assert.deepEqual(kinds(runsOf('값 `$x^2$` 이다')), ['값 ', '⟦x^2⟧', ' 이다'])
    assert.deepEqual(kinds(runsOf('값 $x^2$ 이다')), ['값 ', '⟦x^2⟧', ' 이다'])
    assert.deepEqual(kinds(runsOf('값 $$y$$ 이다')), ['값 ', '⟦y⟧', ' 이다'])
    assert.deepEqual(kinds(runsOf('$a$')), ['⟦a⟧'])
  })

  test('★ 돈 · 이스케이프 · 공백 붙은 $ 는 글자 · 식 안의 * _ 는 강조가 아니다', () => {
    assert.deepEqual(kinds(runsOf('$5 와 $10')), ['$5 와 $10'])
    assert.deepEqual(kinds(runsOf('\\$x\\$')), ['$x$'])
    assert.deepEqual(kinds(runsOf('$ x$ 와 $x $')), ['$ x$ 와 $x $'])
    assert.deepEqual(kinds(runsOf('값 $x$1')), ['값 $x$1'])
    assert.deepEqual(kinds(runsOf('$a_1 * b_2 * c_3$')), ['⟦a_1 * b_2 * c_3⟧'])
    assert.equal(runsOf('보통 `코드` 다')[1]?.annotations.code, true)
  })

  test('★ 내보내기 → 가져오기 왕복 — 서식까지', () => {
    const title = [textRun('넓이는 '), equationRun('\\pi r^2', { bold: true }), textRun(' 이다')]
    const { markdown } = pageToMarkdown({ title: [textRun('T')], doc: { blocks: [blk('paragraph', title)] } }, NO_LINKS, { untitled: 'x' })
    const back = markdownToDoc(markdown).doc.blocks[0]?.title ?? []
    assert.deepEqual(kinds(back), ['넓이는 ', '⟦\\pi r^2⟧', ' 이다'])
    assert.equal(back[1]?.annotations.bold, true)
  })
})
