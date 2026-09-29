/**
 * 코드 블록 — 잔여 묶음 8a-1 (F-01-14 · 실제 ProseMirror 문서 위에서 · DOM 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 저장 모양 — 노드는 `code_block`(인라인 마크 `code` 와 겹치지 않는다) · 노드 이름 ↔ 타입 사상이 모든 타입에서 되돌아온다
 *   ② ★ 문서 ↔ ProseMirror 왕복 — 줄바꿈 · 언어(목록 밖의 값도) 보존 · 서식 · 멘션 · 수식은 평문으로 편다
 *   ③ ★ Enter 는 줄바꿈 · Tab 은 들여쓰기 글자(여러 줄은 줄마다) · Shift+Tab 은 떼기 · Mod+Enter 는 빠져나오기
 *   ④ ★ 코드로 바꾸기 — 서식 · 멘션 · 수식이 든 문단도 던지지 않고 편다 · 블록 메뉴가 사용 가능 여부를 셀 때도 · Mod+Alt+8
 *   ⑤ ★ 입력 규칙 ```` ``` ```` 은 코드 블록을 만든다 · 코드 안에서는 마크다운 · `/` · `@` 가 글자다
 *   ⑥ 합치기 — 서식 든 문단을 코드 블록에 합쳐도 평문
 *   ⑦ ★ 정규화 — 동시 편집으로 코드 블록에 섞인 서식 · 원자를 편다(`plain_text_flattened`)
 *   ⑧ ★ Y.Doc — 요소 이름은 `code_block` · 읽으면 타입 `code`
 *   ⑨ 내보내기 · 블록 복사의 평문 — 울타리 · 언어 · 이스케이프 없음 · 본문 검증
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { BLOCK_TYPES, type BlockType } from '../block/types.ts'
import { DEFAULT_ANNOTATIONS, pageMentionRun, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc, BODY_FRAGMENT } from '../collab/ydoc.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { blockSchema, blockTypeOfNode, nodeNameOf } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { createBlockKeymap, mergeBackwardCommand, splitBlockCommand, turnIntoCommand } from './commands.ts'
import { findContainerById } from './pm-blocks.ts'
import { inputRulesPlugin } from './input-rules.ts'
import { slashMenuPlugin, slashMenuState } from './slash-menu.ts'
import { mentionMenuPlugin, mentionMenuState } from './mention-menu.ts'
import { blockMenuItems } from './block-menu.ts'
import { selectBlockCommand } from './block-selection.ts'
import { createEditorKeymap } from './keymap.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { validateDoc, type EditorBlock, type EditorDoc } from './document.ts'

// ── 도우미 ────────────────────────────────────────────────────────────

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const deps = { isCollapsed: () => false, newId: nextId }

function blk(type: BlockType, title: RichTextRun[] = [], properties: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type, title, properties, format: {}, children: [] }
}

const code = (text: string, properties: Record<string, unknown> = {}) => blk('code', text === '' ? [] : [textRun(text)], properties)
const para = (...runs: RichTextRun[]) => blk('paragraph', runs)
const equationRun = (expression: string): RichTextRun => ({
  type: 'equation',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: expression,
  href: null,
  equation: { expression },
})

function stateOf(blocks: EditorBlock[], plugins: EditorState['plugins'] = []): EditorState {
  return EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })
}

function caret(state: EditorState, blockId: string, from: number, to = from): EditorState {
  const info = findContainerById(state.doc, blockId)
  assert.ok(info, `블록을 찾지 못했다: ${blockId}`)
  const base = info.contentPos + 1
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, base + from, base + to)))
}

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

/** 한 글자씩 — 입력 규칙 플러그인이 있으면 그것을 거친다(`input-rules.test.ts` 와 같은 재현). */
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

/** 최상위 블록들의 (노드 이름, 글자). */
function shape(state: EditorState): [string, string][] {
  const out: [string, string][] = []
  state.doc.child(0).forEach((container) => {
    const content = container.child(0)
    out.push([content.type.name, content.textContent])
  })
  return out
}

