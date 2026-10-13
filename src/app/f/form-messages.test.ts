/**
 * 공개 폼의 문구 — 7a-2b (DOM · DB 없음)
 *
 *   ① 서버의 까닭마다 할 말이 있다 · 모르는 까닭 · 원형의 이름은 일반 문구
 *   ③ 한 사람당 한 번(7b-3) — 이미 낸 사람의 화면 · 제출 실패가 같은 말
 *   ④ 내 응답 보기(7b-4) — 서버가 준 행 주소만 링크로 세운다(다른 곳 · 모양이 다른 주소는 버린다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { SubmitFailure } from '../../lib/database/form-submit.ts'
import { ALREADY_RESPONDED, MY_RESPONSE, WORKSPACE_FORM_LOGIN, formFailureMessage, respondentNote, responsePathOf } from './form-messages.ts'

test('① 까닭마다 할 말 · 모르는 까닭 · 원형의 이름', () => {
  const reasons: SubmitFailure[] = ['not_found', 'bad_origin', 'invalid_token', 'expired', 'too_fast', 'rate_limited', 'invalid_value', 'form_closed', 'already_submitted']
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

test('③ 한 사람당 한 번(7b-3) — 이미 낸 사람의 화면과 제출 실패가 같은 말이다', () => {
  assert.match(ALREADY_RESPONDED, /^이미 응답했습니다/)
  assert.equal(formFailureMessage('already_submitted'), ALREADY_RESPONDED)
  assert.notEqual(formFailureMessage('already_submitted'), formFailureMessage('form_closed'))
})

test('④ 내 응답 보기(7b-4) — 서버가 준 행 주소만 링크로', () => {
  const ws = '0190a3f1-1111-7000-8000-000000000001'
  const row = '0190a3f1-2222-7000-8000-000000000002'
  assert.equal(MY_RESPONSE, '내 응답 보기')
  assert.equal(responsePathOf(`/w/${ws}/${row}`), `/w/${ws}/${row}`)
  for (const bad of [`//evil.example/${row}`, `https://evil.example/w/${ws}/${row}`, `/w/${ws}`, `/w/${ws}/${row}/x`, '/w/a/b', null, 7, undefined]) {
    assert.equal(responsePathOf(bad), null, String(bad))
  }
})
