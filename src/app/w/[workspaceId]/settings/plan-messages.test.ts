/**
 * 요금제 절의 문구 — 잔여 묶음 8k-3 (DOM · DB 없음)
 *
 *   ① 줄 이름 — 아는 키마다 이름 · 모르는 키는 키 그대로
 *   ② 값 — 참거짓 · 무제한(null) · 일 · 명 · 모르는 모양은 그대로
 *   ③ 가격 — 무료 · 문의 · 월(연 결제의 월 환산액과 함께)
 *   ④ 쓴 양 — 한도가 있으면 "n / m명", 무제한이면 수만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { entitlementLabel, formatEntitlement, formatPrice, guestUsageLine } from './plan-messages.ts'

test('① 줄 이름', () => {
  const keys = ['history.days', 'guests.max', 'teamspace.private', 'import.max_bytes', 'trash.custom_retention', 'automation.webhook']
  assert.equal(new Set(keys.map(entitlementLabel)).size, keys.length)
  assert.ok(keys.every((k) => entitlementLabel(k) !== k))
  assert.equal(entitlementLabel('charts.max'), 'charts.max')
})

test('★ ② 값 — 참거짓 · 무제한 · 일 · 명', () => {
  assert.equal(formatEntitlement('teamspace.private', true), '쓸 수 있음')
  assert.equal(formatEntitlement('teamspace.private', false), '—')
  assert.equal(formatEntitlement('history.days', null), '무제한')
  assert.equal(formatEntitlement('history.days', 7), '7일')
  assert.equal(formatEntitlement('guests.max', 10), '10명')
  assert.equal(formatEntitlement('import.max_bytes', 5242880), '5 MB')
  assert.equal(formatEntitlement('charts.max', 1), '1')
  assert.equal(formatEntitlement('ai.credits', { monthly: 100 }), '{"monthly":100}')
})

test('③ 가격 — 무료 · 문의 · 월(연 결제의 월 환산액)', () => {
  assert.equal(formatPrice(0, 0, 'KRW'), '무료')
  assert.equal(formatPrice(null, null, 'KRW'), '문의')
  assert.equal(formatPrice(14000, 11200, 'KRW'), '월 ₩14,000 (연 결제 시 월 ₩11,200)')
  assert.equal(formatPrice(30000, 30000, 'KRW'), '월 ₩30,000')
})

test('④ 쓴 양', () => {
  assert.equal(guestUsageLine(3, 10), '게스트 3 / 10명')
  assert.equal(guestUsageLine(12, null), '게스트 12명 (무제한)')
})
