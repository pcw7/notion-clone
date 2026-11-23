/**
 * API 웹훅의 문구 (API-8 · F-09-09 · 단위)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_WEBHOOK_ATTEMPTS, MAX_WEBHOOKS_PER_TOKEN, MAX_WEBHOOKS_PER_WORKSPACE } from '../../../../lib/api/webhook-format.ts'
import {
  apiWebhookFailureMessage,
  deliveryOutcome,
  verificationLine,
  WEBHOOK_LIMIT_PER_TOKEN,
  WEBHOOK_LIMIT_PER_WORKSPACE,
  WEBHOOK_MAX_ATTEMPTS,
  webhookStatusLabel,
} from './api-webhook-messages.ts'

test('상수가 서버의 것과 같다', () => {
  assert.deepEqual([WEBHOOK_LIMIT_PER_TOKEN, WEBHOOK_LIMIT_PER_WORKSPACE, WEBHOOK_MAX_ATTEMPTS], [MAX_WEBHOOKS_PER_TOKEN, MAX_WEBHOOKS_PER_WORKSPACE, MAX_WEBHOOK_ATTEMPTS])
})

test('★ 거부의 말 — 주소의 까닭은 따로 · 모르는 코드 · 원형의 이름은 기본 말', () => {
  assert.equal(apiWebhookFailureMessage('invalid_url', 'not_https'), 'https 주소만 받습니다.')
  assert.equal(apiWebhookFailureMessage('invalid_url', 'private_host'), '내부 · 사설 주소로는 보낼 수 없습니다.')
  assert.equal(apiWebhookFailureMessage('invalid_url', 'constructor'), '받는 주소가 올바르지 않습니다.')
  assert.match(apiWebhookFailureMessage('wrong_token'), /확인 토큰이 맞지 않습니다/)
  assert.equal(apiWebhookFailureMessage('too_many'), '토큰마다 웹훅은 5개까지입니다.')
  assert.equal(apiWebhookFailureMessage('constructor'), '처리하지 못했습니다.')
  assert.equal(apiWebhookFailureMessage(undefined), '처리하지 못했습니다.')
})

test('★ 상태 칩 — 꺼짐(까닭) · 토큰 만료는 상태보다 앞선다 · 확인 기다림 · 멈춤 · 켜짐', () => {
  const chip = (status: string, disabledReason: string | null = null, tokenExpired = false) => webhookStatusLabel({ status, disabledReason, tokenExpired }).text
  assert.equal(chip('active'), '켜짐')
  assert.equal(chip('pending_verification'), '확인 기다림')
  assert.equal(chip('paused'), '멈춤')
  assert.equal(chip('disabled', 'failures'), '꺼짐 · 실패가 이어짐')
  assert.equal(chip('disabled', 'token_revoked'), '꺼짐 · 토큰 폐기')
  assert.equal(chip('active', null, true), '멈춤 · 토큰 만료')
})

test('★ 배달 기록의 한 줄 — 보냄 · 다시 보낼 예정(시도 수 · 상태 코드) · 실패 · 건너뜀(까닭) · 기다림', () => {
  const row = (over: Partial<Parameters<typeof deliveryOutcome>[0]>) =>
    deliveryOutcome({ status: 'pending', attempts: 0, httpStatus: null, error: null, skipReason: null, nextAttemptAt: null, ...over })
  assert.equal(row({ status: 'delivered', attempts: 1, httpStatus: 200 }), '보냄 · 1/8회 · HTTP 200')
  assert.equal(row({}), '보내기를 기다림')
  assert.match(row({ attempts: 1, httpStatus: 500, nextAttemptAt: '2026-11-23T05:07:00Z' }), /^다시 보낼 예정 \d+\. \d+\. \d\d:07 · 1\/8회 · HTTP 500$/)
  assert.equal(row({ attempts: 2, error: 'network: ECONNREFUSED' }), '다시 보낼 예정 · 2/8회 · network: ECONNREFUSED')
  assert.equal(row({ status: 'failed', attempts: 8, httpStatus: 503 }), '실패 · 8/8회 · HTTP 503')
  assert.equal(row({ status: 'skipped', skipReason: 'paused' }), '건너뜀 · 멈춤')
  assert.equal(row({ status: 'skipped', skipReason: 'access_lost' }), '건너뜀 · 볼 수 없게 됨')
})

test('확인 토큰을 보낸 결과 — 보냄(상태 코드) · 못 보냄(상태 코드 또는 까닭) · 아직', () => {
  assert.match(verificationLine({ sentAt: '2026-11-23T00:00:00Z', httpStatus: 200, error: null }), /보냈습니다 \(HTTP 200\)/)
  assert.match(verificationLine({ sentAt: '2026-11-23T00:00:00Z', httpStatus: 500, error: 'http_error: HTTP 500' }), /보내지 못했습니다 — HTTP 500/)
  assert.match(verificationLine({ sentAt: '2026-11-23T00:00:00Z', httpStatus: null, error: 'network: refused' }), /보내지 못했습니다 — network: refused/)
  assert.equal(verificationLine({ sentAt: null, httpStatus: null, error: null }), '확인 토큰을 아직 보내지 못했습니다.')
})
