/**
 * 멤버 목록을 누가 받는가 — 7d-2조각 (DB 없음)
 *
 * 게스트는 워크스페이스 멤버 목록을 받지 않고(F-06-09), 자기가 받은 페이지에 나오는 사람의 이름만 받는다(`onlyPeople`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { peopleIn, type DiscussionView } from '../comment/discussion.ts'
import { canListMembers, onlyPeople } from './list.ts'

test('★ 멤버 목록을 받는 역할 — 게스트만 아니다(제한 멤버는 받는다)', () => {
  for (const role of ['owner', 'membership_admin', 'member', 'restricted_member'] as const) {
    assert.equal(canListMembers(role), true, role)
  }
  assert.equal(canListMembers('guest'), false)
})

test('목록을 사람들로 좁힌다 — 원래 순서를 지키고 없는 id 는 무시한다', () => {
  const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]
  assert.deepEqual(onlyPeople(members, ['c', 'a', 'zz']), [{ userId: 'a' }, { userId: 'c' }])
  assert.deepEqual(onlyPeople(members, []), [])
})

test('★ 스레드에 나오는 사람 — 연 사람 · 해결한 사람 · 코멘트를 쓴 사람 · 스레드와 코멘트에 반응한 사람', () => {
  const at = new Date(0)
  const thread = (over: Partial<DiscussionView>): DiscussionView => ({
    id: 'd',
    pageId: 'p',
    blockId: 'b',
    onPage: true,
    anchor: null,
    orphaned: false,
    resolved: false,
    resolvedBy: null,
    createdBy: 'opener',
    createdAt: at,
    comments: [],
    reactions: [],
    ...over,
  })
  const people = peopleIn([
    thread({
      resolvedBy: 'resolver',
      reactions: [{ emoji: '👍', userIds: ['fan'] }],
      comments: [
        { id: 'c', authorId: 'writer', richText: [], deleted: false, createdAt: at, editedAt: null, reactions: [{ emoji: '🎉', userIds: ['clapper'] }] },
      ],
    }),
    thread({ createdBy: 'second' }),
  ])
  assert.deepEqual([...people].sort(), ['clapper', 'fan', 'opener', 'resolver', 'second', 'writer'])
})
