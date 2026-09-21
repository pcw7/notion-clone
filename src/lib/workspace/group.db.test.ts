/**
 * 그룹 — Teamspace · 게스트 · 그룹 7a조각 (F-06-03 · DB · 마이그레이션 0027)
 *
 * 이 파일이 지키는 것. 판정(`canViewPage`)과 목록(`listChildPages` — 스코프로 거른다)을 **나란히** 묻는다 — 둘이 어긋나는
 * 것이 이 도메인의 버그 모양이다(HANDOFF §3.3-107).
 *
 *   ① ★ 그룹이 받은 페이지는 그룹 멤버가 본다 · 빠지면 못 본다 · 다시 넣으면 다시 본다(M1 — 같은 행이 살아난다)
 *   ② ★ 게스트는 그룹 행이 남아 있어도 못 본다(G2 — 판정이 게스트의 그룹을 무시한다) · restricted_member 는 본다(G3)
 *   ③ 가장 넓은 것이 이긴다 — 직접 받은 읽기 + 그룹이 받은 편집 = 편집
 *   ④ 고치기는 owner · membership_admin 만 — 거부된 명령은 아무것도 바꾸지 않는다 · 게스트는 목록도 못 본다
 *   ⑤ 멤버 가드 — 게스트 · 초대만 받은 사람 · 다른 워크스페이스 사람은 넣을 수 없다
 *   ⑥ 이름 — 대소문자를 무시하고 살아 있는 그룹 사이에서만 겹치지 않는다(지운 이름은 다시 쓸 수 있다 · 0027 ①)
 *   ⑦ ★ 지우기 — 그 그룹의 부여가 사라지고 경계가 풀린다(목록과 판정이 같이 답한다) · 사람에게 준 것은 남는다
 *      · ★ 관리할 사람이 남지 않는 페이지가 생기면 거부하고 아무것도 바꾸지 않는다 · 지운 그룹 · 남의 그룹에는 줄 수 없다
 *   ⑧ 세대 · 신호 — 멤버가 바뀌면 그 사람의 perm_gen · 워크스페이스의 acl_epoch 가 오르고 협업 서버에 신호가 간다.
 *      이름 바꾸기 · 이미 있는 멤버 넣기는 보내지 않는다. SQL 로 지운 그룹도 보낸다
 *
 * 열린 협업 연결이 그 신호로 실제로 닫히는지는 `collab/collab-server.db.test.ts` ⑨ 가 본다.
 */

import { test, describe, before, after, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, listChildPages, titleFromPlainText } from '../block/page.ts'
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
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  listGroupMembers,
  listGroups,
  removeGroupMember,
  renameGroup,
} from './group.ts'

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

async function newGroup(name = '그룹'): Promise<string> {
  const created = await createGroup(fx.owner.ctx, unique(name))
  assert.ok(created.ok, JSON.stringify(created))
  return created.value.id
}

async function put(groupId: string, ...actors: Actor[]): Promise<void> {
  for (const actor of actors) {
    const added = await addGroupMember(fx.owner.ctx, groupId, actor.userId)
    assert.ok(added.ok, JSON.stringify(added))
  }
}

/** 최상위 페이지를 만들고 모든 멤버의 행을 걷는다 — 소유자만 본다. */
async function privatePage(title: string, parentPageId?: BlockId): Promise<BlockId> {
  const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText(title), parentPageId })).id
  if (parentPageId === undefined) {
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: fx.owner.userId }, 'full_access')).ok)
    assert.ok((await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })).ok)
  }
  return page
}

async function share(page: string, groupId: string, level: 'view' | 'edit' | 'full_access' = 'edit'): Promise<void> {
  const granted = await grantAccess(fx.owner.ctx, page, { type: 'group', id: groupId }, level)
  assert.ok(granted.ok, JSON.stringify(granted))
}

/** 판정과 목록을 **나란히** — 최상위 페이지면 최상위 목록, 아니면 부모의 하위 목록에 있는가. */
async function sees(actor: Actor, page: BlockId, parent: BlockId | null = null): Promise<{ judged: boolean; listed: boolean }> {
  const judged = await canViewPage(actor.ctx, page)
  const listed = (await listChildPages(actor.ctx, parent)).some((p) => p.id === page)
  return { judged, listed }
}

const capsOf = (actor: Actor, page: string) => withReadTransaction((tx) => effectiveCaps(tx, actor.ctx, page))

const scopeOf = async (page: string): Promise<string> =>
  (await queryOne<{ perm_scope_id: string }>(`SELECT perm_scope_id FROM block WHERE id = $1`, [page])).perm_scope_id

