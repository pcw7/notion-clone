/**
 * 멤버 관리의 규칙 — 10o-1 · 10o-2 (F-06-02, DB 없음)
 *
 *   ① owner 는 모두를 무엇으로든 · membership_admin 은 member ↔ restricted 만 · 그 밖의 역할은 아무것도
 *   ② 고르개의 선택지(`assignableRoles`)와 판정(`mayManage`)이 같은 답이다 — 화면이 보인 선택지를 서버가 거부하지 않는다
 *   ③ 초대의 역할 — 관리 역할로 들이는 것은 owner 만
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { MEMBER_ROLES, assignableRoles, invitableRoles, isMemberRole, mayManage } from './member-rules.ts'

describe('① 누가 누구를', () => {
  test('owner 는 모두를 무엇으로든', () => {
    for (const from of MEMBER_ROLES) assert.deepEqual(assignableRoles('owner', from), [...MEMBER_ROLES], from)
  })

  test('membership_admin 은 member ↔ restricted 만 — 관리 역할을 가진 사람은 건드리지 않는다', () => {
    assert.deepEqual(assignableRoles('membership_admin', 'member'), ['member', 'restricted_member'])
    assert.deepEqual(assignableRoles('membership_admin', 'restricted_member'), ['member', 'restricted_member'])
    assert.deepEqual(assignableRoles('membership_admin', 'owner'), [])
    assert.deepEqual(assignableRoles('membership_admin', 'membership_admin'), [])
    assert.equal(mayManage('membership_admin', 'member'), true, '내보내기')
    assert.equal(mayManage('membership_admin', 'owner'), false)
  })

  test('그 밖의 역할은 아무것도 · 게스트 줄에는 선택지가 없다', () => {
    for (const actor of ['member', 'restricted_member', 'guest']) {
      for (const from of MEMBER_ROLES) assert.deepEqual(assignableRoles(actor, from), [], `${actor} → ${from}`)
    }
    assert.deepEqual(assignableRoles('owner', 'guest'), [], '게스트는 게스트의 길')
    assert.equal(isMemberRole('guest'), false)
  })
})

describe('② 선택지와 판정이 같다', () => {
  test('보인 선택지는 모두 mayManage 를 지나고, 보이지 않은 것은 지나지 않는다', () => {
    for (const actor of ['owner', 'membership_admin', 'member']) {
      for (const from of MEMBER_ROLES) {
        const shown = new Set(assignableRoles(actor, from))
        for (const to of MEMBER_ROLES) assert.equal(shown.has(to), mayManage(actor, from, to), `${actor}: ${from} → ${to}`)
      }
    }
  })
})

describe('③ 초대의 역할', () => {
  test('owner 는 셋 · membership_admin 은 멤버만 · 그 밖은 없다', () => {
    assert.deepEqual(invitableRoles('owner'), ['member', 'membership_admin', 'owner'])
    assert.deepEqual(invitableRoles('membership_admin'), ['member'])
    assert.deepEqual(invitableRoles('member'), [])
  })
})
