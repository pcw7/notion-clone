/**
 * 설정 화면의 문구 — 설정 정보구조 8g-1조각 (DOM · DB 없음)
 *
 *   ① 거부 코드마다 다른 말 · 모르는 코드는 일반 문구
 *   ② 글자 칸의 `invalid_value` 는 몇 자까지인지 말한다 — 켜고 끄기는 그렇지 않다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { settingFailureMessage } from './settings-messages.ts'

const text = { kind: 'text', maxLength: 100 } as const
const toggle = { kind: 'toggle' } as const

test('① 거부 코드마다 다른 말 · 모르는 코드는 일반 문구', () => {
  const messages = ['forbidden', 'invalid_value', 'not_found', 'oops', undefined].map((r) => settingFailureMessage(r, toggle))
  assert.equal(new Set(messages.slice(0, 3)).size, 3)
  assert.equal(messages[3], '저장하지 못했습니다.')
  assert.equal(messages[4], '저장하지 못했습니다.')
})

test('② 글자 칸의 invalid_value 는 몇 자까지인지 말한다', () => {
  assert.match(settingFailureMessage('invalid_value', text), /100자/)
  assert.doesNotMatch(settingFailureMessage('invalid_value', toggle), /자까지/)
})
