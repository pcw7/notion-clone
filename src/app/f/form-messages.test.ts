/**
 * 공개 폼의 문구 — 7a-2b (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말이 있다 · 모르는 까닭 · 원형의 이름은 일반 문구
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SubmitFailure } from '../../lib/database/form-submit.ts'
import { formFailureMessage } from './form-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  const reasons: SubmitFailure[] = ['not_found', 'bad_origin', 'invalid_token', 'expired', 'too_fast', 'rate_limited', 'invalid_value']
  const general = formFailureMessage('뭔가')
  for (const reason of reasons) assert.notEqual(formFailureMessage(reason), general, reason)
  assert.equal(formFailureMessage('constructor'), general)
  assert.equal(formFailureMessage(undefined), general)
})
