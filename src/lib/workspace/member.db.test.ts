/**
 * 멤버 내보내기 · 역할 바꾸기 — 10o-1 (F-06-02 · 정본 §3.3 [보강] 멤버 내보내기 · 역할 바꾸기)
 *
 * 지키는 것.
 *   ① ★ 누가 — owner · membership_admin 만. 관리 역할(owner · membership_admin)을 주거나 가진 사람은 owner 만 건드린다 · 초대에도
 *      같은 규칙(membership_admin 은 owner · membership_admin 으로 초대하지 못한다) · 게스트 · 떠난 사람 · 모르는 사람은 not_found ·
 *      게스트 역할로는 바꾸지 않는다(invalid_role)
 *   ② ★ 활성 owner 는 늘 하나 이상 — 혼자인 owner 는 스스로 내려가지 못한다 · 두 owner 가 서로를 동시에 내리면 하나만 된다 ·
 *      자기 자신은 내보내지 않는다(self)
 *   ③ ★ teamspace 의 마지막 행동할 수 있는 owner 는 내보내지 않는다 — 그 이름을 준다 · 떠난 사람은 owner 로 세지 않는다 · 지워지지
 *      않은 그룹은 센다 · restricted 로 내리는 것은 막지 않는다
 *   ④ ★ 내보내기는 M1 — 부여 · 그룹 · teamspace 멤버십은 남고 0단계 게이트가 막는다 · 다시 들어오면 그 페이지가 돌아온다
 *   ⑤ restricted 에서 멤버로 올리면 기본 teamspace 에 들어간다 · restricted 로 내려도 teamspace 멤버십은 남는다
 *   ⑥ 권한 세대가 오르고 감사 로그가 남는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { resolveSessionContext } from '../auth/session-context.ts'
import { grantAccess } from '../permissions/acl.ts'
import { canViewPage } from '../permissions/effective.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { addGroupMember, createGroup } from './group.ts'
import { acceptInvite, createEmailInvite } from './invite.ts'
import { changeMemberRole, removeMember } from './member.ts'
import { addTeamspaceMember, createTeamspace, setDefaultTeamspace } from './teamspace.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unique = (s: string) => `${s} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** 워크스페이스 하나 — owner(대표) · membership_admin(관리) · member(동료) · restricted_member(제한). */
async function office() {
  const ws = await createBareWorkspace('멤버 관리')
  const boss: Actor = await joinAs(ws, await createUser('대표'), 'owner')
  const admin: Actor = await joinAs(ws, await createUser('관리'), 'membership_admin')
  const mate: Actor = await joinAs(ws, await createUser('동료'), 'member')
  const lim: Actor = await joinAs(ws, await createUser('제한'), 'restricted_member')
  return { ws, boss, admin, mate, lim }
}

