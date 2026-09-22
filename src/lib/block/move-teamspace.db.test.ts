/**
 * 페이지를 teamspace 로 · 밖으로 · 사이로 옮긴다 — Teamspace · 게스트 · 그룹 7c-3조각 (F-06-20 · DB · 마이그레이션 0029)
 *
 * 06 F-06-20: *"이동 즉시 새 부모의 권한이 상속되고, 이전 부모 기반 접근은 소멸한다 … 명시 ACL 은 유지."* 판정(`canViewPage`)과
 * 목록(teamspace 최상위 목록 · 사이드바 — 스코프로 거른다)을 **나란히** 묻는다(HANDOFF §3.3-107).
 *
 *   ① ★ 워크스페이스 최상위 → teamspace: 모두에게 준 상속 행을 거두고 멤버만 본다 · 명시 부여는 남는다 · 끊은 페이지는 제 행을 지킨다
 *   ② teamspace → 워크스페이스 최상위 · ★ teamspace A → B · 다른 teamspace 의 페이지 밑으로
 *   ③ ★ 뿌리가 바뀌는 이동은 페이지의 전체 권한이 있어야 한다 · 멤버가 아닌 · 보관된 teamspace 로는 못 간다 · 이미 그 자리면 noop
 *   ④ 옛 부모 본문에서 빠진다 · ★ 부모만 바뀌는 이동도 협업 서버에 신호가 간다(0029)
 *   ⑤ 옮길 곳 목록 — 내가 둘 수 있는 teamspace 만
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { openChangeFeed, type CollabSignal } from '../collab/change-feed.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { canViewPage } from '../permissions/effective.ts'
import { assertBodyMatchesYDoc } from '../testing/body-invariant.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { addTeamspaceMember, createTeamspace } from '../workspace/teamspace.ts'
import { createPage, listTeamspacePages, titleFromPlainText } from './page.ts'
import { listPageTree, type PageTreeNode } from './page-tree.ts'
import { listTeamspaceDestinations, movePage, MoveError, type MoveDestination } from './move-page.ts'

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

const user = (actor: Actor) => ({ type: 'user' as const, id: actor.userId })

/** teamspace 를 만들고(만든 사람이 owner) 사람들을 멤버로 넣는다. */
async function teamspaceWith(by: Actor, ...members: Actor[]): Promise<string> {
  const created = await createTeamspace(by.ctx, { name: unique('팀') })
  assert.ok(created.ok, JSON.stringify(created))
  for (const m of members) assert.ok((await addTeamspaceMember(by.ctx, created.value.id, user(m))).ok)
  return created.value.id
}

async function page(title: string, at: { parentPageId?: BlockId; teamspaceId?: string } = {}, by: Actor = fx.owner): Promise<BlockId> {
  return (await createPage(by.ctx, { ...at, title: titleFromPlainText(title) })).id
}

const flatten = (nodes: readonly PageTreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...flatten(n.children)])

/** 판정 · 사이드바를 나란히. teamspace 를 주면 그 최상위 목록도. */
async function sees(actor: Actor, pageId: string, teamspaceId?: string) {
  const out: { judged: boolean; sidebar: boolean; listed?: boolean } = {
    judged: await canViewPage(actor.ctx, pageId),
    sidebar: flatten(await listPageTree(actor.ctx)).includes(pageId),
  }
  if (teamspaceId !== undefined) out.listed = (await listTeamspacePages(actor.ctx, teamspaceId)).some((p) => p.id === pageId)
  return out
}

const rowOf = (id: string) =>
  queryOne<{ parent_type: string; parent_id: string; ancestor_path: string[]; perm_scope_id: string }>(
    `SELECT parent_type, parent_id, ancestor_path, perm_scope_id FROM block WHERE id = $1`,
    [id],
  )

async function aclOf(nodeId: string) {
  const rows = await query<{ principal_type: string; principal_id: string | null; level: string }>(
    `SELECT principal_type, principal_id, level FROM acl_entry
      WHERE node_kind = 'block' AND node_id = $1 ORDER BY principal_type, principal_id`,
    [nodeId],
  )
  return rows.map((r) => [r.principal_type, r.principal_id, r.level])
}

