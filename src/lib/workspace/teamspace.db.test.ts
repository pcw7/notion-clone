/**
 * teamspace — Teamspace · 게스트 · 그룹 7c-1 · 7c-2 · 7c-5 · 7c-6조각 (F-06-04 · F-02-12 · DB · 마이그레이션 0028)
 *
 * 이 파일이 지키는 것. 판정(`canViewPage`)과 목록(`listTeamspacePages` · 사이드바 `listPageTree` — 스코프로 거른다)을
 * **나란히** 묻는다(HANDOFF §3.3-107).
 *
 *   ① ★ 멤버는 teamspace 의 페이지를 보고 편집한다 · 멤버가 아닌 사람은 제목도 못 본다 · 스코프는 teamspace 다
 *   ② 그룹을 거쳐 멤버가 된 사람도 본다 · 그룹에서 빠지면 못 본다
 *   ③ ★ 빠지면 못 보고 다시 넣으면 본다(M1 — 같은 행) · 멤버였다 게스트가 되면 못 본다
 *   ④ ★ 상속을 끊어도 멤버가 잃지 않는다 — teamspace 노드의 부여가 복사된다(P1)
 *   ⑤ ★ 행이 다 사라진 최상위 페이지는 teamspace 스코프로 돌아간다 — 안 돌아가면 목록이 그 페이지를 잃는다
 *   ⑥ 넣을 수 있는 주체 — 게스트 · 초대만 받은 사람 · 남의 워크스페이스 사람 · 지운 그룹은 invalid_member
 *   ⑦ ★ 역할 — owner 는 노드에 full_access 행 · 역할은 owner 만 바꾼다 · 마지막 owner 는 내리지도 빼지도 못한다
 *   ⑧ 초대와 나가기 — who_can_invite · owner 로 넣기는 owner 만 · 멤버는 자기만 뺀다 · 멤버가 아니면 없는 것과 같다
 *   ⑨ 만들기 · 최상위 페이지 — 제한 멤버 · 게스트는 못 만든다 · 멤버가 아니면 페이지를 못 둔다 · 보관된 teamspace
 *   ⑩ 복제 · 공유 — 최상위 페이지의 사본은 같은 teamspace · ('teamspace', T) 에 준 페이지는 멤버가 본다
 *   ⑪ 세대 · 신호 — 멤버십 · 역할(teamspace 노드의 행) · 보관이 협업 서버에 간다
 *   ⑫ 화면이 읽는 것(7c-2) — 사이드바 노드의 teamspace · 섹션 가르기 · getTeamspace(멤버만 · 그룹을 거친 역할)
 *   ⑬ 공개 범위 · 둘러보기 · 참여(7c-5 · 7c-9) — 목록에 무엇이 오는가 · open 만 참여 · open 은 참여 전에도 **읽는다** ·
 *      설정은 owner 만
 *   ⑭ 보관 · 복원(7c-6) — ★ 보관하면 owner 까지 못 본다(판정 = 목록) · 따로 준 부여는 남는다 · owner 만 되살린다
 *   ⑮ 고아 teamspace(7c-10) — ★ 마지막 owner 인 그룹은 지우지 못한다 · 워크스페이스 owner 는 모든 teamspace 를 보고
 *      owner 로 들어간다(비공개 · 보관 포함) — 막고, 되살린다
 *   ⑯ 기본 teamspace(7c-11) — ★ 켜면 전원(제한 멤버 · 게스트 제외)이 member 로 · ★ 이후 가입자도(초대 수락) · ★ 켜는
 *      명령과 엇갈려도 빠지지 않는다 · 워크스페이스 owner 이면서 teamspace owner 만 · ★ 기본은 보관하지 못한다
 *   ⑰ 멤버 기본 레벨(7c-12) — ★ 낮추면 멤버의 판정 · 만들기 · 목록이 함께 바뀌고 소유자는 그대로 · ★ 끊긴 페이지는 옛 레벨(P2)
 *      · 소유자만 · 넷 밖은 invalid_level · ★ 바꾸면 신호, 같은 값이면 없음
 *   ⑱ 아이콘(7c-14) — ★ 만들 때 · 고칠 때 · 지울 때 목록마다 같은 값 · 모양이 아니면 invalid_icon · owner 만
 *
 * 열린 협업 연결이 멤버에서 빠질 때 닫히는지는 `collab/collab-server.db.test.ts` ⑨ 가 본다.
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { setWorkspacePlan } from '../billing/plan.ts'
import { duplicatePage } from '../block/duplicate.ts'
import { listTeamspaceDestinations } from '../block/move-page.ts'
import { createPage, getPage, listTeamspacePages, PageError, titleFromPlainText } from '../block/page.ts'
import { groupSidebarRoots, listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { getPool, query, queryOne } from '../db/pool.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, listAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { canViewPage, effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import {
  createBareWorkspace,
  createUser,
  joinAs,
  makeFixture,
  probeDatabase,
  type Actor,
  type Fixture,
} from '../testing/db-fixtures.ts'
import { addGroupMember, createGroup, deleteGroup, removeGroupMember } from './group.ts'
import { acceptInvite, createEmailInvite } from './invite.ts'
import {
  addTeamspaceMember,
  archiveTeamspace,
  claimTeamspaceOwnership,
  createTeamspace,
  getTeamspace,
  joinTeamspace,
  listAllTeamspaces,
  listArchivedTeamspaces,
  listBrowsableTeamspaces,
  listMyTeamspaces,
  listTeamspaceMembers,
  removeTeamspaceMember,
  restoreTeamspace,
  joinDefaultTeamspaces,
  setDefaultTeamspace,
  setTeamspaceMemberRole,
  updateTeamspace,
} from './teamspace.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  // private teamspace 는 요금제 게이트다(8k-2 · teamspace.private — Business 부터). 이 파일은 공개 범위의 뜻을 보므로 그 게이트 밖에서 —
  // 게이트 자체는 billing/plan-gates.db.test.ts ④ 가 본다.
  await setWorkspacePlan(fx.workspaceId, 'business')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

const member = async (name: string, role: Parameters<typeof joinAs>[2] = 'member'): Promise<Actor> =>
  joinAs(fx.workspaceId, await createUser(name), role)

async function newTeamspace(by: Actor = fx.owner): Promise<string> {
  const created = await createTeamspace(by.ctx, { name: unique('팀') })
  assert.ok(created.ok, JSON.stringify(created))
  return created.value.id
}

const user = (actor: Actor) => ({ type: 'user' as const, id: actor.userId })

async function join(teamspaceId: string, ...actors: Actor[]): Promise<void> {
  for (const actor of actors) {
    const added = await addTeamspaceMember(fx.owner.ctx, teamspaceId, user(actor))
    assert.ok(added.ok, JSON.stringify(added))
  }
}

async function topPage(teamspaceId: string, title = '팀 문서', by: Actor = fx.owner): Promise<BlockId> {
  return (await createPage(by.ctx, { teamspaceId, title: titleFromPlainText(title) })).id
}

const flatten = (nodes: readonly PageTreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...flatten(n.children)])

/** 판정 · teamspace 목록 · 사이드바를 **나란히**. */
async function sees(actor: Actor, page: string, teamspaceId: string) {
  const judged = await canViewPage(actor.ctx, page)
  const listed = (await listTeamspacePages(actor.ctx, teamspaceId)).some((p) => p.id === page)
  const sidebar = flatten(await listPageTree(actor.ctx)).includes(page)
  return { judged, listed, sidebar }
}
const SEES = { judged: true, listed: true, sidebar: true }
const BLIND = { judged: false, listed: false, sidebar: false }

const capsOf = (actor: Actor, page: string) => withReadTransaction((tx) => effectiveCaps(tx, actor.ctx, page))
const scopeOf = async (page: string): Promise<string> =>
  (await queryOne<{ perm_scope_id: string }>(`SELECT perm_scope_id FROM block WHERE id = $1`, [page])).perm_scope_id
const ownerRows = async (teamspaceId: string) =>
  query<{ principal_type: string; principal_id: string; level: string }>(
    `SELECT principal_type, principal_id, level FROM acl_entry
      WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type <> 'teamspace'
      ORDER BY principal_id`,
    [teamspaceId],
  )

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 멤버와 teamspace 의 페이지', () => {
  test('★ 멤버는 보고 편집한다 · 멤버가 아닌 사람은 판정 · 목록 · 사이드바 어디서도 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('앨리스')
    const outsider = await member('바깥 사람')
    const teamspace = await newTeamspace()
    await join(teamspace, alice)
    const page = await topPage(teamspace)
    const child = (await createPage(fx.owner.ctx, { parentPageId: page, title: titleFromPlainText('하위') })).id

    assert.deepEqual(await sees(alice, page, teamspace), SEES)
    assert.ok(can(await capsOf(alice, child), 'edit_content'), '하위 페이지도 멤버 기본 레벨(full_access)로 받는다')
    assert.deepEqual(await sees(outsider, page, teamspace), BLIND, '워크스페이스 멤버여도 teamspace 멤버가 아니면 못 본다')
    assert.equal(await canViewPage(outsider.ctx, child), false)
  })

  test('최상위 페이지의 부모는 teamspace 이고 스코프도 teamspace 다 — 하위도 따른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)
    const child = (await createPage(fx.owner.ctx, { parentPageId: page, title: titleFromPlainText('하위') })).id
    const row = await queryOne<{ parent_type: string; parent_id: string; ancestor_path: string[] }>(
      `SELECT parent_type, parent_id, ancestor_path FROM block WHERE id = $1`,
      [page],
    )
    assert.deepEqual(row, { parent_type: 'teamspace', parent_id: teamspace, ancestor_path: [] }, 'teamspace 는 ancestor_path 에 없다')
    assert.deepEqual([await scopeOf(page), await scopeOf(child)], [teamspace, teamspace])
    assert.equal((await getPage(fx.owner.ctx, page))?.teamspaceId, teamspace)
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 그룹을 거친 멤버', () => {
  test('그룹이 멤버면 그 그룹의 사람이 본다 · 그룹에서 빠지면 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const bob = await member('밥')
    const group = await createGroup(fx.owner.ctx, unique('그룹'))
    assert.ok(group.ok)
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, bob.userId)).ok)
    const teamspace = await newTeamspace()
    assert.ok((await addTeamspaceMember(fx.owner.ctx, teamspace, { type: 'group', id: group.value.id })).ok)
    const page = await topPage(teamspace)

    assert.deepEqual(await sees(bob, page, teamspace), SEES)
    assert.ok((await listMyTeamspaces(bob.ctx)).some((s) => s.id === teamspace && s.role === 'member'))

    assert.ok((await removeGroupMember(fx.owner.ctx, group.value.id, bob.userId)).ok)
    assert.deepEqual(await sees(bob, page, teamspace), BLIND)
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 빠지기 · 돌아오기 · 게스트', () => {
  test('★ 빠지면 곧바로 못 보고 다시 넣으면 본다 — 같은 행이 살아난다(M1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const carol = await member('캐럴')
    const teamspace = await newTeamspace()
    await join(teamspace, carol)
    const page = await topPage(teamspace)
    assert.deepEqual(await sees(carol, page, teamspace), SEES, '전제')

    assert.ok((await removeTeamspaceMember(fx.owner.ctx, teamspace, user(carol))).ok)
    assert.deepEqual(await sees(carol, page, teamspace), BLIND)

    await join(teamspace, carol)
    assert.deepEqual(await sees(carol, page, teamspace), SEES)
    const rows = await query(`SELECT 1 FROM teamspace_member WHERE teamspace_id = $1 AND principal_id = $2`, [teamspace, carol.userId])
    assert.equal(rows.length, 1)
  })

  test('★ 멤버였다 게스트가 되면 남은 멤버 행이 있어도 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const person = await createUser('게스트가 될 사람')
    const asMember = await joinAs(fx.workspaceId, person, 'member')
    const teamspace = await newTeamspace()
    await join(teamspace, asMember)
    const page = await topPage(teamspace)
    assert.deepEqual(await sees(asMember, page, teamspace), SEES, '전제')

    const asGuest = await joinAs(fx.workspaceId, person, 'guest')
    assert.deepEqual(await sees(asGuest, page, teamspace), BLIND)
    assert.deepEqual(await listMyTeamspaces(asGuest.ctx), [])
  })
})

