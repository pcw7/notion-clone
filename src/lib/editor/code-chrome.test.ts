/**
 * 코드 블록의 크롬 — 잔여 묶음 8a-2 (F-01-14 · 실제 ProseMirror 문서 위에서 · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 언어 · 줄바꿈 · 캡션 명령 — 블록 id 로 찾는다 · 새 객체로 바꾼다(제자리 수정 없음) · 바뀐 것이 없으면 false · 코드가
 *      아니면 false · plain text · 끔 · 빈 캡션은 키를 지운다 · 글자가 같은 캡션은 받은 서식을 지킨다
 *   ② ★ 블록 메뉴의 '코드' — 늘 있고 · 고른 블록이 모두 코드일 때 켜진다 · 언어 · 캡션 · 복사는 하나일 때 · 줄바꿈은 여럿을 함께
 *   ③ 코드를 문단으로 바꾸면 줄바꿈이 사라진다(`normalizeFormat` · 정본 ⑥)
 *   ④ 내보내기 · 블록 복사의 평문이 캡션을 싣는다(정본 F-09-14 "조용히 버리지 않는다")
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'

import type { BlockType } from '../block/types.ts'
import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { blockMenuItems, setCodeWrapSelectionCommand } from './block-menu.ts'
import { BlockSelection } from './block-selection.ts'
import { codeBlockInfo, setCodeCaptionCommand, setCodeLanguageCommand, setCodeWrapCommand } from './code-block.ts'
import { turnIntoCommand } from './commands.ts'
import type { EditorBlock } from './document.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const deps = { isCollapsed: () => false, newId: nextId }

function blk(type: BlockType, title: RichTextRun[] = [], properties: Record<string, unknown> = {}, format: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type, title, properties, format, children: [] }
}
const code = (text: string, properties: Record<string, unknown> = {}, format: Record<string, unknown> = {}) =>
  blk('code', text === '' ? [] : [textRun(text)], properties, format)

const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

const propsOf = (state: EditorState, id: string) => findContainerById(state.doc, id)?.contentNode.attrs.props as Record<string, unknown>
const formatOf = (state: EditorState, id: string) => findContainerById(state.doc, id)?.contentNode.attrs.format as Record<string, unknown>

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 명령', () => {
  test('★ 언어 — 새 객체로 바꾼다 · 같으면 false · null 은 키를 지운다 · 다른 키(캡션)는 남는다', () => {
    const c = code('x', { caption: [textRun('설명')] })
    const state = stateOf([c])
    const before = propsOf(state, c.id)
    const next = run(state, setCodeLanguageCommand(c.id, 'python'))
    assert.ok(next)
    assert.deepEqual(propsOf(next, c.id), { caption: [textRun('설명')], language: 'python' })
    assert.deepEqual(before, { caption: [textRun('설명')] }, '원래 props 객체를 제자리에서 고쳤다(Y update 가 생기지 않는다)')
    assert.notEqual(propsOf(next, c.id), before)

    assert.ok(run(next, setCodeLanguageCommand(c.id, 'python')) === null, '같은 값을 다시 썼다')
    const plain = run(next, setCodeLanguageCommand(c.id, null))
    assert.ok(plain)
    assert.deepEqual(propsOf(plain, c.id), { caption: [textRun('설명')] })
    assert.ok(run(plain, setCodeLanguageCommand(c.id, 'plain text')) === null)
  })

  test('★ 줄바꿈 — 켜면 code_wrap: true · 끄면 키 삭제 · 같으면 false', () => {
    const c = code('x')
    const on = run(stateOf([c]), setCodeWrapCommand(c.id, true))
    assert.ok(on)
    assert.deepEqual(formatOf(on, c.id), { code_wrap: true })
    assert.ok(run(on, setCodeWrapCommand(c.id, true)) === null)
    const off = run(on, setCodeWrapCommand(c.id, false))
    assert.ok(off)
    assert.deepEqual(formatOf(off, c.id), {})
  })

  test('★ 캡션 — 평문 한 런 · 글자가 같으면 받은 서식을 지키고 쓰지 않는다 · 비우면 키 삭제', () => {
    const bold = [textRun('굵은 설명', { bold: true })]
    const c = code('x', { caption: bold })
    const state = stateOf([c])
    assert.ok(run(state, setCodeCaptionCommand(c.id, '굵은 설명')) === null, '글자가 같은데 썼다(서식이 사라진다)')
    assert.ok(run(state, setCodeCaptionCommand(c.id, '  굵은 설명  ')) === null, '앞뒤 공백만 다른데 썼다')
    const changed = run(state, setCodeCaptionCommand(c.id, '새 설명'))
    assert.ok(changed)
    assert.deepEqual(propsOf(changed, c.id).caption, [textRun('새 설명')])
    const cleared = run(changed, setCodeCaptionCommand(c.id, '   '))
    assert.ok(cleared)
    assert.equal('caption' in propsOf(cleared, c.id), false)
  })

  test('코드 블록이 아니거나 없는 블록이면 아무것도 하지 않는다 — 오버레이가 연 사이에 바뀌었을 수 있다', () => {
    const p = blk('paragraph', [textRun('문단')])
    const state = stateOf([p])
    assert.ok(run(state, setCodeLanguageCommand(p.id, 'python')) === null)
    assert.ok(run(state, setCodeWrapCommand(p.id, true)) === null)
    assert.ok(run(state, setCodeCaptionCommand(p.id, '캡션')) === null)
    assert.ok(run(state, setCodeLanguageCommand(nextId(), 'python')) === null)
    assert.equal(codeBlockInfo(state, p.id), null)
  })

  test('명령은 수선이 오기 전의 bigint 에도 던지지 않는다 — 바뀌었는지를 JSON 직렬화로 세지 않는다', () => {
    // 상태에 직접 넣는다 — 블록에서 문서를 만들면 쓰는 쪽(`contentNodeFor`)이 bigint 를 먼저 뺀다. 협업 문서는 수선이 오기 전까지 이런
    // attr 을 그대로 싣는다.
    const c = code('x')
    const base = stateOf([c])
    const info = findContainerById(base.doc, c.id)
    assert.ok(info)
    const poisoned = base.apply(base.tr.setNodeMarkup(info.contentPos, undefined, { ...info.contentNode.attrs, props: { n: 1n } }))
    let next: EditorState | null = null
    assert.doesNotThrow(() => {
      next = run(poisoned, setCodeWrapCommand(c.id, true))
    })
    assert.ok(next)
    assert.deepEqual(formatOf(next, c.id), { code_wrap: true })
  })

  test('codeBlockInfo — 모양이 틀린 캡션 · 언어에도 던지지 않는다', () => {
    const c = code('print(1)', { language: 12345, caption: [null, textRun('남음')] }, { code_wrap: true })
    const info = codeBlockInfo(stateOf([c]), c.id)
    assert.ok(info)
    assert.deepEqual([info.language, info.wrap, info.caption, info.text], [null, true, '남음', 'print(1)'])
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 블록 메뉴의 코드 항목', () => {
  const menu = (state: EditorState) => {
    const items = blockMenuItems(state, deps)
    const top = items.find((i) => i.id === 'code')
    assert.ok(top, "블록 메뉴에 '코드' 가 없다")
    return { top, child: (id: string) => top.children?.find((c) => c.id === id) }
  }
  const select = (state: EditorState, fromId: string, toId = fromId) => {
    const from = findContainerById(state.doc, fromId)
    const to = findContainerById(state.doc, toId)
    assert.ok(from && to)
    return state.apply(state.tr.setSelection(BlockSelection.create(state.doc, from.pos, to.pos)))
  }

  test("★ '코드' 는 늘 있고 · 코드 블록 하나를 고르면 전부 켜진다 · 문단을 고르면 꺼진다", () => {
    const c = code('x')
    const p = blk('paragraph', [textRun('문단')])
    const one = menu(select(stateOf([c, p]), c.id))
    assert.equal(one.top.enabled, true)
    for (const id of ['code:language', 'code:wrap', 'code:caption', 'code:copy']) assert.equal(one.child(id)?.enabled, true, id)
    assert.equal(one.child('code:wrap')?.toggle, true)
    assert.equal(one.child('code:wrap')?.checked, false)

    const para = menu(select(stateOf([c, p]), p.id))
    assert.equal(para.top.enabled, false, '문단을 골랐는데 코드 항목이 켜졌다')
  })

  test('코드 블록 여럿 — 줄바꿈만 켜지고(함께 바꾼다) · 언어 · 캡션 · 복사는 꺼진다 · 섞이면 전부 꺼진다', () => {
    const a = code('a', {}, { code_wrap: true })
    const b = code('b', {}, { code_wrap: true })
    const p = blk('paragraph', [textRun('문단')])
    const both = menu(select(stateOf([a, b, p]), a.id, b.id))
    assert.equal(both.child('code:wrap')?.enabled, true)
    assert.equal(both.child('code:wrap')?.checked, true)
    for (const id of ['code:language', 'code:caption', 'code:copy']) assert.equal(both.child(id)?.enabled, false, id)
    assert.equal(menu(select(stateOf([a, b, p]), a.id, p.id)).top.enabled, false)
  })

  test('★ 줄바꿈 명령은 고른 코드 블록 전부를 한 트랜잭션에 · 코드가 아닌 블록은 건너뛴다', () => {
    const a = code('a')
    const b = code('b', {}, { code_wrap: true })
    const p = blk('paragraph', [textRun('문단')])
    const state = select(stateOf([a, b, p]), a.id, p.id)
    const next = run(state, setCodeWrapSelectionCommand(true))
    assert.ok(next)
    assert.deepEqual([formatOf(next, a.id), formatOf(next, b.id), formatOf(next, p.id)], [{ code_wrap: true }, { code_wrap: true }, {}])
    const off = run(next, setCodeWrapSelectionCommand(false))
    assert.ok(off)
    assert.deepEqual([formatOf(off, a.id), formatOf(off, b.id)], [{}, {}])
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 바꾸기', () => {
  test('코드를 문단으로 바꾸면 줄바꿈이 사라진다 — 문단에 code_wrap 이 남지 않는다(정본 ⑥)', () => {
    const c = code('x', { language: 'python' }, { code_wrap: true })
    let state = stateOf([c])
    const info = findContainerById(state.doc, c.id)
    assert.ok(info)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    const next = run(state, turnIntoCommand('paragraph', deps))
    assert.ok(next)
    const [block] = pmToDoc(next.doc).blocks
    assert.equal(block?.type, 'paragraph')
    assert.equal(block?.format?.code_wrap, undefined, '문단에 줄바꿈이 남았다')
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 내보내기 · 블록 복사', () => {
  const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }

  test('★ Markdown — 울타리 뒤에 캡션 문단(이스케이프) · 캡션이 없으면 울타리만', () => {
    const doc = { blocks: [code('x = 1', { language: 'python', caption: [textRun('*강조 아님* 설명')] }), code('y')] }
    const { markdown } = pageToMarkdown({ title: [textRun('T')], doc }, NO_LINKS, { untitled: 'x' })
    assert.ok(markdown.includes('```python\nx = 1\n```\n\n\\*강조 아님\\* 설명'), markdown)
    assert.ok(markdown.includes('```\ny\n```'), markdown)
  })

  test('Markdown — 캡션의 줄머리(# · - · 1.)는 이스케이프한다 — 제목 · 목록으로 읽히지 않게', () => {
    const doc = { blocks: [code('z', { caption: [textRun('# 제목 아님\n- 목록 아님\n1. 번호 아님')] })] }
    const { markdown } = pageToMarkdown({ title: [textRun('T')], doc }, NO_LINKS, { untitled: 'x' })
    for (const line of ['\\# 제목 아님', '\\- 목록 아님', '1\\. 번호 아님']) assert.ok(markdown.includes(line), `${line}\n${markdown}`)
  })

  test('블록 복사의 평문 — 울타리 뒤에 캡션 한 줄', () => {
    assert.equal(plainTextForBlocks([code('a', { caption: [textRun('설명')] })]), '```\na\n```\n설명')
  })
})