const groupRows = async (groupId: string): Promise<number> =>
  (
    await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM acl_entry WHERE principal_type = 'group' AND principal_id = $1`,
      [groupId],
    )
  ).n

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 그룹이 받은 페이지', () => {
  test('★ 그룹 멤버는 보고 · 빠지면 못 보고 · 다시 넣으면 다시 본다 — 판정과 목록이 같이', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const alice = await member('앨리스')
    const outsider = await member('바깥 사람')
    const group = await newGroup('디자인팀')
    const page = await privatePage('디자인 문서')
    await share(page, group)

    assert.deepEqual(await sees(alice, page), { judged: false, listed: false }, '전제: 그룹에 넣기 전에는 못 본다')

    await put(group, alice)
    assert.deepEqual(await sees(alice, page), { judged: true, listed: true }, '그룹에 들어가면 곧바로 본다')
    assert.ok(can(await capsOf(alice, page), 'edit_content'), '그룹이 받은 레벨(편집)이다')
    assert.deepEqual(await sees(outsider, page), { judged: false, listed: false }, '그룹 밖은 여전히 못 본다')

    assert.ok((await removeGroupMember(fx.owner.ctx, group, alice.userId)).ok)
    assert.deepEqual(await sees(alice, page), { judged: false, listed: false }, '빠지면 곧바로 못 본다')

    await put(group, alice)
    assert.deepEqual(await sees(alice, page), { judged: true, listed: true }, '다시 넣으면 다시 본다')
    const rows = await query<{ removed_at: Date | null }>(
      `SELECT removed_at FROM group_member WHERE group_id = $1 AND user_id = $2`,
      [group, alice.userId],
    )
    assert.deepEqual(rows, [{ removed_at: null }], '같은 행이 살아난다(M1) — 두 번째 행을 만들지 않는다')
  })

  test('하위 페이지도 그룹의 부여를 물려받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const bob = await member('밥')
    const group = await newGroup()
    const root = await privatePage('루트')
    const child = await privatePage('자식', root)
    await share(root, group, 'view')
    await put(group, bob)

    assert.deepEqual(await sees(bob, child, root), { judged: true, listed: true })
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 게스트 · restricted_member', () => {
  test('★ 멤버였다 게스트가 되면 그룹 행이 남아 있어도 그룹이 받은 페이지를 못 본다(G2)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const user = await createUser('게스트가 될 사람')
    const asMember = await joinAs(fx.workspaceId, user, 'member')
    const group = await newGroup()
    const page = await privatePage('팀 문서')
    await share(page, group)
    await put(group, asMember)
    assert.deepEqual(await sees(asMember, page), { judged: true, listed: true }, '전제: 멤버일 때는 본다')

    // M1 — 떠났다 게스트로 돌아온 사람이 이 모양이다. 넣는 쪽 트리거는 이 쪽을 보지 않는다(0027 ②).
    const asGuest = await joinAs(fx.workspaceId, user, 'guest')
    const live = await query(`SELECT 1 FROM group_member WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`, [
      group,
      user.userId,
    ])
    assert.equal(live.length, 1, '전제: 살아 있는 그룹 행이 남아 있다')
    assert.deepEqual(await sees(asGuest, page), { judged: false, listed: false })
  })

  test('restricted_member 는 모든 멤버의 페이지는 못 보지만 그룹으로는 받는다(G3)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const restricted = await member('제한 멤버', 'restricted_member')
    const everyone = (await createPage(fx.owner.ctx, { title: titleFromPlainText('모두의 페이지') })).id
    const group = await newGroup()
    const page = await privatePage('그룹 문서')
    await share(page, group)
    await put(group, restricted)

    assert.deepEqual(await sees(restricted, everyone), { judged: false, listed: false }, 'workspace_everyone 에는 없다')
    assert.deepEqual(await sees(restricted, page), { judged: true, listed: true })
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 가장 넓은 것이 이긴다', () => {
  test('직접 받은 읽기 + 그룹이 받은 편집 = 편집 · 그룹에서 빠지면 읽기로 돌아간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const carol = await member('캐럴')
    const group = await newGroup()
    const page = await privatePage('넓은 쪽')
    assert.ok((await grantAccess(fx.owner.ctx, page, { type: 'user', id: carol.userId }, 'view')).ok)
    await share(page, group, 'edit')
    await put(group, carol)

    assert.ok(can(await capsOf(carol, page), 'edit_content'))
    assert.ok((await removeGroupMember(fx.owner.ctx, group, carol.userId)).ok)
    const caps = await capsOf(carol, page)
    assert.deepEqual([can(caps, 'view'), can(caps, 'edit_content')], [true, false])
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 누가 고치는가', () => {
  test('★ member · restricted_member · guest 는 그룹을 만들지도 고치지도 못한다 — 아무것도 바뀌지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const group = await newGroup('관리 대상')
    const target = await member('넣을 사람')
    await put(group, target)
    const before = await listGroups(fx.owner.ctx)
    assert.ok(before.ok)

    for (const role of ['member', 'restricted_member', 'guest'] as const) {
      const actor = await member(`역할 ${role}`, role)
      const results = [
        await createGroup(actor.ctx, unique('몰래')),
        await renameGroup(actor.ctx, group, unique('몰래 바꾼 이름')),
        await addGroupMember(actor.ctx, group, actor.userId),
        await removeGroupMember(actor.ctx, group, target.userId),
        await deleteGroup(actor.ctx, group),
      ]
      assert.deepEqual(
        results.map((r) => (r.ok ? 'ok' : r.reason)),
        ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden'],
        role,
      )
    }
    assert.deepEqual(await listGroups(fx.owner.ctx), before, '거부된 명령이 무언가 바꿨다')
    const members = await listGroupMembers(fx.owner.ctx, group)
    assert.ok(members.ok)
    assert.deepEqual(
      members.value.map((m) => m.userId),
      [target.userId],
    )
  })

  test('membership_admin 은 고친다 · member 는 목록을 보고 · 게스트는 목록도 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const admin = await member('멤버십 관리자', 'membership_admin')
    const created = await createGroup(admin.ctx, unique('관리자가 만든 그룹'))
    assert.ok(created.ok)
    assert.ok((await addGroupMember(admin.ctx, created.value.id, admin.userId)).ok)

    const plain = await member('보통 멤버')
    const listed = await listGroups(plain.ctx)
    assert.ok(listed.ok && listed.value.some((g) => g.id === created.value.id && g.memberCount === 1))

    const guest = await member('손님', 'guest')
    assert.deepEqual(
      [await listGroups(guest.ctx), await listGroupMembers(guest.ctx, created.value.id)].map((r) => (r.ok ? 'ok' : r.reason)),
      ['forbidden', 'forbidden'],
    )
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 넣을 수 있는 사람', () => {
  test('★ 게스트 · 초대만 받은 사람 · 다른 워크스페이스 사람은 invalid_member — 행이 생기지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const group = await newGroup()
    const guest = await member('손님', 'guest')
    const invited = await createUser('초대만 받은 사람')
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'invited')`,
      [fx.workspaceId, invited.userId],
    )
    const elsewhere = await joinAs(await createBareWorkspace('남의 워크스페이스'), await createUser('남'), 'member')

    for (const userId of [guest.userId, invited.userId, elsewhere.userId]) {
      const added = await addGroupMember(fx.owner.ctx, group, userId)
      assert.deepEqual(added, { ok: false, reason: 'invalid_member' })
    }
    const rows = await query(`SELECT 1 FROM group_member WHERE group_id = $1`, [group])
    assert.equal(rows.length, 0)
  })

  test('DB 도 게스트를 막는다(G2 트리거) — 앱의 확인을 건너뛴 쓰기', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const group = await newGroup()
    const guest = await member('손님', 'guest')
    await assert.rejects(
      query(`INSERT INTO group_member (group_id, user_id) VALUES ($1, $2)`, [group, guest.userId]),
      (e: { code?: string }) => e.code === '23514',
    )
  })

  test('없는 그룹 · 지운 그룹 · 남의 그룹은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const someone = await member('누군가')
    const gone = await newGroup()
    assert.ok((await deleteGroup(fx.owner.ctx, gone)).ok)
    const other = await makeFixture()
    const theirs = await createGroup(other.owner.ctx, '남의 그룹')
    assert.ok(theirs.ok)

    for (const groupId of ['00000000-0000-4000-8000-000000000000', gone, theirs.value.id]) {
      const results = [
        await addGroupMember(fx.owner.ctx, groupId, someone.userId),
        await removeGroupMember(fx.owner.ctx, groupId, someone.userId),
        await renameGroup(fx.owner.ctx, groupId, unique('새 이름')),
        await deleteGroup(fx.owner.ctx, groupId),
        await listGroupMembers(fx.owner.ctx, groupId),
      ]
      assert.deepEqual(
        results.map((r) => (r.ok ? 'ok' : r.reason)),
        ['not_found', 'not_found', 'not_found', 'not_found', 'not_found'],
      )
    }
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 이름', () => {
  test('빈 이름 · 공백뿐 · 너무 긴 이름은 invalid_name · 개행은 접는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const name of ['', '   ', 'ㄱ'.repeat(101), 42]) {
      assert.deepEqual(await createGroup(fx.owner.ctx, name), { ok: false, reason: 'invalid_name' })
    }
    const created = await createGroup(fx.owner.ctx, `  줄\n바꿈 ${(seq += 1)}  `)
    assert.ok(created.ok)
    assert.equal(created.value.name, `줄 바꿈 ${seq}`)
  })

  test('★ 대소문자를 무시하고 겹치지 않는다 · 지운 그룹의 이름은 다시 쓸 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const name = unique('Design')
    const first = await createGroup(fx.owner.ctx, name)
    assert.ok(first.ok)
    assert.deepEqual(await createGroup(fx.owner.ctx, name.toUpperCase()), { ok: false, reason: 'duplicate_name' })

    const second = await newGroup('다른 그룹')
    assert.deepEqual(await renameGroup(fx.owner.ctx, second, name.toLowerCase()), { ok: false, reason: 'duplicate_name' })
    assert.ok((await renameGroup(fx.owner.ctx, first.value.id, name)).ok, '자기 이름으로 바꾸기는 된다')

    assert.ok((await deleteGroup(fx.owner.ctx, first.value.id)).ok)
    const again = await createGroup(fx.owner.ctx, name)
    assert.ok(again.ok, '지운 그룹이 이름을 붙잡았다')
    assert.ok((await renameGroup(fx.owner.ctx, second, unique(name))).ok)
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 지우기', () => {
  test('★ 멤버는 못 보게 되고 그룹의 행이 사라진다 · 사람에게 준 것은 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const dana = await member('데이나')
    const erin = await member('에린')
    const group = await newGroup()
    const root = await privatePage('루트')
    const child = await privatePage('그룹이 받은 하위 페이지', root)
    await share(child, group)
    assert.ok((await grantAccess(fx.owner.ctx, child, { type: 'user', id: erin.userId }, 'view')).ok)
    await put(group, dana)
    assert.equal(await scopeOf(child), child, '전제: 행을 받은 하위 페이지는 스코프 경계다')
    assert.equal(await canViewPage(dana.ctx, child), true, '전제: 그룹 멤버는 본다')

    const deleted = await deleteGroup(fx.owner.ctx, group)
    assert.deepEqual(deleted, { ok: true, value: { nodes: 1 } })

    assert.equal(await groupRows(group), 0, '그룹의 ACL 행이 남았다')
    assert.equal(await canViewPage(dana.ctx, child), false, '지운 그룹의 멤버가 아직 본다')
    assert.equal(await canViewPage(erin.ctx, child), true, '사람에게 준 부여는 남는다')

    // 에린의 행이 남아 경계는 그대로다. 에린의 행까지 걷으면 행이 없는 하위 페이지가 부모의 스코프로 돌아가야 한다.
    assert.equal(await scopeOf(child), child)
  })

  test('★ 행이 그룹 것뿐이던 페이지는 경계가 풀려 부모의 스코프로 돌아간다 — 안 풀리면 소유자의 목록에서 사라진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const group = await newGroup()
    const root = await privatePage('루트')
    const child = await privatePage('그룹만 받은 하위 페이지', root)
    await share(child, group)
    assert.equal(await scopeOf(child), child)

    assert.ok((await deleteGroup(fx.owner.ctx, group)).ok)
    assert.equal(await scopeOf(child), root)
    assert.deepEqual(await sees(fx.owner, child, root), { judged: true, listed: true })
  })

  test('★ 관리할 사람이 남지 않는 페이지가 생기면 would_orphan — 그룹도 행도 그대로다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const group = await newGroup('관리자 그룹')
    await put(group, fx.owner)
    const page = (await createPage(fx.owner.ctx, { title: titleFromPlainText('그룹만 관리하는 페이지') })).id
    assert.ok((await stopInheriting(fx.owner.ctx, page)).ok)
    await share(page, group, 'full_access')
    assert.ok((await revokeAccess(fx.owner.ctx, page, { type: 'workspace_everyone' })).ok)
    const access = await listAccess(fx.owner.ctx, page)
    assert.ok(access.ok)
    assert.deepEqual(
      access.value.map((e) => e.principalType),
      ['group'],
      '전제: 이 페이지를 관리할 수 있는 것은 그룹 하나다',
    )

    assert.deepEqual(await deleteGroup(fx.owner.ctx, group), { ok: false, reason: 'would_orphan', nodes: 1 })
    assert.equal(await groupRows(group), 1)
    const listed = await listGroups(fx.owner.ctx)
    assert.ok(listed.ok && listed.value.some((g) => g.id === group), '거부됐는데 그룹이 지워졌다')
    assert.ok(can(await capsOf(fx.owner, page), 'manage_perm'))
  })

  test('앱을 거치지 않고 지운 그룹(행이 남았다)도 판정은 보지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const gil = await member('길')
    const group = await newGroup()
    const page = await privatePage('SQL 로 지울 그룹의 페이지')
    await share(page, group)
    await put(group, gil)
    assert.deepEqual(await sees(gil, page), { judged: true, listed: true }, '전제')

    await query(`UPDATE "group" SET deleted_at = now() WHERE id = $1`, [group])
    assert.equal(await groupRows(group), 1, '전제: 부여 행은 남아 있다')
    assert.deepEqual(await sees(gil, page), { judged: false, listed: false })
  })

  test('지운 그룹 · 남의 그룹에는 줄 수 없다 — invalid_principal', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const page = await privatePage('줄 곳')
    const gone = await newGroup()
    assert.ok((await deleteGroup(fx.owner.ctx, gone)).ok)
    const other = await makeFixture()
    const theirs = await createGroup(other.owner.ctx, '남의 그룹')
    assert.ok(theirs.ok)

    for (const id of [gone, theirs.value.id, '00000000-0000-4000-8000-000000000000']) {
      assert.deepEqual(await grantAccess(fx.owner.ctx, page, { type: 'group', id }, 'view'), {
        ok: false,
        reason: 'invalid_principal',
      })
    }
    const access = await listAccess(fx.owner.ctx, page)
    assert.ok(access.ok)
    assert.equal(access.value.some((e) => e.principalType === 'group'), false)
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

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
const aclEpoch = async (workspaceId: string): Promise<number> =>
  Number((await queryOne<{ e: string }>(`SELECT acl_epoch::text AS e FROM workspace WHERE id = $1`, [workspaceId])).e)

describe('⑧ 세대 · 신호', () => {
  test('★ 넣기 · 빼기는 세대를 올리고 신호를 보낸다 · 이름 바꾸기와 이미 있는 멤버 넣기는 아무것도 보내지 않는다 · SQL 로 지운 그룹도 보낸다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    // 이 워크스페이스의 신호만 센다 — 신호는 DB 전체에서 온다.
    const own = await makeFixture()
    const frank = await joinAs(own.workspaceId, await createUser('프랭크'), 'member')
    const created = await createGroup(own.owner.ctx, '신호 그룹')
    assert.ok(created.ok)
    const group = created.value.id
    const heard = await listenTo(t, own.workspaceId)

    const [gen0, epoch0] = [await permGen(frank.userId), await aclEpoch(own.workspaceId)]
    assert.ok((await addGroupMember(own.owner.ctx, group, frank.userId)).ok)
    await waitFor('넣기의 신호', () => heard() >= 1)
    assert.deepEqual([await permGen(frank.userId), await aclEpoch(own.workspaceId)], [gen0 + 1, epoch0 + 1])

    // 아무것도 바꾸지 않는 둘. 신호는 커밋 순서대로 오므로, 뒤의 빼기 신호가 도착했을 때 둘째가 아니면 이 둘 중 하나가 보낸 것이다.
    assert.ok((await renameGroup(own.owner.ctx, group, '새 이름')).ok)
    assert.ok((await addGroupMember(own.owner.ctx, group, frank.userId)).ok)
    assert.deepEqual([await permGen(frank.userId), await aclEpoch(own.workspaceId)], [gen0 + 1, epoch0 + 1])

    assert.ok((await removeGroupMember(own.owner.ctx, group, frank.userId)).ok)
    await waitFor('빼기의 신호', () => heard() >= 2)
    assert.equal(heard(), 2, '이름 바꾸기 · 이미 있는 멤버 넣기가 신호를 보냈다')
    assert.deepEqual([await permGen(frank.userId), await aclEpoch(own.workspaceId)], [gen0 + 2, epoch0 + 2])

    // 앱을 거치지 않고 지운 그룹 — 판정은 지운 그룹을 보지 않으므로 권한이 바뀐다. 알리기를 빠뜨리지 않는다(0027 ③).
    assert.ok((await addGroupMember(own.owner.ctx, group, frank.userId)).ok)
    await waitFor('다시 넣기의 신호', () => heard() >= 3)
    await query(`UPDATE "group" SET deleted_at = now() WHERE id = $1`, [group])
    await waitFor('지우기의 신호', () => heard() >= 4)
    assert.equal(await permGen(frank.userId), gen0 + 4, '지운 그룹의 멤버 세대가 오르지 않았다')
  })
})
