/**
 * 2단계 인증 패널의 문구 — 잔여 묶음 8i-2b (DOM · DB 없음)
 *
 *   ① 거부 코드마다 다른 말 · 모르는 코드는 일반 문구
 *   ② 비밀값은 넷씩 끊는다 · 백업 코드 파일은 한 줄에 하나
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { backupCodesFile, groupSecret, mfaFailureMessage } from './mfa-messages.ts'

test('① 거부 코드마다 다른 말', () => {
  const reasons = ['invalid_code', 'password_required', 'too_many_methods', 'not_found', 'invalid_label']
  assert.equal(new Set(reasons.map(mfaFailureMessage)).size, reasons.length)
  assert.equal(mfaFailureMessage('oops'), '저장하지 못했습니다.')
})

test('② 비밀값은 넷씩 · 백업 코드 파일은 한 줄에 하나', () => {
  assert.equal(groupSecret('ABCDEFGHIJ'), 'ABCD EFGH IJ')
  const file = backupCodesFile(['aaaaa-bbbbb', 'ccccc-ddddd'])
  assert.deepEqual(file.split('\n').slice(2, 4), ['aaaaa-bbbbb', 'ccccc-ddddd'])
})
