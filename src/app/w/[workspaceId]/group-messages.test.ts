/**
 * 그룹 화면의 문구 · 넣을 사람 — 7b조각 (F-06-03, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 지우기의 거부는 몇 페이지인지 말한다 · 개수가 이상해도 "NaN개"가 새지 않는다
 *   ② 지운 뒤의 알림은 거둔 공유가 있을 때만 그 수를 말한다
 *   ③ ★ 고르개에는 활성 · 게스트 아님 · 아직 없는 사람만 선다
 *
 * 문구는 글자 그대로 비교한다(§6).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { addableMembers, deletedNotice, groupFailureMessage } from './group-messages.ts'

describe('groupFailureMessage', () => {
  test('★ 지우기의 거부는 페이지 수를 말한다', () => {
    assert.equal(
      groupFailureMessage('would_orphan', 2),
      '이 그룹을 지우면 관리할 수 있는 사람이 아무도 남지 않는 페이지 2개가 생깁니다. 그 페이지에 다른 사람의 전체 권한을 먼저 주세요.',
    )
  })

  test('개수가 없거나 NaN · 0 이면 수를 빼고 말한다', () => {
    const plain =
      '이 그룹을 지우면 관리할 수 있는 사람이 아무도 남지 않는 페이지가 생깁니다. 그 페이지에 다른 사람의 전체 권한을 먼저 주세요.'
    assert.equal(groupFailureMessage('would_orphan'), plain)
    assert.equal(groupFailureMessage('would_orphan', Number.NaN), plain)
    assert.equal(groupFailureMessage('would_orphan', 0), plain)
    assert.equal(groupFailureMessage('would_orphan', '3'), plain)
  })

  test('나머지 코드와 모르는 코드', () => {
    assert.equal(groupFailureMessage('duplicate_name'), '같은 이름의 그룹이 이미 있습니다.')
    assert.equal(
      groupFailureMessage('invalid_member'),
      '그룹에는 이 워크스페이스의 멤버만 넣을 수 있습니다. 게스트는 넣을 수 없습니다.',
    )
    assert.equal(groupFailureMessage('teapot'), '바꾸지 못했습니다.')
    assert.equal(groupFailureMessage(undefined), '바꾸지 못했습니다.')
  })
})

describe('deletedNotice', () => {
  test('거둔 공유가 있으면 그 수를 · 없으면 말하지 않는다', () => {
    assert.equal(deletedNotice('디자인팀', 3), '"디자인팀" 그룹을 지웠습니다. 이 그룹이 받은 공유 3개도 함께 거뒀습니다.')
    assert.equal(deletedNotice('디자인팀', 0), '"디자인팀" 그룹을 지웠습니다.')
    assert.equal(deletedNotice('디자인팀', Number.NaN), '"디자인팀" 그룹을 지웠습니다.')
  })
})

describe('addableMembers', () => {
  const person = (userId: string, role = 'member', status = 'active') => ({ userId, name: userId, email: null, role, status })

  test('★ 게스트 · 초대만 받은 사람 · 이미 있는 사람은 고르개에 서지 않는다', () => {
    const members = [
      person('a'),
      person('guest', 'guest'),
      person('invited', 'member', 'invited'),
      person('in-group'),
      person('restricted', 'restricted_member'),
      person('admin', 'membership_admin'),
    ]
    assert.deepEqual(
      addableMembers(members, [{ userId: 'in-group' }]).map((m) => m.userId),
      ['a', 'restricted', 'admin'],
    )
  })
})
