/**
 * 멤버 관리의 문구 — 10o-2 (F-06-02, DOM · DB 없음)
 *
 *   ① 역할은 이름으로 · 들어와 있지 않으면 상태를 붙인다
 *   ② 거부는 이유를 말한다 — 팀스페이스의 마지막 소유자면 그 이름들을
 *   ③ 내보내기 전의 한 줄은 M1 을 말한다(들어오지 못한다 · 30일 안에 다시 초대하면 돌아온다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LEAVE_NOTICE,
  REMOVE_MEMBER_NOTICE,
  leaveFailureMessage,
  memberManageFailureMessage,
  memberRoleText,
  roleChangedNotice,
} from './member-messages.ts'

test('④ 나가기(10o-3) — 자기 이야기로 · 팀스페이스 이름 · 무엇을 잃는지', () => {
  assert.equal(
    leaveFailureMessage('teamspace_last_owner', ['설계']),
    '내가 마지막 소유자인 팀스페이스가 있습니다: 설계. 먼저 그 팀스페이스의 소유자를 넘기세요.',
  )
  assert.match(leaveFailureMessage('last_owner'), /마지막 소유자는 나갈 수 없습니다/)
  assert.equal(leaveFailureMessage('뭔가'), '나가지 못했습니다.')
  assert.match(LEAVE_NOTICE, /30일 안에 다시 초대받으면/)
})

const view = (role: string, status = 'active') => ({ userId: 'u', name: '하나', email: null, role, status })

test('① 역할은 이름으로 · 상태를 붙인다', () => {
  assert.equal(memberRoleText(view('owner')), '소유자')
  assert.equal(memberRoleText(view('restricted_member')), '제한된 멤버')
  assert.equal(memberRoleText(view('guest')), '게스트')
  assert.equal(memberRoleText(view('member', 'invited')), '멤버 · 초대 수락 전')
  assert.equal(memberRoleText(view('member', 'suspended')), '멤버 · 멈춤')
})

test('② 거부는 이유를 — 팀스페이스의 이름들', () => {
  assert.equal(
    memberManageFailureMessage('teamspace_last_owner', ['설계', '영업']),
    '이 사람이 마지막 소유자인 팀스페이스가 있습니다: 설계 · 영업. 먼저 그 팀스페이스의 소유자를 넘기세요.',
  )
  assert.match(memberManageFailureMessage('last_owner'), /소유자가 한 명은/)
  assert.match(memberManageFailureMessage('forbidden'), /소유자만/)
  assert.match(memberManageFailureMessage('self'), /자기 자신/)
  assert.equal(memberManageFailureMessage('뭔가'), '바꾸지 못했습니다.')
})

test('③ 내보내기 전의 한 줄 · 역할을 바꾼 알림', () => {
  assert.match(REMOVE_MEMBER_NOTICE, /들어오지 못합니다/)
  assert.match(REMOVE_MEMBER_NOTICE, /30일 안에 다시 초대하면/)
  assert.equal(roleChangedNotice('하나', 'member', 1), '하나 님의 역할을 멤버(으)로 바꿨습니다. 기본 팀스페이스 1곳에도 들어갔습니다.')
  assert.equal(roleChangedNotice('하나', 'restricted_member', 0), '하나 님의 역할을 제한된 멤버(으)로 바꿨습니다.')
})
