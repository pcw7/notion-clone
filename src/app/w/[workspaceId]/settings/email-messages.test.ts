/**
 * 이메일 주소 패널의 문구 — AC-1 (F-14-07 · DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emailDoneMessage, emailFailureMessage } from './email-messages.ts'

test('거부 코드마다 제 말이 있다 · 모르는 코드는 일반 실패', () => {
  const reasons = [
    'invalid_email', 'reauth_required', 'wrong_password', 'already_yours', 'limit_reached', 'rate_limited', 'invalid', 'expired',
    'too_many_attempts', 'unavailable', 'not_found', 'primary_locked', 'already_primary', 'session_required',
  ]
  const messages = reasons.map(emailFailureMessage)
  assert.equal(new Set(messages).size, reasons.length, '코드마다 다른 말')
  assert.ok(!messages.includes('저장하지 못했습니다.'))
  assert.equal(emailFailureMessage('뭔가 새로운 것'), '저장하지 못했습니다.')
  assert.equal(emailFailureMessage(undefined), '저장하지 못했습니다.')
})

test('★ "이미 다른 계정의 주소"를 말하는 문구가 없다 — 서버가 그 응답을 주지 않는다(열거 방지)', () => {
  assert.match(emailDoneMessage({ kind: 'requested', email: 'a@example.com' }), /확인 코드를 보냈습니다/)
  assert.doesNotMatch(emailFailureMessage('unavailable'), /다른 계정/)
})

test('빼면 다른 기기에서 로그아웃한 수를 말한다 · 대표를 바꾸면 옛 주소로 알렸다고 말한다', () => {
  assert.equal(emailDoneMessage({ kind: 'removed', email: 'a@example.com', revokedSessions: 0 }), 'a@example.com 를 뺐습니다.')
  assert.match(emailDoneMessage({ kind: 'removed', email: 'a@example.com', revokedSessions: 2 }), /다른 기기 2곳에서 로그아웃/)
  assert.match(emailDoneMessage({ kind: 'primary', email: 'b@example.com' }), /옛 대표 주소로 알림/)
})
