/**
 * 버튼 블록의 라벨 (자동화 5e-1 · F-08-06 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buttonDisplayLabel, buttonLabelOf, buttonPlainText, clampButtonLabel, MAX_BUTTON_LABEL, withButtonLabel } from './button.ts'

test('★ 라벨 — 없으면 빈 글 · 그릴 때는 "버튼" · 평문은 [버튼: …]', () => {
  assert.equal(buttonLabelOf({}), '')
  assert.equal(buttonLabelOf({ label: 3 }), '')
  assert.equal(buttonDisplayLabel({}), '버튼')
  assert.equal(buttonDisplayLabel({ label: '  보내기 ' }), '보내기')
  assert.equal(buttonPlainText({ label: '보내기' }), '[버튼: 보내기]')
  assert.equal(buttonPlainText({}), '[버튼: 버튼]')
})

test('★ 쓰기 — 비면 키를 지운다 · 줄바꿈은 빈칸 · 상한에서 자르되 대리쌍을 끊지 않는다 · 다른 키는 그대로', () => {
  assert.deepEqual(withButtonLabel({ label: '옛', other: 1 }, '   '), { other: 1 })
  assert.deepEqual(withButtonLabel({}, ' 줄\n바꿈 '), { label: '줄 바꿈' })
  assert.equal((withButtonLabel({}, '가'.repeat(150)).label as string).length, MAX_BUTTON_LABEL)
  const emoji = 'a'.repeat(MAX_BUTTON_LABEL - 1) + '😀'
  assert.equal(clampButtonLabel(emoji), 'a'.repeat(MAX_BUTTON_LABEL - 1), '대리쌍의 앞 반쪽에서 끊지 않는다')
})
