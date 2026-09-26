/**
 * teamspace 화면의 문구 · 고르기 — 7c-2 · 7c-5조각 (DOM · DB 없음)
 *
 * 공개 범위의 목록이 서버 모듈의 것과 어긋나지 않는지도 여기서 막는다 — **검사만** 두 모듈을 함께 읽는다(화면은 서버
 * 모듈을 import 하면 `pg` 가 번들에 끌려온다 · §3.3-163).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { TEAMSPACE_VISIBILITIES } from '../../../lib/workspace/teamspace.ts'
import {
  TEAMSPACE_VISIBILITY_ORDER,
  canInviteAsOwner,
  canInviteHere,
  teamspaceCandidates,
  teamspaceFailureMessage,
  teamspaceJoinAction,
  teamspaceRoleLabel,
  teamspaceVisibilityHint,
  teamspaceVisibilityLabel,
  type TeamspaceMemberView,
  type TeamspaceVisibilityName,
} from './teamspace-messages.ts'

const person = (userId: string, role = 'member', status = 'active') => ({ userId, name: userId, email: null, role, status })

describe('teamspace 화면의 문구', () => {
  test('거부 코드마다 할 말이 있다 · 마지막 소유자는 무엇을 먼저 할지 말한다 · 모르는 코드는 일반 문구', () => {
    const codes = ['not_found', 'forbidden', 'invalid_name', 'invalid_role', 'invalid_member', 'last_owner',
      'needs_invite', 'invalid_visibility', 'invalid_settings']
    for (const code of codes) {
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

describe('공개 범위 (7c-5)', () => {
  test('목록이 서버의 것과 같다 — 순서만 우리가 정한다(넓은 것부터)', () => {
    assert.deepEqual([...TEAMSPACE_VISIBILITY_ORDER].sort(), [...TEAMSPACE_VISIBILITIES].sort())
    assert.deepEqual(TEAMSPACE_VISIBILITY_ORDER, ['open', 'closed', 'private'])
  })

  test('셋 다 이름과 한 줄 설명이 있고 · 서로 다르다', () => {
    const labels = TEAMSPACE_VISIBILITY_ORDER.map(teamspaceVisibilityLabel)
    const hints = TEAMSPACE_VISIBILITY_ORDER.map(teamspaceVisibilityHint)
    assert.equal(new Set(labels).size, 3, labels.join(' · '))
    assert.equal(new Set(hints).size, 3)
    assert.ok(hints.every((h) => h.length > 10))
  })

  test('★ 줄마다 무엇을 두는가 — 멤버면 공개 범위와 무관하게 멤버 · open 만 참여 · closed 는 초대 · private 는 그리지 않는다', () => {
    const rows: [TeamspaceVisibilityName, 'owner' | 'member' | null, string][] = [
      ['open', null, 'join'],
      ['closed', null, 'needs_invite'],
      ['private', null, 'hidden'],
      ['open', 'member', 'member'],
      ['closed', 'member', 'member'],
      ['private', 'owner', 'member'],
    ]
    for (const [visibility, role, want] of rows) {
      assert.equal(teamspaceJoinAction({ visibility, role }), want, `${visibility} · ${role}`)
    }
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
