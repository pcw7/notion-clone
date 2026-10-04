/**
 * 비밀번호 패널의 문구 — 잔여 묶음 8i-1b (DOM · DB 없음)
 *
 *   ① 체크리스트 — 걸리는 규칙은 지켰는지 · 15자부터 "글자와 숫자"는 지운 줄 · 256자 상한은 넘었을 때만
 *   ② 거부 코드마다 다른 말 · 바꾸면 로그아웃한 기기 수를 말한다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { passwordRules } from '../../../../lib/auth/password-policy.ts'
import { checklistOf, passwordFailureMessage, passwordSavedMessage } from './password-messages.ts'

const states = (password: string) => checklistOf(passwordRules(password)).map((item) => [item.id, item.state])

test('★ ① 체크리스트 — 15자부터 "글자와 숫자"는 지운 줄 · 256자 상한은 넘었을 때만', () => {
  assert.deepEqual(states(''), [['length', 'unmet'], ['unique', 'unmet'], ['letter_and_digit', 'unmet']])
  assert.deepEqual(states('abcd1234'), [['length', 'met'], ['unique', 'met'], ['letter_and_digit', 'met']])
  assert.deepEqual(states('abcdefghijklmno'), [['length', 'met'], ['unique', 'met'], ['letter_and_digit', 'waived']])
  assert.match(checklistOf(passwordRules('abcdefghijklmno'))[2]!.label, /15자부터는 필요 없습니다/)
  assert.deepEqual(states('ab12'.repeat(64) + 'c').at(-1), ['max_length', 'unmet'])
})

test('② 거부 코드마다 다른 말 · 바꾸면 로그아웃한 기기 수', () => {
  const reasons = ['weak_password', 'current_required', 'wrong_password', 'no_password', 'mfa_enabled']
  assert.equal(new Set(reasons.map(passwordFailureMessage)).size, reasons.length)
  assert.equal(passwordFailureMessage('oops'), '저장하지 못했습니다.')
  assert.match(passwordSavedMessage('changed', 2), /다른 기기 2곳/)
  assert.doesNotMatch(passwordSavedMessage('changed', 0), /기기/)
})