// ── ④ · ⑤ ─────────────────────────────────────────────────────────────

describe('④ · ⑤ 상속 끊기와 스코프', () => {
  test('★ teamspace 페이지의 상속을 끊어도 멤버는 잃지 않는다 — teamspace 노드의 부여가 이 페이지로 복사된다(P1)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const dana = await member('데이나')
    const teamspace = await newTeamspace()
    await join(teamspace, dana)
    const page = await topPage(teamspace)

    assert.ok((await stopInheriting(fx.owner.ctx, page)).ok)
    assert.deepEqual(await sees(dana, page, teamspace), SEES, '끊자 멤버가 접근을 잃었다')
    const access = await listAccess(fx.owner.ctx, page)
    assert.ok(access.ok)
    assert.ok(
      access.value.some((e) => e.principalType === 'teamspace' && e.principalId === teamspace && !e.inherited),
      JSON.stringify(access.value),
    )
  })

  test('상속된 것을 보여줄 때 teamspace 노드의 부여도 "상위에서 상속됨"으로 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)
    const access = await listAccess(fx.owner.ctx, page)
    assert.ok(access.ok)
    assert.deepEqual(
      access.value.map((e) => [e.principalType, e.inherited]).sort(),
      [
        ['teamspace', true],
        ['user', true],
      ],
      '멤버 전원 행 · 만든 사람(owner) 행',
    )
  })

  test('★ 최상위 페이지의 마지막 행을 지우면 teamspace 스코프로 돌아간다 — 멤버의 목록이 그 페이지를 잃지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const erin = await member('에린')
    const extra = await member('따로 받은 사람')
    const teamspace = await newTeamspace()
    await join(teamspace, erin)
    const page = await topPage(teamspace)

    assert.ok((await grantAccess(fx.owner.ctx, page, user(extra), 'view')).ok)
    assert.equal(await scopeOf(page), page, '전제: 행이 생기면 경계다')
    assert.ok((await revokeAccess(fx.owner.ctx, page, user(extra))).ok)

    assert.equal(await scopeOf(page), teamspace)
    assert.deepEqual(await sees(erin, page, teamspace), SEES)
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 넣을 수 있는 주체', () => {
  test('게스트 · 초대만 받은 사람 · 남의 워크스페이스 사람 · 지운 그룹 · 남의 그룹은 invalid_member — 행이 생기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const guest = await member('손님', 'guest')
    const invited = await createUser('초대만 받은 사람')
    await query(`INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'invited')`, [
      fx.workspaceId,
      invited.userId,
    ])
    const elsewhere = await joinAs(await createBareWorkspace('남의 워크스페이스'), await createUser('남'), 'member')
    const gone = await createGroup(fx.owner.ctx, unique('지울 그룹'))
    assert.ok(gone.ok)
    assert.ok((await deleteGroup(fx.owner.ctx, gone.value.id)).ok)
    const other = await makeFixture()
    const theirs = await createGroup(other.owner.ctx, '남의 그룹')
    assert.ok(theirs.ok)

    for (const principal of [
      user(guest),
      { type: 'user' as const, id: invited.userId },
      user(elsewhere),
      { type: 'group' as const, id: gone.value.id },
      { type: 'group' as const, id: theirs.value.id },
    ]) {
      assert.deepEqual(await addTeamspaceMember(fx.owner.ctx, teamspace, principal), { ok: false, reason: 'invalid_member' })
    }
    const rows = await query(`SELECT 1 FROM teamspace_member WHERE teamspace_id = $1`, [teamspace])
    assert.equal(rows.length, 1, '만든 사람 하나뿐이다')
  })

  test('DB 도 게스트를 막는다 — 앱의 확인을 건너뛴 쓰기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const guest = await member('손님', 'guest')
    await assert.rejects(
      query(`INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role) VALUES ($1, 'user', $2, 'member')`, [
        teamspace,
        guest.userId,
      ]),
      (e: { code?: string }) => e.code === '23514',
    )
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 역할', () => {
  test('★ owner 로 올리면 teamspace 노드에 full_access 행이 서고 내리면 사라진다 — 멤버로서의 접근은 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const gil = await member('길')
    const teamspace = await newTeamspace()
    await join(teamspace, gil)
    const page = await topPage(teamspace)
    assert.deepEqual(
      (await ownerRows(teamspace)).map((r) => r.principal_id),
      [fx.owner.userId],
      '전제: 만든 사람의 owner 행 하나',
    )

    assert.ok((await setTeamspaceMemberRole(fx.owner.ctx, teamspace, user(gil), 'owner')).ok)
    assert.deepEqual(
      (await ownerRows(teamspace)).map((r) => [r.principal_id, r.level]).sort(),
      [
        [fx.owner.userId, 'full_access'],
        [gil.userId, 'full_access'],
      ].sort(),
    )
    assert.ok((await listMyTeamspaces(gil.ctx)).some((s) => s.id === teamspace && s.role === 'owner'))

    assert.ok((await setTeamspaceMemberRole(fx.owner.ctx, teamspace, user(gil), 'member')).ok)
    assert.deepEqual((await ownerRows(teamspace)).map((r) => r.principal_id), [fx.owner.userId])
    assert.deepEqual(await sees(gil, page, teamspace), SEES, '멤버로서는 여전히 본다')
  })

  test('역할은 owner 만 바꾼다 — 멤버는 forbidden · 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const hana = await member('하나')
    const teamspace = await newTeamspace()
    await join(teamspace, hana)
    assert.deepEqual(await setTeamspaceMemberRole(hana.ctx, teamspace, user(hana), 'owner'), { ok: false, reason: 'forbidden' })
    assert.deepEqual((await ownerRows(teamspace)).map((r) => r.principal_id), [fx.owner.userId])
  })

  test('★ 마지막 owner 는 내리지도 빼지도 못한다 — 다른 owner 가 있으면 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ian = await member('이안')
    const teamspace = await newTeamspace()
    await join(teamspace, ian)

    assert.deepEqual(await setTeamspaceMemberRole(fx.owner.ctx, teamspace, user(fx.owner), 'member'), {
      ok: false,
      reason: 'last_owner',
    })
    assert.deepEqual(await removeTeamspaceMember(fx.owner.ctx, teamspace, user(fx.owner)), { ok: false, reason: 'last_owner' })
    assert.deepEqual((await ownerRows(teamspace)).map((r) => r.principal_id), [fx.owner.userId], '거부됐는데 바뀌었다')

    assert.ok((await setTeamspaceMemberRole(fx.owner.ctx, teamspace, user(ian), 'owner')).ok)
    assert.ok((await removeTeamspaceMember(fx.owner.ctx, teamspace, user(fx.owner))).ok, '다른 owner 가 있으면 나갈 수 있다')
    assert.deepEqual((await ownerRows(teamspace)).map((r) => r.principal_id), [ian.userId])
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ 초대와 나가기', () => {
  test('멤버도 초대한다(all_members) · owner 로 넣기는 owner 만 · owners 로 좁히면 멤버는 못 한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const [jay, kim, lee, mo] = [await member('제이'), await member('김'), await member('리'), await member('모')]
    const teamspace = await newTeamspace()
    await join(teamspace, jay)

    assert.ok((await addTeamspaceMember(jay.ctx, teamspace, user(kim))).ok)
    assert.deepEqual(await addTeamspaceMember(jay.ctx, teamspace, user(lee), 'owner'), { ok: false, reason: 'forbidden' })

    await query(`UPDATE teamspace SET who_can_invite = 'owners' WHERE id = $1`, [teamspace])
    assert.deepEqual(await addTeamspaceMember(jay.ctx, teamspace, user(mo)), { ok: false, reason: 'forbidden' })
    assert.ok((await addTeamspaceMember(fx.owner.ctx, teamspace, user(mo))).ok)
  })

  test('멤버는 자기만 뺀다(나가기) · 남은 못 뺀다 · 멤버가 아니면 없는 teamspace 와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const [nam, oh, stranger] = [await member('남'), await member('오'), await member('모르는 사람')]
    const teamspace = await newTeamspace()
    await join(teamspace, nam, oh)

    assert.deepEqual(await removeTeamspaceMember(nam.ctx, teamspace, user(oh)), { ok: false, reason: 'forbidden' })
    assert.ok((await removeTeamspaceMember(nam.ctx, teamspace, user(nam))).ok)

    const results = [
      await addTeamspaceMember(stranger.ctx, teamspace, user(stranger)),
      await setTeamspaceMemberRole(stranger.ctx, teamspace, user(oh), 'owner'),
      await removeTeamspaceMember(stranger.ctx, teamspace, user(oh)),
      await listTeamspaceMembers(stranger.ctx, teamspace),
    ]
    assert.deepEqual(
      results.map((r) => (r.ok ? 'ok' : r.reason)),
      ['not_found', 'not_found', 'not_found', 'not_found'],
    )
  })
})

// ── ⑨ ─────────────────────────────────────────────────────────────────

describe('⑨ 만들기 · 최상위 페이지', () => {
  test('restricted_member · guest 는 만들지 못한다 · 이름 · 보이는 범위가 틀리면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const role of ['restricted_member', 'guest'] as const) {
      const actor = await member(`역할 ${role}`, role)
      assert.deepEqual(await createTeamspace(actor.ctx, { name: '몰래' }), { ok: false, reason: 'forbidden' }, role)
    }
    assert.deepEqual(await createTeamspace(fx.owner.ctx, { name: '   ' }), { ok: false, reason: 'invalid_name' })
    assert.deepEqual(await createTeamspace(fx.owner.ctx, { name: '팀', visibility: 'secret' }), {
      ok: false,
      reason: 'invalid_visibility',
    })
  })

  test('멤버가 아니면 최상위에 페이지를 못 둔다 · 보관된 teamspace 에도 · 부모와 teamspace 를 함께 줄 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stranger = await member('모르는 사람')
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)

    const attempt = (actor: Actor, input: Parameters<typeof createPage>[1]) =>
      createPage(actor.ctx, input).then(
        () => 'ok',
        (e: unknown) => (e instanceof PageError ? e.code : String(e)),
      )
    assert.equal(await attempt(stranger, { teamspaceId: teamspace }), 'parent_not_found')
    assert.equal(await attempt(fx.owner, { teamspaceId: teamspace, parentPageId: page }), 'parent_not_found')

    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [teamspace])
    assert.equal(await attempt(fx.owner, { teamspaceId: teamspace }), 'parent_not_found')
  })
})

