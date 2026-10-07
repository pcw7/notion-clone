/**
 * 서식 툴바의 규칙 — 언제 서는가 · 무엇이 켜졌는가 · 링크 주소 (Phase 2 1e-2 · F-01-03 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 서는 때 — 비지 않은 글자 선택(블록을 넘어도) · 캐럿만 · 코드 블록 · 블록 선택 · 노드 선택(원자) · 셀 사각 선택에는 서지 않는다
 *   ② ★ 켜짐 — 걸린 서식(일부에만 걸려도) · 첫 글자의 색 · 첫 글자의 링크
 *   ③ ★ 링크 주소 — 공백 · 스킴 없으면 https:// · http · https · mailto 만 · `javascript:`(제어 문자를 끼워도) 거부 · 포트가 붙은 호스트는
 *        주소 · 비우면 뗀다 · 상한
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

import type { BlockType } from '../block/types.ts'
import { MAX_LINK_URL, textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { BlockSelection } from './block-selection.ts'
import type { EditorBlock } from './document.ts'
import { FORMAT_BUTTONS, formatToolbarState, normalizeLinkInput } from './format-toolbar.ts'
import { docToPm } from './pm-adapter.ts'
import { findContainerById } from './pm-blocks.ts'
import { blockSchema } from './schema.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, title: RichTextRun[] = [], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title,
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const stateOf = (blocks: EditorBlock[]) => EditorState.create({ schema: blockSchema, doc: docToPm({ blocks }) })
const textPos = (state: EditorState, id: string, offset: number) => findContainerById(state.doc, id)!.contentPos + 1 + offset
const select = (state: EditorState, from: number, to: number) => state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
const styled = (text: string, extra: Partial<RichTextRun['annotations']> = {}, link: string | null = null): RichTextRun => {
  const base = textRun(text)
  return { ...base, annotations: { ...base.annotations, ...extra }, href: link, text: { content: text, link: link === null ? null : { url: link } } }
}

describe('① 서는 때', () => {
  test('★ 비지 않은 글자 선택 — 서고, 블록을 넘어도 선다', () => {
    const a = blk('paragraph', [textRun('하나')])
    const b = blk('heading_2', [textRun('둘')])
    const state = stateOf([a, b])
    assert.notEqual(formatToolbarState(select(state, textPos(state, a.id, 0), textPos(state, a.id, 2))), null)
    assert.notEqual(formatToolbarState(select(state, textPos(state, a.id, 1), textPos(state, b.id, 1))), null)
  })

  test('★ 캐럿만 · 코드 블록 · 블록 선택 · 노드 선택 · 셀 사각 선택에는 서지 않는다', () => {
    const a = blk('paragraph', [textRun('글')])
    const code = blk('code', [textRun('let x = 1')])
    const img = blk('image', [], { properties: { source: { type: 'external', url: 'https://example.com/a.png' } } })
    const t = blk('table', [], { children: [blk('table_row', [], { properties: { cells: [[textRun('a')], [textRun('b')]] } })] })
    const state = stateOf([a, code, img, t])
    assert.equal(formatToolbarState(select(state, textPos(state, a.id, 1), textPos(state, a.id, 1))), null, '캐럿만')
    assert.equal(formatToolbarState(select(state, textPos(state, code.id, 0), textPos(state, code.id, 3))), null, '코드 블록')
    const blocks = state.apply(state.tr.setSelection(BlockSelection.create(state.doc, findContainerById(state.doc, a.id)!.pos)))
    assert.equal(formatToolbarState(blocks), null, '블록 선택')
    const node = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, findContainerById(state.doc, img.id)!.contentPos)))
    assert.equal(formatToolbarState(node), null, '노드 선택')
    const table = findContainerById(state.doc, t.id)!
    const firstCell = table.contentPos + 2
    const secondCell = firstCell + table.contentNode.child(0).child(0).nodeSize
    const cells = state.apply(state.tr.setSelection(CellSelection.create(state.doc, firstCell, secondCell)))
    assert.equal(formatToolbarState(cells), null, '셀 사각 선택')
  })
})

describe('② 켜짐', () => {
  test('★ 걸린 서식(일부에만 걸려도) · 첫 글자의 색 · 첫 글자의 링크', () => {
    const a = blk('paragraph', [styled('굵', { bold: true, color: 'red' }, 'https://x.y'), styled('보통')])
    const state = stateOf([a])
    const out = formatToolbarState(select(state, textPos(state, a.id, 0), textPos(state, a.id, 3)))!
    assert.deepEqual(out.formats, ['bold'])
    assert.equal(out.color, 'red')
    assert.equal(out.link, 'https://x.y')
    const plain = formatToolbarState(select(state, textPos(state, a.id, 1), textPos(state, a.id, 3)))!
    assert.deepEqual(plain.formats, [])
    assert.equal(plain.color, 'default')
    assert.equal(plain.link, null)
  })

  test('버튼은 다섯 서식 — 단축키와 함께', () => {
    assert.deepEqual(FORMAT_BUTTONS.map((b) => b.mark), ['bold', 'italic', 'underline', 'strikethrough', 'code'])
  })
})

describe('③ 링크 주소', () => {
  test('★ 다듬기 — 공백 · 스킴이 없으면 https:// · 받는 스킴 · 비우면 뗀다', () => {
    assert.deepEqual(normalizeLinkInput('  example.com/a  '), { ok: true, href: 'https://example.com/a' })
    assert.deepEqual(normalizeLinkInput('http://a.b'), { ok: true, href: 'http://a.b' })
    assert.deepEqual(normalizeLinkInput('HTTPS://A.B'), { ok: true, href: 'HTTPS://A.B' })
    assert.deepEqual(normalizeLinkInput('mailto:me@x.y'), { ok: true, href: 'mailto:me@x.y' })
    assert.deepEqual(normalizeLinkInput('localhost:3000/p'), { ok: true, href: 'https://localhost:3000/p' }, '포트가 붙은 호스트는 스킴이 아니다')
    assert.deepEqual(normalizeLinkInput('   '), { ok: true, href: null })
  })

  test('★ 받지 않는 스킴은 거부한다 — 제어 문자를 끼워도 · 상한', () => {
    assert.deepEqual(normalizeLinkInput('javascript:alert(1)'), { ok: false, reason: 'scheme' })
    assert.deepEqual(normalizeLinkInput('java\tscript:alert(1)'), { ok: false, reason: 'scheme' })
    assert.deepEqual(normalizeLinkInput('data:text/html,x'), { ok: false, reason: 'scheme' })
    assert.deepEqual(normalizeLinkInput(`https://x.y/${'a'.repeat(MAX_LINK_URL)}`), { ok: false, reason: 'too_long' })
  })
})
