/**
 * 스위처의 다른 계정 — 잔여 묶음 8j-3 (DOM · DB 없음)
 *
 *   ① 상태의 말 — 들어와 있으면 없다 · 나머지 둘은 서로 다르다
 *   ② 바꾸기 실패의 말 — 이유마다 다르다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountStateLabel, switchFailureMessage } from './switcher-messages.ts'

test('① 상태의 말', () => {
  assert.equal(accountStateLabel('signed_in'), null)
  assert.notEqual(accountStateLabel('mfa_required'), accountStateLabel('signed_out'))
  assert.ok(accountStateLabel('signed_out')?.includes('다시 로그인'))
})

test('② 바꾸기 실패의 말 — 이유마다 다르다', () => {
  const messages = ['signed_out', 'not_found', 'oops'].map(switchFailureMessage)
  assert.equal(new Set(messages).size, 3)
})
