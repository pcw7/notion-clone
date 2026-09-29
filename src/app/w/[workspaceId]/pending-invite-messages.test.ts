/**
 * 대기 중인 초대의 문구 — 7g-3조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inviteRoleLabel, revokeFailureMessage, revokedNotice } from './pending-invite-messages.ts'

test('목록 줄의 역할 — 게스트의 대기 초대는 "게스트 · 페이지 하나"(제목 없이) · 나머지는 역할 그대로', () => {
  assert.equal(inviteRoleLabel('guest'), '게스트 · 페이지 하나')
  assert.equal(inviteRoleLabel('member'), 'member')
  assert.equal(inviteRoleLabel('membership_admin'), 'membership_admin')
})

test('★ 취소한 뒤 — 누구의 초대였는지와 보낸 링크가 이제 열리지 않는다는 것', () => {
  assert.equal(revokedNotice('a@x.io'), 'a@x.io 의 초대를 취소했습니다 — 보낸 링크는 이제 열리지 않습니다.')
  assert.match(revokedNotice(null), /링크는 이제 열리지 않습니다/)
})

test('거부 코드마다 할 말 · 모르는 코드는 일반 문구', () => {
  for (const code of ['forbidden', 'not_found']) assert.notEqual(revokeFailureMessage(code), '취소하지 못했습니다.', code)
  assert.equal(revokeFailureMessage('something_new'), '취소하지 못했습니다.')
})