const memberRow = async (ws: string, userId: string) =>
  (await query<{ role: string; status: string; removed_at: Date | null }>(
    `SELECT role, status, removed_at FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [ws, userId],
  ))[0] ?? null

const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason)

describe('① ★ 누가', () => {
  test('membership_admin 은 member ↔ restricted 만 · 관리 역할은 owner 만 · 멤버는 아무것도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, admin, mate, lim } = await office()

    assert.equal(reasonOf(await changeMemberRole(mate.ctx, lim.userId, 'member')), 'forbidden', '멤버는 다루지 못한다')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, mate.userId, 'restricted_member')), 'ok', 'membership_admin — 멤버를 제한으로')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, mate.userId, 'member')), 'ok', '다시 멤버로')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, mate.userId, 'owner')), 'forbidden', '★ owner 로 올리기는 owner 만')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, mate.userId, 'membership_admin')), 'forbidden', '★ membership_admin 으로도')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, boss.userId, 'member')), 'forbidden', '★ owner 를 건드리지 못한다')
    assert.equal(reasonOf(await removeMember(admin.ctx, boss.userId)), 'forbidden', '★ owner 를 내보내지 못한다')
    assert.equal((await memberRow(ws, boss.userId))?.role, 'owner')

    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'membership_admin')), 'ok', 'owner 는 관리 역할을 준다')
    assert.equal(reasonOf(await changeMemberRole(admin.ctx, mate.userId, 'member')), 'forbidden', 'membership_admin 은 다른 관리자를 건드리지 못한다')
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'guest')), 'invalid_role', '게스트로 내리기는 이 명령이 아니다')
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'owner')), 'ok')
    assert.equal((await memberRow(ws, mate.userId))?.role, 'owner')
  })

  test('게스트 · 떠난 사람 · 모르는 사람은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const guest = await joinAs(ws, await createUser('손님'), 'guest')
    const gone = await joinAs(ws, await createUser('떠난'), 'member')
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [ws, gone.userId])
    const stranger = await createUser('남')
    for (const [name, id] of [['게스트', guest.userId], ['떠난 사람', gone.userId], ['모르는 사람', stranger.userId]] as const) {
      assert.equal(reasonOf(await changeMemberRole(boss.ctx, id, 'member')), 'not_found', `${name} — 역할`)
      assert.equal(reasonOf(await removeMember(boss.ctx, id)), 'not_found', `${name} — 내보내기`)
    }
  })

  test('★ 초대도 같다 — membership_admin 은 owner · membership_admin 으로 초대하지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, admin } = await office()
    const invite = (inviter: Actor, role: 'owner' | 'membership_admin' | 'member') =>
      createEmailInvite({ workspaceId: ws, inviterUserId: inviter.userId, inviterRole: inviter.ctx.role, email: `${unique('초대')}@example.com`.replace(/\s/g, ''), role })
    assert.equal(reasonOf(await invite(admin, 'owner')), 'forbidden')
    assert.equal(reasonOf(await invite(admin, 'membership_admin')), 'forbidden')
    assert.equal(reasonOf(await invite(admin, 'member')), 'ok')
    assert.equal(reasonOf(await invite(boss, 'owner')), 'ok', 'owner 는 owner 로 초대한다')
  })
})

describe('② ★ 활성 owner 는 늘 하나 이상', () => {
  test('혼자인 owner 는 스스로 내려가지 못한다 · 둘이면 된다 · 자기 자신은 내보내지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await office()
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, boss.userId, 'member')), 'last_owner')
    assert.equal(reasonOf(await removeMember(boss.ctx, boss.userId)), 'self')
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'owner')), 'ok')
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, boss.userId, 'member')), 'ok', '다른 owner 가 있으면 내려간다')
    assert.equal((await memberRow(ws, boss.userId))?.role, 'member')
  })

  test('★ 두 owner 가 서로를 동시에 내리면 하나만 된다 — owner 가 0 이 되지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (let round = 0; round < 5; round += 1) {
      const { ws, boss, mate } = await office()
      unwrapOk(await changeMemberRole(boss.ctx, mate.userId, 'owner'))
      const mateAsOwner = await joinAs(ws, { userId: mate.userId }, 'owner')
      const results = await Promise.all([
        changeMemberRole(boss.ctx, mate.userId, 'member'),
        changeMemberRole(mateAsOwner.ctx, boss.userId, 'member'),
      ])
      const owners = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM workspace_member WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'`,
        [ws],
      )
      assert.equal(owners.n, 1, `판 ${round}: 남은 owner ${owners.n} — ${JSON.stringify(results.map(reasonOf))}`)
      assert.equal(results.filter((r) => r.ok).length, 1, `판 ${round}: 하나만 된다 — ${JSON.stringify(results.map(reasonOf))}`)
    }
  })
})

