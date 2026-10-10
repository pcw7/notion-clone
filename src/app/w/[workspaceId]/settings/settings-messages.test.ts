/**
 * 설정 화면의 문구 — 설정 정보구조 8g-1조각 (DOM · DB 없음)
 *
 *   ① 거부 코드마다 다른 말 · 모르는 코드는 일반 문구
 *   ② 글자 칸의 `invalid_value` 는 몇 자까지인지 말한다 — 켜고 끄기는 그렇지 않다
 *   ③ 숫자 칸의 `invalid_value` 는 범위와 단위를 말한다 · 요금제 거부는 요금제를 말한다(이름은 말하지 않는다 — 4b-3)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SETTING_PLAN_NOTE, settingFailureMessage } from './settings-messages.ts'

const text = { kind: 'text', maxLength: 100 } as const
const toggle = { kind: 'toggle' } as const
const days = { kind: 'number', min: 1, max: 3650, unit: '일' } as const

test('① 거부 코드마다 다른 말 · 모르는 코드는 일반 문구', () => {
  const messages = ['forbidden', 'invalid_value', 'not_found', 'plan_required', 'oops', undefined].map((r) => settingFailureMessage(r, toggle))
  assert.equal(new Set(messages.slice(0, 4)).size, 4)
  assert.equal(messages[4], '저장하지 못했습니다.')
  assert.equal(messages[5], '저장하지 못했습니다.')
})

test('② 글자 칸의 invalid_value 는 몇 자까지인지 말한다', () => {
  assert.match(settingFailureMessage('invalid_value', text), /100자/)
  assert.doesNotMatch(settingFailureMessage('invalid_value', toggle), /자까지/)
})

test('③ 숫자 칸은 범위와 단위를 · 요금제 거부는 요금제를 말한다', () => {
  assert.equal(settingFailureMessage('invalid_value', days), '1일에서 3650일 사이의 정수를 적으세요.')
  assert.equal(settingFailureMessage('plan_required', days), SETTING_PLAN_NOTE)
  assert.doesNotMatch(SETTING_PLAN_NOTE, /Enterprise|Business|Plus|Free/i)
})