const rejectsWith = (code: MoveError['code'], run: () => Promise<unknown>) =>
  assert.rejects(run, (e: unknown) => e instanceof MoveError && e.code === code)

const move = (actor: Actor, pageId: BlockId, destination: MoveDestination) => movePage(actor.ctx, pageId, destination)

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 워크스페이스 최상위 → teamspace', () => {
  test('★ 멤버만 본다 — 모두에게 준 상속 행을 거두고 teamspace 노드에서 물려받는다 · 스코프는 teamspace · 자손이 따른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('앨리스')
    const outsider = await member('바깥 사람')
    const team = await teamspaceWith(fx.owner, alice)
    const top = await page('옮길 최상위')
    const child = await page('그 자식', { parentPageId: top })
    assert.deepEqual(await sees(outsider, top), { judged: true, sidebar: true }, '전제: 최상위는 모두에게 열려 있다')

    const moved = await move(fx.owner, top, { teamspaceId: team })

    assert.deepEqual([moved.teamspaceId, moved.parentBlockId, moved.noop], [team, null, false])
    assert.deepEqual(await rowOf(top), { parent_type: 'teamspace', parent_id: team, ancestor_path: [], perm_scope_id: team })
    assert.equal((await rowOf(child)).perm_scope_id, team, '자손이 옛 스코프에 남았다')
    assert.deepEqual(await aclOf(top), [], '모두에게 준 상속 행이 남았다 — 옮겨도 워크스페이스 전체에 열려 있다')
    assert.deepEqual(await sees(alice, top, team), { judged: true, sidebar: true, listed: true })
    assert.deepEqual(await sees(outsider, top, team), { judged: false, sidebar: false, listed: false })
    assert.equal(await canViewPage(outsider.ctx, child), false)
  })

  test('명시 부여는 남는다 — 따로 준 사람은 멤버가 아니어도 보고, 페이지는 제 스코프를 지킨다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const guestLike = await member('따로 받은 사람')
    const team = await teamspaceWith(fx.owner)
    const top = await page('따로 준 최상위')
    assert.ok((await grantAccess(fx.owner.ctx, top, user(guestLike), 'view')).ok)

    await move(fx.owner, top, { teamspaceId: team })

    assert.deepEqual(await aclOf(top), [['user', guestLike.userId, 'view']])
    assert.equal((await rowOf(top)).perm_scope_id, top, '명시 부여가 남았으니 경계다')
    assert.deepEqual(await sees(guestLike, top), { judged: true, sidebar: true })
  })

  test('상속을 끊은 최상위 페이지는 떠나도 제 행을 지킨다 — 그 행은 절단 시점의 자기 부여다 (P2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const outsider = await member('바깥 사람')
    const team = await teamspaceWith(fx.owner)
    const top = await page('끊은 최상위')
    assert.ok((await stopInheriting(fx.owner.ctx, top)).ok)
    const before = await aclOf(top)

    await move(fx.owner, top, { teamspaceId: team })

    assert.deepEqual(await aclOf(top), before)
    assert.equal((await rowOf(top)).perm_scope_id, top)
    assert.equal(await canViewPage(outsider.ctx, top), true, '끊은 페이지는 새 부모를 따르지 않는다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② teamspace 밖으로 · 사이로', () => {
  test('teamspace 최상위를 워크스페이스 최상위로 — 모두가 본다 · 자기가 스코프다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const outsider = await member('바깥 사람')
    const team = await teamspaceWith(fx.owner)
    const top = await page('팀 문서', { teamspaceId: team })
    assert.equal(await canViewPage(outsider.ctx, top), false, '전제')

    await move(fx.owner, top, null)

    assert.deepEqual(await rowOf(top), { parent_type: 'workspace', parent_id: fx.workspaceId, ancestor_path: [], perm_scope_id: top })
    assert.deepEqual(await aclOf(top), [['workspace_everyone', null, 'full_access']])
    assert.deepEqual(await sees(outsider, top), { judged: true, sidebar: true })
  })

  test('★ teamspace A → B — A 에만 있는 사람은 잃고 B 에만 있는 사람은 얻는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const amy = await member('에이미')
    const ben = await member('벤')
    const a = await teamspaceWith(fx.owner, amy)
    const b = await teamspaceWith(fx.owner, ben)
    const top = await page('A 의 문서', { teamspaceId: a })
    const child = await page('A 의 하위', { parentPageId: top })

    await move(fx.owner, top, { teamspaceId: b })

    assert.deepEqual([(await rowOf(top)).perm_scope_id, (await rowOf(child)).perm_scope_id], [b, b])
    assert.deepEqual(await sees(amy, top, a), { judged: false, sidebar: false, listed: false })
    assert.equal(await canViewPage(amy.ctx, child), false)
    assert.deepEqual(await sees(ben, top, b), { judged: true, sidebar: true, listed: true })
    assert.equal(await canViewPage(ben.ctx, child), true)
  })

  test('다른 teamspace 의 페이지 밑으로 — 블록 대상도 뿌리를 바꾼다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const amy = await member('에이미')
    const ben = await member('벤')
    const a = await teamspaceWith(fx.owner, amy)
    const b = await teamspaceWith(fx.owner, ben)
    const moving = await page('A 의 문서', { teamspaceId: a })
    const host = await page('B 의 문서', { teamspaceId: b })

    await move(fx.owner, moving, host)

    assert.deepEqual(await rowOf(moving), { parent_type: 'block', parent_id: host, ancestor_path: [host], perm_scope_id: b })
    assert.equal(await canViewPage(amy.ctx, moving), false)
    assert.deepEqual(await sees(ben, moving), { judged: true, sidebar: true })
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 누가 어디로 옮길 수 있는가', () => {
  test('★ 뿌리가 바뀌는 이동은 페이지의 전체 권한이 있어야 한다 — edit 만 있으면 needs_full_access · 같은 뿌리 안에서는 옮긴다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ed = await member('에드')
    const team = await teamspaceWith(fx.owner, ed)
    const moving = await page('에드가 고치기만 하는 페이지')
    assert.ok((await grantAccess(fx.owner.ctx, moving, user(fx.owner), 'full_access')).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, moving, { type: 'workspace_everyone' })).ok)
    assert.ok((await grantAccess(fx.owner.ctx, moving, user(ed), 'edit')).ok)

    const inTeam = await page('팀 안의 페이지', { teamspaceId: team })
    await rejectsWith('needs_full_access', () => move(ed, moving, { teamspaceId: team }))
    await rejectsWith('needs_full_access', () => move(ed, moving, inTeam))
    assert.equal((await rowOf(moving)).parent_type, 'workspace', '거부됐는데 자리가 바뀌었다')

    // 같은 뿌리(워크스페이스) 안에서는 edit 으로 옮긴다 — 전과 같다.
    const host = await page('모두에게 열린 부모')
    await move(ed, moving, host)
    assert.equal((await rowOf(moving)).parent_id, host)

    assert.ok((await grantAccess(fx.owner.ctx, moving, user(ed), 'full_access')).ok)
    await move(ed, moving, { teamspaceId: team })
    assert.deepEqual([(await rowOf(moving)).parent_type, (await rowOf(moving)).parent_id], ['teamspace', team])
  })

  test('같은 teamspace 안의 이동은 edit 로 된다 — 뿌리는 페이지 자신이 아니라 루트 블록의 부모로 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ed = await member('에드')
    const team = await teamspaceWith(fx.owner, ed)
    const top = await page('팀 최상위', { teamspaceId: team })
    const host = await page('팀 안의 다른 페이지', { parentPageId: await page('팀 두 번째 최상위', { teamspaceId: team }) })
    const nested = await page('에드가 고치기만 하는 하위', { parentPageId: top })
    assert.ok((await stopInheriting(fx.owner.ctx, nested)).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, nested, { type: 'teamspace', id: team })).ok)
    assert.ok((await grantAccess(fx.owner.ctx, nested, user(ed), 'edit')).ok)

    // 하위 → 그 teamspace 의 최상위 · 최상위 → 그 teamspace 안의 깊은 페이지 밑. 둘 다 뿌리가 그대로다.
    await move(ed, nested, { teamspaceId: team })
    assert.deepEqual([(await rowOf(nested)).parent_type, (await rowOf(nested)).parent_id], ['teamspace', team])
    await move(ed, nested, host)
    assert.equal((await rowOf(nested)).parent_id, host)
  })

  test('멤버가 아닌 · 보관된 · 남의 워크스페이스 teamspace 로는 못 간다(target_not_found) · 이미 그 자리면 noop', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const other = await member('다른 사람')
    const notMine = await teamspaceWith(other)
    const archived = await teamspaceWith(fx.owner)
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [archived])
    const elsewhere = await makeFixture()
    const theirs = await teamspaceWith(elsewhere.owner)
    const moving = await page('옮길 것')

    for (const teamspaceId of [notMine, archived, theirs]) {
      await rejectsWith('target_not_found', () => move(fx.owner, moving, { teamspaceId }))
    }
    assert.deepEqual(await aclOf(moving), [['workspace_everyone', null, 'full_access']], '거부됐는데 상속 행을 거뒀다')

    const team = await teamspaceWith(fx.owner)
    const inTeam = await page('팀 문서', { teamspaceId: team })
    assert.equal((await move(fx.owner, inTeam, { teamspaceId: team })).noop, true)
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

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