describe('② ★ 낡은 세션의 역할', () => {
  test('방금 내려간 owner 가 그 전에 받은 세션으로 다른 owner 를 건드리지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate, lim } = await office()
    unwrapOk(await changeMemberRole(boss.ctx, mate.userId, 'owner'))
    unwrapOk(await changeMemberRole(boss.ctx, lim.userId, 'owner'))
    const stale = await joinAs(ws, { userId: mate.userId }, 'owner') // owner 일 때 받은 세션
    unwrapOk(await changeMemberRole(boss.ctx, mate.userId, 'member'))
    assert.equal(stale.ctx.role, 'owner', '전제: 세션은 아직 owner 라고 말한다')
    assert.equal(reasonOf(await changeMemberRole(stale.ctx, lim.userId, 'member')), 'forbidden', '★ 지금 역할로 판정한다')
    assert.equal(reasonOf(await removeMember(stale.ctx, lim.userId)), 'forbidden')
    assert.equal((await memberRow(ws, lim.userId))?.role, 'owner')
  })
})

function unwrapOk<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

describe('③ ★ teamspace 의 마지막 owner', () => {
  test('마지막 owner 는 내보내지 않는다 — 그 이름을 준다 · 다른 owner 가 생기면 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await office()
    const name = unique('설계팀')
    const team = unwrapOk(await createTeamspace(mate.ctx, { name }))
    const refused = await removeMember(boss.ctx, mate.userId)
    assert.equal(reasonOf(refused), 'teamspace_last_owner')
    assert.deepEqual(!refused.ok && refused.teamspaces, [name], '★ 그 teamspace 의 이름')
    assert.equal((await memberRow(ws, mate.userId))?.status, 'active', '아무것도 바뀌지 않았다')

    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'restricted_member')), 'ok', 'restricted 로 내리는 것은 막지 않는다(행동할 수 있는 owner 다)')
    assert.equal(reasonOf(await changeMemberRole(boss.ctx, mate.userId, 'member')), 'ok')

    unwrapOk(await addTeamspaceMember(mate.ctx, team.id, { type: 'user', id: boss.userId }, 'owner'))
    assert.equal(reasonOf(await removeMember(boss.ctx, mate.userId)), 'ok', '다른 owner 가 있으면 내보낸다')
  })

  test('떠난 사람은 owner 로 세지 않는다 · 지워지지 않은 그룹은 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await office()
    const gone = await joinAs(ws, await createUser('떠날 사람'), 'member')
    const team = unwrapOk(await createTeamspace(mate.ctx, { name: unique('공방') }))
    unwrapOk(await addTeamspaceMember(mate.ctx, team.id, { type: 'user', id: gone.userId }, 'owner'))
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [ws, gone.userId])
    assert.equal(reasonOf(await removeMember(boss.ctx, mate.userId)), 'teamspace_last_owner', '떠난 사람의 owner 행은 owner 가 아니다')

    const group = unwrapOk(await createGroup(boss.ctx, unique('관리팀')))
    unwrapOk(await addTeamspaceMember(mate.ctx, team.id, { type: 'group', id: group.id }, 'owner'))
    assert.equal(reasonOf(await removeMember(boss.ctx, mate.userId)), 'ok', '지워지지 않은 그룹은 owner 로 센다')
  })
})

