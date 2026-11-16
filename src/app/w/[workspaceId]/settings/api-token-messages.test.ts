/**
 * API 토큰의 문구 — 거부 코드 · 만료 고르개 · 가린 값 (API-1 · F-09-02 · 순수)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { API_TOKEN_DEFAULT_EXPIRY_DAYS, API_TOKEN_EXPIRY_DAYS, API_TOKEN_MAX_LIVE } from '../../../../lib/api/token-format.ts'
import { API_TOKEN_EXPIRY_OPTIONS, API_TOKEN_PANEL_NOTE, apiTokenFailureMessage, expiryValue, maskedToken } from './api-token-messages.ts'

test('거부 코드마다 말이 있고 모르는 코드 · 원형의 이름은 일반 문구다', () => {
  for (const reason of ['forbidden', 'invalid_name', 'invalid_expiry', 'limit_reached', 'not_found']) {
    assert.notEqual(apiTokenFailureMessage(reason), '처리하지 못했습니다.', reason)
  }
  assert.equal(apiTokenFailureMessage('constructor'), '처리하지 못했습니다.')
  assert.equal(apiTokenFailureMessage(undefined), '처리하지 못했습니다.')
})

test('★ 만료 고르개 — 첫째가 기본(1년) · 명령이 받는 일수와 만료 없음(null)만', () => {
  assert.equal(expiryValue(API_TOKEN_EXPIRY_OPTIONS[0]!.value), API_TOKEN_DEFAULT_EXPIRY_DAYS)
  const values = API_TOKEN_EXPIRY_OPTIONS.map((o) => expiryValue(o.value))
  assert.deepEqual(values.filter((v) => v !== null).sort((a, b) => a! - b!), [...API_TOKEN_EXPIRY_DAYS])
  assert.equal(values.filter((v) => v === null).length, 1)
})

test('가린 값 · 설명의 상한이 명령의 상한과 같다', () => {
  assert.equal(maskedToken('Ab9z'), 'ntn_…Ab9z')
  assert.ok(API_TOKEN_PANEL_NOTE.includes(`${API_TOKEN_MAX_LIVE}개`))
})
