import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MENTION_PEOPLE_EMPTY, MENTION_PEOPLE_QUERY, mentionPeopleCap, rankMentionPeople } from './mention-rank.ts'

const p = (name: string, email: string | null = null) => ({ name, email })

test('★ ① 그 글자로 시작하는 이름이 먼저 · 그다음 이름순(한국어)', () => {
  const people = [p('박김수'), p('김하나'), p('이김'), p('김가람'), p('최수')]
  assert.deepEqual(rankMentionPeople(people, '김').map((x) => x.name), ['김가람', '김하나', '박김수', '이김'])
  assert.deepEqual(rankMentionPeople(people, '').map((x) => x.name), ['김가람', '김하나', '박김수', '이김', '최수'], '빈 쿼리는 이름순 전부')
})

test('② 이메일로도 찾는다 — 이름이 그 글자로 시작하지 않으면 뒤에 · 숫자는 자연 정렬', () => {
  const people = [p('하늘', 'kim@x.io'), p('kim2'), p('kim10'), p('강', null)]
  assert.deepEqual(rankMentionPeople(people, 'kim').map((x) => x.name), ['kim2', 'kim10', '하늘'])
})

test('③ 앞세울 사람 수 — 빈 쿼리 5 · 글자가 있으면 10', () => {
  assert.equal(mentionPeopleCap(''), MENTION_PEOPLE_EMPTY)
  assert.equal(mentionPeopleCap('김'), MENTION_PEOPLE_QUERY)
  assert.ok(MENTION_PEOPLE_EMPTY < MENTION_PEOPLE_QUERY)
})
