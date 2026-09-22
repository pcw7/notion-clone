/**
 * 옮기기의 문구 — 7c-3조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { moveFailureMessage } from './move-messages.ts'

test('거부 코드마다 할 말이 있다 · 전체 권한이 필요한 까닭을 말한다 · 모르는 코드는 일반 문구', () => {
  for (const code of ['too_deep', 'cycle', 'forbidden', 'needs_full_access', 'target_not_found']) {
    assert.notEqual(moveFailureMessage(code), '옮기지 못했습니다.', code)
  }
  assert.match(moveFailureMessage('needs_full_access'), /전체 권한/)
  assert.match(moveFailureMessage('needs_full_access'), /볼 수 있는 사람이 바뀝니다/)
  assert.equal(moveFailureMessage('something_new'), '옮기지 못했습니다.')
})
