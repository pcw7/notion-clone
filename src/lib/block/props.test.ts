/**
 * 본문 블록의 속성 정화 — 잔여 묶음 8a-2 (정본 §3.4 [보강] 코드 블록 ⑧ · DOM · DB 없음)
 *
 *   ① ★ RichText 정화 — 배열이 아니면 null · 계약을 어긴 런은 글자를 살리고(서식 없이 · 2000자 단위) · 살릴 글자가 없으면 빼고 ·
 *      plain_text 는 다시 계산 · 멀쩡하면 같은 배열 · 멀쩡한 런은 같은 객체 · 던지지 않는다(bigint)
 *   ② ★ 캡션(이미지 · 코드) · 언어(코드) · format 정화 — 멀쩡하면 같은 객체(정규화는 읽을 때마다 돈다)
 *   ③ ★ JSON 으로 나타낼 수 없는 값은 모든 타입에서 뺀다 — 하위 페이지 참조 · unsupported 도(그 밖의 속성은 건드리지 않는다)
 *   ④ toPlainText 는 모양이 틀린 런에 던지지 않는다(마지막 방어) · splitText 는 서로게이트 쌍을 가르지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ANNOTATIONS,
  MAX_RUN_CONTENT,
  pageMentionRun,
  sanitizeRichText,
  splitText,
  textRun,
  toPlainText,
  validateRichText,
  type RichTextRun,
} from '../contracts/rich-text.ts'
import { sanitizeBlockAttrs } from './props.ts'

const equation = (expression: string): RichTextRun => ({
  type: 'equation',
  annotations: { ...DEFAULT_ANNOTATIONS },
  plain_text: expression,
  href: null,
  equation: { expression },
})

test('★ ① RichText 정화 — 배열이 아니면 null · 멀쩡하면 같은 배열 · 멀쩡한 런은 같은 객체', () => {
  assert.equal(sanitizeRichText('str'), null)
  assert.equal(sanitizeRichText(undefined), null)
  const empty: unknown[] = []
  assert.equal(sanitizeRichText(empty), empty)
  const ok = [textRun('멀쩡'), equation('x')]
  assert.equal(sanitizeRichText(ok), ok, '멀쩡한 배열을 새로 만들었다(정규화가 매번 고쳤다고 센다)')
  const [kept] = sanitizeRichText([ok[0], null]) ?? []
  assert.equal(kept, ok[0], '멀쩡한 런을 새 객체로 바꿨다')
})

test('★ ① RichText 정화 — 계약을 어긴 런은 글자를 살린다 · 살릴 글자가 없으면 뺀다 · plain_text 는 다시 계산', () => {
  const hostile = { ...textRun('글자'), plain_text: { toString: 0 } }
  const missing = { ...textRun('없음'), plain_text: undefined }
  const badColor = textRun('색이 틀림', { color: 'default_background' as never })
  const bigColor = { ...textRun('큰 수 색'), annotations: { ...DEFAULT_ANNOTATIONS, color: 7n } }
  const long = { ...textRun('가'.repeat(MAX_RUN_CONTENT + 10)) }
  const out = sanitizeRichText([null, 7, { type: 'text' }, hostile, missing, equation('e=mc^2'), pageMentionRun('bad-id'), badColor, bigColor, long])
  assert.deepEqual(out?.map((r) => [r.type, r.plain_text.length > 20 ? r.plain_text.length : r.plain_text]), [
    ['text', '글자'],
    ['text', '없음'],
    ['equation', 'e=mc^2'],
    ['text', '색이 틀림'],
    ['text', '큰 수 색'],
    ['text', MAX_RUN_CONTENT],
    ['text', '가'.repeat(10)],
  ])
  // 살린 런은 서식이 없다 — 그리고 결과 전체가 계약을 지킨다.
  assert.deepEqual(out?.[3]?.annotations, DEFAULT_ANNOTATIONS)
  assert.deepEqual(validateRichText(out), [])
  assert.doesNotThrow(() => JSON.stringify(out))
  // 검증 자체도 bigint 에 던지지 않는다(안내문이 값을 보여 준다).
  assert.doesNotThrow(() => validateRichText([bigColor]))
})

test('① 글자 살리기의 우선순위 — 글자 런은 content(받은 plain_text 가 달라도) · 그 밖은 받은 plain_text', () => {
  const textWithStalePlain = { ...textRun('본문'), annotations: { ...DEFAULT_ANNOTATIONS, color: 'nope' }, plain_text: '다른 글자' }
  const badMention = { ...pageMentionRun('bad-id'), plain_text: '@누구' }
  assert.deepEqual(sanitizeRichText([textWithStalePlain, badMention])?.map((r) => [r.type, r.plain_text]), [
    ['text', '본문'],
    ['text', '@누구'],
  ])
})

test('① RichText 정화만 불러도(캡션 읽기 · 복제) 결과는 JSON 으로 옮겨진다 — 계약이 보지 않는 칸(href)의 bigint 도 뺀다', () => {
  const out = sanitizeRichText([{ ...textRun('링크 칸'), href: 9n }])
  assert.doesNotThrow(() => JSON.stringify(out))
  assert.deepEqual(out?.map((r) => r.plain_text), ['링크 칸'])
})

test('★ ② 코드 — 캡션 · 언어 · format 을 고친다 · 멀쩡하면 같은 객체', () => {
  const props = { language: 'python', caption: [textRun('설명')] }
  const format = { code_wrap: true }
  const clean = sanitizeBlockAttrs('code', props, format)
  assert.equal(clean.changed, false)
  assert.equal(clean.props, props)
  assert.equal(clean.format, format)

  const bad = sanitizeBlockAttrs(
    'code',
    { language: 12345, caption: [null, textRun('남는다')], keep: 'x' },
    { code_wrap: 'yes', block_color: 'red' },
  )
  assert.equal(bad.changed, true)
  assert.deepEqual(bad.props, { caption: [textRun('남는다')], keep: 'x' })
  assert.deepEqual(bad.format, {})

  assert.deepEqual(sanitizeBlockAttrs('code', { caption: 'str', language: 'x'.repeat(65) }, {}).props, {})
  assert.deepEqual(sanitizeBlockAttrs('code', { language: '   ' }, {}).props, {})
  assert.deepEqual(sanitizeBlockAttrs('code', { language: null }, { code_wrap: null }), { props: {}, format: {}, changed: true })
  // 빈 배열은 그대로 — 노션 API 가 `caption: []` 을 돌려준다(뜻이 같은 값을 고쳐 쓰지 않는다).
  const empty = { caption: [] }
  assert.equal(sanitizeBlockAttrs('code', empty, {}).changed, false)
  // null 원소 하나 — null 만 다른 정화다(수선이 따로 쓴다 · `repair.ts`).
  assert.deepEqual(sanitizeBlockAttrs('code', { caption: [null] }, {}).props, { caption: [] })
})

test('② 이미지 캡션도 같은 규칙 · 문단의 code_wrap 은 버린다 · 문단에는 캡션 칸이 없다', () => {
  const image = sanitizeBlockAttrs('image', { source: { type: 'external', url: 'https://x.io/a.png' }, caption: [null] }, {})
  assert.deepEqual(image.props, { source: { type: 'external', url: 'https://x.io/a.png' }, caption: [] })
  const para = sanitizeBlockAttrs('paragraph', { caption: [null] }, { code_wrap: true })
  assert.deepEqual(para.props, { caption: [null] }, '캡션 칸이 없는 타입의 속성을 고쳤다')
  assert.deepEqual(para.format, {})
})

test('★ ③ JSON 으로 나타낼 수 없는 값은 모든 타입에서 뺀다 · 던지지 않는다', () => {
  for (const type of ['code', 'image', 'paragraph', 'page', 'unsupported'] as const) {
    const out = sanitizeBlockAttrs(type, { keep: 'x', big: 5n, nested: { n: 1n, ok: true } }, { weird: 3n } as never)
    assert.equal(out.changed, true, type)
    assert.deepEqual(out.props, { keep: 'x', nested: { ok: true } }, type)
    assert.doesNotThrow(() => JSON.stringify([out.props, out.format]), type)
  }
  const withoutHref: Record<string, unknown> = { ...textRun('캡션') }
  delete withoutHref.href
  const code = sanitizeBlockAttrs('code', { caption: [{ ...textRun('캡션'), href: 9n }] }, {})
  assert.deepEqual(code.props, { caption: [withoutHref] }, '런 안의 bigint 가 남았다')
  // 하위 페이지 참조 · unsupported 의 다른 속성은 그대로(같은 객체).
  const junk = { caption: [null], language: 1 }
  assert.equal(sanitizeBlockAttrs('page', junk, { block_color: 'nope' } as never).changed, false)
  assert.equal(sanitizeBlockAttrs('unsupported', junk, {}).props, junk)
})

test('④ toPlainText 는 모양이 틀린 런에 던지지 않는다 · splitText 는 서로게이트 쌍을 가르지 않는다', () => {
  const runs = [textRun('a'), null, { plain_text: { toString: 0 } }, textRun('b')] as unknown as RichTextRun[]
  assert.equal(toPlainText(runs), 'ab')

  assert.deepEqual(splitText(''), [])
  assert.deepEqual(splitText('abcde', 2), ['ab', 'cd', 'e'])
  // 경계에 이모지(서로게이트 쌍)가 걸리면 그 쌍을 다음 조각으로 넘긴다.
  const parts = splitText('a😀b', 2)
  assert.deepEqual(parts, ['a', '😀', 'b'])
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
  for (const part of parts) assert.equal(lone.test(part), false, '짝 없는 서로게이트가 남았다')
  assert.equal(splitText('😀😀', 1).join(''), '😀😀', '상한이 쌍보다 작아도 글자를 잃지 않는다')
})