describe('④ ★ 내보내기는 M1', () => {
  test('부여 · 그룹 · teamspace 멤버십은 남고 게이트가 막는다 · 다시 들어오면 그 페이지가 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate } = await office()
    const page = await createPage(boss.ctx, { title: titleFromPlainText(unique('기밀')), privateTop: true })
    assert.ok((await grantAccess(boss.ctx, page.id as BlockId, { type: 'user', id: mate.userId }, 'edit')).ok)
    const group = unwrapOk(await createGroup(boss.ctx, unique('설계')))
    unwrapOk(await addGroupMember(boss.ctx, group.id, mate.userId))
    const team = unwrapOk(await createTeamspace(boss.ctx, { name: unique('본부') }))
    unwrapOk(await addTeamspaceMember(boss.ctx, team.id, { type: 'user', id: mate.userId }, 'member'))
    const gen = async () => (await queryOne<{ g: string }>(`SELECT perm_gen::text AS g FROM "user" WHERE id = $1`, [mate.userId])).g
    const genBefore = await gen()
    assert.equal(await canViewPage(mate.ctx, page.id as BlockId), true, '전제: 받은 페이지를 본다')

    assert.equal(reasonOf(await removeMember(boss.ctx, mate.userId)), 'ok')
    const row = await memberRow(ws, mate.userId)
    assert.equal(row?.status, 'removed')
    assert.ok(row?.removed_at instanceof Date, 'removed_at')
    const kept = await queryOne<{ acl: number; grp: number; tsm: number }>(
      `SELECT (SELECT count(*)::int FROM acl_entry WHERE principal_type = 'user' AND principal_id = $1 AND node_id = $2) AS acl,
              (SELECT count(*)::int FROM group_member WHERE user_id = $1 AND group_id = $3 AND removed_at IS NULL) AS grp,
              (SELECT count(*)::int FROM teamspace_member WHERE principal_type = 'user' AND principal_id = $1 AND teamspace_id = $4
                                                            AND removed_at IS NULL) AS tsm`,
      [mate.userId, page.id, group.id, team.id],
    )
    assert.deepEqual(kept, { acl: 1, grp: 1, tsm: 1 }, '★ 거두지 않는다(M1)')
    assert.equal((await resolveSessionContext(mate.token, ws)).ok, false, '★ 0단계 게이트가 막는다')
    assert.notEqual(await gen(), genBefore, '권한 세대가 오른다')

    const again = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: mate.email, role: 'member' })
    assert.ok(again.ok, JSON.stringify(again))
    assert.equal((await acceptInvite(again.token, mate.userId)).ok, true)
    const back = await resolveSessionContext(mate.token, ws)
    assert.ok(back.ok, '다시 들어온다')
    assert.equal(await canViewPage(back.context, page.id as BlockId), true, '★ 그 페이지가 돌아온다')
  })
})

describe('⑤ 기본 teamspace', () => {
  test('restricted 에서 멤버로 올리면 기본 teamspace 에 들어간다 · 내려도 멤버십은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, lim } = await office()
    const everyone = unwrapOk(await createTeamspace(boss.ctx, { name: unique('전사') }))
    unwrapOk(await setDefaultTeamspace(boss.ctx, everyone.id, true))
    const inTeam = async () =>
      (await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM teamspace_member WHERE teamspace_id = $1 AND principal_type = 'user' AND principal_id = $2 AND removed_at IS NULL`,
        [everyone.id, lim.userId],
      )).n
    assert.equal(await inTeam(), 0, '전제: 제한 멤버는 기본 teamspace 에 없다')
    const up = unwrapOk(await changeMemberRole(boss.ctx, lim.userId, 'member'))
    assert.equal(up.teamspaces, 1)
    assert.equal(await inTeam(), 1, '★ 올리면 들어간다')
    unwrapOk(await changeMemberRole(boss.ctx, lim.userId, 'restricted_member'))
    assert.equal(await inTeam(), 1, '내려도 멤버십은 남는다')
  })
})

describe('⑥ 감사 로그', () => {
  test('역할 바꾸기 · 내보내기가 남는다 — 같은 역할이면 아무것도 쓰지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, mate, lim } = await office()
    unwrapOk(await changeMemberRole(boss.ctx, mate.userId, 'member'))
    unwrapOk(await changeMemberRole(boss.ctx, mate.userId, 'restricted_member'))
    unwrapOk(await removeMember(boss.ctx, lim.userId))
    const events = await query<{ event_type: string; target_id: string; metadata: Record<string, unknown> }>(
      `SELECT event_type, target_id, metadata FROM audit_event WHERE workspace_id = $1 AND event_type LIKE 'workspace.member_%' ORDER BY occurred_at, id`,
      [ws],
    )
    assert.deepEqual(
      events.map((e) => [e.event_type, e.target_id, e.metadata]),
      [
        ['workspace.member_role_changed', mate.userId, { from: 'member', to: 'restricted_member' }],
        ['workspace.member_removed', lim.userId, { role: 'restricted_member' }],
      ],
    )
  })
})