describe('④ 본문 · 신호', () => {
  test('하위 페이지를 teamspace 최상위로 꺼내면 옛 부모 본문에서 빠진다 — 행과 Y.Doc 이 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const team = await teamspaceWith(fx.owner)
    const parent = await page('옛 부모')
    const moving = await page('꺼낼 것', { parentPageId: parent })
    const stay = await page('남는 것', { parentPageId: parent })

    await move(fx.owner, moving, { teamspaceId: team })

    assert.deepEqual((await assertBodyMatchesYDoc(fx.owner.ctx, parent, '옛 부모')).blocks.map((b) => b.id), [stay])
    assert.deepEqual([(await rowOf(moving)).parent_type, (await rowOf(moving)).ancestor_path], ['teamspace', []])
  })

  test('★ 자기 행을 가진 최상위 페이지를 teamspace 사이로 옮기면 협업 서버에 신호가 간다 — 경로도 스코프도 그대로, 부모만 바뀐다 (0029)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const own = await makeFixture()
    const amy = await joinAs(own.workspaceId, await createUser('에이미'), 'member')
    const a = await teamspaceWith(own.owner, amy)
    const b = await teamspaceWith(own.owner)
    const top = await page('자기 행을 가진 팀 문서', { teamspaceId: a }, own.owner)
    assert.ok((await grantAccess(own.owner.ctx, top, user(own.owner), 'full_access')).ok) // 경계 — 옮겨도 스코프가 그대로다
    const before = await rowOf(top)
    assert.equal(await canViewPage(amy.ctx, top), true, '전제: A 의 멤버는 본다')

    const heard = await listenTo(t, own.workspaceId)
    await move(own.owner, top, { teamspaceId: b })
    await waitFor('부모만 바뀐 이동의 신호', () => heard() >= 1)

    const after = await rowOf(top)
    assert.deepEqual([after.ancestor_path, after.perm_scope_id], [before.ancestor_path, before.perm_scope_id], '전제: 경로 · 스코프는 그대로다')
    assert.equal(await canViewPage(amy.ctx, top), false, 'A 의 멤버가 잃었다 — 그래서 신호가 가야 한다')
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 옮길 곳 목록', () => {
  test('내가 둘 수 있는 teamspace 만 — 멤버가 아닌 것 · 보관된 것은 없다 · 게스트는 빈 목록', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const own = await makeFixture()
    const other = await joinAs(own.workspaceId, await createUser('다른 사람'), 'member')
    const guest = await joinAs(own.workspaceId, await createUser('손님'), 'guest')
    const mine = await teamspaceWith(own.owner)
    await teamspaceWith(other)
    const archived = await teamspaceWith(own.owner)
    await query(`UPDATE teamspace SET archived_at = now() WHERE id = $1`, [archived])

    assert.deepEqual((await listTeamspaceDestinations(own.owner.ctx)).map((d) => d.id), [mine])
    assert.deepEqual(await listTeamspaceDestinations(guest.ctx), [])
  })
})
