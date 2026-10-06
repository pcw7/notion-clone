/**
 * 블록 수식 — 저장 모양 · 명령 · 내보내기와 가져오기 (Phase 2 1a · F-01-20 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 레지스트리 · 스키마 — 원자 · 자식 없음 · 색 없음 · **노드는 `equation_block`**(인라인 수식의 `equation` 과 따로) · 이름 왕복
 *   ② ★ Y.Doc — 요소 이름 `equation_block` · 읽으면 같은 타입 · 식 그대로 / 정규화가 틀린 식을 고친다(넘는 것은 자르고 색은 뺀다)
 *   ③ ★ 투영(행) — `properties` 는 `{ expression }` 뿐
 *   ④ ★ 내보내기 → 가져오기 왕복 — `$$` 울타리 · 빈 식은 쓰지 않는다 · 문단이 통째로 `$$` 일 때만 수식으로 되읽는다 · 복사의 평문
 *   ⑤ ★ 명령 — 식 쓰기(같으면 쓰지 않는다 · 비우면 키를 지운다 · 수식이 아니면 거절) · 골라진 수식의 Enter 가 입력창을 연다
 *   ⑥ `/수식` — 메뉴에 선다 · 지금 블록이 수식이 되고 뒤에 빈 문단
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, NodeSelection, TextSelection, type Command } from '@tiptap/pm/state'

import { EQUATION_TYPE } from '../block/equation.ts'
import { BLOCK_TYPES, type BlockType } from '../block/types.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc, BODY_FRAGMENT } from '../collab/ydoc.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { repairBodyYDoc } from '../collab/repair.ts'
import { contentElementOf } from '../testing/collab-peers.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { markdownToDoc } from '../import/markdown.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { BlockSelection } from './block-selection.ts'
import { projectDocument, validateDoc, type EditorBlock } from './document.ts'
import { equationBlockInfo, openEquationCommand, selectedEquationId, setEquationExpressionCommand } from './equation-block.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema, blockTypeOfNode, nodeNameOf } from './schema.ts'
import { filterSlashCommands, runSlashCommand, slashMenuPlugin, slashMenuState } from './slash-menu.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(type: string, text = '', properties: Record<string, unknown> = {}, format: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type: type as BlockType, title: text === '' ? [] : [textRun(text)], properties, format, children: [] }
}
const eq = (expression?: string, format: Record<string, unknown> = {}) =>
  blk(EQUATION_TYPE, '', expression === undefined ? {} : { expression }, format)
const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }
const markdownOf = (blocks: EditorBlock[]) => pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, NO_LINKS, { untitled: 'x' })
const stateOf = (blocks: EditorBlock[], plugins: EditorState['plugins'] = []) =>
  EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }), plugins })

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const handled = command(state, (tr) => {
    next = state.apply(tr)
  })
  return handled ? next : null
}

describe('① 레지스트리 · 스키마', () => {
  test('★ 원자 · 자식 없음 · 색 없음 · 노드는 equation_block — 인라인 수식과 따로', () => {
    const spec = BLOCK_TYPES[EQUATION_TYPE]
    assert.equal(spec.hasRichText, false)
    assert.equal(spec.canHaveChildren, false)
    assert.equal(spec.supportsColor, false)
    assert.equal(nodeNameOf(EQUATION_TYPE), 'equation_block')
    assert.equal(blockTypeOfNode('equation_block'), EQUATION_TYPE)
    assert.equal(blockSchema.nodes.equation_block?.spec.atom, true)
    // 인라인 수식 노드는 그대로 인라인이다 — 블록 타입으로 읽히지 않는다
    assert.equal(blockSchema.nodes.equation?.spec.inline, true)
    assert.notEqual(blockTypeOfNode('equation'), EQUATION_TYPE)
  })
})

describe('② ③ 저장', () => {
  test('★ Y.Doc — 요소 이름 equation_block · 식 그대로 · 정규화가 고칠 것이 없다', () => {
    const e = eq('\\frac{a}{b}')
    const ydoc = createBodyYDoc({ blocks: [blk('paragraph', '앞'), e] })
    const group = ydoc.getXmlFragment(BODY_FRAGMENT).toArray()[0] as unknown as { toArray(): { toArray(): { nodeName: string }[] }[] }
    assert.equal(group.toArray()[1]?.toArray()[0]?.nodeName, 'equation_block')
    const read = readBodyYDoc(ydoc, nextId())
    assert.deepEqual(read.fixes, [])
    assert.equal(read.doc.blocks[1]?.type, EQUATION_TYPE)
    assert.deepEqual(read.doc.blocks[1]?.properties, { expression: '\\frac{a}{b}' })
    assert.deepEqual(normalizeBody(docToPm({ blocks: [eq('x')] }), { seed: nextId() }).fixes, [])
  })

  test('★ 참여자가 쓴 틀린 식 — 정규화가 고치고 수선이 Y.Doc 에 쓴다(넘는 것은 자르고 · 문자열이 아니면 지우고 · 색은 뺀다)', () => {
    const long = eq('x')
    const wrong = eq('y')
    const ydoc = createBodyYDoc({ blocks: [long, wrong] })
    // 참여자의 쓰기 — 검증을 거치지 않는다(`attr-poison.test.ts` 와 같은 재현).
    contentElementOf(ydoc, long.id).setAttribute('props', { expression: 'q'.repeat(1300) } as never)
    contentElementOf(ydoc, long.id).setAttribute('format', { block_color: 'red' } as never)
    contentElementOf(ydoc, wrong.id).setAttribute('props', { expression: 5 } as never)
    const page = nextId()
    const read = readBodyYDoc(ydoc, page)
    assert.ok(read.fixes.includes('invalid_props_dropped'), JSON.stringify(read.fixes))
    assert.equal(repairBodyYDoc(ydoc, page).kind, 'repaired')
    const fixed = readBodyYDoc(ydoc, page)
    assert.deepEqual(fixed.fixes, [])
    assert.equal((fixed.doc.blocks[0]?.properties?.expression as string).length, 1000)
    assert.deepEqual(fixed.doc.blocks[0]?.format ?? {}, {})
    assert.deepEqual(fixed.doc.blocks[1]?.properties ?? {}, {})
  })

  test('★ 투영(행) — properties 는 { expression } 뿐', () => {
    const e = eq('E = mc^2')
    const projected = projectDocument(nextId(), [], { blocks: [e] }).blocks.find((b) => b.type === EQUATION_TYPE)
    assert.deepEqual(projected?.properties, { expression: 'E = mc^2' })
    assert.deepEqual(validateDoc({ blocks: [e] }), [])
  })
})

describe('④ 내보내기 · 가져오기', () => {
  test('★ $$ 울타리로 쓰고 같은 식으로 되읽는다 · 빈 식은 쓰지 않는다', () => {
    const { markdown: md } = markdownOf([blk('paragraph', '앞'), eq('\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}'), eq(), blk('paragraph', '뒤')])
    assert.ok(md.includes('$$\n\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}\n$$'), md)
    assert.equal(md.match(/\$\$/g)?.length, 2, '빈 식이 울타리를 남겼다')
    const back = markdownToDoc(md).doc.blocks
    assert.deepEqual(back.map((b) => b.type), ['paragraph', EQUATION_TYPE, 'paragraph'])
    assert.deepEqual(back[1]?.properties, { expression: '\\sum_{i=1}^n i\n= \\frac{n(n+1)}{2}' })
  })

  test('★ 문단이 통째로 $$ 일 때만 — 한 줄짜리도 · 글 속의 $$ 는 글자', () => {
    const doc = markdownToDoc('$$x^2$$\n\n값은 $$y$$ 다\n\n$$\n$$').doc.blocks
    assert.deepEqual(doc.map((b) => b.type), [EQUATION_TYPE, 'paragraph', 'paragraph'])
    assert.deepEqual(doc[0]?.properties, { expression: 'x^2' })
  })

  test('복사의 평문 — 같은 $$ 울타리', () => {
    assert.equal(plainTextForBlocks([blk('paragraph', 'a'), eq('x+y')]), 'a\n$$\nx+y\n$$')
  })
})

describe('⑤ 명령', () => {
  test('★ 식 쓰기 — 같으면 쓰지 않는다 · 비우면 키를 지운다 · 수식이 아니면 거절', () => {
    const e = eq('a')
    const p = blk('paragraph', '글')
    const state = stateOf([p, e])
    assert.equal(equationBlockInfo(state, e.id)?.expression, 'a')
    assert.equal(equationBlockInfo(state, p.id), null)

    const written = run(state, setEquationExpressionCommand(e.id, 'a+b'))
    assert.ok(written)
    assert.equal(equationBlockInfo(written, e.id)?.expression, 'a+b')
    assert.equal(run(written, setEquationExpressionCommand(e.id, 'a+b')), null, '같은 식을 다시 썼다')
    const cleared = run(written, setEquationExpressionCommand(e.id, '   '))
    assert.ok(cleared)
    assert.deepEqual(pmToDoc(cleared.doc).blocks[1]?.properties ?? {}, {})
    assert.equal(run(state, setEquationExpressionCommand(p.id, 'x')), null)
    assert.equal(run(state, setEquationExpressionCommand(nextId(), 'x')), null)
  })

  test('★ 골라진 수식의 Enter — 노드 선택 · 블록 하나의 선택만 입력창을 연다', () => {
    const e = eq('a')
    const p = blk('paragraph', '글')
    const base = stateOf([p, e])
    const info = findContainerById(base.doc, e.id)!
    const opened: string[] = []
    const open = openEquationCommand((id) => opened.push(id))

    const nodeSelected = base.apply(base.tr.setSelection(NodeSelection.create(base.doc, info.contentPos)))
    assert.equal(selectedEquationId(nodeSelected), e.id)
    assert.ok(run(nodeSelected, open) !== null || opened.length === 1)
    assert.deepEqual(opened, [e.id])

    const blockSelected = base.apply(base.tr.setSelection(BlockSelection.create(base.doc, info.pos, info.pos)))
    assert.equal(selectedEquationId(blockSelected), e.id)
    const pInfo = findContainerById(base.doc, p.id)!
    const both = base.apply(base.tr.setSelection(BlockSelection.create(base.doc, pInfo.pos, info.pos)))
    assert.equal(selectedEquationId(both), null, '둘을 고르면 열지 않는다')
    // 수식이 첫째인 두 블록 — 첫 블록만 보고 열면 안 된다
    const after = blk('paragraph', '뒤')
    const three = stateOf([p, e, after])
    const eqInfo = findContainerById(three.doc, e.id)!
    const afterInfo = findContainerById(three.doc, after.id)!
    const eqFirst = three.apply(three.tr.setSelection(BlockSelection.create(three.doc, eqInfo.pos, afterInfo.pos)))
    assert.equal(selectedEquationId(eqFirst), null, '수식이 첫째인 두 블록을 고르면 열지 않는다')
    const inText = base.apply(base.tr.setSelection(TextSelection.create(base.doc, pInfo.contentPos + 1)))
    assert.equal(selectedEquationId(inText), null)
    assert.equal(open(inText, () => undefined), false)
  })
})

describe('⑥ /수식', () => {
  test('메뉴에 선다 — 수식 · math · latex', () => {
    for (const query of ['수식', 'math', 'latex', '블록 수식']) {
      assert.ok(filterSlashCommands(query).some((c) => c.kind === 'block' && c.id === EQUATION_TYPE), query)
    }
  })

  test('★ 지금 블록이 수식이 되고 뒤에 빈 문단', () => {
    const p = blk('paragraph')
    let state = stateOf([p], [slashMenuPlugin()])
    const info = findContainerById(state.doc, p.id)!
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, info.contentPos + 1)))
    for (const char of '/수식') {
      const { from, to } = state.selection
      state = state.apply(state.tr.insertText(char, from, to))
    }
    assert.equal(slashMenuState(state).active, true)
    const command = filterSlashCommands('수식').find((c) => c.kind === 'block' && c.id === EQUATION_TYPE)!
    const next = run(state, (s, d) => runSlashCommand(s, d, command as never, { isCollapsed: () => false, newId: nextId }))
    assert.ok(next)
    const blocks = pmToDoc(next.doc).blocks
    assert.deepEqual(blocks.map((b) => b.type), [EQUATION_TYPE, 'paragraph'])
    assert.equal(blocks[0]?.id, p.id, '블록 id 가 그대로다(바꾼 뒤 그 입력창을 연다)')
    assert.deepEqual(blocks[0]?.properties ?? {}, {})
  })
})
