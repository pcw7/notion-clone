/**
 * 페이지 웹훅 칸의 글자 (4e-3 · F-11-19)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lastDeliveryLabel, webhookErrorMessage, webhookStateLabel } from './webhook-messages.ts'

test('★ 거절 — 주소 모양은 까닭마다 · 나머지는 오류마다', () => {
  assert.equal(webhookErrorMessage('invalid_url', 'not_https'), 'https 주소만 받습니다.')
  assert.equal(webhookErrorMessage('invalid_url', 'private_host'), '내부 주소로는 보낼 수 없습니다.')
  assert.equal(webhookErrorMessage('invalid_url', '모르는 까닭'), '올바른 주소가 아닙니다.')
  assert.equal(webhookErrorMessage('too_many', undefined), '이 페이지에는 웹훅을 5개까지 걸 수 있습니다.')
  assert.equal(webhookErrorMessage(undefined, undefined), '웹훅을 바꾸지 못했습니다.')
})

test('★ 상태 · 마지막 배달', () => {
  assert.equal(webhookStateLabel(null), '켜짐')
  assert.equal(webhookStateLabel({ reason: 'manual' }), '멈춤')
  assert.equal(webhookStateLabel({ reason: 'failures' }), '멈춤 — 보내기가 계속 실패했습니다')
  const time = (iso: string) => `[${iso}]`
  assert.equal(lastDeliveryLabel(null, time), '아직 보낸 적 없음')
  assert.equal(lastDeliveryLabel({ status: 'sent', at: 't', httpStatus: 200 }, time), '보냄 · [t]')
  assert.equal(lastDeliveryLabel({ status: 'failed', at: 't', httpStatus: 500 }, time), '실패(HTTP 500) · [t]')
  assert.equal(lastDeliveryLabel({ status: 'failed', at: 't', httpStatus: null }, time), '실패 · [t]')
  assert.equal(lastDeliveryLabel({ status: 'dropped', at: 't', httpStatus: null }, time), '보내지 않음 · [t]')
})
