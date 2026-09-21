/**
 * 공유 패널의 주체 — 7a조각 (F-06-03, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹 행은 **그룹**으로 보낸다 — "사용자가 아니면 모든 멤버"로 읽으면 그룹의 "제거"가 모든 멤버를 지운다
 *   ② 모르는 종류의 주체는 보내지 않는다(null) — 아는 것으로 바꿔 보내지 않는다
 *   ③ 추가 고르개의 값은 종류를 싣는다 — 사람과 그룹이 한 목록이다
 *
 * 문구는 글자 그대로 비교한다(§6).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { choiceValue, entryLabel, parseChoice, principalOfEntry } from './share-principals.ts'

const USER = '00000000-0000-4000-8000-000000000001'
const GROUP = '00000000-0000-4000-8000-000000000002'

describe('principalOfEntry', () => {
  test('★ 그룹 행은 그룹 주체다 — 모든 멤버가 아니다', () => {
    assert.deepEqual(principalOfEntry({ principalType: 'group', principalId: GROUP }), { type: 'group', id: GROUP })
  })

  test('사용자 · 모든 멤버는 그대로', () => {
    assert.deepEqual(principalOfEntry({ principalType: 'user', principalId: USER }), { type: 'user', id: USER })
    assert.deepEqual(principalOfEntry({ principalType: 'workspace_everyone', principalId: null }), {
      type: 'workspace_everyone',
    })
  })

  test('★ 모르는 종류 · id 없는 행은 null — 고치지 못한다', () => {
    assert.equal(principalOfEntry({ principalType: 'teamspace', principalId: GROUP }), null)
    assert.equal(principalOfEntry({ principalType: 'public', principalId: null }), null)
    assert.equal(principalOfEntry({ principalType: 'group', principalId: null }), null)
  })
})

describe('entryLabel', () => {
  const members = [{ userId: USER, name: '앨리스', email: 'a@example.com' }]
  const groups = [{ groupId: GROUP, name: '디자인팀', memberCount: 3 }]

  test('그룹은 이름과 인원을 말한다 · 이름을 모르면 "그룹"', () => {
    assert.equal(entryLabel({ principalType: 'group', principalId: GROUP }, members, groups), '그룹 · 디자인팀 (3명)')
    assert.equal(entryLabel({ principalType: 'group', principalId: GROUP }, members, []), '그룹')
  })

  test('사람 · 모든 멤버 · 모르는 것', () => {
    assert.equal(entryLabel({ principalType: 'user', principalId: USER }, members, groups), '앨리스 (a@example.com)')
    assert.equal(entryLabel({ principalType: 'workspace_everyone', principalId: null }, members, groups), '워크스페이스 모든 멤버')
    assert.equal(entryLabel({ principalType: 'teamspace', principalId: GROUP }, members, groups), '알 수 없는 주체')
  })
})

describe('choiceValue · parseChoice', () => {
  test('★ 종류가 값에 실린다 — 같은 id 라도 사람과 그룹은 다른 값이다', () => {
    assert.notEqual(choiceValue({ type: 'user', id: USER }), choiceValue({ type: 'group', id: USER }))
    assert.deepEqual(parseChoice(choiceValue({ type: 'group', id: GROUP })), { type: 'group', id: GROUP })
    assert.deepEqual(parseChoice(choiceValue({ type: 'user', id: USER })), { type: 'user', id: USER })
  })

  test('빈 값 · 모르는 종류 · id 없는 값은 null', () => {
    assert.equal(parseChoice(''), null)
    assert.equal(parseChoice(USER), null)
    assert.equal(parseChoice('workspace_everyone:'), null)
    assert.equal(parseChoice('teamspace:x'), null)
    assert.equal(parseChoice('group:'), null)
  })
})