// ── ⑩ ─────────────────────────────────────────────────────────────────

describe('⑩ 복제 · 공유', () => {
  test('최상위 페이지를 같은 자리에 복제하면 사본도 그 teamspace 의 최상위다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace, '원본')
    const copy = await duplicatePage(fx.owner.ctx, page)
    const row = await queryOne<{ parent_type: string; parent_id: string }>(`SELECT parent_type, parent_id FROM block WHERE id = $1`, [
      copy.page.id,
    ])
    assert.deepEqual(row, { parent_type: 'teamspace', parent_id: teamspace })
  })

  test('워크스페이스 직속 페이지를 teamspace 에 공유하면 그 멤버가 본다 · 남의 teamspace 에는 줄 수 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const pat = await member('팻')
    const teamspace = await newTeamspace()
    await join(teamspace, pat)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('직속') })).id
    assert.ok((await grantAccess(fx.owner.ctx, page, user(fx.owner), 'full_access')).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })).ok)
    assert.equal(await canViewPage(pat.ctx, page), false, '전제')

    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'teamspace', id: teamspace }, 'view')).ok)
    assert.equal(await canViewPage(pat.ctx, page), true)

    const other = await makeFixture()
    const theirs = await createTeamspace(other.owner.ctx, { name: '남의 팀' })
    assert.ok(theirs.ok)
    assert.deepEqual(await grantAccess(fx.owner.ctx, page, { type: 'teamspace', id: theirs.value.id }, 'view'), {
      ok: false,
      reason: 'invalid_principal',
    })
  })
})

// ── ⑪ ─────────────────────────────────────────────────────────────────

