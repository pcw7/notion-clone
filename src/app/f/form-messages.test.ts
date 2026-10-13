/**
 * 공개 폼의 문구 — 7a-2b (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말이 있다 · 모르는 까닭 · 원형의 이름은 일반 문구
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SubmitFailure } from '../../lib/database/form-submit.ts'
import { WORKSPACE_FORM_LOGIN, formFailureMessage, respondentNote } from './form-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  const reasons: SubmitFailure[] = ['not_found', 'bad_origin', 'invalid_token', 'expired', 'too_fast', 'rate_limited', 'invalid_value']
  const general = formFailureMessage('뭔가')
  for (const reason of reasons) assert.notEqual(formFailureMessage(reason), general, reason)
  assert.equal(formFailureMessage('constructor'), general)
  assert.equal(formFailureMessage(undefined), general)
})

test('② 워크스페이스 멤버만의 폼(7b-1) — 응답자 줄 · 로그인 안내(제목을 싣지 않는다)', () => {
  assert.equal(respondentNote('김하나'), '응답자: 김하나 — 응답에 이름이 남습니다.')
  assert.equal(respondentNote(''), '응답자: 나 — 응답에 이름이 남습니다.', '이름이 비면 나')
  assert.match(WORKSPACE_FORM_LOGIN, /로그인/)
})
