/**
 * 워크스페이스 정책의 문구 — 7g-2조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { policySavedNotice } from './security-policy-messages.ts'

test('저장한 뒤 — 켰는지 껐는지 · 끄면 대기 중이던 요청도 빠지고 다시 켜면 돌아온다고', () => {
  assert.match(policySavedNotice(true), /요청할 수 있습니다/)
  assert.match(policySavedNotice(false), /요청할 수 없고/)
  assert.match(policySavedNotice(false), /다시 켜면 돌아옵니다/)
})
