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
 *
 * 워크스페이스마다 새로 만든다 — 좌석 · 멤버 수를 정확히 센다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { searchMentionCandidates } from '../block/mention-candidates.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { listPageTree, type PageTreeNode } from '../block/page-tree.ts'
import { query, queryOne } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { grantAccess } from '../permissions/acl.ts'
import { canViewPage } from '../permissions/effective.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage } from './guest.ts'
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
    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, nobody, 'view'), { ok: false, reason: 'no_account' })
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

    assert.deepEqual(await inviteGuestToPage(boss.ctx, doc, unverified, 'view'), { ok: false, reason: 'no_account' })
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
