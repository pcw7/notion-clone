/**
 * teamspace 화면의 문구 · 고르기 — 7c-2조각 (DOM · DB 없음)
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  canInviteAsOwner,
  canInviteHere,
  teamspaceCandidates,
  teamspaceFailureMessage,
  teamspaceRoleLabel,
  type TeamspaceMemberView,
} from './teamspace-messages.ts'

const person = (userId: string, role = 'member', status = 'active') => ({ userId, name: userId, email: null, role, status })

describe('teamspace 화면의 문구', () => {
  test('거부 코드마다 할 말이 있다 · 마지막 소유자는 무엇을 먼저 할지 말한다 · 모르는 코드는 일반 문구', () => {
    for (const code of ['not_found', 'forbidden', 'invalid_name', 'invalid_role', 'invalid_member', 'last_owner']) {
      assert.notEqual(teamspaceFailureMessage(code), '처리하지 못했습니다.', code)
    }
    assert.match(teamspaceFailureMessage('last_owner'), /다른 사람을 소유자로/)
    assert.equal(teamspaceFailureMessage('something_new'), '처리하지 못했습니다.')
    assert.equal(teamspaceFailureMessage(undefined), '처리하지 못했습니다.')
  })

  test('역할 이름', () => {
    assert.deepEqual([teamspaceRoleLabel('owner'), teamspaceRoleLabel('member')], ['소유자', '멤버'])
  })
})

describe('누구에게 "넣기"를 보이는가 — 서버와 같은 규칙', () => {
  test('소유자는 늘 · 멤버는 초대 규칙이 all_members 일 때만 · 소유자로 넣는 것은 소유자만', () => {
    assert.deepEqual(
      [
        canInviteHere('owner', 'owners'),
        canInviteHere('owner', 'all_members'),
        canInviteHere('member', 'all_members'),
        canInviteHere('member', 'owners'),
      ],
      [true, true, true, false],
    )
    assert.deepEqual([canInviteAsOwner('owner'), canInviteAsOwner('member')], [true, false])
  })
})

describe('넣을 후보', () => {
  test('사람은 활성 · 게스트 아님 · 아직 사람으로 멤버가 아닌 사람 · 그룹은 아직 멤버가 아닌 그룹', () => {
    const members: TeamspaceMemberView[] = [
      { principal: { type: 'user', id: 'ann' }, role: 'owner', name: 'ann', email: null },
      { principal: { type: 'group', id: 'g1' }, role: 'member', name: '기획', email: null },
    ]
    const picked = teamspaceCandidates(
      [person('ann'), person('bob'), person('guest', 'guest'), person('invited', 'member', 'invited'), person('restricted', 'restricted_member')],
      [
        { id: 'g1', name: '기획', memberCount: 2 },
        { id: 'g2', name: '디자인', memberCount: 1 },
      ],
      members,
    )
    assert.deepEqual(picked.people.map((p) => p.userId), ['bob', 'restricted'])
    assert.deepEqual(picked.groups.map((g) => g.id), ['g2'])
  })

  test('그룹 id 와 사람 id 가 같아도 섞이지 않는다 — 종류로 가른다', () => {
    const members: TeamspaceMemberView[] = [{ principal: { type: 'group', id: 'same' }, role: 'member', name: '그룹', email: null }]
    const picked = teamspaceCandidates([person('same')], [{ id: 'same', name: '그룹', memberCount: 0 }], members)
    assert.deepEqual([picked.people.map((p) => p.userId), picked.groups.map((g) => g.id)], [['same'], []])
  })
})
