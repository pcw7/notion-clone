/**
 * 초대 수락 화면의 문구 · 목적지 — 7g-1조각 (DOM · DB 없음)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { acceptDestination, acceptFailureMessage, acceptLabel, inviteSummary } from './invite-messages.ts'

test('★ 게스트 초대는 페이지 하나를 받는다고 말하고 제목은 싣지 않는다 · 멤버 초대는 역할을 말한다', () => {
  assert.match(inviteSummary('a@x.io', 'guest'), /페이지 하나에 게스트로/)
  assert.match(inviteSummary('a@x.io', 'member'), /역할 member/)
  assert.equal(acceptLabel('guest', false), '초대 받아들이기')
  assert.equal(acceptLabel('member', false), '워크스페이스 참여')
})

test('★ 받아들이면 게스트는 받은 페이지로 · 멤버는 워크스페이스 홈으로', () => {
  assert.equal(acceptDestination({ workspaceId: 'w', pageId: 'p' }), '/w/w/p')
  assert.equal(acceptDestination({ workspaceId: 'w' }), '/w/w')
  assert.equal(acceptDestination({ workspaceId: 'w', pageId: 42 }), '/w/w')
})

test('거부 코드마다 할 말 · 모르는 코드는 "유효하지 않다"', () => {
  for (const code of ['already_member', 'email_mismatch', 'seat_limit', 'page_unavailable', 'unavailable']) {
    assert.notEqual(acceptFailureMessage(code), '초대가 유효하지 않습니다.', code)
  }
  assert.equal(acceptFailureMessage('invalid'), '초대가 유효하지 않습니다.')
})
