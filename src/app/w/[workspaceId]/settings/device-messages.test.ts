/**
 * 로그인한 기기 패널의 문구 — AC-3 (F-14-08 · DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deviceDoneMessage, deviceFailureMessage, relativeTime } from './device-messages.ts'

test('거부 코드마다 제 말이 있다 · 모르는 코드는 일반 실패', () => {
  const reasons = ['not_found', 'current_session', 'session_required', 'unauthenticated']
  const messages = reasons.map(deviceFailureMessage)
  assert.equal(new Set(messages).size, reasons.length, '코드마다 다른 말')
  const fallback = deviceFailureMessage('뭔가 새로운 것')
  assert.ok(!messages.includes(fallback))
  assert.equal(deviceFailureMessage(undefined), fallback)
})

test('해낸 뒤 — 하나는 그 기기의 이름 · 다른 모두는 수와 "API 토큰은 그대로" · 없으면 없다고', () => {
  assert.equal(deviceDoneMessage({ kind: 'one', label: 'Chrome · Windows' }), 'Chrome · Windows 에서 로그아웃시켰습니다.')
  assert.match(deviceDoneMessage({ kind: 'others', revokedSessions: 3 }), /다른 기기 3곳에서 로그아웃.*API 토큰은 그대로/)
  assert.equal(deviceDoneMessage({ kind: 'others', revokedSessions: 0 }), '로그아웃시킬 다른 기기가 없습니다.')
})

test('상대 시각 — 서버의 "지금"으로 센다 · 앞날 · 틀린 값은 "방금"', () => {
  const now = '2026-11-28T12:00:00.000Z'
  assert.equal(relativeTime('2026-11-28T11:59:30.000Z', now), '방금')
  assert.equal(relativeTime('2026-11-28T11:55:00.000Z', now), '5분 전')
  assert.equal(relativeTime('2026-11-28T09:00:00.000Z', now), '3시간 전')
  assert.equal(relativeTime('2026-11-20T12:00:00.000Z', now), '8일 전')
  assert.equal(relativeTime('2026-11-29T12:00:00.000Z', now), '방금')
  assert.equal(relativeTime('엉뚱한 값', now), '방금')
})
