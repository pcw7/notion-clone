/**
 * 번역의 표지 — 런 ↔ 글 왕복 · 엄격한 되읽기 (AI-4 · F-10-03)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { equationRun, pageMentionRun, textRun, userMentionRun, type RichTextRun } from '../contracts/rich-text.ts'
import { markupToRuns, runsToMarkup } from './translate-markup.ts'

const link = (content: string, url: string, ann: Parameters<typeof textRun>[1] = {}): RichTextRun => ({
  ...textRun(content, ann),
  href: url,
  text: { content, link: { url } },
})

const RUNS: RichTextRun[] = [
  textRun('안녕 '),
  textRun('굵게', { bold: true }),
  textRun(' 그리고 '),
  link('링크', 'https://example.com/a'),
  textRun(' '),
  pageMentionRun('3f0c9b8e-7a1d-4c6e-9b2a-1d2e3f4a5b6c'),
  textRun(' 식 '),
  equationRun('E=mc^2'),
  textRun(' 코드 '),
  textRun('npm run dev', { code: true }),
  textRun(' 빨강', { color: 'red' }),
]

test('★ 서식은 꼬리표 · 멘션 · 수식 · 인라인 코드는 자리표 · 링크 주소와 멘션 대상은 보내지 않는다', () => {
  const m = runsToMarkup(RUNS)
  assert.equal(m.text, '안녕 <t1>굵게</t1> 그리고 <t2>링크</t2> ⟦3⟧ 식 ⟦4⟧ 코드 ⟦5⟧<t6> 빨강</t6>')
  assert.ok(m.translatable)
  assert.ok(!m.text.includes('example.com') && !m.text.includes('3f0c9b8e'), '주소 · 대상이 새지 않는다')
  assert.equal(m.slots.spans.size, 3)
  assert.equal(m.slots.atoms.size, 3)
})

test('★ 왕복 — 번역한 글에서 서식 · 링크 주소 · 멘션 · 수식 · 코드가 그대로 돌아온다(꼬리표는 어순 따라 옮겨도 된다)', () => {
  const m = runsToMarkup(RUNS)
  const answer = 'Hello <t2>link</t2> and <t1>bold</t1> ⟦3⟧ formula ⟦4⟧ code ⟦5⟧<t6> red</t6>'
  const runs = markupToRuns(answer, m.slots)
  assert.ok(runs !== null)
  const bold = runs.find((r) => r.plain_text === 'bold')
  const linked = runs.find((r) => r.plain_text === 'link')
  assert.equal(bold?.annotations.bold, true)
  assert.equal(linked?.text?.link?.url, 'https://example.com/a')
  assert.equal(linked?.href, 'https://example.com/a')
  assert.deepEqual(runs.find((r) => r.type === 'mention')?.mention, RUNS[5]!.mention)
  assert.equal(runs.find((r) => r.type === 'equation')?.equation?.expression, 'E=mc^2')
  assert.equal(runs.find((r) => r.annotations.code)?.plain_text, 'npm run dev')
  assert.equal(runs.find((r) => r.annotations.color === 'red')?.plain_text, ' red')
  assert.equal(runs.map((r) => r.plain_text).join(''), 'Hello link and bold  formula E=mc^2 code npm run dev red')
})

test('★ 엄격 — 빠진 자리표 · 두 번 · 모르는 번호 · 닫히지 않은 꼬리표 · 겹친 꼬리표 · 남은 표지 글자는 null', () => {
  const m = runsToMarkup(RUNS)
  const good = 'Hello <t1>bold</t1> and <t2>link</t2> ⟦3⟧ f ⟦4⟧ c ⟦5⟧<t6> red</t6>'
  assert.ok(markupToRuns(good, m.slots) !== null)
  for (const bad of [
    good.replace('⟦3⟧', ''), // 멘션이 사라졌다
    good.replace('⟦4⟧', '⟦4⟧⟦4⟧'), // 두 번
    good.replace('⟦5⟧', '⟦9⟧'), // 모르는 번호
    good.replace('</t1>', ''), // 닫히지 않았다
    good.replace('<t1>bold</t1>', 'bold'), // 꼬리표가 빠졌다(서식을 잃는다)
    good.replace('<t1>bold</t1> and <t2>link</t2>', '<t1>bold <t2>link</t2></t1>'), // 겹쳤다
    good.replace('</t2>', '</t1>'), // 다른 번호로 닫았다
    `${good} ⟦`, // 남은 표지 글자
  ]) {
    assert.equal(markupToRuns(bad, m.slots), null, bad)
  }
})

test('자리표 · 꼬리표의 빈칸은 너그럽게 읽는다(모델이 더한 빈칸)', () => {
  const m = runsToMarkup([textRun('가 '), textRun('나', { italic: true }), textRun(' '), userMentionRun('1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6')])
  const runs = markupToRuns('A < t1 >B</ t1 > ⟦ 2 ⟧', m.slots)
  assert.ok(runs !== null)
  assert.equal(runs.find((r) => r.annotations.italic)?.plain_text, 'B')
})

test('원문의 표지처럼 보이는 글은 자리표가 되어 그대로 돌아온다', () => {
  const m = runsToMarkup([textRun('태그 <t1> 와 ⟦ 괄호')])
  assert.equal(m.slots.atoms.size, 2)
  assert.equal(m.text, '태그 ⟦1⟧ 와 ⟦2⟧ 괄호')
  const runs = markupToRuns('tag ⟦1⟧ and ⟦2⟧ bracket', m.slots)
  assert.equal(runs?.map((r) => r.plain_text).join(''), 'tag <t1> and ⟦ bracket')
})

test('번역할 글자가 없으면 보내지 않는다 — 멘션만 · 수식만 · 숫자 · 빈칸', () => {
  assert.equal(runsToMarkup([pageMentionRun('3f0c9b8e-7a1d-4c6e-9b2a-1d2e3f4a5b6c')]).translatable, false)
  assert.equal(runsToMarkup([equationRun('x^2'), textRun(' 2024 ')]).translatable, false)
  assert.equal(runsToMarkup([textRun('npm', { code: true })]).translatable, false)
  assert.equal(runsToMarkup([]).translatable, false)
  assert.equal(runsToMarkup([textRun('x')]).translatable, true)
})

test('제목은 한 줄 — 줄바꿈을 빈칸으로 접는다', () => {
  const m = runsToMarkup([textRun('제목')])
  assert.equal(markupToRuns('Title\nline', m.slots, true)?.[0]?.plain_text, 'Title line')
  assert.equal(markupToRuns('Title\nline', m.slots, false)?.[0]?.plain_text, 'Title\nline')
})

test('긴 번역은 2,000자 런으로 나뉜다(정규화)', () => {
  const m = runsToMarkup([textRun('가')])
  const runs = markupToRuns('a'.repeat(4500), m.slots)
  assert.deepEqual(runs?.map((r) => r.plain_text.length), [2000, 2000, 500])
})
