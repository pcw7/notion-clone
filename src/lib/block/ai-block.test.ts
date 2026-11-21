/**
 * AI 블록의 등록 · 저장 모양 · 바깥으로 나가는 모양 (AI-5 · F-10-04 · 정본 §3.10 [보강 AI-1] ⑩ · §3.4 [보강] AI 블록)
 *
 *   ① 레지스트리 · 스키마 · 어댑터 · 정규화 — 자식(결과)을 가진 글 없는 원자 · 왕복에서 속성 · 자식이 그대로
 *   ② 속성 — 읽기의 기본값 · 정화 · 본문 저장의 검증
 *   ③ 공개 API — `unsupported` + has_children · 만들 수 없다
 *   ④ 내보내기 · 평문 복사 — 결과(자식)만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { blockContentToApi, columnWidthsOf, parseApiChildren } from '../api/block-json.ts'
import { createBodyYDoc, readBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import { plainTextForBlocks } from '../editor/block-clipboard.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema, blockTypeOfNode, nodeNameOf } from '../editor/schema.ts'
import { pageToMarkdown } from '../export/markdown.ts'
import { readAiBlock } from '../ai/block-source.ts'
import { AI_BLOCK_INSTRUCTION_MAX, AI_BLOCK_TYPE, sanitizeAiBlockProps, validateAiBlockProperties } from './ai-block.ts'
import { sanitizeBlockAttrs } from './props.ts'
import { BLOCK_TYPES, isBodyBlockType, isKnownBlockType } from './types.ts'

const blk = (type: EditorBlock['type'], text: string, extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children: [],
  ...extra,
})

const aiBlock = (children: EditorBlock[], properties: Record<string, unknown> = { kind: 'summary' }): EditorBlock => ({
  id: randomUUID(),
  type: AI_BLOCK_TYPE,
  title: [],
  properties,
  format: {},
  children,
})

test('① 레지스트리 — 글 · 색 없는 원자 · 자식을 가진다 · 본문 타입 목록 밖(바꾸기 · 입력 규칙에 서지 않는다)', () => {
  assert.ok(isKnownBlockType(AI_BLOCK_TYPE))
  assert.equal(isBodyBlockType(AI_BLOCK_TYPE), false)
  assert.deepEqual(BLOCK_TYPES.ai_block, { hasRichText: false, canHaveChildren: true, supportsColor: false })
  assert.equal(nodeNameOf(AI_BLOCK_TYPE), 'ai_block')
  assert.equal(blockTypeOfNode('ai_block'), AI_BLOCK_TYPE)
  const node = blockSchema.nodes.ai_block!
  assert.ok(node.isAtom && node.spec.selectable === true && node.spec.group === 'blockContent')
})

test('★ ① 어댑터 · Y.Doc 왕복 — 속성 · 자식(결과)이 그대로 · 정규화가 자식을 풀지 않는다', () => {
  const props = { kind: 'custom', instruction: '세 줄로', generatedAt: '2026-11-21T00:00:00.000Z', sourceHash: 'a-1', resultHash: 'b-2' }
  const result = [blk('bulleted_list_item', '첫째'), blk('to_do', '할 일', { properties: { checked: false } })]
  const doc = { blocks: [blk('paragraph', '앞 글'), aiBlock(result, props), blk('paragraph', '뒤 글')] }
  const back = pmToDoc(docToPm(doc))
  assert.deepEqual(back.blocks[1]!.properties, props)
  assert.deepEqual(back.blocks[1]!.children!.map((b) => b.title[0]?.plain_text), ['첫째', '할 일'])
  const read = readBodyYDoc(createBodyYDoc(doc), randomUUID())
  assert.deepEqual(read.fixes, [], '정규화가 고칠 것이 없다')
  assert.equal(read.doc.blocks[1]!.type, AI_BLOCK_TYPE)
  assert.equal(read.doc.blocks[1]!.children!.length, 2)
  assert.deepEqual(validateDoc(doc), [])
})

test('② 속성 — 읽기의 기본값 · 정화(모르는 종류 · 긴 지시 · 틀린 해시) · 검증', () => {
  assert.deepEqual(readAiBlock({}), { kind: 'custom', instruction: '', generatedAt: null, sourceHash: null, resultHash: null })
  assert.deepEqual(readAiBlock({ kind: 'action_items', sourceHash: 5 }).kind, 'action_items')
  assert.equal(readAiBlock({ sourceHash: 5 }).sourceHash, null)

  const same = { kind: 'summary', instruction: '', generatedAt: null }
  assert.equal(sanitizeAiBlockProps(same), same, '바뀐 것이 없으면 같은 객체')
  const long = 'ㄱ'.repeat(AI_BLOCK_INSTRUCTION_MAX + 10)
  assert.deepEqual(sanitizeAiBlockProps({ kind: 'weird', instruction: long, resultHash: { x: 1 }, sourceHash: 'ok' }), {
    instruction: 'ㄱ'.repeat(AI_BLOCK_INSTRUCTION_MAX),
    sourceHash: 'ok',
  })
  const attrs = sanitizeBlockAttrs(AI_BLOCK_TYPE, { kind: 1, generatedAt: 'x'.repeat(100) }, { block_color: 'red' })
  assert.deepEqual([attrs.props, attrs.format, attrs.changed], [{}, {}, true], '색도 받지 않는다')

  assert.deepEqual(validateAiBlockProperties({ kind: 'summary', instruction: '', generatedAt: null }, 'p'), [])
  assert.deepEqual(
    validateAiBlockProperties({ kind: 'x', instruction: long, sourceHash: 3 }, 'p').map((i) => i.path),
    ['p.kind', 'p.instruction', 'p.sourceHash'],
  )
  assert.ok(validateDoc({ blocks: [aiBlock([], { kind: 'nope' })] }).some((i) => i.path.endsWith('.kind')), '본문 저장이 거부한다')
})

test('★ ③ 공개 API — 읽으면 unsupported(+ 결과가 있으면 has_children) · 만들기는 거부', () => {
  const filled = aiBlock([blk('paragraph', '결과')])
  const read = { links: { origin: 'https://app.test', pageUrl: (id: string) => `https://app.test/w/ws/${id}` }, refs: new Map(), fileNames: new Map(), columnWidths: columnWidthsOf({ blocks: [filled] }) }
  assert.deepEqual(blockContentToApi(filled, read), { type: 'unsupported', payload: {}, hasChildren: true })
  assert.deepEqual(blockContentToApi(aiBlock([]), read), { type: 'unsupported', payload: {}, hasChildren: false })
  const parsed = parseApiChildren([{ type: 'ai_block', ai_block: {} }], 'body.children', 'page', randomUUID)
  assert.equal(parsed.ok, false)
  assert.match(!parsed.ok ? parsed.message : '', /"ai_block" is not supported/)
})

test('★ ④ Markdown 내보내기 · 평문 복사 — 결과(자식)만 · 머리 줄(종류 · 지시)은 쓰지 않는다 · 잃은 것으로 세지 않는다', () => {
  const doc = {
    blocks: [
      blk('paragraph', '앞 글'),
      aiBlock([blk('bulleted_list_item', '요약 하나'), blk('to_do', '할 일 하나', { properties: { checked: true } })], { kind: 'custom', instruction: '비밀 지시' }),
      blk('paragraph', '뒤 글'),
    ],
  }
  const { markdown, losses } = pageToMarkdown({ title: [textRun('T')], doc }, { page: () => null, image: () => null }, { untitled: '제목 없음' })
  assert.equal(markdown, '# T\n\n앞 글\n\n- 요약 하나\n- [x] 할 일 하나\n\n뒤 글\n')
  assert.ok(!markdown.includes('비밀 지시'))
  assert.equal(losses.flattened, 0)
  assert.equal(plainTextForBlocks(doc.blocks), '앞 글\n- 요약 하나\n- [x] 할 일 하나\n뒤 글')
  // 클립보드의 HTML 껍데기 — 종류만 · 글이 없다(결과는 자식 그룹의 것)
  const spec = blockSchema.nodes.ai_block!.spec.toDOM!(docToPm({ blocks: [doc.blocks[1]!] }).firstChild!.firstChild!.firstChild!) as unknown[]
  assert.deepEqual(spec, ['div', { 'data-block-type': 'ai_block', 'data-ai-kind': 'custom', class: 'blk blk-ai_block' }])
})