async function waitFor(label: string, check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) assert.fail(`기다리다 끝났다 — ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function listenTo(t: TestContext, workspaceId: string): Promise<() => number> {
  const heard: CollabSignal[] = []
  const feed = await openChangeFeed({ onSignal: (s) => void heard.push(s), onResync: () => {} })
  t.after(() => feed.close())
  return () => heard.filter((s) => s.kind === 'access' && s.workspaceId === workspaceId).length
}

const permGen = async (userId: string): Promise<number> =>
  Number((await queryOne<{ g: string }>(`SELECT perm_gen::text AS g FROM "user" WHERE id = $1`, [userId])).g)

describe('⑪ 세대 · 신호', () => {
  test('★ 넣기 · 빼기 · 되살리기 · 역할 바꾸기(teamspace 노드의 행) · 보관이 신호를 보낸다 · 그룹이 멤버가 되면 그 사람들의 세대가 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const own = await makeFixture()
    const quinn = await joinAs(own.workspaceId, await createUser('퀸'), 'member')
    const rae = await joinAs(own.workspaceId, await createUser('레이'), 'member')
    const created = await createTeamspace(own.owner.ctx, { name: '신호 팀' })
    assert.ok(created.ok)
    const teamspace = created.value.id
    const group = await createGroup(own.owner.ctx, '신호 그룹')
    assert.ok(group.ok)
    assert.ok((await addGroupMember(own.owner.ctx, group.value.id, rae.userId)).ok)
    const heard = await listenTo(t, own.workspaceId)

    const quinnRef = { type: 'user' as const, id: quinn.userId }
    const gen0 = await permGen(quinn.userId)
    assert.ok((await addTeamspaceMember(own.owner.ctx, teamspace, quinnRef)).ok)
    await waitFor('넣기의 신호', () => heard() >= 1)
    assert.equal(await permGen(quinn.userId), gen0 + 1)

    // 빼기 · 되살리기는 **평범한 멤버**로 본다. owner 를 빼면 teamspace 노드의 owner 행도 지워져 그 삭제가 따로 신호를
    // 보낸다 — 그러면 멤버 행의 신호가 빠져도 통과한다(dD 반사실이 처음에 그래서 통과했다).
    assert.ok((await removeTeamspaceMember(own.owner.ctx, teamspace, quinnRef)).ok)
    await waitFor('빼기의 신호', () => heard() >= 2)
    assert.ok((await addTeamspaceMember(own.owner.ctx, teamspace, quinnRef)).ok)
    await waitFor('되살리기의 신호', () => heard() >= 3)

    // 역할은 P(U) 를 바꾸지 않는다 — 신호는 teamspace 노드의 owner 행이 보낸다(0028 ④).
    assert.ok((await setTeamspaceMemberRole(own.owner.ctx, teamspace, quinnRef, 'owner')).ok)
    await waitFor('역할(teamspace 노드의 행)의 신호', () => heard() >= 4)

    const raeGen = await permGen(rae.userId)
    assert.ok((await addTeamspaceMember(own.owner.ctx, teamspace, { type: 'group', id: group.value.id })).ok)
    await waitFor('그룹 넣기의 신호', () => heard() >= 5)
    assert.equal(await permGen(rae.userId), raeGen + 1, '그룹의 사람 세대가 오르지 않았다')

    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [teamspace])
    await waitFor('보관의 신호', () => heard() >= 6)
  })
})

// ── ⑫ ─────────────────────────────────────────────────────────────────

describe('⑫ 화면이 읽는 것 (7c-2)', () => {
  const find = (nodes: readonly PageTreeNode[], id: string): PageTreeNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node
      const hit = find(node.children, id)
      if (hit) return hit
    }
    return undefined
  }

  test('★ 사이드바 트리의 노드가 자기 teamspace 를 싣고 · 루트가 내 teamspace 섹션으로 간다 — 직속은 rest', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace, '팀 최상위')
    const child = (await createPage(fx.owner.ctx, { parentPageId: page, title: titleFromPlainText('팀 하위') })).id
    const direct = (await createPage(fx.owner.ctx, { title: titleFromPlainText('직속') })).id

    const tree = await listPageTree(fx.owner.ctx)
    assert.deepEqual(
      [find(tree, page)?.teamspaceId, find(tree, child)?.teamspaceId, find(tree, direct)?.teamspaceId],
      [teamspace, teamspace, null],
    )
    const split = groupSidebarRoots(tree, await listMyTeamspaces(fx.owner.ctx))
    const section = split.teamspaces.find((s) => s.teamspace.id === teamspace)
    assert.deepEqual(section?.pages.map((p) => p.id), [page])
    assert.ok(split.workspacePages.some((p) => p.id === direct))
    assert.ok(!split.workspacePages.some((p) => p.id === page), '팀 최상위가 직속 페이지와 섞였다')
  })

  test('팀 밖에서 공유받은 하위 페이지 — 루트를 못 봐도 teamspace 를 싣지만 · 멤버가 아니니 공유됨으로 간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const sam = await member('샘')
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)
    const child = (await createPage(fx.owner.ctx, { parentPageId: page, title: titleFromPlainText('따로 공유') })).id
    assert.ok((await grantAccess(fx.owner.ctx, child, user(sam), 'view')).ok)

    const tree = await listPageTree(sam.ctx)
    assert.equal(find(tree, page), undefined, '전제 — 루트는 못 본다')
    assert.equal(find(tree, child)?.teamspaceId, teamspace)
    const split = groupSidebarRoots(tree, await listMyTeamspaces(sam.ctx))
    assert.deepEqual(split.teamspaces, [])
    assert.ok(split.shared.some((p) => p.id === child), '따로 공유받은 팀 페이지가 공유됨에 없다')
  })

  test('getTeamspace — 멤버는 머리와 내 역할 · 초대 규칙을 받는다 · 그룹을 거친 owner 도 owner 다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tess = await member('테스')
    const uma = await member('우마')
    const teamspace = await newTeamspace()
    await join(teamspace, tess)
    const group = await createGroup(fx.owner.ctx, unique('owner 그룹'))
    assert.ok(group.ok)
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, uma.userId)).ok)
    assert.ok((await addTeamspaceMember(fx.owner.ctx, teamspace, { type: 'group', id: group.value.id }, 'owner')).ok)

    const seen = await getTeamspace(tess.ctx, teamspace)
    assert.ok(seen.ok)
    assert.deepEqual(
      { role: seen.value.role, whoCanInvite: seen.value.whoCanInvite, visibility: seen.value.visibility },
      { role: 'member', whoCanInvite: 'all_members', visibility: 'closed' },
    )
    const viaGroup = await getTeamspace(uma.ctx, teamspace)
    assert.ok(viaGroup.ok && viaGroup.value.role === 'owner', JSON.stringify(viaGroup))
  })

  test('getTeamspace — 멤버가 아닌 사람 · 게스트 · 남의 워크스페이스 · 보관된 teamspace 는 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stranger = await member('낯선 사람')
    const guest = await member('손님', 'guest')
    const teamspace = await newTeamspace()
    const other = await makeFixture()

    const results = [
      await getTeamspace(stranger.ctx, teamspace),
      await getTeamspace(guest.ctx, teamspace),
      await getTeamspace(other.owner.ctx, teamspace),
    ]
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [teamspace])
    results.push(await getTeamspace(fx.owner.ctx, teamspace))
    assert.deepEqual(
      results.map((r) => (r.ok ? 'ok' : r.reason)),
      ['not_found', 'not_found', 'not_found', 'not_found'],
    )
  })
})

// ── ⑬ ─────────────────────────────────────────────────────────────────

/**
 * 7c-5. **공개 범위는 존재와 참여만 정한다** — 판정에는 들어가지 않는다(`teamspace.ts` 머리말). 그래서 여기서 나란히 묻는
 * 것은 "목록에 오는가"와 "보이는가"다: open teamspace 여도 참여하기 전에는 페이지를 못 본다.
 */

/** 이 검사가 만든 teamspace 만 골라 본다 — 픽스처 워크스페이스에는 앞 절들이 만든 teamspace 가 쌓여 있다. */
const browseOf = async (actor: Actor, ids: readonly string[]) =>
  (await listBrowsableTeamspaces(actor.ctx)).filter((t) => ids.includes(t.id))

async function teamspaceOfVisibility(visibility: 'open' | 'closed' | 'private'): Promise<string> {
  const created = await createTeamspace(fx.owner.ctx, { name: unique('범위 팀'), visibility })
  assert.ok(created.ok, JSON.stringify(created))
  return created.value.id
}

const memberRows = async (teamspaceId: string, actor: Actor) =>
  query<{ role: string; removed_at: string | null }>(
    `SELECT role, removed_at FROM teamspace_member
      WHERE teamspace_id = $1 AND principal_type = 'user' AND principal_id = $2`,
    [teamspaceId, actor.userId],
  )

describe('⑬ 공개 범위 · 둘러보기 (7c-5)', () => {
  test('★ 둘러보기 — open · closed 는 멤버가 아니어도 보이고 private 는 안 보인다 · 내 것은 범위와 무관하게 온다 · 사람 수를 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stranger = await member('둘러보는 사람')
    const alice = await member('공개팀 앨리스')
    const bob = await member('그룹 밥')
    const carol = await member('그룹 캐럴')
    const open = await teamspaceOfVisibility('open')
    const closed = await teamspaceOfVisibility('closed')
    const secret = await teamspaceOfVisibility('private')
    const ids = [open, closed, secret]

    // open 의 사람 수 — 소유자 + 사람으로 넣은 한 명 + 그룹을 거친 두 명 = 4(주체 수가 아니라 사람 수다).
    const group = await createGroup(fx.owner.ctx, unique('공개팀 그룹'))
    assert.ok(group.ok)
    for (const who of [bob, carol]) assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, who.userId)).ok)
    await join(open, alice)
    assert.ok((await addTeamspaceMember(fx.owner.ctx, open, { type: 'group', id: group.value.id })).ok)

    const seen = await browseOf(stranger, ids)
    assert.deepEqual(new Set(seen.map((t) => t.id)), new Set([open, closed]), 'private 가 남의 눈에 보인다')
    assert.deepEqual(seen.map((t) => t.role), [null, null], '멤버가 아닌데 역할이 왔다')
    assert.equal(seen.find((t) => t.id === open)?.memberCount, 4)

    const mine = await browseOf(fx.owner, ids)
    assert.deepEqual(new Set(mine.map((t) => t.id)), new Set(ids), '내가 소유자인 private 가 내 목록에 없다')
    assert.deepEqual(new Set(mine.map((t) => t.role)), new Set(['owner']))
    // 멤버로 들어온 사람의 줄에는 member 가 온다.
    assert.equal((await browseOf(alice, [open]))[0]?.role, 'member')
    assert.equal((await browseOf(bob, [open]))[0]?.role, 'member', '그룹을 거친 멤버의 역할이 비었다')
  })

  test('보관된 · 남의 워크스페이스 teamspace 는 둘러보기에 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stranger = await member('보관 둘러보기')
    const archived = await teamspaceOfVisibility('open')
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [archived])
    const elsewhere = await makeFixture()
    const theirs = await createTeamspace(elsewhere.owner.ctx, { name: unique('남의 공개팀'), visibility: 'open' })
    assert.ok(theirs.ok)

    assert.deepEqual(await browseOf(stranger, [archived, theirs.value.id]), [])
    assert.deepEqual(await browseOf(fx.owner, [archived]), [], '보관한 것이 소유자 목록에 남았다')
  })

  test('게스트 · 제한 멤버는 둘러보지도 참여하지도 못한다 — 목록은 비고 참여는 not_found · 아무 행도 남지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const guest = await member('둘러보는 손님', 'guest')
    const restricted = await member('둘러보는 제한 멤버', 'restricted_member')
    const open = await teamspaceOfVisibility('open')

    for (const who of [guest, restricted]) {
      assert.deepEqual(await browseOf(who, [open]), [], '둘러볼 수 없는 역할에게 목록이 갔다')
      assert.deepEqual(await joinTeamspace(who.ctx, open), { ok: false, reason: 'not_found' })
      assert.deepEqual(await memberRows(open, who), [], '거부됐는데 멤버 행이 생겼다')
    }
  })
})

describe('⑬ 참여 (7c-5)', () => {
  test('★ 참여는 open 만 — closed 는 needs_invite · private 는 not_found · 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const joiner = await member('참여하는 사람')
    const open = await teamspaceOfVisibility('open')
    const closed = await teamspaceOfVisibility('closed')
    const secret = await teamspaceOfVisibility('private')
    const openPage = await topPage(open, '공개팀 문서')

    assert.deepEqual(await joinTeamspace(joiner.ctx, closed), { ok: false, reason: 'needs_invite' })
    assert.deepEqual(await joinTeamspace(joiner.ctx, secret), { ok: false, reason: 'not_found' })
    for (const id of [closed, secret]) assert.deepEqual(await memberRows(id, joiner), [], id)

    const before = await permGen(joiner.userId)
    assert.deepEqual(await joinTeamspace(joiner.ctx, open), { ok: true })
    assert.deepEqual(
      (await memberRows(open, joiner)).map((r) => [r.role, r.removed_at]),
      [['member', null]],
      '참여로 owner 가 됐거나 행이 없다',
    )
    assert.ok((await permGen(joiner.userId)) > before, '참여가 perm_gen 을 올리지 않았다 — 협업 서버가 모른다')
    assert.deepEqual(await sees(joiner, openPage, open), SEES, '참여했는데 페이지를 못 본다')
    assert.ok((await listMyTeamspaces(joiner.ctx)).some((t) => t.id === open))
    assert.equal((await browseOf(joiner, [open]))[0]?.role, 'member', '참여했는데 둘러보기가 남으로 본다')
  })

  test('★ open 은 참여 전에도 읽는다(view) — 고치지는 못하고 · 사이드바에는 서지 않고 · 게스트 · 제한 멤버는 못 본다 (7c-9)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 7c-5 는 이 검사를 "open 이어도 못 본다"로 고정했었다 — 열람 행을 두면 그 페이지들이 전원의 사이드바로 쏟아지는데
    // 설 자리가 없었다(§3.2-45). 공유됨 섹션과 뿌리 가리기가 생겨 7c-9 가 되돌렸다: 노드의 행은 view 하나, 판정 기계는
    // 그대로, 사이드바는 멤버가 아닌 open 뿌리를 세우지 않는다.
    const stranger = await member('참여 안 한 사람')
    const guest = await member('열람 손님', 'guest')
    const restricted = await member('열람 제한 멤버', 'restricted_member')
    const open = await teamspaceOfVisibility('open')
    const page = await topPage(open, '참여 전 문서')

    assert.deepEqual(
      await query<{ level: string }>(
        `SELECT level FROM acl_entry WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'workspace_everyone'`,
        [open],
      ),
      [{ level: 'view' }],
      'open 노드의 열람 행이 없거나 레벨이 다르다',
    )
    // 판정 · teamspace 목록 · 트리는 열리고 — **화면에 가는 섹션**에는 없다(의도된 비대칭 · 세우면 전원의 사이드바가 남의
    // 팀 문서로 덮인다). \`sees().sidebar\` 는 가르기 **전** 트리라 true 다 — 가리는 것은 groupSidebarRoots 다.
    assert.deepEqual(await sees(stranger, page, open), SEES)
    const sections = groupSidebarRoots(await listPageTree(stranger.ctx), await listMyTeamspaces(stranger.ctx))
    const shown = [
      ...sections.workspacePages, ...sections.shared, ...sections.privatePages, ...sections.teamspaces.flatMap((x) => x.pages),
    ].flatMap((n) => [n.id, ...flatten(n.children)])
    assert.ok(!shown.includes(page), '멤버가 아닌 open teamspace 의 페이지가 사이드바 섹션에 섰다')
    const caps = await capsOf(stranger, page)
    assert.equal(can(caps, 'view'), true)
    assert.equal(can(caps, 'edit_content'), false, '참여하지 않았는데 고칠 수 있다')
    // 게스트 · 제한 멤버는 workspace_everyone 주체를 받지 않는다(P(U)) — F-06-04 의 제약이 자동으로 지켜진다.
    assert.deepEqual(await sees(guest, page, open), BLIND)
    assert.deepEqual(await sees(restricted, page, open), BLIND)
    // 참여하면 멤버 레벨로 올라서고 사이드바의 그 teamspace 섹션에 선다.
    assert.deepEqual(await joinTeamspace(stranger.ctx, open), { ok: true })
    const joined = groupSidebarRoots(await listPageTree(stranger.ctx), await listMyTeamspaces(stranger.ctx))
    assert.ok(joined.teamspaces.find((x) => x.teamspace.id === open)?.pages.some((n) => n.id === page), '참여했는데 섹션에 안 선다')
    assert.equal(can(await capsOf(stranger, page), 'edit_content'), true)
  })

  test('★ open ↔ closed 전환이 열람 행을 나른다 — 좁히면 참여 안 한 사람이 잃고 · 따로 준 공유와 멤버는 남는다 (7c-9)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const reader = await member('읽기만 하던 사람')
    const grantee = await member('따로 받은 사람')
    const mate = await member('들어온 멤버')
    const open = await teamspaceOfVisibility('open')
    await join(open, mate)
    const page = await topPage(open, '좁혀질 문서')
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: grantee.userId }, 'view')).ok)
    assert.equal(await canViewPage(reader.ctx, page), true, '전제 — open 이라 읽는다')

    assert.ok((await updateTeamspace(fx.owner.ctx, open, { visibility: 'closed' })).ok)
    assert.deepEqual(await sees(reader, page, open), BLIND, '좁혔는데 참여 안 한 사람이 아직 읽는다')
    assert.equal(await canViewPage(grantee.ctx, page), true, '좁히자 따로 준 공유까지 걷혔다')
    assert.deepEqual(await sees(mate, page, open), SEES, '좁히자 멤버가 잃었다')
    // 좁혔다 다시 열면 행이 돌아온다 — 다른 설정만 고치는 것은 행을 건드리지 않는다.
    assert.ok((await updateTeamspace(fx.owner.ctx, open, { name: unique('이름만') })).ok)
    assert.deepEqual(await sees(reader, page, open), BLIND)
    assert.ok((await updateTeamspace(fx.owner.ctx, open, { visibility: 'open' })).ok)
    assert.equal(await canViewPage(reader.ctx, page), true, '다시 열었는데 안 돌아온다')
    // 보관하면 open 이어도 닫힌다 — 판정이 보관된 노드의 행을 읽지 않는다(7c-6).
    assert.ok((await archiveTeamspace(fx.owner.ctx, open)).ok)
    assert.equal(await canViewPage(reader.ctx, page), false, '보관됐는데 열람이 남았다')
  })

  test('두 번 눌러도 멤버는 하나다 · 나갔다 다시 참여하면 같은 행이 살아나고 역할은 member 다(owner 부여는 돌아오지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const twice = await member('두 번 누르는 사람')
    const open = await teamspaceOfVisibility('open')

    assert.deepEqual(await joinTeamspace(twice.ctx, open), { ok: true })
    assert.deepEqual(await joinTeamspace(twice.ctx, open), { ok: true })
    assert.equal((await memberRows(open, twice)).length, 1)

    // 소유자로 올려 둔 다음 스스로 나간다 — 마지막 소유자가 아니므로 나갈 수 있다.
    assert.ok((await setTeamspaceMemberRole(fx.owner.ctx, open, user(twice), 'owner')).ok)
    assert.ok((await ownerRows(open)).some((r) => r.principal_id === twice.userId), '소유자 부여가 없다')
    assert.ok((await removeTeamspaceMember(twice.ctx, open, user(twice))).ok)

    assert.deepEqual(await joinTeamspace(twice.ctx, open), { ok: true })
    assert.deepEqual(
      (await memberRows(open, twice)).map((r) => [r.role, r.removed_at]),
      [['member', null]],
      '다시 참여했는데 행이 둘이거나 owner 로 살아났다',
    )
    assert.ok(!(await ownerRows(open)).some((r) => r.principal_id === twice.userId), '나간 소유자의 부여가 돌아왔다')
  })

  test('★ 범위를 좁혀도 이미 들어온 멤버는 그대로다 — 앞으로의 참여만 막힌다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const early = await member('먼저 들어온 사람')
    const late = await member('늦게 온 사람')
    const open = await teamspaceOfVisibility('open')
    const page = await topPage(open, '좁히기 문서')

    assert.deepEqual(await joinTeamspace(early.ctx, open), { ok: true })
    assert.ok((await updateTeamspace(fx.owner.ctx, open, { visibility: 'closed' })).ok)

    assert.deepEqual(await sees(early, page, open), SEES, '범위를 좁히자 이미 들어온 멤버가 잃었다')
    assert.deepEqual(await joinTeamspace(late.ctx, open), { ok: false, reason: 'needs_invite' })
    assert.deepEqual(new Set((await browseOf(late, [open])).map((t) => t.visibility)), new Set(['closed']))
  })
})

describe('⑬ 설정 (7c-5)', () => {
  test('★ 설정은 owner 만 고친다 — 멤버는 forbidden · 멤버가 아니면 not_found · 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const plain = await member('설정 보는 멤버')
    const stranger = await member('설정 낯선 사람')
    const teamspace = await teamspaceOfVisibility('closed')
    await join(teamspace, plain)
    const now = async () => {
      const read = await getTeamspace(fx.owner.ctx, teamspace)
      assert.ok(read.ok)
      return { name: read.value.name, visibility: read.value.visibility, whoCanInvite: read.value.whoCanInvite }
    }
    const was = await now()

    assert.deepEqual(await updateTeamspace(plain.ctx, teamspace, { visibility: 'open' }), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await updateTeamspace(stranger.ctx, teamspace, { visibility: 'open' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await now(), was, '거부됐는데 설정이 바뀌었다')

    const renamed = unique('고친 이름')
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, teamspace, { name: renamed, visibility: 'open', whoCanInvite: 'owners' }), {
      ok: true,
    })
    assert.deepEqual(await now(), { name: renamed, visibility: 'open', whoCanInvite: 'owners' })
  })

  test('주지 않은 칸은 건드리지 않는다 · 모양이 틀리면 거부하고 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await teamspaceOfVisibility('closed')
    const read = async () => {
      const got = await getTeamspace(fx.owner.ctx, teamspace)
      assert.ok(got.ok)
      return { name: got.value.name, visibility: got.value.visibility, whoCanInvite: got.value.whoCanInvite }
    }
    const was = await read()

    assert.ok((await updateTeamspace(fx.owner.ctx, teamspace, { whoCanInvite: 'owners' })).ok)
    assert.deepEqual(await read(), { ...was, whoCanInvite: 'owners' }, '초대 규칙만 줬는데 다른 칸이 바뀌었다')

    const refusals = [
      [{}, 'invalid_settings'],
      [{ nothing: 1 }, 'invalid_settings'],
      [{ name: '   ' }, 'invalid_name'],
      [{ name: 'x'.repeat(101) }, 'invalid_name'],
      [{ visibility: 'public' }, 'invalid_visibility'],
      [{ whoCanInvite: 'nobody' }, 'invalid_settings'],
    ] as const
    for (const [input, reason] of refusals) {
      assert.deepEqual(await updateTeamspace(fx.owner.ctx, teamspace, input), { ok: false, reason }, JSON.stringify(input))
    }
    assert.deepEqual(await read(), { ...was, whoCanInvite: 'owners' }, '거부됐는데 설정이 바뀌었다')
  })

  test('보관된 · 남의 워크스페이스 teamspace 의 설정은 고칠 수 없다(not_found)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const archived = await teamspaceOfVisibility('closed')
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [archived])
    const elsewhere = await makeFixture()
    const theirs = await createTeamspace(elsewhere.owner.ctx, { name: unique('남의 팀') })
    assert.ok(theirs.ok)

    assert.deepEqual(await updateTeamspace(fx.owner.ctx, archived, { visibility: 'open' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, theirs.value.id, { visibility: 'open' }), { ok: false, reason: 'not_found' })
    assert.equal(
      (await queryOne<{ visibility: string }>(`SELECT visibility FROM teamspace WHERE id = $1`, [theirs.value.id])).visibility,
      'closed',
      '남의 워크스페이스 teamspace 가 바뀌었다',
    )
  })
})

// ── ⑭ ─────────────────────────────────────────────────────────────────

/**
 * 7c-6. **보관은 지우기를 대신한다** — 아무도 못 보고(owner 까지), 되살릴 사람만 그 존재를 본다.
 *
 * 여기서 나란히 묻는 것은 `sees`(판정 · teamspace 목록 · 사이드바) 셋이다. 보관 전에는 SEES, 보관 뒤에는 BLIND 여야
 * 한다 — **owner 도** 그렇다. 판정만 막고 목록을 안 막거나(또는 그 반대) 하면 주소를 아는 사람만 들어갈 수 있다.
 */

const archivedIds = async (actor: Actor) => (await listArchivedTeamspaces(actor.ctx)).map((t) => t.id)

const archivedAtOf = async (teamspaceId: string): Promise<string | null> => {
  // pg 는 timestamptz 를 Date 로 준다 — Date 두 개는 같은 시각이어도 === 가 아니므로 문자열로 비교한다.
  const row = await queryOne<{ archived_at: Date | null }>(`SELECT archived_at FROM teamspace WHERE id = $1`, [teamspaceId])
  return row.archived_at === null ? null : new Date(row.archived_at).toISOString()
}

describe('⑭ 보관 (7c-6)', () => {
  test('★ 보관하면 owner 까지 그 teamspace 의 페이지를 못 본다 — 판정과 목록이 나란히 · 행은 그대로 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mate = await member('보관 동료')
    const teamspace = await newTeamspace()
    await join(teamspace, mate)
    const page = await topPage(teamspace, '보관될 문서')
    assert.deepEqual(await sees(fx.owner, page, teamspace), SEES)
    assert.deepEqual(await sees(mate, page, teamspace), SEES)

    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    assert.deepEqual(await sees(mate, page, teamspace), BLIND, '보관했는데 멤버가 아직 본다')
    assert.deepEqual(await sees(fx.owner, page, teamspace), BLIND, '보관했는데 소유자가 아직 본다 — 주소를 알면 들어간다')
    assert.equal(can(await capsOf(fx.owner, page), 'view'), false, '소유자의 판정이 아직 열려 있다')
    // 행은 건드리지 않았다 — 복원이 정확해야 한다.
    assert.equal(
      (await query(`SELECT id FROM acl_entry WHERE node_kind = 'teamspace' AND node_id = $1`, [teamspace])).length,
      2,
      '보관이 teamspace 노드의 행을 지웠다',
    )
    assert.equal(
      (await query(`SELECT 1 FROM teamspace_member WHERE teamspace_id = $1 AND removed_at IS NULL`, [teamspace])).length,
      2,
      '보관이 멤버 행을 지웠다',
    )
  })

  test('★ 페이지에 따로 준 부여는 보관을 넘긴다 — teamspace 에서 오지 않은 접근이다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const guestish = await member('따로 받은 사람')
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace, '따로 공유한 문서')
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: guestish.userId }, 'edit')).ok)
    assert.equal(await canViewPage(guestish.ctx, page), true)

    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    assert.equal(await canViewPage(guestish.ctx, page), true, '따로 준 부여가 보관으로 사라졌다')
    assert.ok(flatten(await listPageTree(guestish.ctx)).includes(page), '따로 받은 사람의 사이드바에서 빠졌다')
    assert.equal(await canViewPage(fx.owner.ctx, page), false, '소유자는 teamspace 를 통해서만 봤으므로 잃어야 한다')
  })

  test('보관은 owner 만 — 멤버는 forbidden · 멤버가 아니면 not_found · 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const plain = await member('보관 못 하는 멤버')
    const stranger = await member('보관 낯선 사람')
    const teamspace = await newTeamspace()
    await join(teamspace, plain)

    assert.deepEqual(await archiveTeamspace(plain.ctx, teamspace), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await archiveTeamspace(stranger.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.equal(await archivedAtOf(teamspace), null, '거부됐는데 보관됐다')
  })

  test('이미 보관된 것을 또 보관하려 하면 not_found — 살아 있는 것만 잠근다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })
    const at = await archivedAtOf(teamspace)
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.equal(await archivedAtOf(teamspace), at, '두 번째 보관이 시각을 덮었다')
  })

  test('보관된 teamspace 에는 아무것도 못 한다 — 만들기 · 넣기 · 설정 · 둘러보기 · 참여가 전부 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const outsider = await member('보관 밖 사람')
    const created = await createTeamspace(fx.owner.ctx, { name: unique('보관될 팀'), visibility: 'open' })
    assert.ok(created.ok)
    const teamspace = created.value.id
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    const made = await createPage(fx.owner.ctx, { teamspaceId: teamspace }).then(
      () => 'ok',
      (e: unknown) => (e instanceof PageError ? e.code : String(e)),
    )
    assert.equal(made, 'parent_not_found')
    assert.deepEqual(await addTeamspaceMember(fx.owner.ctx, teamspace, user(outsider)), { ok: false, reason: 'not_found' })
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, teamspace, { visibility: 'closed' }), { ok: false, reason: 'not_found' })
    assert.deepEqual(await getTeamspace(fx.owner.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.deepEqual(await listBrowsableTeamspaces(outsider.ctx).then((ts) => ts.filter((x) => x.id === teamspace)), [])
    assert.deepEqual(await joinTeamspace(outsider.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.deepEqual((await listMyTeamspaces(fx.owner.ctx)).filter((x) => x.id === teamspace), [])
  })
})

describe('⑭ 복원 (7c-6)', () => {
  test('★ 되살리면 멤버와 소유자가 그대로 돌아온다 — 보관 목록은 owner 에게만 보인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const mate = await member('되살릴 동료')
    const teamspace = await newTeamspace()
    await join(teamspace, mate)
    const page = await topPage(teamspace, '되살릴 문서')
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    assert.ok((await archivedIds(fx.owner)).includes(teamspace), '소유자의 보관 목록에 없다')
    assert.ok(!(await archivedIds(mate)).includes(teamspace), '소유자가 아닌 멤버에게 보관 목록이 갔다')

    assert.deepEqual(await restoreTeamspace(fx.owner.ctx, teamspace), { ok: true })
    assert.equal(await archivedAtOf(teamspace), null)
    assert.deepEqual(await sees(fx.owner, page, teamspace), SEES, '되살렸는데 소유자가 못 본다')
    assert.deepEqual(await sees(mate, page, teamspace), SEES, '되살렸는데 멤버가 못 본다')
    assert.ok(!(await archivedIds(fx.owner)).includes(teamspace), '되살린 것이 보관 목록에 남았다')
  })

  test('복원은 owner 만 — 멤버는 forbidden · 멤버가 아니면 not_found · 살아 있는 것은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const plain = await member('되살리지 못하는 멤버')
    const stranger = await member('되살리는 낯선 사람')
    const teamspace = await newTeamspace()
    await join(teamspace, plain)
    const live = await newTeamspace()
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    assert.deepEqual(await restoreTeamspace(plain.ctx, teamspace), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await restoreTeamspace(stranger.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.deepEqual(await restoreTeamspace(fx.owner.ctx, live), { ok: false, reason: 'not_found' })
    assert.notEqual(await archivedAtOf(teamspace), null, '거부됐는데 되살아났다')
  })

  test('그룹을 거쳐 소유자인 사람도 보관 목록을 보고 되살린다 · 게스트와 남의 워크스페이스는 빈 목록', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const viaGroup = await member('그룹 소유자')
    const guest = await member('보관 손님', 'guest')
    const teamspace = await newTeamspace()
    const group = await createGroup(fx.owner.ctx, unique('보관 그룹'))
    assert.ok(group.ok)
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, viaGroup.userId)).ok)
    assert.ok((await addTeamspaceMember(fx.owner.ctx, teamspace, { type: 'group', id: group.value.id }, 'owner')).ok)
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, teamspace), { ok: true })

    assert.ok((await archivedIds(viaGroup)).includes(teamspace), '그룹을 거친 소유자에게 안 보인다')
    assert.deepEqual(await archivedIds(guest), [])
    const elsewhere = await makeFixture()
    assert.ok(!(await archivedIds(elsewhere.owner)).includes(teamspace), '남의 워크스페이스에 보였다')
    assert.deepEqual(await restoreTeamspace(viaGroup.ctx, teamspace), { ok: true })
  })
})

// ── ⑮ ─────────────────────────────────────────────────────────────────

/**
 * 7c-10. **고아 teamspace — owner 가 아무도 없어 설정을 고칠 수 없는 teamspace.** F-06-04 가 필수로 적었다: *"클론은
 * '마지막 owner 이탈 차단' 또는 'workspace owner 의 강제 owner 지정' 중 하나를 필수 구현"*. 7c-1 이 앞의 것을 teamspace
 * 명령 안에서 했는데, **그룹 삭제**가 그 밖으로 새고 있었다 — 그룹이 유일한 owner 면 지우는 순간 고아가 된다.
 */

/** 이 teamspace 를 고칠 수 있는 owner 가 한 명이라도 있는가 — 역할 이름으로 묻고, 실제로 명령을 불러 본다. */
const someoneCanManage = async (teamspaceId: string, candidates: readonly Actor[]) => {
  for (const who of candidates) {
    const got = await getTeamspace(who.ctx, teamspaceId)
    if (got.ok && got.value.role === 'owner') return true
  }
  return false
}

describe('⑮ 고아 teamspace — 막기 (7c-10)', () => {
  test('★ 마지막 owner 인 그룹은 지우지 못한다 — 지우면 teamspace 를 고칠 사람이 아무도 없다 · 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const creator = await member('그룹에 넘긴 사람')
    const inGroup = await member('소유 그룹원')
    const created = await createTeamspace(creator.ctx, { name: unique('그룹이 소유한 팀') })
    assert.ok(created.ok)
    const teamspace = created.value.id
    const group = await createGroup(fx.owner.ctx, unique('소유 그룹'))
    assert.ok(group.ok)
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, inGroup.userId)).ok)
    assert.ok((await addTeamspaceMember(creator.ctx, teamspace, { type: 'group', id: group.value.id }, 'owner')).ok)
    // 만든 사람이 나간다 — 그룹이 남은 owner 이므로 last_owner 에 걸리지 않는다.
    assert.deepEqual(await removeTeamspaceMember(creator.ctx, teamspace, user(creator)), { ok: true })
    assert.equal(await someoneCanManage(teamspace, [inGroup]), true, '전제 — 그룹원이 owner 다')

    const refused = await deleteGroup(fx.owner.ctx, group.value.id)
    assert.equal(refused.ok, false, '마지막 owner 인 그룹이 지워졌다 — teamspace 가 고아가 된다')
    assert.equal(refused.ok ? null : refused.reason, 'last_teamspace_owner')
    assert.equal(refused.ok ? null : refused.nodes, 1, '몇 teamspace 인지 말해야 한다')
    assert.equal(await someoneCanManage(teamspace, [inGroup]), true, '거부됐는데 그룹원이 owner 를 잃었다')
  })

  test('★ 관리 경로가 헛 owner 를 셈 — 떠난 사람이 유일한 다른 owner 면 그룹을 지우지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // "다른 owner" 를 행으로만 세면, 워크스페이스를 떠난 사람의 owner 행이 남아 있을 때 그룹을 지워도 된다고 답한다 —
    // 그 사람은 행동할 수 없으니 같은 고아가 다른 모양으로 남는다.
    const leaver = await member('떠날 공동 소유자')
    const created = await createTeamspace(leaver.ctx, { name: unique('헛 owner 팀') })
    assert.ok(created.ok)
    const group = await createGroup(fx.owner.ctx, unique('남는 소유 그룹'))
    assert.ok(group.ok)
    assert.ok((await addTeamspaceMember(leaver.ctx, created.value.id, { type: 'group', id: group.value.id }, 'owner')).ok)
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [
      fx.workspaceId,
      leaver.userId,
    ])

    const refused = await deleteGroup(fx.owner.ctx, group.value.id)
    assert.equal(refused.ok ? null : refused.reason, 'last_teamspace_owner', '떠난 사람을 owner 로 세어 그룹을 지웠다')
  })

  test('보관된 teamspace 의 마지막 owner 여도 지우지 못한다 — 되살릴 사람이 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const creator = await member('보관 그룹에 넘긴 사람')
    const created = await createTeamspace(creator.ctx, { name: unique('보관될 그룹 팀') })
    assert.ok(created.ok)
    const group = await createGroup(fx.owner.ctx, unique('보관 소유 그룹'))
    assert.ok(group.ok)
    assert.ok((await addTeamspaceMember(creator.ctx, created.value.id, { type: 'group', id: group.value.id }, 'owner')).ok)
    assert.deepEqual(await archiveTeamspace(creator.ctx, created.value.id), { ok: true })
    assert.deepEqual(await removeTeamspaceMember(creator.ctx, created.value.id, user(creator)), { ok: false, reason: 'not_found' },
      '전제 — 보관된 teamspace 에서는 나가지도 못한다(살아 있는 것만 잠근다)')
    // 만든 사람이 여전히 owner 라 그룹은 마지막이 아니다 — 지울 수 있고, 지우면 그 그룹의 행이 정리된다.
    assert.deepEqual(await deleteGroup(fx.owner.ctx, group.value.id), { ok: true, value: { nodes: 0 } })
    assert.deepEqual(
      await query(
        `SELECT 1 FROM teamspace_member WHERE teamspace_id = $1 AND principal_type = 'group' AND removed_at IS NULL`,
        [created.value.id],
      ),
      [],
      '지운 그룹의 멤버 행이 살아 있다 — 마지막 owner 를 셀 때 헛것이 된다',
    )
    assert.deepEqual(
      await query(
        `SELECT 1 FROM acl_entry WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'group'`,
        [created.value.id],
      ),
      [],
      '지운 그룹의 owner 부여가 teamspace 노드에 남았다',
    )
  })
})

describe('⑮ 고아 teamspace — 되살리기 (7c-10)', () => {
  /** owner 가 워크스페이스를 떠난 teamspace — 명령으로는 아직 못 만드니(워크스페이스 멤버 제거가 없다) 행으로 만든다. */
  async function orphan(): Promise<{ teamspace: string; page: string; leaver: Actor }> {
    const leaver = await member('떠날 소유자')
    const created = await createTeamspace(leaver.ctx, { name: unique('고아 될 팀'), visibility: 'private' })
    assert.ok(created.ok)
    const page = await topPage(created.value.id, '고아의 문서', leaver)
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [
      fx.workspaceId,
      leaver.userId,
    ])
    return { teamspace: created.value.id, page, leaver }
  }

  const rowOf = async (actor: Actor, id: string) => (await listAllTeamspaces(actor.ctx)).find((t) => t.id === id)

  test('★ 워크스페이스 owner 는 비공개 · 보관 · 고아까지 모든 teamspace 를 본다 — 내용은 아니다 · 다른 역할은 빈 목록', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { teamspace, page } = await orphan()
    const archived = await newTeamspace()
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, archived), { ok: true })

    const seen = await rowOf(fx.owner, teamspace)
    assert.deepEqual(
      seen && { visibility: seen.visibility, ownerCount: seen.ownerCount, role: seen.role, archived: seen.archivedAt !== null },
      { visibility: 'private', ownerCount: 0, role: null, archived: false },
      '비공개 고아가 목록에 없거나 owner 수를 헛것으로 셌다',
    )
    assert.ok((await rowOf(fx.owner, archived))?.archivedAt, '보관된 것이 목록에 없다')
    // 목록은 콘텐츠를 열지 않는다 — 역할이 볼 수 있는 것을 바꾸지 않는다(F-06-02).
    assert.equal(await canViewPage(fx.owner.ctx, page), false, '관리 목록을 본 것만으로 비공개 페이지가 열렸다')

    for (const role of ['membership_admin', 'member', 'restricted_member', 'guest'] as const) {
      const who = await member(`관리 목록 ${role}`, role)
      assert.deepEqual(await listAllTeamspaces(who.ctx), [], `${role} 에게 관리 목록이 갔다`)
    }
  })

  test('★ 소유자로 들어가면 고아가 되살아난다 — 멤버 목록에 이름이 서고 · 설정을 고치고 · 페이지를 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { teamspace, page } = await orphan()
    assert.deepEqual(await claimTeamspaceOwnership(fx.owner.ctx, teamspace), { ok: true })

    assert.equal((await rowOf(fx.owner, teamspace))?.ownerCount, 1)
    const members = await listTeamspaceMembers(fx.owner.ctx, teamspace)
    assert.ok(members.ok && members.value.some((m) => m.principal.id === fx.owner.userId && m.role === 'owner'),
      '들어간 사람이 멤버 목록에 없다 — 몰래 여는 문이 된다')
    assert.equal(await canViewPage(fx.owner.ctx, page), true)
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, teamspace, { visibility: 'closed' }), { ok: true }, '되살렸는데 설정을 못 고친다')
    // 7c-1 의 불변식 — owner 역할이면 노드에 owner 부여 행이 있다. 위 두 검사는 이것을 못 가린다: 멤버 기본 레벨이 지금
    // full_access 라 멤버 행만으로도 열리고 고쳐진다(반사실 r6 이 통과해 알았다). 기본 레벨이 바뀌면 이 행이 차이를 만든다.
    assert.ok(
      (await ownerRows(teamspace)).some((r) => r.principal_id === fx.owner.userId && r.level === 'full_access'),
      '들어간 owner 에게 노드의 owner 부여가 없다 — 다른 owner 와 모양이 다르다',
    )
    // 두 번 들어가도 한 줄이다.
    assert.deepEqual(await claimTeamspaceOwnership(fx.owner.ctx, teamspace), { ok: true })
    assert.equal((await memberRows(teamspace, fx.owner)).length, 1)
  })

  test('보관된 고아 — 들어가고 되살린다(§3.2-46 ③ 의 "워크스페이스 owner 도 되살린다") · member 였으면 owner 로 올린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const creator = await member('보관하고 떠날 사람')
    const created = await createTeamspace(creator.ctx, { name: unique('보관된 고아') })
    assert.ok(created.ok)
    assert.ok((await addTeamspaceMember(creator.ctx, created.value.id, user(fx.owner))).ok)
    assert.deepEqual(await archiveTeamspace(creator.ctx, created.value.id), { ok: true })
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [
      fx.workspaceId,
      creator.userId,
    ])
    // 전제 — 워크스페이스 owner 는 member 라 되살리지 못한다.
    assert.deepEqual(await restoreTeamspace(fx.owner.ctx, created.value.id), { ok: false, reason: 'forbidden' })

    assert.deepEqual(await claimTeamspaceOwnership(fx.owner.ctx, created.value.id), { ok: true })
    assert.equal((await memberRows(created.value.id, fx.owner))[0]?.role, 'owner', 'member 에서 owner 로 오르지 않았다')
    assert.deepEqual(await restoreTeamspace(fx.owner.ctx, created.value.id), { ok: true })
  })

  test('워크스페이스 owner 가 아니면 들어가지 못한다(not_found — 경로가 있다는 것도 알리지 않는다) · 남의 워크스페이스도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { teamspace } = await orphan()
    const admin = await member('멤버십 관리자', 'membership_admin')
    assert.deepEqual(await claimTeamspaceOwnership(admin.ctx, teamspace), { ok: false, reason: 'not_found' })
    const elsewhere = await makeFixture()
    assert.deepEqual(await claimTeamspaceOwnership(elsewhere.owner.ctx, teamspace), { ok: false, reason: 'not_found' })
    assert.equal((await rowOf(fx.owner, teamspace))?.ownerCount, 0, '거부됐는데 owner 가 생겼다')
  })
})

// ── ⑯ 기본 teamspace (7c-11) ──────────────────────────────────────────

describe('⑯ 기본 teamspace (7c-11)', () => {
  /** 기본 teamspace 는 워크스페이스 전원을 건드린다 — 다른 검사의 워크스페이스(fx)와 섞이지 않게 검사마다 새로 만든다. */
  async function office() {
    const ws = await createBareWorkspace('기본 teamspace')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') =>
      joinAs(ws, await createUser(name), role)
    const created = await createTeamspace(boss.ctx, { name: unique('전사'), visibility: 'closed' })
    assert.ok(created.ok, JSON.stringify(created))
    return { ws, boss, person, teamspace: created.value.id }
  }

  /** 살아 있는 멤버 행의 역할 — 없거나 빠졌으면 null. */
  const liveRole = async (teamspaceId: string, userId: string): Promise<string | null> => {
    const rows = await query<{ role: string }>(
      `SELECT role FROM teamspace_member
        WHERE teamspace_id = $1 AND principal_type = 'user' AND principal_id = $2 AND removed_at IS NULL`,
      [teamspaceId, userId],
    )
    return rows[0]?.role ?? null
  }

  /** 초대하고 받아들인다 — 앱의 가입 경로 그대로(`acceptInvite`). */
  async function arrive(ws: string, boss: Actor, name: string) {
    const newcomer = await createUser(name)
    const invited = await createEmailInvite({
      workspaceId: ws,
      inviterUserId: boss.userId,
      inviterRole: 'owner',
      email: newcomer.email,
      role: 'member',
    })
    assert.ok(invited.ok, JSON.stringify(invited))
    const accepted = await acceptInvite(invited.token, newcomer.userId)
    assert.ok(accepted.ok, JSON.stringify(accepted))
    return newcomer
  }

  test('★ 켜면 워크스페이스 멤버 전원이 member 로 들어와 페이지를 본다 — 제한 멤버 · 게스트 · 초대만 받은 · 떠난 사람은 빠지고 owner 는 owner 로 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person, teamspace } = await office()
    const page = await topPage(teamspace, '전사 공지', boss)
    const admin = await person('관리자', 'membership_admin')
    const alice = await person('앨리스')
    const restricted = await person('제한 멤버', 'restricted_member')
    const guest = await person('게스트', 'guest')
    const invitedOnly = await createUser('초대만 받은 사람')
    await query(`INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'invited')`, [
      ws,
      invitedOnly.userId,
    ])
    const leaver = await person('떠난 사람')
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [ws, leaver.userId])
    const returning = await person('돌아올 사람')
    assert.ok((await addTeamspaceMember(boss.ctx, teamspace, user(returning))).ok)
    assert.ok((await removeTeamspaceMember(returning.ctx, teamspace, user(returning))).ok)
    const coOwner = await person('공동 소유자')
    assert.ok((await addTeamspaceMember(boss.ctx, teamspace, user(coOwner), 'owner')).ok)
    assert.deepEqual(await sees(alice, page, teamspace), BLIND, '전제 — 켜기 전에는 closed 라 못 본다')

    // 들어오는 것은 관리자 · 앨리스 · 돌아올 사람(빠졌던 행이 되살아난다) — 대표와 공동 소유자는 이미 있다.
    assert.deepEqual(await setDefaultTeamspace(boss.ctx, teamspace, true), { ok: true, value: { added: 3 } })
    for (const who of [admin, alice, returning]) assert.equal(await liveRole(teamspace, who.userId), 'member')
    assert.equal(await liveRole(teamspace, coOwner.userId), 'owner', '켜기가 owner 를 member 로 내렸다')
    assert.equal(await liveRole(teamspace, boss.userId), 'owner')
    for (const who of [restricted.userId, guest.userId, invitedOnly.userId, leaver.userId]) {
      assert.equal(await liveRole(teamspace, who), null, '들어오지 말아야 할 사람이 들어왔다')
    }
    assert.deepEqual(await sees(alice, page, teamspace), SEES)
    assert.deepEqual(await sees(restricted, page, teamspace), BLIND)
    assert.ok((await listMyTeamspaces(alice.ctx)).some((ts) => ts.id === teamspace))

    // 들어오는 순간의 규칙도 같은 역할 목록이다 — 지금 수락 경로는 제한 멤버를 넘기지 않지만(초대 역할에 없다), 게스트 ·
    // 제한 멤버를 들이는 길이 생기면 이 함수가 거른다.
    assert.equal(await withTransaction((tx) => joinDefaultTeamspaces(tx, ws, restricted.userId, 'restricted_member')), 0)
    assert.equal(await liveRole(teamspace, restricted.userId), null, '제한 멤버가 들어오는 순간 기본 teamspace 에 들어갔다')
  })

  test('★ 이후 가입자 — 초대를 받아들이면 기본 teamspace 에 들어간다(기본이 아닌 곳에는 아니다) · 끄면 멈추고 들어온 사람은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, teamspace } = await office()
    const plain = await createTeamspace(boss.ctx, { name: unique('보통 팀') })
    assert.ok(plain.ok)
    assert.deepEqual(await setDefaultTeamspace(boss.ctx, teamspace, true), { ok: true, value: { added: 0 } })

    const newcomer = await arrive(ws, boss, '새로 온 사람')
    assert.equal(await liveRole(teamspace, newcomer.userId), 'member', '가입자가 기본 teamspace 에 들어가지 않았다')
    assert.equal(await liveRole(plain.value.id, newcomer.userId), null, '기본이 아닌 teamspace 에 들어갔다')
    const session = await joinAs(ws, newcomer, 'member')
    assert.ok((await listMyTeamspaces(session.ctx)).some((ts) => ts.id === teamspace))

    assert.deepEqual(await setDefaultTeamspace(boss.ctx, teamspace, false), { ok: true, value: { added: 0 } })
    assert.equal(await liveRole(teamspace, newcomer.userId), 'member', '끄기가 이미 들어온 사람을 뺐다')
    const late = await arrive(ws, boss, '끈 뒤에 온 사람')
    assert.equal(await liveRole(teamspace, late.userId), null, '끈 뒤에도 가입자가 들어갔다')
  })

  test('★ 엇갈려도 빠지지 않는다 — 켜는 명령이 커밋하기 전에 받아들인 사람은 그 커밋을 기다렸다가 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, teamspace } = await office()
    const newcomer = await createUser('엇갈린 사람')
    const invited = await createEmailInvite({
      workspaceId: ws,
      inviterUserId: boss.userId,
      inviterRole: 'owner',
      email: newcomer.email,
      role: 'member',
    })
    assert.ok(invited.ok)

    // 켜는 명령의 앞 절반을 붙들어 둔다 — 행을 잠그고 `is_default` 를 바꿨지만 아직 커밋하지 않았다. 그 명령의 배치 삽입은
    // 아직 커밋되지 않은 이 사람의 멤버 행을 못 보므로, 이 사람을 넣는 것은 수락 쪽의 몫이다.
    const holder = await getPool().connect()
    await holder.query('BEGIN')
    await holder.query(`SELECT id FROM teamspace WHERE id = $1 FOR UPDATE`, [teamspace])
    await holder.query(`UPDATE teamspace SET is_default = true WHERE id = $1`, [teamspace])
    let settled = false
    const accepting = acceptInvite(invited.token, newcomer.userId).finally(() => {
      settled = true
    })
    let blocked = false
    try {
      await pollUntil(async () => {
        blocked = await waitingOnDefaultLock()
        return blocked || settled
      })
    } finally {
      // 무엇이 실패해도 잠금은 푼다 — 남으면 다음 검사가 멈춘다.
      await holder.query('COMMIT')
      holder.release()
    }
    assert.ok((await accepting).ok)
    assert.ok(blocked, '수락이 기본 teamspace 의 잠금 앞에서 기다리지 않았다 — 엇갈림이 일어나지 않은 검사다')
    assert.equal(await liveRole(teamspace, newcomer.userId), 'member', '켜는 명령과 엇갈린 가입자가 빠졌다')
  })

  test('누가 켜는가 — 워크스페이스 owner 이면서 그 teamspace 의 owner 만 · 멤버가 아니면 not_found · 모양이 아니면 invalid_settings', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, teamspace } = await office()
    const lead = await person('팀장') // teamspace 의 owner 이지만 워크스페이스 member
    const theirs = await createTeamspace(lead.ctx, { name: unique('팀장의 팀') })
    assert.ok(theirs.ok)
    const admin = await person('관리자', 'membership_admin')
    const adminTeam = await createTeamspace(admin.ctx, { name: unique('관리자의 팀') })
    assert.ok(adminTeam.ok)

    assert.deepEqual(await setDefaultTeamspace(lead.ctx, theirs.value.id, true), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setDefaultTeamspace(admin.ctx, adminTeam.value.id, true), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await setDefaultTeamspace(boss.ctx, theirs.value.id, true), { ok: false, reason: 'not_found' })
    assert.ok((await addTeamspaceMember(lead.ctx, theirs.value.id, user(boss))).ok)
    assert.deepEqual(
      await setDefaultTeamspace(boss.ctx, theirs.value.id, true),
      { ok: false, reason: 'forbidden' },
      '멤버일 뿐인 워크스페이스 owner 가 켰다 — 먼저 드러나게 owner 로 들어가야 한다',
    )
    const still = await getTeamspace(lead.ctx, theirs.value.id)
    assert.ok(still.ok && still.value.isDefault === false, '거부됐는데 기본이 켜졌다')

    assert.deepEqual(await claimTeamspaceOwnership(boss.ctx, theirs.value.id), { ok: true })
    assert.ok((await setDefaultTeamspace(boss.ctx, theirs.value.id, true)).ok)
    assert.deepEqual(await setDefaultTeamspace(boss.ctx, teamspace, 'yes'), { ok: false, reason: 'invalid_settings' })
  })

  test('★ 기본 teamspace 는 보관하지 못한다(default_teamspace) — 끄면 보관된다 · 같은 값은 아무것도 바꾸지 않는다 · 목록이 기본을 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, teamspace } = await office()
    const isDefault = async () => {
      const detail = await getTeamspace(boss.ctx, teamspace)
      const browse = (await listBrowsableTeamspaces(boss.ctx)).find((r) => r.id === teamspace)
      const admin = (await listAllTeamspaces(boss.ctx)).find((r) => r.id === teamspace)
      return [detail.ok && detail.value.isDefault, browse?.isDefault, admin?.isDefault]
    }
    assert.deepEqual(await isDefault(), [false, false, false])
    assert.ok((await setDefaultTeamspace(boss.ctx, teamspace, true)).ok)
    assert.deepEqual(await isDefault(), [true, true, true])

    assert.deepEqual(await archiveTeamspace(boss.ctx, teamspace), { ok: false, reason: 'default_teamspace' })
    assert.ok((await getTeamspace(boss.ctx, teamspace)).ok, '거부됐는데 보관됐다')
    assert.deepEqual(await setDefaultTeamspace(boss.ctx, teamspace, true), { ok: true, value: { added: 0 } })

    assert.ok((await setDefaultTeamspace(boss.ctx, teamspace, false)).ok)
    assert.deepEqual(await archiveTeamspace(boss.ctx, teamspace), { ok: true })
    assert.deepEqual(
      await setDefaultTeamspace(boss.ctx, teamspace, true),
      { ok: false, reason: 'not_found' },
      '보관된 teamspace 를 기본으로 켰다',
    )
  })

  test('기본 teamspace 에서도 스스로 나간다 — 나가기는 막지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, teamspace } = await office()
    const alice = await person('나갈 앨리스')
    assert.ok((await setDefaultTeamspace(boss.ctx, teamspace, true)).ok)
    assert.deepEqual(await removeTeamspaceMember(alice.ctx, teamspace, user(alice)), { ok: true })
    assert.equal(await liveRole(teamspace, alice.userId), null)
  })
})

/** `joinDefaultTeamspaces` 의 잠금 앞에서 기다리는 연결이 있는가 — 그 문장만 찾는다(다른 검사 파일의 잠금과 섞이지 않게). */
async function waitingOnDefaultLock(): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()
        AND query LIKE '%FROM teamspace WHERE workspace_id = $1 ORDER BY id FOR SHARE%'`,
  )
  return row.n > 0
}

