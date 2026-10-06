/**
 * 표의 데이터 경로 — 가져오기 · 검색 색인 · 백링크 · 복제 (Phase 2 1d-3 · F-01-18 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 가져오기 — GFM 표가 표가 된다(머리 줄이 첫 행 · 머리 표시 · 셀의 꾸밈 · 칸 수가 모자란 행은 채운다 · 검증을 지난다) ·
 *        글자 안의 `<br>` 은 줄바꿈 · 표는 이제 잃은 것이 아니다
 *   ② ★ 왕복 — 우리 내보내기(GFM)를 다시 가져오면 같은 격자다(셀 안의 `|` · 줄바꿈 · 코드 안의 `|`)
 *   ③ ★ 검색 색인 — 셀의 글자가 본문 글에 든다(문서 순서)
 *   ④ ★ 백링크 — 셀 안의 멘션이 그 행 블록의 멘션이다
 *   ⑤ ★ 복제 — 셀 안의 페이지 멘션이 사본으로 · 행도 새 id
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { mentionTarget, pageMentionRun, textRun, toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { pageToMarkdown } from '../export/markdown.ts'
import { markdownToDoc } from '../import/markdown.ts'
import { buildBodyText } from '../search/index-page.ts'
import { remapBody } from './duplicate-remap.ts'
import { mentionsOf } from './link-edges.ts'
import { TABLE_CELLS_KEY } from './table.ts'
import type { BlockType } from './types.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const blk = (type: string, children: EditorBlock[] = [], properties: Record<string, unknown> = {}, title: RichTextRun[] = []): EditorBlock => ({
  id: nextId(),
  type: type as BlockType,
  title,
  properties,
  format: {},
  children,
})
const row = (...cells: RichTextRun[][]) => blk('table_row', [], { [TABLE_CELLS_KEY]: cells })
const cell = (text: string): RichTextRun[] => (text === '' ? [] : [textRun(text)])
const gridOf = (block: EditorBlock): string[][] =>
  (block.children ?? []).map((r) => ((r.properties?.[TABLE_CELLS_KEY] ?? []) as RichTextRun[][]).map((c) => toPlainText(c)))

describe('① 가져오기', () => {
  test('★ GFM 표 — 표 블록 · 머리 줄이 첫 행 · 머리 표시 · 셀의 꾸밈 · 검증을 지난다', () => {
    const { doc, losses } = markdownToDoc(['앞', '', '| 이름 | **값** |', '|---|---|', '| a | `b` |', '| c | d |', '', '뒤'].join('\n'))
    assert.deepEqual(doc.blocks.map((b) => b.type), ['paragraph', 'table', 'paragraph'])
    const table = doc.blocks[1]!
    assert.deepEqual(table.properties, { has_column_header: true })
    assert.deepEqual(gridOf(table), [['이름', '값'], ['a', 'b'], ['c', 'd']])
    const cells = (r: number) => table.children![r]!.properties![TABLE_CELLS_KEY] as RichTextRun[][]
    assert.equal(cells(0)[1]![0]!.annotations.bold, true)
    assert.equal(cells(1)[1]![0]!.annotations.code, true)
    assert.deepEqual(validateDoc(doc), [])
    assert.equal('tables' in losses, false, '표는 잃은 것이 아니다')
  })

  test('칸 수가 모자란 행은 빈 셀로 — 행마다 같은 셀 수', () => {
    const { doc } = markdownToDoc(['| a | b | c |', '|---|---|---|', '| 1 |', '| 2 | 3 | 4 |'].join('\n'))
    const grid = gridOf(doc.blocks[0]!)
    assert.ok(grid.every((cells) => cells.length === 3), JSON.stringify(grid))
    assert.deepEqual(validateDoc(doc), [])
  })

  test('글자 안의 `<br>` 은 줄바꿈이다(문단 · 셀)', () => {
    const { doc, losses } = markdownToDoc(['한 줄<br>두 줄', '', '| a<br/>b |', '|---|'].join('\n'))
    assert.equal(toPlainText(doc.blocks[0]!.title), '한 줄\n두 줄')
    assert.deepEqual(gridOf(doc.blocks[1]!), [['a\nb']])
    assert.equal(losses.html, 0)
  })
})

describe('② 왕복', () => {
  test('★ 우리 내보내기(GFM)를 다시 가져오면 같은 격자 — 셀 안의 `|` · 줄바꿈 · 코드 안의 `|`', () => {
    const code: RichTextRun[] = [{ ...textRun('a|b'), annotations: { ...textRun('').annotations, code: true } }]
    const table = blk('table', [row(cell('머리'), cell('둘')), row(cell('파이프 | 하나'), code), row(cell('두\n줄'), cell(''))])
    const { markdown } = pageToMarkdown({ title: [textRun('T')], doc: { blocks: [table] } }, { page: () => null, image: () => null }, { untitled: 'x' })
    const back = markdownToDoc(markdown).doc.blocks.find((b) => b.type === 'table')!
    assert.deepEqual(gridOf(back), [['머리', '둘'], ['파이프 | 하나', 'a|b'], ['두\n줄', '']])
    const backCode = (back.children![1]!.properties![TABLE_CELLS_KEY] as RichTextRun[][])[1]![0]!
    assert.equal(backCode.annotations.code, true)
  })
})

describe('③ 검색 색인', () => {
  test('★ 셀의 글자가 본문 글에 든다 — 문서 순서', () => {
    const text = buildBodyText([
      { type: 'paragraph', properties: { title: [textRun('앞 문단')] } },
      { type: 'table', properties: { has_column_header: true } },
      { type: 'table_row', properties: { [TABLE_CELLS_KEY]: [cell('사과'), cell('바나나')] } },
      { type: 'table_row', properties: { [TABLE_CELLS_KEY]: [cell(''), cell('체리')] } },
    ])
    assert.equal(text, '앞 문단\n사과 바나나\n체리')
  })

  test('모양이 틀린 셀은 건너뛴다(던지지 않는다)', () => {
    assert.equal(buildBodyText([{ type: 'table_row', properties: { [TABLE_CELLS_KEY]: 'x' } }]), '')
    assert.equal(buildBodyText([{ type: 'table_row', properties: { [TABLE_CELLS_KEY]: [null, cell('ok')] } }]), 'ok')
  })
})

describe('④ 백링크', () => {
  test('★ 셀 안의 멘션이 그 행 블록의 멘션이다 — 같은 대상은 한 번', () => {
    const target = nextId()
    const r = row([pageMentionRun(target)], [textRun('글'), pageMentionRun(target)])
    const mentions = mentionsOf([{ id: r.id, properties: r.properties as Record<string, unknown> }])
    assert.deepEqual(mentions, [{ blockId: r.id, target: { kind: 'page', id: target } }])
  })
})

describe('⑤ 복제', () => {
  test('★ 셀 안의 페이지 멘션이 사본으로 — 서브트리 밖은 그대로 · 행도 새 id', () => {
    const [inside, copy, outside] = [nextId(), nextId(), nextId()]
    const r = row([pageMentionRun(inside)], [pageMentionRun(outside)])
    const table = blk('table', [r])
    const out = remapBody({ blocks: [table] }, new Map([[inside, copy]]), nextId)
    const newRow = out.blocks[0]!.children![0]!
    assert.notEqual(newRow.id, r.id)
    const cells = newRow.properties![TABLE_CELLS_KEY] as RichTextRun[][]
    assert.deepEqual(mentionTarget(cells[0]![0]!), { kind: 'page', id: copy })
    assert.deepEqual(mentionTarget(cells[1]![0]!), { kind: 'page', id: outside })
  })
})
