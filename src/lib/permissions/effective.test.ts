/**
 * 유효 권한 판정 — W6-b (정본 §3.11)
 *
 * 이 파일이 지키는 것 넷.
 *
 *   ① **기본값은 "없음"이다.** grant 가 없으면 아무것도 못 한다 — 모두 보임이 아니다.
 *   ② **레벨을 크기로 비교하지 않는다**(규칙 A2). `create` 는 `view` 를 포함하지 않는다.
 *   ③ **절단된 노드 위의 조상은 아무 영향도 주지 않는다**(불변식 P2).
 *   ④ **guest 는 `workspace_everyone` 이 아니다.** 손님을 초대했더니 워크스페이스
 *      전체가 보이는 사고가 그 한 줄에서 난다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { principalsOf, resolveCaps, type AclRow, type Principal } from './effective.ts'
import { can, capabilitiesOf } from './levels.ts'
import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'

const USER = 'u-1'
const OTHER = 'u-2'

const ME: Principal[] = [
  { type: 'user', id: USER },
  { type: 'workspace_everyone', id: null },
]

const entry = (node: string, level: string, principal: Partial<AclRow> = {}): AclRow => ({
  node_id: node,
  principal_type: 'user',
  principal_id: USER,
  level,
  ...principal,
})

const resolve = (chain: string[], entries: AclRow[], cuts: string[] = [], principals = ME) =>
  resolveCaps({ chain, cutAt: new Set(cuts), entries, principals })

describe('★ 기본값은 "없음"이다', () => {
  test('grant 가 하나도 없으면 아무것도 못 한다', () => {
    const caps = resolve(['page', 'root'], [])
    assert.equal(can(caps, 'view'), false)
    assert.equal(can(caps, 'edit_content'), false)
  })

  test('남에게 준 grant 는 나에게 오지 않는다', () => {
    const caps = resolve(['page'], [entry('page', 'full_access', { principal_id: OTHER })])
    assert.equal(can(caps, 'view'), false)
  })
})

describe('상속 — 조상의 grant 가 내려온다', () => {
  test('루트에 준 권한이 자손에게 닿는다', () => {
    const caps = resolve(['child', 'page', 'root'], [entry('root', 'edit')])
    assert.equal(can(caps, 'edit_content'), true)
  })

  test('가까운 곳과 먼 곳의 권한은 합쳐진다 — deny 가 없으므로(A1)', () => {
    const caps = resolve(
      ['page', 'root'],
      [entry('root', 'view'), entry('page', 'edit', { principal_type: 'workspace_everyone', principal_id: null })],
    )
    assert.equal(can(caps, 'view'), true)
    assert.equal(can(caps, 'edit_content'), true)
  })

  test('★ 절단된 노드 위의 조상은 무시된다 (P2)', () => {
    const entries = [entry('root', 'full_access'), entry('page', 'view')]
    assert.equal(can(resolve(['page', 'root'], entries), 'edit_content'), true, '절단 전에는 내려온다')
    assert.equal(
      can(resolve(['page', 'root'], entries, ['page']), 'edit_content'),
      false,
      '절단했는데 조상 권한이 그대로 내려왔다',
    )
    assert.equal(can(resolve(['page', 'root'], entries, ['page']), 'view'), true, '자기 것은 남는다')
  })

  test('중간 노드가 절단돼 있으면 그 위도 끊긴다', () => {
    const caps = resolve(
      ['leaf', 'mid', 'root'],
      [entry('root', 'full_access'), entry('mid', 'view')],
      ['mid'],
    )
    assert.equal(can(caps, 'view'), true)
    assert.equal(can(caps, 'manage_perm'), false)
  })
})

describe('★ 레벨은 전순서가 아니다 (규칙 A2)', () => {
  test('★ create 는 view 를 포함하지 않는다 — 정수 비교였다면 포함했을 것이다', () => {
    // 이 두 레벨은 database 전용이라 페이지 트리에는 오지 않는다. 규칙 자체는
    // `level_capability` 가 갖고 있고, 여기서는 그 규칙이 살아 있는지만 본다.
    assert.equal(can(capabilitiesOf('database', 'create'), 'create_child'), true)
    assert.equal(can(capabilitiesOf('database', 'create'), 'view'), false)
  })

  test('★ 페이지에 없는 레벨이 들어오면 grant 로 치지 않는다 — 던지지 않는다', () => {
    // `node_kind='block'` 하나에 페이지와 database 가 섞이므로 DB CHECK 으로는
    // 막을 수 없는 조합이다. 판정이 던지면 그 페이지를 아무도 못 여는 500 이 된다.
    const caps = resolve(['page'], [entry('page', 'create')])
    assert.equal(can(caps, 'create_child'), false)
    assert.equal(can(caps, 'view'), false)
  })

  test('두 grant 를 합치면 capability 가 합쳐진다', () => {
    const caps = resolve(
      ['page'],
      [
        entry('page', 'comment'),
        entry('page', 'edit', { principal_type: 'workspace_everyone', principal_id: null }),
      ],
    )
    assert.equal(can(caps, 'comment'), true)
    assert.equal(can(caps, 'edit_content'), true)
  })

  test('view 는 편집을 주지 않는다', () => {
    const caps = resolve(['page'], [entry('page', 'view')])
    assert.equal(can(caps, 'edit_content'), false)
    assert.equal(can(caps, 'manage_perm'), false)
  })

  test('edit 은 공유·권한 관리를 주지 않는다 — full_access 만 준다', () => {
    assert.equal(can(resolve(['p'], [entry('p', 'edit')]), 'manage_perm'), false)
    assert.equal(can(resolve(['p'], [entry('p', 'full_access')]), 'manage_perm'), true)
  })
})

describe('★ 주체 집합 P(U)', () => {
  const ctxWith = (role: WorkspaceRole): SessionContext =>
    ({ userId: USER, workspaceId: 'w', role }) as unknown as SessionContext

  test('멤버는 workspace_everyone 에 포함된다', () => {
    for (const role of ['owner', 'membership_admin', 'member'] as const) {
      const types = principalsOf(ctxWith(role)).map((p) => p.type)
      assert.ok(types.includes('workspace_everyone'), role)
    }
  })

  test('★ guest 와 restricted_member 는 포함되지 않는다', () => {
    for (const role of ['guest', 'restricted_member'] as const) {
      const types = principalsOf(ctxWith(role)).map((p) => p.type)
      assert.equal(types.includes('workspace_everyone'), false, role)
      assert.deepEqual(types, ['user'], '손님에게는 자기에게 직접 준 것만 보인다')
    }
  })

  test('workspace_everyone 행은 멤버에게만 닿는다', () => {
    const everyone = [entry('root', 'full_access', { principal_type: 'workspace_everyone', principal_id: null })]
    const asMember = resolve(['root'], everyone, [], principalsOf(ctxWith('member')))
    const asGuest = resolve(['root'], everyone, [], principalsOf(ctxWith('guest')))
    assert.equal(can(asMember, 'view'), true)
    assert.equal(can(asGuest, 'view'), false)
  })

  test('public 은 아직 주체가 아니다 — 공개 링크가 없다', () => {
    assert.equal(principalsOf(ctxWith('owner')).some((p) => p.type === 'public'), false)
  })
})