async function pollUntil(check: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// ── ⑰ 멤버 기본 레벨 (7c-12) ──────────────────────────────────────────

describe('⑰ 멤버 기본 레벨 (7c-12)', () => {
  const level = (teamspaceId: string, memberLevel: unknown, by: Actor = fx.owner) =>
    updateTeamspace(by.ctx, teamspaceId, { memberLevel })
  const canCreateIn = async (actor: Actor, teamspaceId: string) => ({
    listed: (await listMyTeamspaces(actor.ctx)).find((t) => t.id === teamspaceId)?.canCreatePages,
    destination: (await listTeamspaceDestinations(actor.ctx)).some((d) => d.id === teamspaceId),
  })

  test('★ 읽기로 낮추면 멤버는 보기만 한다 — 못 고치고 최상위에 못 둔다(만들기 · 사이드바 · 옮기기 피커) · 소유자는 그대로 · 올리면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)
    const alice = await member('레벨 앨리스')
    await join(teamspace, alice)
    const bob = await member('레벨 그룹원 밥')
    const group = await createGroup(fx.owner.ctx, unique('레벨 그룹'))
    assert.ok(group.ok)
    assert.ok((await addGroupMember(fx.owner.ctx, group.value.id, bob.userId)).ok)
    assert.ok((await addTeamspaceMember(fx.owner.ctx, teamspace, { type: 'group', id: group.value.id })).ok)
    assert.ok(can(await capsOf(alice, page), 'edit_content'), '전제 — 만들 때는 full_access 다')

    assert.deepEqual(await level(teamspace, 'view'), { ok: true })
    for (const who of [alice, bob]) {
      const caps = await capsOf(who, page)
      assert.ok(can(caps, 'view') && !can(caps, 'edit_content') && !can(caps, 'comment'), '읽기로 낮췄는데 고치거나 댓글을 단다')
      assert.deepEqual(await sees(who, page, teamspace), SEES, '읽기로 낮추자 목록에서 사라졌다 — 판정과 목록이 어긋난다')
    }
    await assert.rejects(createPage(alice.ctx, { teamspaceId: teamspace, title: titleFromPlainText('몰래') }), PageError)
    assert.deepEqual(await canCreateIn(alice, teamspace), { listed: false, destination: false })
    const detail = await getTeamspace(alice.ctx, teamspace)
    assert.ok(detail.ok && detail.value.memberLevel === 'view' && !detail.value.canCreatePages)

    // 소유자는 자기 owner 행으로 늘 full_access 다 — 멤버 레벨과 무관하다(7c-10 의 반사실 r6 이 예고한 차이가 여기서 난다).
    assert.ok(can(await capsOf(fx.owner, page), 'manage_perm'), '멤버 레벨을 낮추자 소유자까지 잃었다')
    assert.deepEqual(await canCreateIn(fx.owner, teamspace), { listed: true, destination: true })

    // 편집 — 만들고 고치지만 공유는 못 한다.
    assert.deepEqual(await level(teamspace, 'edit'), { ok: true })
    const edit = await capsOf(alice, page)
    assert.ok(can(edit, 'edit_content') && can(edit, 'create_child') && !can(edit, 'share') && !can(edit, 'manage_perm'))
    assert.deepEqual(await canCreateIn(alice, teamspace), { listed: true, destination: true })
    assert.ok((await createPage(alice.ctx, { teamspaceId: teamspace, title: titleFromPlainText('편집자의 문서') })).id)

    assert.deepEqual(await level(teamspace, 'full_access'), { ok: true })
    assert.ok(can(await capsOf(alice, page), 'manage_perm'), '다시 올렸는데 돌아오지 않았다')
  })

  test('★ 상속을 끊은 페이지는 끊을 때의 레벨을 지킨다(P2) — 끊지 않은 형제는 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const kept = await topPage(teamspace, '따로 관리하는 문서')
    const follows = await topPage(teamspace, '따르는 문서')
    const alice = await member('끊긴 페이지의 앨리스')
    await join(teamspace, alice)
    assert.ok((await stopInheriting(fx.owner.ctx, kept)).ok)

    assert.deepEqual(await level(teamspace, 'comment'), { ok: true })
    assert.ok(can(await capsOf(alice, kept), 'edit_content'), '끊긴 페이지가 멤버 레벨 변경을 받았다 — P2 가 깨졌다')
    const followed = await capsOf(alice, follows)
    assert.ok(can(followed, 'comment') && !can(followed, 'edit_content'), '끊지 않은 페이지가 멤버 레벨을 따르지 않았다')
  })

  test('누가 · 무엇으로 — 소유자만(멤버 forbidden · 멤버가 아니면 not_found) · 넷 밖의 값은 invalid_level · 레벨만 줘도 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const alice = await member('레벨 못 바꾸는 앨리스')
    await join(teamspace, alice)
    const stranger = await member('레벨 모르는 사람')

    assert.deepEqual(await level(teamspace, 'view', alice), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await level(teamspace, 'view', stranger), { ok: false, reason: 'not_found' })
    for (const bad of ['edit_content', 'create', 'owner', '', null]) {
      assert.deepEqual(await level(teamspace, bad), { ok: false, reason: 'invalid_level' }, String(bad))
    }
    const still = await getTeamspace(fx.owner.ctx, teamspace)
    assert.ok(still.ok && still.value.memberLevel === 'full_access', '거부됐는데 레벨이 바뀌었다')
  })

  test('★ 레벨을 바꾸면 협업 서버에 알린다 — 같은 값을 다시 보내면(이름만 고친 저장) 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const teamspace = await newTeamspace()
    const heard = await listenTo(t, fx.workspaceId)

    assert.deepEqual(await level(teamspace, 'view'), { ok: true })
    await waitFor('낮춘 레벨의 신호', () => heard() >= 1)
    // 폼은 저장마다 모든 칸을 보낸다 — 이름만 고쳐도 같은 레벨이 온다. 그 저장이 권한 신호를 내면 열린 편집기가 헛되이 흔들린다.
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, teamspace, { name: unique('이름만'), memberLevel: 'view' }), { ok: true })
    assert.deepEqual(await level(teamspace, 'full_access'), { ok: true })
    await waitFor('올린 레벨의 신호', () => heard() >= 2)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(heard(), 2, '같은 레벨을 다시 쓴 저장이 권한 신호를 냈다')
  })
})

