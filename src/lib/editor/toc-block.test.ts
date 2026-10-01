/**
 * 목차 블록 — 저장 모양 · 내보내기 · 복사 (잔여 묶음 8b-1 · F-01-16 · DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 레지스트리 — 텍스트 없음(원자) · 자식 없음 · 색은 있다
 *   ② ★ Y.Doc — 요소 이름은 `table_of_contents` · 읽으면 같은 타입 · 색 그대로 · 정규화가 고칠 것이 없다
 *   ③ ★ 투영(행) — 내용을 저장하지 않는다(`properties` 에 title 이 없다) · 색만
 *   ④ ★ Markdown 내보내기 — 같은 규칙의 정적 목록 · 바로 앞의 글머리표 목록과 합쳐지지 않는다 · 한 칸씩만 들어간다 ·
 *      줄머리 글자는 이스케이프 · 손실은 한 번만 센다 · 헤딩이 없으면 아무것도 쓰지 않는다
 *   ⑤ 블록 복사의 평문 — 목차는 줄을 남기지 않는다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { micromark } from 'micromark'

import { BLOCK_TYPES, normalizeFormat, type BlockType } from '../block/types.ts'
import { TOC_TYPE } from '../block/toc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createBodyYDoc, readBodyYDoc, BODY_FRAGMENT } from '../collab/ydoc.ts'
import { normalizeBody } from '../collab/normalize.ts'
import { pageToMarkdown, type MarkdownLinks } from '../export/markdown.ts'
import { plainTextForBlocks } from './block-clipboard.ts'
import { projectDocument, type EditorBlock, type EditorDoc } from './document.ts'
import { docToPm } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'

let counter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function blk(type: string, text = '', children: EditorBlock[] = [], format: Record<string, unknown> = {}): EditorBlock {
  return { id: nextId(), type: type as BlockType, title: text === '' ? [] : [textRun(text)], properties: {}, format, children }
}
const toc = (format: Record<string, unknown> = {}) => blk(TOC_TYPE, '', [], format)
const NO_LINKS: MarkdownLinks = { page: () => null, image: () => null }
const markdownOf = (blocks: EditorBlock[]) => pageToMarkdown({ title: [textRun('T')], doc: { blocks } }, NO_LINKS, { untitled: 'x' })

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 레지스트리', () => {
  test('★ 텍스트 없음(원자) · 자식 없음 · 색은 있다 — 스키마가 원자로 만든다', () => {
    const spec = BLOCK_TYPES[TOC_TYPE as BlockType]
    assert.deepEqual(spec, { hasRichText: false, canHaveChildren: false, supportsColor: true })
    const node = blockSchema.nodes.table_of_contents
    assert.ok(node, '스키마에 목차 노드가 없다')
    assert.equal(node.spec.atom, true)
    assert.deepEqual(normalizeFormat(TOC_TYPE as BlockType, { block_color: 'blue', code_wrap: true }), { block_color: 'blue' })
    assert.deepEqual(normalizeFormat(TOC_TYPE as BlockType, { block_color: 'no-such-color' }), {})
  })
})

// ── ② ③ ───────────────────────────────────────────────────────────────

describe('② ③ 저장', () => {
  test('★ Y.Doc — 요소 이름은 table_of_contents · 읽으면 같은 타입 · 색 그대로 · 정규화가 고칠 것이 없다', () => {
    const t = toc({ block_color: 'gray_background' })
    const ydoc = createBodyYDoc({ blocks: [blk('heading_1', 'A'), t] })
    const group = ydoc.getXmlFragment(BODY_FRAGMENT).toArray()[0] as unknown as { toArray(): { toArray(): { nodeName: string }[] }[] }
    assert.equal(group.toArray()[1]?.toArray()[0]?.nodeName, 'table_of_contents')

    const read = readBodyYDoc(ydoc, nextId())
    assert.deepEqual(read.fixes, [])
    const block = read.doc.blocks[1]
    assert.equal(block?.type, TOC_TYPE)
    assert.equal(block?.id, t.id)
    assert.deepEqual(block?.format, { block_color: 'gray_background' })
    assert.deepEqual(block?.title, [])

    assert.deepEqual(normalizeBody(docToPm({ blocks: [toc(), blk('heading_2', 'B')] }), { seed: nextId() }).fixes, [])
  })

  test('★ 투영(행) — 내용을 저장하지 않는다 · title 이 없고 색만', () => {
    const page = nextId()
    const doc: EditorDoc = { blocks: [blk('heading_1', 'A'), toc({ block_color: 'red' })] }
    const projected = projectDocument(page, [], doc).blocks.find((b) => b.type === TOC_TYPE)
    assert.ok(projected)
    assert.deepEqual(projected.properties, {})
    assert.deepEqual(projected.format, { block_color: 'red' })
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ Markdown 내보내기', () => {
  test('★ 같은 규칙의 정적 목록 — 토글 안의 헤딩까지 · 쓰인 수준의 순위로 들여 쓴다', () => {
    const { markdown } = markdownOf([
      toc(),
      blk('heading_2', '개요'),
      blk('toggle', '접힘', [blk('heading_3', '안쪽')]),
      blk('heading_2', '끝'),
    ])
    assert.ok(markdown.includes('* 개요\n  * 안쪽\n* 끝'), markdown)
  })

  test('★ 바로 앞의 글머리표 목록과 합쳐지지 않는다 — 렌더하면 목록이 둘', () => {
    const { markdown } = markdownOf([blk('bulleted_list_item', '항목'), toc(), blk('heading_1', '제목')])
    const html = micromark(markdown)
    assert.equal(html.match(/<ul>/g)?.length, 2, html)
    assert.ok(/<li>항목<\/li>\n<\/ul>\n<ul>\n<li>제목<\/li>/.test(html), html)
  })

  test('★ 들여쓰기는 한 칸씩만 들어간다 — 제목 1 다음 곧바로 제목 3 이 둘째 칸이어도 목록이 끊기지 않는다', () => {
    const { markdown } = markdownOf([toc(), blk('heading_1', 'a'), blk('heading_2', 'b'), blk('heading_1', 'c'), blk('heading_3', 'd')])
    assert.ok(markdown.includes('* a\n  * b\n* c\n  * d'), markdown)
  })

  test('★ 줄머리 글자는 이스케이프 · 손실은 헤딩 줄에서 한 번만 센다', () => {
    const colored = { ...blk('heading_1', ''), title: [textRun('# 색', { color: 'red' })] }
    const { markdown, losses } = markdownOf([toc(), colored])
    assert.ok(markdown.includes('* \\# 색'), markdown)
    assert.equal(losses.color, 1, '목차가 헤딩의 손실을 한 번 더 셌다')
    assert.ok(micromark(markdown).includes('<li># 색</li>'), '목차 줄이 글자로 읽히지 않았다(제목이 됐다)')
  })

  test('헤딩이 없으면 아무것도 쓰지 않는다 · 지원하지 않는 블록으로 세지 않는다', () => {
    const { markdown, losses } = markdownOf([blk('paragraph', '문단'), toc()])
    assert.equal(markdown, '# T\n\n문단\n')
    assert.equal(losses.unsupported, 0)
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 복사', () => {
  test('블록 복사의 평문 — 목차는 줄을 남기지 않는다', () => {
    assert.equal(plainTextForBlocks([blk('paragraph', '앞'), toc(), blk('heading_1', '뒤')]), '앞\n# 뒤')
  })
})
