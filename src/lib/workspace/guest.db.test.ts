/**
 * 게스트를 들인다 — Teamspace · 게스트 · 그룹 7d-1조각 (F-06-09 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 계정 있는 외부 사람을 게스트로 — 곧바로 들어와 그 페이지와 하위만 본다 · 좌석을 안 쓴다 · 기본 teamspace 에 안 들어간다
 *   ② ★ 부여가 거부되면 멤버십도 남지 않는다 · 공유할 수 없는 사람에게는 계정이 있는지도 말하지 않는다
 *   ③ 이미 멤버면 역할을 건드리지 않는다 · 이미 게스트면 부여만 · 떠난 사람은 게스트로 돌아온다 · 멈춘 사람은 못 들인다
 *   ④ 이메일 — 검증된 주소만 계정으로 친다 · 대소문자 무시 · 별칭 · 모양
 *   ⑤ ★ 게스트의 레벨은 편집까지 — 초대도 공유 패널의 부여도 · 게스트는 다른 게스트를 들이지 못한다
 *   ⑥ (7d-2) ★ 공유의 사용자 주체는 이 워크스페이스의 사람이다 · ★ 게스트는 `@` 의 사람 후보를 받지 않는다
 *      (공유 패널 · 코멘트 · 홈의 목록은 라우트가 좁힌다 — e2e 가 본다)
 *   ⑦ (7d-3) ★ 목록(받은 페이지 수) · ★ 멤버로 올리기(공유 그대로 · 전체 · 기본 teamspace · 좌석) · ★ 빼기(공유를 모두 걷는다)
 *   ⑧ (7g-1) ★ 계정이 없으면 대기 초대 — (페이지, 이메일)마다 하나 · 다시 초대하면 레벨 · 토큰을 새로 쓴다 · 멤버 초대가 건드리지
 *      않는다 · ★ 가입해 받아들이면 멤버십 → 부여를 한 번에 · ★ 초대한 사람이 이제 공유할 수 없거나 페이지가 휴지통이면 받지 못하고
 *      아무것도 안 바뀐다 · 이미 멤버면 역할 그대로 · 멈춘 사람 · 다른 이메일 · 권한을 낮추지 않는다
 *      · owner · membership_admin 만
 *
 * 워크스페이스마다 새로 만든다 — 좌석 · 멤버 수를 정확히 센다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { searchMentionCandidates } from '../block/mention-candidates.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { canViewPage } from '../permissions/effective.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage, listGuests, promoteGuest, removeGuest } from './guest.ts'
import { acceptInvite, createEmailInvite, previewInvite } from './invite.ts'
import { createTeamspace, setDefaultTeamspace } from './teamspace.ts'

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

// ── 도우미 ────────────────────────────────────────────────────────────

let seq = 0
const unique = (name: string): string => `${name} ${(seq += 1)}`

async function office() {
  const ws = await createBareWorkspace('게스트')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  return { ws, boss, person }
}

const page = async (by: Actor, where: { parentPageId?: BlockId; privateTop?: true } = {}) =>
  (await createPage(by.ctx, { ...where, title: titleFromPlainText(unique('문서')) })).id

const membershipOf = async (ws: string, userId: string) =>
  (
    await query<{ role: string; status: string }>(`SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      userId,
    ])
  )[0] ?? null

const flatten = (nodes: readonly PageTreeNode[]): string[] => nodes.flatMap((n) => [n.id, ...flatten(n.children)])

const seats = async (ws: string) =>
  Number((await query<{ seats: string }>(`SELECT seats FROM workspace_seat_count WHERE workspace_id = $1`, [ws]))[0]?.seats ?? 0)

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 계정 있는 외부 사람을 게스트로', () => {
  test('★ 곧바로 들어와 그 페이지와 하위만 본다 · 좌석을 안 쓴다 · 기본 teamspace 에 안 들어간다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const shared = await page(boss)
    const child = await page(boss, { parentPageId: shared })
    const other = await page(boss)
    const everyone = await createTeamspace(boss.ctx, { name: unique('전사') })
    assert.ok(everyone.ok)
    assert.ok((await setDefaultTeamspace(boss.ctx, everyone.value.id, true)).ok)
    const seatsBefore = await seats(ws)

    const outsider = await createUser('바깥 사람')
    const gen = async () => (await queryOne<{ perm_gen: string }>(`SELECT perm_gen FROM "user" WHERE id = $1`, [outsider.userId])).perm_gen
    const genBefore = await gen()
    const invited = await inviteGuestToPage(boss.ctx, shared, outsider.email, 'comment')
    assert.deepEqual(invited, { ok: true, value: { userId: outsider.userId, as: 'guest', joined: true } })
    assert.deepEqual(await membershipOf(ws, outsider.userId), { role: 'guest', status: 'active' })
    assert.notEqual(await gen(), genBefore, '멤버십이 생겼는데 권한 세대가 그대로다 — 캐시가 옛 답을 준다(정본 §3.11)')

    const guest = await joinAs(ws, outsider, 'guest') // 세션만 받는다 — 역할은 이미 guest 다
    assert.equal(await canViewPage(guest.ctx, shared), true)
    assert.equal(await canViewPage(guest.ctx, child), true, '하위 페이지를 못 본다')
    assert.equal(await canViewPage(guest.ctx, other), false, '공유하지 않은 페이지가 보인다')
    assert.deepEqual(flatten(await listPageTree(guest.ctx)).sort(), [shared, child].sort())
    assert.equal(await seats(ws), seatsBefore, '게스트가 좌석을 썼다(M2)')
    const inDefault = await query(
      `SELECT 1 FROM teamspace_member WHERE teamspace_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [everyone.value.id, outsider.userId],
    )
    assert.equal(inDefault.length, 0, '게스트가 기본 teamspace 에 들어갔다')
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 거부 — 멤버십이 남지 않는다 · 계정 유무를 흘리지 않는다', () => {
  test('★ 공유할 수 없는 사람의 초대는 forbidden 이고 그 사람은 워크스페이스에 들어오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const editor = await person('편집자')
    // 대표의 개인 페이지 — 대표만 전체 권한이고, 편집자는 받은 레벨(편집 — 공유 없음)만 갖는다.
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: editor.userId }, 'edit')).ok)

    const outsider = await createUser('들어오면 안 될 사람')
    assert.deepEqual(await inviteGuestToPage(editor.ctx, doc, outsider.email, 'view'), { ok: false, reason: 'forbidden' })
    assert.equal(await membershipOf(ws, outsider.userId), null, '거부됐는데 멤버십이 남았다')
  })

  test('★ 공유할 수 없는 사람에게는 계정이 있는지 없는지 말하지 않는다 — 볼 수 없으면 not_found · 볼 수만 있으면 forbidden', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person } = await office()
    const viewer = await person('보기만')
    const stranger = await person('못 보는 사람')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    const nobody = `없는-${randomUUID()}@example.com`

    assert.deepEqual(await inviteGuestToPage(viewer.ctx, doc, nobody, 'view'), { ok: false, reason: 'forbidden' })
    assert.deepEqual(await inviteGuestToPage(stranger.ctx, doc, nobody, 'view'), { ok: false, reason: 'not_found' })
    // 계정이 없으면 대기 초대를 남긴다(7g-1) — 게이트를 지난 사람에게만(위 둘은 계정 유무를 모른 채 거부됐다).
    const pending = await inviteGuestToPage(boss.ctx, doc, nobody, 'view')
    assert.ok(pending.ok && pending.value.as === 'pending', JSON.stringify(pending))
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 이미 있는 사람', () => {
  test('이미 멤버면 역할을 건드리지 않는다 · 이미 게스트면 부여만 · 떠난 사람은 게스트로 돌아온다 · 멈춘 사람은 못 들인다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const doc = await page(boss)
    const second = await page(boss)

    const mate = await person('동료')
    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, mate.email, 'view'), {
      ok: true,
      value: { userId: mate.userId, as: 'member', joined: false },
    })
    assert.deepEqual(await membershipOf(ws, mate.userId), { role: 'member', status: 'active' }, '멤버를 게스트로 내렸다')

    const outsider = await createUser('두 번 받는 손님')
    assert.ok((await inviteGuestToPage(boss.ctx, doc, outsider.email, 'view')).ok)
    assert.deepEqual(await inviteGuestToPage(boss.ctx, second, outsider.email, 'edit'), {
      ok: true,
      value: { userId: outsider.userId, as: 'guest', joined: false },
    })

    const leaver = await person('떠난 사람')
    await query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [
      ws,
      leaver.userId,
    ])
    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, leaver.email, 'view'), {
      ok: true,
      value: { userId: leaver.userId, as: 'guest', joined: true },
    })
    assert.deepEqual(await membershipOf(ws, leaver.userId), { role: 'guest', status: 'active' })

    const paused = await person('멈춘 사람')
    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [ws, paused.userId])
    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, paused.email, 'view'), { ok: false, reason: 'unavailable' })
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 이메일', () => {
  test('검증된 주소만 계정으로 친다(미검증 주소는 누구나 등록한다) · 대소문자 무시 · 검증된 별칭도 찾는다 · 모양이 아니면 invalid_email', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss } = await office()
    const doc = await page(boss)
    const owner = await createUser('별칭 주인')
    const alias = `별칭-${randomUUID().slice(0, 8)}@example.com`
    const unverified = `미검증-${randomUUID().slice(0, 8)}@example.com`
    await query(
      `INSERT INTO user_email (id, user_id, email, verified_at, is_primary, added_at)
       VALUES ($1, $3, $2, now(), false, now()), ($4, $3, $5, NULL, false, now())`,
      [randomUUID(), alias, owner.userId, randomUUID(), unverified],
    )

    const toUnverified = await inviteGuestToPage(boss.ctx, doc, unverified, 'view')
    assert.ok(toUnverified.ok && toUnverified.value.as === 'pending', '미검증 주소를 계정으로 쳤다 — 대기 초대여야 한다')
    const byAlias = await inviteGuestToPage(boss.ctx, doc, `  ${alias.toUpperCase()} `, 'view')
    assert.ok(byAlias.ok && byAlias.value.userId === owner.userId, JSON.stringify(byAlias))
    for (const bad of ['', '이메일', 'a b@c.d', 42]) {
      assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, bad, 'view'), { ok: false, reason: 'invalid_email' }, String(bad))
    }
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 게스트의 레벨은 편집까지', () => {
  test('★ 초대도 공유 패널의 부여도 전체 권한을 거부한다 · 멤버에게는 준다 · 게스트는 다른 게스트를 들이지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const doc = await page(boss)
    const outsider = await createUser('편집까지 손님')

    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, outsider.email, 'full_access'), { ok: false, reason: 'invalid_level' })
    assert.ok((await inviteGuestToPage(boss.ctx, doc, outsider.email, 'edit')).ok)
    assert.deepEqual(await grantAccess(boss.ctx, doc, { type: 'user', id: outsider.userId }, 'full_access'), {
      ok: false,
      reason: 'guest_level',
    })
    const level = await queryOne<{ level: string }>(
      `SELECT level FROM acl_entry WHERE node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [doc, outsider.userId],
    )
    assert.equal(level.level, 'edit', '거부됐는데 레벨이 바뀌었다')
    const mate = await person('전체 권한 받을 멤버')
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: mate.userId }, 'full_access')).ok, '멤버의 전체 권한까지 막았다')

    // 편집까지인 게스트는 공유를 바꿀 수 없다 — 다른 게스트를 들이지 못한다(F-06-09 의 순환).
    const guest = await joinAs(ws, outsider, 'guest')
    const another = await createUser('손님의 손님')
    assert.deepEqual(await inviteGuestToPage(guest.ctx, doc, another.email, 'view'), { ok: false, reason: 'forbidden' })
    assert.equal(await membershipOf(ws, another.userId), null)
  })
})

// ── ⑥ 7d-2 — 공유의 사용자 주체 · 게스트가 받는 이름 ──────────────────

describe('⑥ 공유의 사용자 주체는 이 워크스페이스의 사람이다 (7d-2)', () => {
  test('★ 처음 보는 사람 · 초대만 받은 사람 · 떠난 사람에게는 줄 수 없다(invalid_principal) · 멤버 · 게스트 · 멈춘 사람에게는 준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const doc = await page(boss)
    const give = (userId: string) => grantAccess(boss.ctx, doc, { type: 'user', id: userId }, 'view')

    const stranger = await createUser('처음 보는 사람')
    const invitedOnly = await createUser('초대만 받은 사람')
    await query(`INSERT INTO workspace_member (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'invited')`, [
      ws,
      invitedOnly.userId,
    ])
    const leaver = await person('떠난 사람')
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [ws, leaver.userId])
    for (const who of [stranger.userId, invitedOnly.userId, leaver.userId, randomUUID()]) {
      assert.deepEqual(await give(who), { ok: false, reason: 'invalid_principal' }, who)
    }
    const rows = await query(`SELECT 1 FROM acl_entry WHERE node_id = $1 AND principal_type = 'user'`, [doc])
    assert.equal(rows.length, 0, '거부됐는데 행이 남았다')

    const mate = await person('동료')
    const paused = await person('멈춘 동료')
    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [ws, paused.userId])
    const outsider = await createUser('손님')
    assert.ok((await inviteGuestToPage(boss.ctx, doc, outsider.email, 'view')).ok, '게스트 초대가 새 규칙에 막혔다 — 멤버십이 부여보다 먼저여야 한다')
    for (const who of [mate.userId, paused.userId, outsider.userId]) {
      assert.deepEqual(await give(who), { ok: true }, who)
    }
  })

  test('★ 게스트는 `@` 의 사람 후보를 받지 않는다 — 페이지 후보는 볼 수 있는 것만 · 멤버는 사람을 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    await person('후보가 될 동료')
    const shared = await page(boss)
    const outsider = await createUser('후보를 보는 손님')
    assert.ok((await inviteGuestToPage(boss.ctx, shared, outsider.email, 'view')).ok)
    const guest = await joinAs(ws, outsider, 'guest')

    const forGuest = await searchMentionCandidates(guest.ctx, '')
    assert.deepEqual(forGuest.filter((c) => c.kind === 'user'), [], '게스트에게 사람 후보가 갔다 — 멤버 목록이 샌다')
    assert.ok(forGuest.some((c) => c.kind === 'page' && c.id === shared), '게스트가 받은 페이지가 후보에 없다')
    const forBoss = await searchMentionCandidates(boss.ctx, '')
    assert.ok(forBoss.some((c) => c.kind === 'user'), '멤버에게서 사람 후보까지 사라졌다')
  })
})

// ── ⑦ 7d-3 — owner 의 게스트 관리 ──────────────────────────────────────

describe('⑦ 게스트 관리 — 목록 · 멤버로 올리기 · 빼기 (7d-3)', () => {
  /** 사무실 하나에 게스트 하나 — 페이지 둘을 받았다. */
  async function withGuest() {
    const o = await office()
    const first = await page(o.boss)
    const second = await page(o.boss)
    const outsider = await createUser('관리될 손님')
    assert.ok((await inviteGuestToPage(o.boss.ctx, first, outsider.email, 'view')).ok)
    assert.ok((await inviteGuestToPage(o.boss.ctx, second, outsider.email, 'comment')).ok)
    const guest = await joinAs(o.ws, outsider, 'guest')
    return { ...o, first, second, outsider, guest }
  }

  test('★ 목록 — 들어와 있는 게스트만 · 받은 페이지 수(휴지통은 빼고) · owner · membership_admin 만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person, second, outsider, guest } = await withGuest()
    const mate = await person('멤버는 목록에 없다')
    const gone = await createUser('떠난 손님')
    assert.ok((await inviteGuestToPage(boss.ctx, second, gone.email, 'view')).ok)
    await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [ws, gone.userId])

    const listed = await listGuests(boss.ctx)
    assert.ok(listed.ok)
    assert.deepEqual(
      listed.value.map((g) => [g.userId, g.pages]),
      [[outsider.userId, 2]],
    )
    assert.ok(!listed.value.some((g) => g.userId === mate.userId))

    assert.ok((await trashPage(boss.ctx, second)).ok !== false)
    const afterTrash = await listGuests(boss.ctx)
    assert.ok(afterTrash.ok && afterTrash.value[0]?.pages === 1, '휴지통 페이지까지 셌다')

    const admin = await person('멤버십 관리자', 'membership_admin')
    assert.ok((await listGuests(admin.ctx)).ok)
    for (const who of [mate, guest]) assert.deepEqual(await listGuests(who.ctx), { ok: false, reason: 'forbidden' })
  })

  test('★ 멤버로 올리면 받은 공유는 그대로 · 워크스페이스 전체를 본다 · 기본 teamspace 에 들어간다 · 좌석을 쓴다 · 전체 권한을 받을 수 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, first, outsider, guest } = await withGuest()
    const everyonePage = await page(boss) // 워크스페이스 최상위 — 모든 멤버가 본다
    const everyone = await createTeamspace(boss.ctx, { name: unique('전사') })
    assert.ok(everyone.ok)
    assert.ok((await setDefaultTeamspace(boss.ctx, everyone.value.id, true)).ok)
    assert.equal(await canViewPage(guest.ctx, everyonePage), false, '전제 — 게스트는 모든 멤버의 페이지를 못 본다')
    const seatsBefore = await seats(ws)

    assert.deepEqual(await promoteGuest(boss.ctx, outsider.userId), { ok: true, value: { teamspaces: 1 } })
    const row = await queryOne<{ role: string; join_method: string }>(
      `SELECT role, join_method FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [ws, outsider.userId],
    )
    assert.deepEqual(row, { role: 'member', join_method: 'guest_upgrade' })
    const member = await joinAs(ws, outsider, 'member')
    assert.equal(await canViewPage(member.ctx, first), true, '받은 공유가 사라졌다')
    assert.equal(await canViewPage(member.ctx, everyonePage), true, '올렸는데 워크스페이스 전체를 못 본다')
    assert.equal(await seats(ws), seatsBefore + 1, '멤버가 됐는데 좌석을 안 쓴다(M2)')
    assert.deepEqual(await grantAccess(boss.ctx, first, { type: 'user', id: outsider.userId }, 'full_access'), { ok: true })

    // 이미 멤버 · 처음 보는 사람은 게스트가 아니다.
    assert.deepEqual(await promoteGuest(boss.ctx, outsider.userId), { ok: false, reason: 'not_found' })
    assert.deepEqual(await promoteGuest(boss.ctx, randomUUID()), { ok: false, reason: 'not_found' })
  })

  test('★ 빼면 받은 공유가 모두 걷힌다 — 다시 초대해도 옛 페이지는 돌아오지 않는다 · 권한 세대가 오른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, first, second, outsider } = await withGuest()
    const gen = async () => (await queryOne<{ perm_gen: string }>(`SELECT perm_gen FROM "user" WHERE id = $1`, [outsider.userId])).perm_gen
    const genBefore = await gen()

    assert.deepEqual(await removeGuest(boss.ctx, outsider.userId), { ok: true, value: { pages: 2 } })
    assert.deepEqual(await membershipOf(ws, outsider.userId), { role: 'guest', status: 'removed' })
    const rows = await query(`SELECT 1 FROM acl_entry WHERE principal_type = 'user' AND principal_id = $1`, [outsider.userId])
    assert.equal(rows.length, 0, '뺐는데 공유 행이 남았다')
    assert.notEqual(await gen(), genBefore, '멤버십이 바뀌었는데 권한 세대가 그대로다')

    const third = await page(boss)
    assert.ok((await inviteGuestToPage(boss.ctx, third, outsider.email, 'view')).ok)
    const back = await joinAs(ws, outsider, 'guest')
    assert.equal(await canViewPage(back.ctx, third), true)
    for (const old of [first, second]) {
      assert.equal(await canViewPage(back.ctx, old), false, '다시 초대받자 옛 페이지가 돌아왔다')
    }
  })

  test('게스트 관리는 owner · membership_admin 만 — 멤버와 게스트는 forbidden · 게스트가 아닌 사람은 not_found', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, outsider, guest } = await withGuest()
    const mate = await person('못 다루는 멤버')
    for (const who of [mate, guest]) {
      assert.deepEqual(await promoteGuest(who.ctx, outsider.userId), { ok: false, reason: 'forbidden' })
      assert.deepEqual(await removeGuest(who.ctx, outsider.userId), { ok: false, reason: 'forbidden' })
    }
    assert.deepEqual(await removeGuest(boss.ctx, mate.userId), { ok: false, reason: 'not_found' }, '멤버를 게스트 빼기로 뺐다')
  })
})

// ── ⑧ 게스트의 대기 초대 (7g-1) ───────────────────────────────────────

describe('⑧ 계정이 없는 이메일 — 대기 초대', () => {
  const newEmail = () => `가입-전-${randomUUID().slice(0, 8)}@example.com`

  /** 그 이메일로 가입한 사람 — 계정을 만들고 대표 주소를 그 이메일로(검증됨) 바꾼다. */
  async function signUp(email: string, name = '새로 가입한 사람') {
    const user = await createUser(name)
    await query(`UPDATE user_email SET email = $2 WHERE user_id = $1 AND is_primary`, [user.userId, email])
    return { ...user, email }
  }

  async function pend(by: Actor, doc: string, email: string, level: 'view' | 'comment' | 'edit') {
    const result = await inviteGuestToPage(by.ctx, doc, email, level)
    assert.ok(result.ok && result.value.as === 'pending', JSON.stringify(result))
    if (!result.ok || result.value.as !== 'pending') throw new Error('unreachable')
    return result.value.token
  }

  const invitesOf = (doc: string) =>
    query<{ role: string; page_level: string; kind: string; accepted_at: Date | null }>(
      `SELECT role, page_level, kind, accepted_at FROM workspace_invite WHERE page_id = $1 ORDER BY created_at`,
      [doc],
    )

  const directLevel = async (doc: string, userId: string) =>
    (
      await query<{ level: string }>(
        `SELECT level FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
        [doc, userId],
      )
    )[0]?.level ?? null

  test('★ 대기 초대는 (페이지, 이메일)마다 하나 — 다시 초대하면 레벨 · 토큰을 새로 쓰고 옛 링크는 죽는다 · 멤버 초대가 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const doc = await page(boss, { privateTop: true })
    const email = newEmail()

    const first = await pend(boss, doc, email, 'view')
    const second = await pend(boss, doc, email, 'comment')
    assert.deepEqual(
      (await invitesOf(doc)).map((r) => [r.role, r.page_level, r.kind]),
      [['guest', 'comment', 'email']],
    )
    assert.equal(await previewInvite(first), null, '다시 초대했는데 옛 링크가 산다')
    assert.equal((await previewInvite(second))?.role, 'guest')

    const member = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email, role: 'member' })
    assert.ok(member.ok)
    assert.deepEqual(
      (await invitesOf(doc)).map((r) => [r.role, r.page_level]),
      [['guest', 'comment']],
      '멤버 초대가 게스트 초대를 멤버 초대로 바꿨다',
    )
  })

  test('★ 가입해 받아들이면 게스트로 들어와 그 페이지만 본다 — 멤버십과 부여를 한 번에 · 다시 받아들이지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const doc = await page(boss, { privateTop: true })
    const other = await page(boss, { privateTop: true })
    const email = newEmail()
    const token = await pend(boss, doc, email, 'comment')
    const newcomer = await signUp(email)

    assert.deepEqual(await acceptInvite(token, newcomer.userId), { ok: true, workspaceId: ws, role: 'guest', pageId: doc })
    assert.deepEqual(await membershipOf(ws, newcomer.userId), { role: 'guest', status: 'active' })
    assert.equal(await directLevel(doc, newcomer.userId), 'comment')
    const guest = await joinAs(ws, newcomer, 'guest')
    assert.equal(await canViewPage(guest.ctx, doc), true)
    assert.equal(await canViewPage(guest.ctx, other), false, '초대받지 않은 페이지가 보인다')
    assert.ok((await invitesOf(doc))[0]?.accepted_at, '받아들였는데 초대가 열려 있다')
    assert.deepEqual(await acceptInvite(token, newcomer.userId), { ok: false, reason: 'invalid' })
  })

  test('★ 초대한 사람이 이제 공유할 수 없으면 · 페이지가 휴지통이면 받지 못한다 — 멤버십도 부여도 남지 않고 초대는 열려 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const helper = await person('공동 관리자')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: helper.userId }, 'full_access')).ok)
    const email = newEmail()
    const token = await pend(helper, doc, email, 'view')
    const newcomer = await signUp(email)
    assert.ok((await revokeAccess(boss.ctx, doc, { type: 'user', id: helper.userId })).ok)

    assert.deepEqual(await acceptInvite(token, newcomer.userId), { ok: false, reason: 'page_unavailable' })
    assert.equal(await membershipOf(ws, newcomer.userId), null, '받지 못했는데 멤버십이 남았다')
    assert.equal(await directLevel(doc, newcomer.userId), null)
    assert.equal((await invitesOf(doc))[0]?.accepted_at, null)

    const trashed = await page(boss, { privateTop: true })
    const email2 = newEmail()
    const token2 = await pend(boss, trashed, email2, 'view')
    const newcomer2 = await signUp(email2, '둘째 가입자')
    await trashPage(boss.ctx, trashed as BlockId)
    assert.deepEqual(await acceptInvite(token2, newcomer2.userId), { ok: false, reason: 'page_unavailable' })
    assert.equal(await membershipOf(ws, newcomer2.userId), null)
  })

  test('이미 멤버면 역할 그대로 부여만 · 권한을 낮추지 않는다 · 멈춘 사람은 받지 못한다 · 다른 이메일의 계정은 받지 못한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const doc = await page(boss, { privateTop: true })

    // 초대할 때는 계정이 없었고, 그 뒤에 다른 길로 멤버가 됐다.
    const email = newEmail()
    const token = await pend(boss, doc, email, 'view')
    const signed = await signUp(email, '나중에 멤버가 된 사람')
    await joinAs(ws, signed, 'member')
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: signed.userId }, 'edit')).ok)
    assert.deepEqual(await acceptInvite(token, signed.userId), { ok: true, workspaceId: ws, role: 'member', pageId: doc })
    assert.deepEqual(await membershipOf(ws, signed.userId), { role: 'member', status: 'active' }, '멤버를 게스트로 내렸다')
    assert.equal(await directLevel(doc, signed.userId), 'edit', '초대의 읽기가 편집을 낮췄다')

    const email2 = newEmail()
    const token2 = await pend(boss, doc, email2, 'view')
    const paused = await signUp(email2, '멈춘 사람')
    await joinAs(ws, paused, 'member')
    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [ws, paused.userId])
    assert.deepEqual(await acceptInvite(token2, paused.userId), { ok: false, reason: 'unavailable' })
    assert.equal(await directLevel(doc, paused.userId), null)

    const token3 = await pend(boss, doc, newEmail(), 'view')
    const stranger = await person('다른 이메일')
    assert.deepEqual(await acceptInvite(token3, stranger.userId), { ok: false, reason: 'email_mismatch' })
  })
})