// ── ⑱ 아이콘 (7c-14) ──────────────────────────────────────────────────

describe('⑱ 아이콘 (7c-14)', () => {
  test('★ 만들 때 · 고칠 때 · 지울 때 — 목록마다 같은 아이콘이 실린다(내 목록 · 머리 · 둘러보기 · 관리 · 옮기기 피커 · 보관)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const created = await createTeamspace(fx.owner.ctx, { name: unique('아이콘 팀'), icon: '🚀' })
    assert.ok(created.ok && created.value.icon === '🚀', JSON.stringify(created))
    const id = created.value.id
    const everywhere = async () => {
      const detail = await getTeamspace(fx.owner.ctx, id)
      return [
        (await listMyTeamspaces(fx.owner.ctx)).find((r) => r.id === id)?.icon,
        detail.ok ? detail.value.icon : 'x',
        (await listBrowsableTeamspaces(fx.owner.ctx)).find((r) => r.id === id)?.icon,
        (await listAllTeamspaces(fx.owner.ctx)).find((r) => r.id === id)?.icon,
        (await listTeamspaceDestinations(fx.owner.ctx)).find((r) => r.id === id)?.icon,
      ]
    }
    assert.deepEqual(await everywhere(), Array(5).fill('🚀'))

    assert.deepEqual(await updateTeamspace(fx.owner.ctx, id, { icon: '👨‍👩‍👧‍👦' }), { ok: true })
    assert.deepEqual(await everywhere(), Array(5).fill('👨‍👩‍👧‍👦'))
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, id, { icon: null }), { ok: true })
    assert.deepEqual(await everywhere(), Array(5).fill(null), '지웠는데 남았다')

    assert.deepEqual(await updateTeamspace(fx.owner.ctx, id, { icon: '🌱' }), { ok: true })
    assert.deepEqual(await archiveTeamspace(fx.owner.ctx, id), { ok: true })
    assert.equal((await listArchivedTeamspaces(fx.owner.ctx)).find((r) => r.id === id)?.icon, '🌱')
  })

  test('모양이 아니면 invalid_icon — 만들기도 고치기도 · 아이콘은 owner 만 바꾼다 · 거부는 아무것도 바꾸지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const bad of ['🚀🚀', 'ab', 7]) {
      assert.deepEqual(await createTeamspace(fx.owner.ctx, { name: unique('나쁜 아이콘'), icon: bad }), {
        ok: false,
        reason: 'invalid_icon',
      })
    }
    const id = await newTeamspace()
    assert.deepEqual(await updateTeamspace(fx.owner.ctx, id, { icon: '팀' }), { ok: false, reason: 'invalid_icon' })
    const alice = await member('아이콘 못 바꾸는 앨리스')
    await join(id, alice)
    assert.deepEqual(await updateTeamspace(alice.ctx, id, { icon: '🔒' }), { ok: false, reason: 'forbidden' })
    const detail = await getTeamspace(fx.owner.ctx, id)
    assert.ok(detail.ok && detail.value.icon === null, '거부됐는데 아이콘이 바뀌었다')
  })
})
