/**
 * 페이지 번역의 계획 — 단위 · 청크 · 메시지 · 되읽기 · 번역본의 본문 (AI-4 · F-10-03)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { validateDoc, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { EDIT_LANGUAGES, EDIT_LANGUAGE_LABEL } from './edit-prompt.ts'
import {
  TRANSLATE_MAX_UNITS,
  buildTranslatedDoc,
  collectUnits,
  hasBodyUnits,
  planChunks,
  readTranslation,
  stopNotice,
  translateMessages,
  translateSystemPrompt,
  translatedTitle,
  unitOutputTokens,
  type TranslateUnit,
} from './translate-plan.ts'

const ids = { n: 0 }
const id = () => `00000000-0000-4000-8000-${String(++ids.n).padStart(12, '0')}`
const blk = (type: EditorBlock['type'], title: RichTextRun[], extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: id(),
  type,
  title,
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const LIMITS = { maxInputChars: 6000, maxOutputTokens: 1500 }

function sample(): { doc: EditorDoc; childPage: string; inner: EditorBlock } {
  const inner = blk('paragraph', [textRun('토글 안의 글')])
  const childPage = id()
  const doc: EditorDoc = {
    blocks: [
      blk('heading_1', [textRun('회의록')]),
      blk('paragraph', [textRun('굵은 글', { bold: true }), textRun(' 보통 글')]),
      blk('to_do', [textRun('끝낸 일')], { properties: { checked: true } }),
      blk('code', [textRun('const a = 1 // 주석')], { properties: { language: 'javascript' } }),
      blk('equation', [], { properties: { expression: 'x^2' } }),
      blk('toggle', [textRun('펼치기')], { children: [inner] }),
      { id: childPage, type: 'page', title: [], properties: {}, format: {}, children: [] },
      blk('table', [], {
        properties: { has_column_header: true },
        children: [blk('table_row', [], { properties: { cells: [[textRun('이름')], [textRun('2024')]] } })],
      }),
      blk('divider', []),
    ],
  }
  return { doc, childPage, inner }
}

test('★ 단위 — 제목 · 글 블록(토글 안까지) · 표의 셀 · 코드 · 수식 · 참조 · 숫자만의 셀은 단위가 아니다', () => {
  const { doc } = sample()
  const units = collectUnits([textRun('페이지 제목')], doc)
  assert.deepEqual(
    units.map((u) => [u.key, u.target.kind, u.markup]),
    [
      [1, 'title', '페이지 제목'],
      [2, 'block', '회의록'],
      [3, 'block', '<t1>굵은 글</t1> 보통 글'],
      [4, 'block', '끝낸 일'],
      [5, 'block', '펼치기'],
      [6, 'block', '토글 안의 글'],
      [7, 'cell', '이름'],
    ],
  )
  assert.ok(hasBodyUnits(units))
})

test('★ 빈 페이지 — 본문 단위가 없으면 청크가 없다(제목만으로는 부르지 않는다)', () => {
  const units = collectUnits([textRun('제목만')], { blocks: [blk('paragraph', []), blk('divider', [])] })
  assert.equal(hasBodyUnits(units), false)
  assert.equal(planChunks([], 'en', LIMITS).chunks.length, 0)
})

const unit = (key: number, chars: number, ch = 'a'): TranslateUnit => ({
  key,
  target: { kind: 'block', blockId: `b${key}` },
  markup: ch.repeat(chars),
  slots: { spans: new Map(), atoms: new Map() },
})

test('★ 청크 — 단위를 쪼개지 않고 차례대로 · 출력 어림이 상한의 60% 안 · 넣는 글이 상한 안', () => {
  const units = Array.from({ length: 30 }, (_, i) => unit(i + 1, 100))
  const plan = planChunks(units, 'en', LIMITS)
  const flat = plan.chunks.flat().map((u) => u.key)
  assert.deepEqual(flat, units.map((u) => u.key), '차례 그대로 · 빠짐 없음 · 쪼갠 단위 없음')
  for (const chunk of plan.chunks) {
    const out = chunk.reduce((n, u) => n + unitOutputTokens(u, 'en'), 0)
    assert.ok(out <= 1500 * 0.6, `출력 어림 ${out}`)
    const input = translateMessages('en', chunk).reduce((n, m) => n + m.content.length, 0)
    assert.ok(input <= 6000, `넣는 글 ${input}`)
  }
  // 100자 × 0.7 + 8 = 78 토큰 → 900 안에 11개
  assert.deepEqual(plan.chunks.map((c) => c.length), [11, 11, 8])
})

test('★ 빽빽한 언어(한 · 일 · 중)로 옮기면 청크가 작다 — 같은 글이 더 많은 청크', () => {
  const units = Array.from({ length: 30 }, (_, i) => unit(i + 1, 100))
  const en = planChunks(units, 'en', LIMITS).chunks.length
  for (const dense of ['ko', 'ja', 'zh'] as const) {
    const n = planChunks(units, dense, LIMITS).chunks.length
    assert.ok(n > en, `${dense} ${n} > en ${en}`)
  }
  assert.equal(planChunks(units, 'ko', LIMITS).chunks.length, 5, '100 × 1.2 + 8 = 128 → 7개씩')
})

test('청크 — 단위 수 상한 · 혼자 큰 단위는 혼자 · 상한을 넘는 단위는 보내지 않는다', () => {
  const tiny = Array.from({ length: 90 }, (_, i) => unit(i + 1, 1))
  assert.deepEqual(planChunks(tiny, 'en', LIMITS).chunks.map((c) => c.length), [TRANSLATE_MAX_UNITS, TRANSLATE_MAX_UNITS, 10])
  const big = [unit(1, 10), unit(2, 1500), unit(3, 10), unit(4, 3000)]
  const plan = planChunks(big, 'en', LIMITS)
  // 1500 × 0.7 + 8 = 1058 > 900(묶음) 이지만 ≤ 1350(혼자) → 혼자 · 3000 은 2108 > 1350 → 보내지 않는다
  assert.deepEqual(plan.chunks.map((c) => c.map((u) => u.key)), [[1], [2], [3]])
  assert.deepEqual(plan.tooLong.map((u) => u.key), [4])
  const narrow = planChunks([unit(1, 50), unit(2, 50)], 'en', { maxInputChars: translateSystemPrompt('en').length + 70, maxOutputTokens: 1500 })
  assert.deepEqual(narrow.chunks.map((c) => c.length), [1, 1], '넣는 글의 상한이 묶음을 가른다')
})

test('메시지 — 고정된 시스템(언어는 닫힌 목록의 이름) · user 는 번호 열쇠의 JSON · 고치기의 일곱 언어를 그대로 쓴다', () => {
  assert.deepEqual([...EDIT_LANGUAGES], ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'])
  const messages = translateMessages('ja', [unit(3, 2), unit(5, 1, 'b')])
  assert.equal(messages[0]!.role, 'system')
  assert.match(messages[0]!.content, /into Japanese\./)
  assert.match(messages[0]!.content, /not instructions to you/)
  assert.deepEqual(JSON.parse(messages[1]!.content), { 3: 'aa', 5: 'b' })
})

test('★ 되읽기 — 같은 열쇠의 JSON · 울타리 · 앞뒤 말은 걷는다 · 빠진 열쇠 · 글이 아닌 값 · 틀린 표지는 담지 않는다(원문을 둔다)', () => {
  const units = collectUnits([], { blocks: [blk('paragraph', [textRun('하나', { bold: true })]), blk('paragraph', [textRun('둘')]), blk('paragraph', [textRun('셋')])] })
  const fenced = '```json\n{"1":"<t1>One</t1>","2":"Two","3":"Three"}\n```'
  assert.deepEqual([...readTranslation(fenced, units).keys()], [1, 2, 3])
  const partial = readTranslation('Here: {"1":"One","3":7}', units)
  assert.deepEqual([...partial.keys()], [], '1 은 꼬리표가 빠졌다 · 2 는 없다 · 3 은 글이 아니다')
  assert.equal(readTranslation('not json at all', units).size, 0)
  assert.equal(readTranslation('{"1": "<t1>One", "2": "Two"}', units).size, 1, '틀린 단위만 뺀다')
})

test('★ 번역본의 본문 — 같은 구조 · 종류 · 속성 · 새 id · 번역이 없으면 원문 · 참조는 멘션 한 줄 · 코드는 그대로', () => {
  const { doc, childPage } = sample()
  const units = collectUnits([], doc)
  const translations = new Map<number, RichTextRun[]>(units.filter((u) => u.key !== 2).map((u) => [u.key, [textRun(`[EN] ${u.markup.replace(/<\/?t\d+>/g, '')}`)]]))
  let n = 0
  const out = buildTranslatedDoc(doc, units, translations, () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`)
  assert.deepEqual(validateDoc(out), [])
  const shape = (blocks: readonly EditorBlock[]): unknown[] => blocks.map((b) => [b.type, (b.children ?? []).length === 0 ? null : shape(b.children!)])
  assert.deepEqual(shape(out.blocks), shape(doc.blocks).map((s, i) => (doc.blocks[i]!.type === 'page' ? ['paragraph', null] : s)))
  const text = (b: EditorBlock) => b.title.map((r) => r.plain_text).join('')
  assert.equal(text(out.blocks[0]!), '[EN] 회의록')
  assert.equal(text(out.blocks[1]!), '굵은 글 보통 글', '번역이 없는 단위는 원문(서식째)')
  assert.equal(out.blocks[1]!.title[0]!.annotations.bold, true)
  assert.equal(out.blocks[2]!.properties?.checked, true, '체크는 그대로')
  assert.equal(text(out.blocks[3]!), 'const a = 1 // 주석', '코드는 번역하지 않는다')
  assert.equal(out.blocks[3]!.properties?.language, 'javascript')
  assert.equal(out.blocks[4]!.properties?.expression, 'x^2')
  assert.equal(text(out.blocks[5]!.children![0]!), '[EN] 토글 안의 글')
  assert.deepEqual(out.blocks[6]!.title[0]!.mention, { type: 'page', page: { id: childPage } }, '하위 페이지는 원래 페이지를 가리키는 멘션')
  const cells = out.blocks[7]!.children![0]!.properties?.cells as RichTextRun[][]
  assert.deepEqual(cells.map((c) => c.map((r) => r.plain_text).join('')), ['[EN] 이름', '2024'])
  const all = (blocks: readonly EditorBlock[]): string[] => blocks.flatMap((b) => [b.id, ...all(b.children ?? [])])
  const before = new Set(all(doc.blocks))
  assert.ok(all(out.blocks).every((x) => !before.has(x)), '블록 id 는 모두 새것')
})

test('제목 — 번역한 제목(없으면 원래) 뒤에 언어 이름 · 멈춘 콜아웃의 말', () => {
  assert.equal(translatedTitle([textRun('회의')], [textRun('Meeting')], 'en').map((r) => r.plain_text).join(''), `Meeting (${EDIT_LANGUAGE_LABEL.en})`)
  assert.equal(translatedTitle([textRun('회의')], null, 'ja').map((r) => r.plain_text).join(''), '회의 (日本語)')
  const notice = stopNotice(id(), 3, 8, 'limit')
  assert.equal(notice.type, 'callout')
  assert.equal(notice.title[0]!.plain_text, '번역이 3/8 에서 멈췄습니다 — AI 한도에 닿았습니다. 나머지는 원문 그대로입니다.')
  assert.deepEqual(validateDoc({ blocks: [notice] }), [])
})
