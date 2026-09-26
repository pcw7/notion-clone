/**
 * teamspace — Teamspace · 게스트 · 그룹 7c-1 · 7c-2 · 7c-5조각 (F-06-04 · F-02-12 · DB · 마이그레이션 0028)
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
 *   ⑬ 공개 범위 · 둘러보기 · 참여(7c-5) — 목록에 무엇이 오는가 · open 만 참여 · 참여 전에는 못 본다 · 설정은 owner 만
 *
 * 열린 협업 연결이 멤버에서 빠질 때 닫히는지는 `collab/collab-server.db.test.ts` ⑨ 가 본다.
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { duplicatePage } from '../block/duplicate.ts'
import { createPage, getPage, listTeamspacePages, PageError, titleFromPlainText } from '../block/page.ts'
import { groupRootsByTeamspace, listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { query, queryOne } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
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
import {
  addTeamspaceMember,
  createTeamspace,
  getTeamspace,
  joinTeamspace,
  listBrowsableTeamspaces,
  listMyTeamspaces,
  listTeamspaceMembers,
  removeTeamspaceMember,
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
    const split = groupRootsByTeamspace(tree, await listMyTeamspaces(fx.owner.ctx))
    const section = split.teamspaces.find((s) => s.teamspace.id === teamspace)
    assert.deepEqual(section?.pages.map((p) => p.id), [page])
    assert.ok(split.rest.some((p) => p.id === direct))
    assert.ok(!split.rest.some((p) => p.id === page), '팀 최상위가 직속 페이지와 섞였다')
  })

  test('팀 밖에서 공유받은 하위 페이지 — 루트를 못 봐도 teamspace 를 싣지만 · 멤버가 아니니 rest 로 간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const sam = await member('샘')
    const teamspace = await newTeamspace()
    const page = await topPage(teamspace)
    const child = (await createPage(fx.owner.ctx, { parentPageId: page, title: titleFromPlainText('따로 공유') })).id
    assert.ok((await grantAccess(fx.owner.ctx, child, user(sam), 'view')).ok)

    const tree = await listPageTree(sam.ctx)
    assert.equal(find(tree, page), undefined, '전제 — 루트는 못 본다')
    assert.equal(find(tree, child)?.teamspaceId, teamspace)
    const split = groupRootsByTeamspace(tree, await listMyTeamspaces(sam.ctx))
    assert.deepEqual(split.teamspaces, [])
    assert.ok(split.rest.some((p) => p.id === child))
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

  test('★ 공개 범위는 판정에 들어가지 않는다 — open 이어도 참여하기 전에는 못 본다 · 노드에 "모두" 행이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const stranger = await member('참여 안 한 사람')
    const open = await teamspaceOfVisibility('open')
    const page = await topPage(open, '참여 전 문서')

    assert.deepEqual(await sees(stranger, page, open), BLIND, 'open teamspace 의 페이지가 멤버 아닌 사람에게 보인다')
    assert.deepEqual(
      await query(
        `SELECT principal_type FROM acl_entry WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'workspace_everyone'`,
        [open],
      ),
      [],
      'open 이 노드에 workspace_everyone 행을 뒀다 — 사이드바가 전원에게 이 페이지를 싣는다',
    )
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
