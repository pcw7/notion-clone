/**
 * 공개 API 의 rich text — 우리 런 ↔ 노션 `rich_text` (API-2 · F-09-03 · 순수)
 *
 *   ★ 내보내기 — 글자(링크면 href) · 수식 · 사람 멘션(`user.object`) · 페이지 멘션(href 는 앱의 주소) · 모양이 틀린 런은 글자만
 *   ★ 받기 — `type` · `annotations` 생략 · 이웃한 같은 서식은 합친다 · 대시 없는 id · 빈 배열
 *   ★ 거부 — 자리를 영어로 말한다(배열 아님 · 2000자 초과 · 101개 · 틀린 색 · 날짜 멘션 · 모르는 종류)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ANNOTATIONS, equationRun, pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import { parseApiRichText, toApiRichText, type ApiLinks } from './rich-text.ts'

const links: ApiLinks = { origin: 'https://app.test', pageUrl: (id) => `https://app.test/w/ws/${id}` }
const PAGE = '1f2e3d4c-5b6a-4789-8abc-def012345678'
const USER = '2a2e3d4c-5b6a-4789-8abc-def012345678'

test('★ 내보내기 — 글자 · 링크 · 수식 · 사람 · 페이지 멘션이 노션의 모양', () => {
  const linked: RichTextRun = { ...textRun('여기', { bold: true }), text: { content: '여기', link: { url: 'https://example.com' } } }
  const out = toApiRichText([textRun('안녕 '), linked, equationRun('E=mc^2'), userMentionRun(USER), pageMentionRun(PAGE, { italic: true })], links)
  assert.deepEqual(out[0], { type: 'text', text: { content: '안녕 ', link: null }, annotations: DEFAULT_ANNOTATIONS, plain_text: '안녕 ', href: null })
  assert.deepEqual(out[1], {
    type: 'text',
    text: { content: '여기', link: { url: 'https://example.com' } },
    annotations: { ...DEFAULT_ANNOTATIONS, bold: true },
    plain_text: '여기',
    href: 'https://example.com',
  })
  assert.deepEqual(out[2], { type: 'equation', equation: { expression: 'E=mc^2' }, annotations: DEFAULT_ANNOTATIONS, plain_text: 'E=mc^2', href: null })
  assert.deepEqual(out[3].mention, { type: 'user', user: { object: 'user', id: USER } })
  assert.equal(out[3].href, null)
  assert.deepEqual(out[4].mention, { type: 'page', page: { id: PAGE } })
  assert.equal(out[4].href, `https://app.test/w/ws/${PAGE}`)
  assert.equal(out[4].annotations.italic, true)
})

test('내보내기는 관대하다 — 모양이 틀린 런은 그 글자만 · 런이 아닌 것은 뺀다', () => {
  const broken = [null, { type: 'text', plain_text: '살린 글' }] as unknown as RichTextRun[]
  const out = toApiRichText(broken, links)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].text, { content: '살린 글', link: null })
})

test('★ 받기 — type · annotations 생략 · 같은 서식은 합친다 · 대시 없는 id · 빈 배열은 비운다', () => {
  const parsed = parseApiRichText(
    [
      { text: { content: '하나' } },
      { type: 'text', text: { content: '둘', link: null }, annotations: { bold: false } },
      { text: { content: '굵게' }, annotations: { bold: true, color: 'red_background' } },
      { mention: { page: { id: PAGE.replace(/-/g, '') } } },
      { type: 'mention', mention: { type: 'user', user: { id: USER.toUpperCase() } } },
      { equation: { expression: 'x^2' } },
      { text: { content: '링크', link: { url: 'https://example.com/a' } }, plain_text: '무시', href: '무시' },
    ],
    'body.properties.Name.title',
  )
  assert.ok(parsed.ok, JSON.stringify(parsed))
  if (!parsed.ok) return
  assert.equal(parsed.runs.length, 6, '하나 + 둘은 합쳐진다')
  assert.equal(parsed.runs[0].text?.content, '하나둘')
  assert.equal(parsed.runs[0].plain_text, '하나둘')
  assert.deepEqual(parsed.runs[1].annotations, { ...DEFAULT_ANNOTATIONS, bold: true, color: 'red_background' })
  assert.deepEqual(parsed.runs[2].mention, { type: 'page', page: { id: PAGE } })
  assert.deepEqual(parsed.runs[3].mention, { type: 'user', user: { id: USER } })
  assert.equal(parsed.runs[4].type, 'equation')
  assert.equal(parsed.runs[5].href, 'https://example.com/a', 'href 는 받은 것이 아니라 링크에서 다시 계산한다')
  assert.equal(parsed.runs[5].plain_text, '링크')

  const empty = parseApiRichText([], 'x')
  assert.ok(empty.ok && empty.runs.length === 0)
})

test('★ 되돌리기 — 내보낸 것을 그대로 다시 보내면 같은 런이다', () => {
  const runs = [textRun('앞 ', { underline: true }), userMentionRun(USER), textRun(' 뒤', { code: true, color: 'blue' })]
  const back = parseApiRichText(toApiRichText(runs, links), 'x')
  assert.ok(back.ok)
  if (!back.ok) return
  assert.deepEqual(back.runs, runs)
})

test('★ 받기 — 2000자 조각 여럿으로 보낸 긴 글(노션의 방식)을 받는다 · 같은 서식은 합친 뒤 2000자 단위로 다시 쪼갠다(API-3)', () => {
  const long = '가'.repeat(3000)
  const r = parseApiRichText([{ text: { content: long.slice(0, 2000) } }, { text: { content: long.slice(2000) } }], 'p')
  assert.ok(r.ok, r.ok ? '' : r.message)
  if (!r.ok) return
  assert.deepEqual(r.runs.map((x) => x.plain_text.length), [2000, 1000])
  assert.equal(r.runs.map((x) => x.plain_text).join(''), long)
})

test('★ 거부 — 자리를 영어로 말한다', () => {
  const cases: [unknown, RegExp][] = [
    ['글', /^p should be an array, instead was `"글"`\.$/],
    [[{ text: { content: 3 } }], /^p\[0\]\.text\.content should be a string/],
    [[{ text: { content: 'x'.repeat(2001) } }], /^p\[0\]\.text\.content\.length should be ≤ 2000/],
    [Array.from({ length: 101 }, () => ({ text: { content: 'a' } })), /^p should have at most 100 items/],
    [[{ text: { content: 'a' }, annotations: { color: 'default_background' } }], /^p\[0\]\.annotations\.color should be a valid color/],
    [[{ text: { content: 'a' }, annotations: { bold: 'yes' } }], /^p\[0\]\.annotations\.bold should be a boolean/],
    [[{ text: { content: 'a', link: { url: '' } } }], /^p\[0\]\.text\.link\.url should be a string/],
    [[{ mention: { type: 'date', date: { start: '2026-01-01' } } }], /^p\[0\]\.mention\.type `"date"` is not supported/],
    [[{ mention: { type: 'page', page: { id: 'nope' } } }], /^p\[0\]\.mention\.page\.id should be a valid uuid/],
    [[{ type: 'image' }], /^p\[0\]\.type should be "text", "mention" or "equation"/],
    [[null], /^p\[0\] should be an object/],
  ]
  for (const [raw, pattern] of cases) {
    const r = parseApiRichText(raw, 'p')
    assert.ok(!r.ok, JSON.stringify(raw).slice(0, 80))
    if (!r.ok) assert.match(r.message, pattern)
  }
})