const hasMarks = (node: PmNode) => {
  let found = false
  node.descendants((n) => {
    if (n.marks.length > 0 || (n.isInline && !n.isText)) found = true
  })
  return found
}

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 저장 모양', () => {
  test('★ 노드는 code_block — 인라인 마크 code 는 그대로 · 평문 노드다', () => {
    assert.ok(blockSchema.nodes.code_block, 'code_block 노드가 없다')
    assert.equal(blockSchema.nodes.code, undefined, 'code 가 노드가 됐다(마크 이름과 겹친다)')
    assert.ok(blockSchema.marks.code, '인라인 코드 마크가 사라졌다')
    assert.equal(blockSchema.nodes.code_block.spec.code, true)
    assert.equal(blockSchema.nodes.code_block.spec.marks, '')
  })

  test('★ 노드 이름 ↔ 타입이 모든 타입에서 되돌아온다 — 코드 · 페이지는 이름이 다르다', () => {
    for (const t of Object.keys(BLOCK_TYPES) as BlockType[]) {
      assert.equal(blockTypeOfNode(nodeNameOf(t)), t, t)
      assert.ok(blockSchema.nodes[nodeNameOf(t)], `${t} 의 노드(${nodeNameOf(t)})가 스키마에 없다`)
    }
    assert.equal(nodeNameOf('code'), 'code_block')
    assert.equal(nodeNameOf('page'), 'page_ref')
    assert.equal(blockTypeOfNode('code'), 'unsupported', '타입 이름 code 는 노드 이름이 아니다')
    assert.equal(blockTypeOfNode('모르는 노드'), 'unsupported')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 왕복', () => {
  test('★ 줄바꿈 · 언어(목록 밖의 값도)가 그대로 돌아온다', () => {
    const a = code('function f() {\n\treturn 1\n}', { language: 'typescript' })
    const b = code('x', { language: 'my weird lang' })
    const back = pmToDoc(docToPm({ blocks: [a, b] }))
    assert.deepEqual(
      back.blocks.map((x) => [x.type, x.title.map((r) => r.plain_text).join(''), x.properties?.language]),
      [
        ['code', 'function f() {\n\treturn 1\n}', 'typescript'],
        ['code', 'x', 'my weird lang'],
      ],
    )
  })

  test('★ 서식 · 멘션 · 수식이 든 제목은 평문으로 편다 — 수식은 식의 글자 · 멘션은 뺀다', () => {
    const block = blk('code', [textRun('굵게', { bold: true }), pageMentionRun(nextId()), equationRun('x^2'), textRun(' 끝')])
    const pm = docToPm({ blocks: [block] })
    assert.equal(pm.child(0).child(0).child(0).textContent, '굵게x^2 끝')
    assert.equal(hasMarks(pm), false, '코드 블록에 서식 · 원자가 남았다')
    assert.doesNotThrow(() => pm.check(), '스키마에 맞지 않는 문서')
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 키', () => {
  test('★ Enter 는 블록을 쪼개지 않고 줄바꿈 글자를 넣는다', () => {
    const c = code('ab')
    const next = run(caret(stateOf([c]), c.id, 1), splitBlockCommand(deps))
    assert.ok(next)
    assert.deepEqual(shape(next), [['code_block', 'a\nb']])
  })

  test('★ Tab 은 들여쓰기 글자 · 여러 줄을 골랐으면 줄마다 · Shift+Tab 은 뗀다 — 블록을 중첩하지 않는다', () => {
    const keys = createBlockKeymap(deps)
    const one = code('x')
    const tabbed = run(caret(stateOf([para(textRun('앞')), one]), one.id, 0), keys.Tab)
    assert.ok(tabbed)
    assert.deepEqual(shape(tabbed), [['paragraph', '앞'], ['code_block', '\tx']], '코드 블록이 앞 블록의 자식이 됐다')

    const many = code('a\nb\nc')
    const indented = run(caret(stateOf([many]), many.id, 0, 3), keys.Tab)
    assert.ok(indented)
    assert.deepEqual(shape(indented), [['code_block', '\ta\n\tb\nc']])

    const outdented = run(indented.apply(indented.tr), keys['Shift-Tab'])
    assert.ok(outdented)
    assert.deepEqual(shape(outdented), [['code_block', 'a\nb\nc']])
  })

  test('★ Mod+Enter 는 빠져나온다 — 뒤에 빈 문단 · 캐럿이 그리로 · 코드 밖이면 아무것도 안 한다', () => {
    const keys = createBlockKeymap(deps)
    const c = code('x')
    const out = run(caret(stateOf([c]), c.id, 1), keys['Mod-Enter'])
    assert.ok(out)
    assert.deepEqual(shape(out), [['code_block', 'x'], ['paragraph', '']])
    assert.equal(out.selection.$from.parent.type.name, 'paragraph')

    const p = para(textRun('문단'))
    assert.equal(run(caret(stateOf([p]), p.id, 1), keys['Mod-Enter']), null)
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 코드로 바꾸기', () => {
  test('★ 서식 · 멘션 · 수식이 든 문단도 던지지 않고 편다 · 블록 메뉴가 셀 때도 던지지 않는다', () => {
    const p = para(textRun('굵게', { bold: true }), pageMentionRun(nextId()), equationRun('x^2'))
    const state = caret(stateOf([p]), p.id, 1)
    // 블록 메뉴는 블록을 고른 채로 연다 — 항목마다 버리는 트랜잭션으로 바꾸기를 돌려 사용 가능 여부를 센다.
    const selected = run(state, selectBlockCommand())
    assert.ok(selected)
    assert.doesNotThrow(() => blockMenuItems(selected, deps), '블록 메뉴가 던졌다')
    const items = blockMenuItems(selected, deps).flatMap((i) => [i, ...(i.children ?? [])])
    const turn = items.find((i) => i.id === 'turn_into:code')
    assert.ok(turn?.enabled, '바꾸기 목록에 코드가 없거나 꺼져 있다')

    const next = run(state, turnIntoCommand('code', deps))
    assert.ok(next)
    assert.deepEqual(shape(next), [['code_block', '굵게x^2']])
    assert.equal(hasMarks(next.doc), false)
    assert.doesNotThrow(() => next.doc.check())

    const back = run(next, turnIntoCommand('paragraph', deps))
    assert.ok(back)
    assert.deepEqual(shape(back), [['paragraph', '굵게x^2']], '코드에서 문단으로 되돌리면 글자가 남아야 한다')
  })

  test('Mod+Alt+8 은 코드 블록', () => {
    const p = para(textRun('x'))
    const next = run(caret(stateOf([p]), p.id, 0), createEditorKeymap(deps)['Mod-Alt-8'] as Command)
    assert.ok(next)
    assert.deepEqual(shape(next), [['code_block', 'x']])
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 입력 규칙 · 메뉴', () => {
  test('★ 줄 머리의 ``` 은 코드 블록을 만든다 · 코드 안의 마크다운은 글자다', () => {
    const p = para()
    let state = caret(stateOf([p], [inputRulesPlugin()]), p.id, 0)
    state = type(state, '```')
    assert.deepEqual(shape(state), [['code_block', '']])
    state = type(state, '# **a** - [ ] ')
    assert.deepEqual(shape(state), [['code_block', '# **a** - [ ] ']], '코드 안에서 입력 규칙이 돌았다')
    assert.equal(hasMarks(state.doc), false)
  })

  test('★ 뒤에 서식 든 글자가 있는 줄에서도 ``` 은 코드 블록 — 서식을 버리고 글자는 남는다(던지지 않는다)', () => {
    const p = para(textRun('굵게', { bold: true }))
    let state = caret(stateOf([p], [inputRulesPlugin()]), p.id, 0)
    state = type(state, '```')
    assert.deepEqual(shape(state), [['code_block', '굵게']])
    assert.equal(hasMarks(state.doc), false)
    assert.doesNotThrow(() => state.doc.check())
  })

  test('★ 코드 안의 / · @ 는 메뉴를 열지 않는다 — 문단에서는 연다', () => {
    const c = code('')
    const p = para()
    const inCode = type(caret(stateOf([c, p], [slashMenuPlugin(), mentionMenuPlugin()]), c.id, 0), '/')
    assert.equal(slashMenuState(inCode).active, false, '코드 안에서 / 메뉴가 열렸다')
    const atCode = type(caret(stateOf([c, p], [slashMenuPlugin(), mentionMenuPlugin()]), c.id, 0), '@')
    assert.equal(mentionMenuState(atCode).active, false, '코드 안에서 @ 메뉴가 열렸다')

    const inPara = type(caret(stateOf([c, p], [slashMenuPlugin(), mentionMenuPlugin()]), p.id, 0), '/')
    assert.equal(slashMenuState(inPara).active, true, '전제 — 문단에서는 / 메뉴가 열린다')
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 합치기', () => {
  test('서식 든 문단을 앞의 코드 블록에 합쳐도 평문이다 — 수식은 식의 글자로 남는다(말없이 버리지 않는다)', () => {
    // ProseMirror 는 받지 않는 서식은 스스로 떼지만 원자(수식 · 멘션)는 말없이 버린다 — 식의 글자가 남는지 본다.
    const c = code('x')
    const p = para(textRun('y', { bold: true }), equationRun('z^2'))
    const next = run(caret(stateOf([c, p]), p.id, 0), mergeBackwardCommand(deps))
    assert.ok(next)
    assert.deepEqual(shape(next), [['code_block', 'xyz^2']])
    assert.equal(hasMarks(next.doc), false)
    assert.doesNotThrow(() => next.doc.check())
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 정규화', () => {
  test('★ 코드 블록에 섞인 서식 · 원자를 편다 — plain_text_flattened', () => {
    const bold = blockSchema.marks.bold.create()
    const content = blockSchema.nodes.code_block.create({ props: {}, format: {} }, [
      blockSchema.text('a', [bold]),
      blockSchema.nodes.equation.create({ expression: 'e=mc^2' }),
      blockSchema.nodes.mention.create({ mention: { type: 'page', page: { id: nextId() } } }),
      blockSchema.text('b'),
    ])
    const container = blockSchema.nodes.blockContainer.create({ blockId: nextId() }, [content])
    const doc = blockSchema.nodes.doc.create(null, blockSchema.nodes.blockGroup.create(null, [container]))
    const result = normalizeBody(doc, { seed: nextId() })
    assert.ok(result.fixes.includes('plain_text_flattened'), JSON.stringify(result.fixes))
    const fixed = result.doc.child(0).child(0).child(0)
    assert.equal(fixed.type.name, 'code_block')
    assert.equal(fixed.textContent, 'ae=mc^2b')
    assert.equal(hasMarks(result.doc), false)
    assert.doesNotThrow(() => result.doc.check())

    const clean = normalizeBody(docToPm({ blocks: [code('ok')] }), { seed: nextId() })
    assert.deepEqual(clean.fixes, [], '멀쩡한 코드 블록을 고쳤다')
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ Y.Doc', () => {
  test('★ 요소 이름은 code_block — 읽으면 타입 code · 글자 · 언어 그대로', () => {
    const c = code('a\n\tb', { language: 'python' })
    const ydoc = createBodyYDoc({ blocks: [c] })
    const group = ydoc.getXmlFragment(BODY_FRAGMENT).toArray()[0] as unknown as { toArray(): { toArray(): { nodeName: string }[] }[] }
    assert.equal(group.toArray()[0]?.toArray()[0]?.nodeName, 'code_block')

    const read = readBodyYDoc(ydoc, nextId())
    assert.deepEqual(read.fixes, [])
    const [block] = read.doc.blocks
    assert.equal(block?.type, 'code')
    assert.equal(block?.title.map((r) => r.plain_text).join(''), 'a\n\tb')
    assert.equal(block?.properties?.language, 'python')
  })
})

// ── ⑨ ─────────────────────────────────────────────────────────────────

describe('⑨ 내보내기 · 복사 · 검증', () => {
  const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }

  test('★ Markdown 은 울타리 · 언어 — 코드 안은 이스케이프하지 않고 · 안의 ``` 보다 긴 울타리', () => {
    const doc: EditorDoc = {
      blocks: [code('print(*args)\n# not heading', { language: 'python' }), code('```\ninner\n```')],
    }
    const { markdown, losses } = pageToMarkdown({ title: [textRun('T')], doc }, NO_LINKS, { untitled: 'x' })
    assert.ok(markdown.includes('```python\nprint(*args)\n# not heading\n```'), markdown)
    assert.ok(markdown.includes('````\n```\ninner\n```\n````'), markdown)
    assert.equal(losses.unsupported, 0, '코드 블록이 지원하지 않는 블록으로 세어졌다')
  })

  test('블록 복사의 평문도 울타리 — 목록 안이면 줄마다 들여 쓴다', () => {
    const inner = code('a\nb', { language: 'ts' })
    const item: EditorBlock = { ...blk('bulleted_list_item', [textRun('항목')]), children: [inner] }
    assert.equal(plainTextForBlocks([item]), '- 항목\n  ```ts\n  a\n  b\n  ```')
  })

  test('본문 검증 — 언어는 문자열', () => {
    assert.deepEqual(validateDoc({ blocks: [code('x', { language: 'go' })] }), [])
    const issues = validateDoc({ blocks: [code('x', { language: 7 })] })
    assert.ok(issues.some((i) => i.path.endsWith('.properties.language')), JSON.stringify(issues))
  })
})
