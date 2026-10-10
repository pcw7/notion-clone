/**
 * 공유 패널의 주체 — 7a조각 (F-06-03, DOM · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹 행은 **그룹**으로 보낸다 — "사용자가 아니면 모든 멤버"로 읽으면 그룹의 "제거"가 모든 멤버를 지운다
 *   ② 모르는 종류의 주체는 보내지 않는다(null) — 아는 것으로 바꿔 보내지 않는다
 *   ③ 추가 고르개의 값은 종류를 싣는다 — 사람과 그룹이 한 목록이다
 *   ④ 레벨 고르개는 노드의 종류가 정한다(6f-1) — 서버가 받는 목록과 같다 · ★ 목록에 없는 지금 레벨은 그 줄에 덧붙인다
 *
 * 문구는 글자 그대로 비교한다(§6).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { LEVELS, isGrantableLevel } from '../../../../lib/permissions/levels.ts'
import { GUEST_LEVELS } from '../../../../lib/workspace/guest.ts'
import {
  GUEST_LEVEL_OPTIONS,
  choiceValue,
  entryLabel,
  entryLevelOptions,
  levelLabel,
  shareLevelOptions,
  guestInviteMessage,
  guestInvitedNotice,
  memberLabel,
  parseChoice,
  principalOfEntry,
} from './share-principals.ts'

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

  test('teamspace 행은 teamspace 주체다(7c-1)', () => {
    assert.deepEqual(principalOfEntry({ principalType: 'teamspace', principalId: GROUP }), { type: 'teamspace', id: GROUP })
  })

  test('★ 모르는 종류 · id 없는 행은 null — 고치지 못한다', () => {
    assert.equal(principalOfEntry({ principalType: 'public', principalId: null }), null)
    assert.equal(principalOfEntry({ principalType: 'agent', principalId: GROUP }), null)
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
    assert.equal(entryLabel({ principalType: 'public', principalId: null }, members, groups), '알 수 없는 주체')
  })
})

describe('entryLabel — teamspace (7c-1)', () => {
  test('teamspace 행은 그 멤버 전원이라고 말한다 · 이름을 모르면 종류만', () => {
    const teamspaces = [{ teamspaceId: GROUP, name: '제품팀' }]
    assert.equal(entryLabel({ principalType: 'teamspace', principalId: GROUP }, [], [], teamspaces), 'teamspace · 제품팀 멤버')
    assert.equal(entryLabel({ principalType: 'teamspace', principalId: GROUP }, [], []), 'teamspace 멤버')
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

describe('레벨 고르개 (6f-1)', () => {
  const values = (options: readonly { value: string }[]) => options.map((o) => o.value)

  test('페이지는 서버가 받는 넷 · 데이터베이스는 "만들기만"(6f-2)을 뺀 다섯 — 고를 수 있으면 서버가 받는다', () => {
    assert.deepEqual(values(shareLevelOptions('page')), LEVELS.filter((l) => isGrantableLevel('page', l)))
    assert.deepEqual(values(shareLevelOptions('database')), LEVELS.filter((l) => isGrantableLevel('database', l) && l !== 'create'))
    assert.deepEqual(
      shareLevelOptions('database').find((o) => o.value === 'edit_content'),
      { value: 'edit_content', label: '내용 편집' },
    )
  })

  test('★ 목록에 없는 지금 레벨은 그 줄에만 덧붙인다 — API 로 준 "만들기만" 이 "읽기" 로 보이지 않는다', () => {
    assert.deepEqual(entryLevelOptions('database', 'create').at(-1), { value: 'create', label: '만들기만' })
    assert.equal(entryLevelOptions('database', 'create').length, 6)
    assert.deepEqual(entryLevelOptions('database', 'edit_content'), shareLevelOptions('database'), '목록에 있으면 그대로')
    assert.deepEqual(entryLevelOptions('page', 'edit_content').at(-1), { value: 'edit_content', label: '내용 편집' })
  })

  test('레벨 이름 — 모르는 값은 그대로 · 프로토타입 이름에 함수를 내주지 않는다', () => {
    assert.equal(levelLabel('full_access'), '전체 권한')
    assert.equal(levelLabel('owner'), 'owner')
    assert.equal(levelLabel('constructor'), 'constructor')
  })
})

describe('이메일로 초대 · 게스트 (7d-1)', () => {
  test('★ 게스트 레벨 고르개는 서버의 목록과 같다 — 편집까지(전체 권한이 없다)', () => {
    assert.deepEqual(
      GUEST_LEVEL_OPTIONS.map((l) => l.value),
      [...GUEST_LEVELS],
    )
    assert.ok(!GUEST_LEVEL_OPTIONS.some((l) => l.value === 'full_access'))
  })

  test('게스트는 이름 뒤에 "게스트" — 공유 목록의 행도 같다', () => {
    const guest = { userId: 'g', name: '손님', email: 'g@example.com', guest: true }
    assert.equal(memberLabel(guest), '손님 (g@example.com) · 게스트')
    assert.equal(memberLabel({ ...guest, guest: false }), '손님 (g@example.com)')
    assert.equal(entryLabel({ principalType: 'user', principalId: 'g', level: 'view', inherited: false }, [guest], []), memberLabel(guest))
  })

  test('거부 코드마다 할 말이 있다 · 멤버에게 준 것 · 게스트로 들인 것 · 대기 초대(초대 메일)를 구분해 말한다', () => {
    for (const code of ['invalid_email', 'invalid_level', 'guest_level', 'unavailable', 'forbidden', 'not_found', 'guest_limit']) {
      assert.notEqual(guestInviteMessage(code), '초대하지 못했습니다.', code)
    }
    assert.match(guestInvitedNotice('pending', 'a@x.io'), /초대 메일을 보냈습니다/)
    assert.match(guestInvitedNotice('member', 'a@x.io'), /멤버로 공유/)
    assert.match(guestInvitedNotice('guest', 'a@x.io'), /게스트로 초대/)
  })
})
