/**
 * 워크스페이스 밖의 사람의 접근 요청 — Teamspace · 게스트 · 그룹 7g-2조각 (F-06-15 · DB)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 밖의 사람의 신원 — 멤버십이 없거나 떠난 사람만 · 멤버 · 멈춘 · 초대만 받은 사람 · 폐기된 세션 · 지운 계정은 아니다
 *   ② ★ 요청 화면 — 살아 있는 페이지에서만 · 휴지통 · 다른 워크스페이스 · 없는 id · 없는 워크스페이스 · 보관된 teamspace ·
 *      정책이 끈 워크스페이스는 null(404)
 *   ③ ★ 요청 — 대기 중인 요청 하나 · 관리자에게 알림 · 다시 눌러도 하나 · 정책이 끄면 not_found 이고 아무것도 쓰지 않는다
 *   ④ ★ 목록 — "워크스페이스 밖" · 이메일 · 게스트 레벨 · 정책을 끄면 빠지고 켜면 돌아온다
 *   ⑤ ★ 허락하면 게스트로 들어온다 — 멤버십(join_method access_request) → 부여 · 알림 · 이제 세션을 받고 그 페이지만 본다
 *   ⑥ ★ 전체 권한을 고르면 guest_level — 멤버십도 부여도 남지 않고 요청은 대기로
 *   ⑦ 정책을 끄면 허락 · 무시할 수 없다(not_found) · 켜면 다시 된다
 *   ⑧ ★ 떠난 사람은 밖의 사람이다 — 게스트일 때 보낸 접근 요청이 밖의 요청으로 서고 허락하면 돌아온다 · 편집 요청은 서지 않는다
 *   ⑨ 무시하면 하루 동안 "보냈습니다" · 알리지 않는다
 *   ⑩ 정책 — owner 만 읽고 바꾼다 · 행이 없으면 기본값(켜짐) · 모양이 아니면 invalid_policy
 *   ⑪ 게스트를 들이는 길은 한 도우미 — 이메일 공유와 요청의 허락이 들어온 길만 다르게 남긴다 · 이미 이 워크스페이스의 사람은 들이지 않는다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { resolveOutsiderContext } from '../auth/outsider-context.ts'
import { resolveSessionContext } from '../auth/session-context.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { query, queryOne } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { asWorkspaceId, type BlockId, type WorkspaceId } from '../ids.ts'
import {
  createBareWorkspace,
  createUser,
  joinAs,
  probeDatabase,
  visitAsOutsider,
  type Actor,
} from '../testing/db-fixtures.ts'
import { admitGuestIn, inviteGuestToPage, removeGuest } from '../workspace/guest.ts'
import { getSecurityPolicy, updateSecurityPolicy } from '../workspace/security-policy.ts'
import { archiveTeamspace, createTeamspace } from '../workspace/teamspace.ts'
import {
  approveAccessRequest,
  ignoreAccessRequest,
  listAccessRequests,
  outsiderNoAccessState,
  requestAccessAsOutsider,
  requestEditAccess,
  requestPageAccess,
} from './access-request.ts'
import { grantAccess } from './acl.ts'
import { canViewPage } from './effective.ts'

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
  const ws = await createBareWorkspace('밖의 요청')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const person = async (name: string, role: Parameters<typeof joinAs>[2] = 'member') => joinAs(ws, await createUser(name), role)
  /** 이 워크스페이스에 멤버십이 없는 사람 — 로그인만 했다. */
  const stranger = async (name = '밖의 사람') => visitAsOutsider(ws, await createUser(name))
  return { ws, boss, person, stranger }
}

const page = async (by: Actor, where: { parentPageId?: BlockId; privateTop?: true } = {}) =>
  (await createPage(by.ctx, { ...where, title: titleFromPlainText(unique('문서')) })).id

const requestsOf = async (pageId: string) =>
  query<{ id: string; requester_id: string; kind: string; status: string }>(
    `SELECT id, requester_id, kind, status FROM access_request WHERE node_id = $1 ORDER BY created_at, id`,
    [pageId],
  )

const notified = async (pageId: string, kind: string) =>
  (
    await query<{ recipient_id: string }>(
      `SELECT recipient_id FROM notification WHERE page_id = $1 AND kind = $2 ORDER BY recipient_id`,
      [pageId, kind],
    )
  ).map((r) => r.recipient_id)

const directLevel = async (pageId: string, userId: string) =>
  (
    await query<{ level: string }>(
      `SELECT level FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 AND principal_type = 'user' AND principal_id = $2`,
      [pageId, userId],
    )
  )[0]?.level ?? null

const membershipOf = async (ws: string, userId: string) =>
  (
    await query<{ role: string; status: string; join_method: string | null; invited_by: string | null }>(
      `SELECT role, status, join_method, invited_by FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [ws, userId],
    )
  )[0] ?? null

const setPolicy = async (boss: Actor, allow: boolean) => {
  const saved = await updateSecurityPolicy(boss.ctx, { allowNonmemberPageAccessRequest: allow })
  assert.ok(saved.ok && saved.value.allowNonmemberPageAccessRequest === allow)
}

const removeFrom = (ws: string, userId: string) =>
  query(`UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, [ws, userId])

// ── ① ─────────────────────────────────────────────────────────────────

describe('① 밖의 사람의 신원', () => {
  test('멤버십이 없거나 떠난 사람만 — 멤버 · 멈춘 · 초대만 받은 사람 · 폐기된 세션 · 지운 계정은 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person, stranger } = await office()
    const outside = await stranger()
    assert.equal(outside.outsider.userId, outside.userId)
    assert.equal(outside.outsider.workspaceId, ws)
    assert.equal(await resolveOutsiderContext(boss.token, ws), null, '멤버가 밖의 사람이 됐다')

    const leaver = await person('떠난 사람')
    await removeFrom(ws, leaver.userId)
    assert.ok(await resolveOutsiderContext(leaver.token, ws), '떠난 사람은 밖의 사람이다')

    const paused = await person('멈춘 사람')
    await query(`UPDATE workspace_member SET status = 'suspended' WHERE workspace_id = $1 AND user_id = $2`, [ws, paused.userId])
    assert.equal(await resolveOutsiderContext(paused.token, ws), null, '멈춘 사람이 요청으로 돌아올 길이 생겼다')

    const invited = await person('초대만 받은 사람')
    await query(`UPDATE workspace_member SET status = 'invited' WHERE workspace_id = $1 AND user_id = $2`, [ws, invited.userId])
    assert.equal(await resolveOutsiderContext(invited.token, ws), null)

    const revoked = await stranger('세션을 닫은 사람')
    await query(`UPDATE user_session SET revoked_at = now() WHERE user_id = $1`, [revoked.userId])
    assert.equal(await resolveOutsiderContext(revoked.token, ws), null)

    const gone = await stranger('계정을 지운 사람')
    await query(`UPDATE "user" SET deleted_at = now() WHERE id = $1`, [gone.userId])
    assert.equal(await resolveOutsiderContext(gone.token, ws), null)

    assert.equal(await resolveOutsiderContext(null, ws), null)
    assert.equal(await resolveOutsiderContext('없는 토큰', ws), null)
  })
})

// ── ② ─────────────────────────────────────────────────────────────────

describe('② 요청 화면', () => {
  test('★ 살아 있는 페이지에서만 — 휴지통 · 다른 워크스페이스 · 없는 id · 없는 워크스페이스 · 보관된 teamspace 는 null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })
    const trashed = await page(boss, { privateTop: true })
    await trashPage(boss.ctx, trashed as BlockId)
    const elsewhere = await office()
    const foreign = await page(elsewhere.boss, { privateTop: true })
    const team = await createTeamspace(boss.ctx, { name: unique('닫힌 팀'), visibility: 'closed' })
    assert.ok(team.ok)
    const teamDoc = (await createPage(boss.ctx, { teamspaceId: team.value.id, title: titleFromPlainText(unique('팀 문서')) })).id

    assert.deepEqual(await outsiderNoAccessState(outside.outsider, doc), { requested: false })
    assert.deepEqual(await outsiderNoAccessState(outside.outsider, teamDoc), { requested: false }, '전제 — 보관 전')
    for (const id of [trashed, foreign, randomUUID()]) {
      assert.equal(await outsiderNoAccessState(outside.outsider, id), null, id)
    }
    assert.ok((await archiveTeamspace(boss.ctx, team.value.id)).ok)
    assert.equal(await outsiderNoAccessState(outside.outsider, teamDoc), null, '보관된 teamspace 의 페이지가 요청 화면을 낸다')

    // 없는 워크스페이스 — 그 사람에게는 멤버십이 없으니 신원은 나온다. 가르는 것은 페이지다(존재를 알리지 않는다).
    const nowhere = await visitAsOutsider(asWorkspaceId(randomUUID()) as WorkspaceId, { userId: outside.userId })
    assert.equal(await outsiderNoAccessState(nowhere.outsider, doc), null, '다른 워크스페이스 id 로 이 페이지의 요청 화면이 섰다')
    assert.equal((await query(`SELECT 1 FROM access_request WHERE workspace_id = $1`, [ws])).length, 0)
  })

  test('★ 정책이 끄면 null — 다시 켜면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })

    await setPolicy(boss, false)
    assert.equal(await outsiderNoAccessState(outside.outsider, doc), null, '정책이 껐는데 요청 화면이 선다')
    await setPolicy(boss, true)
    assert.deepEqual(await outsiderNoAccessState(outside.outsider, doc), { requested: false })
  })
})

// ── ③ ─────────────────────────────────────────────────────────────────

describe('③ 요청', () => {
  test('★ 대기 중인 요청 하나 · 관리자에게 알림 · 다시 눌러도 하나 · 볼 수는 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person, stranger } = await office()
    await person('구경꾼')
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })

    assert.deepEqual(await requestAccessAsOutsider(outside.outsider, doc), { ok: true, value: { sent: true } })
    assert.deepEqual(
      (await requestsOf(doc)).map((r) => [r.requester_id, r.kind, r.status]),
      [[outside.userId, 'page_access', 'pending']],
    )
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId])
    const event = await queryOne<{ actor_id: string; workspace_id: string }>(
      `SELECT actor_id, workspace_id FROM activity_event WHERE page_id = $1 AND type = 'access.requested'`,
      [doc],
    )
    assert.deepEqual([event.actor_id, event.workspace_id], [outside.userId, ws])
    assert.deepEqual(await outsiderNoAccessState(outside.outsider, doc), { requested: true })

    assert.deepEqual(await requestAccessAsOutsider(outside.outsider, doc), { ok: true, value: { sent: false } })
    assert.equal((await requestsOf(doc)).length, 1, '다시 눌렀더니 요청이 늘었다')
    assert.deepEqual(await notified(doc, 'access_requested'), [boss.userId], '다시 눌렀더니 알림이 또 갔다')
    assert.equal(await membershipOf(ws, outside.userId), null, '요청만으로 멤버십이 생겼다')
  })

  test('★ 정책이 끄면 not_found — 아무것도 쓰지 않는다 · 없는 페이지도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })

    await setPolicy(boss, false)
    assert.deepEqual(await requestAccessAsOutsider(outside.outsider, doc), { ok: false, reason: 'not_found' })
    await setPolicy(boss, true)
    assert.deepEqual(await requestAccessAsOutsider(outside.outsider, randomUUID()), { ok: false, reason: 'not_found' })
    assert.equal((await query(`SELECT 1 FROM access_request WHERE workspace_id = $1`, [ws])).length, 0)
    assert.deepEqual(await notified(doc, 'access_requested'), [])
  })
})

// ── ④ ─────────────────────────────────────────────────────────────────

describe('④ 목록', () => {
  test('★ "워크스페이스 밖" · 이메일 · 게스트 레벨 — 정책을 끄면 빠지고 켜면 돌아온다 · 공유할 수 없는 사람은 못 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { boss, person, stranger } = await office()
    const outside = await stranger()
    const member = await person('안의 사람')
    const viewer = await person('보기만')
    const doc = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, doc, { type: 'user', id: viewer.userId }, 'view')).ok)
    assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
    assert.ok((await requestPageAccess(member.ctx, doc)).ok)

    const listed = await listAccessRequests(boss.ctx, doc)
    assert.ok(listed.ok)
    const rows = listed.value.map((r) => [r.requesterId, r.outsider, r.guest])
    assert.deepEqual(rows, [
      [outside.userId, true, true],
      [member.userId, false, false],
    ])
    const email = await queryOne<{ email: string }>(`SELECT email::text FROM user_email WHERE user_id = $1 AND is_primary`, [outside.userId])
    assert.equal(listed.value[0]?.email, email.email, '허락하는 사람이 밖의 사람의 이메일을 못 본다')
    assert.deepEqual(await listAccessRequests(viewer.ctx, doc), { ok: false, reason: 'forbidden' })

    await setPolicy(boss, false)
    const off = await listAccessRequests(boss.ctx, doc)
    assert.ok(off.ok)
    assert.deepEqual(off.value.map((r) => r.requesterId), [member.userId], '정책을 껐는데 밖의 요청이 선다')
    await setPolicy(boss, true)
    const on = await listAccessRequests(boss.ctx, doc)
    assert.ok(on.ok)
    assert.equal(on.value.length, 2, '다시 켰는데 밖의 요청이 돌아오지 않는다')
  })
})

// ── ⑤ ─────────────────────────────────────────────────────────────────

describe('⑤ 허락', () => {
  test('★ 게스트로 들어온다 — 멤버십(access_request) → 부여 · 알림 · 이제 세션을 받고 그 페이지만 본다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })
    const other = await page(boss, { privateTop: true })
    assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
    const [request] = await requestsOf(doc)
    assert.ok(request)

    assert.deepEqual(await approveAccessRequest(boss.ctx, request.id, 'comment'), { ok: true, value: { granted: true } })
    assert.deepEqual(await membershipOf(ws, outside.userId), {
      role: 'guest',
      status: 'active',
      join_method: 'access_request',
      invited_by: boss.userId,
    })
    assert.equal(await directLevel(doc, outside.userId), 'comment')
    assert.deepEqual((await requestsOf(doc)).map((r) => r.status), ['approved'])
    assert.deepEqual(await notified(doc, 'access_granted'), [outside.userId])

    const session = await resolveSessionContext(outside.token, ws)
    assert.ok(session.ok, '허락받았는데 워크스페이스에 들어오지 못한다')
    assert.equal(session.context.role, 'guest')
    assert.equal(await canViewPage(session.context, doc), true)
    assert.equal(await canViewPage(session.context, other), false, '게스트가 받지 않은 페이지를 본다')
    assert.equal(await resolveOutsiderContext(outside.token, ws), null, '들어왔는데 여전히 밖의 사람이다')
  })
})

// ── ⑥ ─────────────────────────────────────────────────────────────────

describe('⑥ 허락의 한계', () => {
  test('★ 전체 권한은 guest_level — 멤버십도 부여도 남지 않고 요청은 대기로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })
    assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
    const [request] = await requestsOf(doc)
    assert.ok(request)

    assert.deepEqual(await approveAccessRequest(boss.ctx, request.id, 'full_access'), { ok: false, reason: 'guest_level' })
    assert.equal(await membershipOf(ws, outside.userId), null, '거부됐는데 멤버십이 남았다')
    assert.equal(await directLevel(doc, outside.userId), null)
    assert.deepEqual((await requestsOf(doc)).map((r) => r.status), ['pending'])
    assert.deepEqual(await notified(doc, 'access_granted'), [])
    assert.ok(await resolveOutsiderContext(outside.token, ws), '거부됐는데 밖의 사람이 아니게 됐다')
  })
})

// ── ⑦ ─────────────────────────────────────────────────────────────────

describe('⑦ 정책을 끄면', () => {
  test('허락 · 무시할 수 없다(not_found) — 켜면 다시 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })
    assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
    const [request] = await requestsOf(doc)
    assert.ok(request)

    await setPolicy(boss, false)
    assert.deepEqual(await approveAccessRequest(boss.ctx, request.id, 'view'), { ok: false, reason: 'not_found' })
    assert.deepEqual(await ignoreAccessRequest(boss.ctx, request.id), { ok: false, reason: 'not_found' })
    assert.equal(await membershipOf(ws, outside.userId), null)
    assert.deepEqual((await requestsOf(doc)).map((r) => r.status), ['pending'])

    await setPolicy(boss, true)
    assert.deepEqual(await approveAccessRequest(boss.ctx, request.id, 'view'), { ok: true, value: { granted: true } })
  })
})

// ── ⑧ ─────────────────────────────────────────────────────────────────

describe('⑧ 떠난 사람', () => {
  test('★ 게스트일 때 보낸 접근 요청이 밖의 요청으로 선다 · 허락하면 돌아온다 · 편집 요청은 서지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const guest = await person('손님', 'guest')
    const shared = await page(boss, { privateTop: true })
    const wanted = await page(boss, { privateTop: true })
    assert.ok((await grantAccess(boss.ctx, shared, { type: 'user', id: guest.userId }, 'view')).ok)
    assert.ok((await requestPageAccess(guest.ctx, wanted)).ok)
    assert.ok((await requestEditAccess(guest.ctx, shared)).ok)
    const [access] = await requestsOf(wanted)
    const [edit] = await requestsOf(shared)
    assert.ok(access && edit)

    assert.ok((await removeGuest(boss.ctx, guest.userId)).ok)
    const listed = await listAccessRequests(boss.ctx, wanted)
    assert.ok(listed.ok)
    assert.deepEqual(listed.value.map((r) => [r.requesterId, r.outsider]), [[guest.userId, true]])
    assert.deepEqual(await listAccessRequests(boss.ctx, shared), { ok: true, value: [] }, '떠난 사람의 편집 요청이 선다')
    assert.deepEqual(await approveAccessRequest(boss.ctx, edit.id, 'edit'), { ok: false, reason: 'not_found' })

    assert.deepEqual(await approveAccessRequest(boss.ctx, access.id, 'view'), { ok: true, value: { granted: true } })
    const back = await membershipOf(ws, guest.userId)
    assert.deepEqual([back?.role, back?.status, back?.join_method], ['guest', 'active', 'access_request'])
    assert.equal(await directLevel(wanted, guest.userId), 'view')
    assert.equal(await directLevel(shared, guest.userId), null, '빼면서 거둔 부여가 돌아왔다')
  })
})

// ── ⑨ ─────────────────────────────────────────────────────────────────

describe('⑨ 무시', () => {
  test('하루 동안 "보냈습니다" · 알리지 않는다 · 들어오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, stranger } = await office()
    const outside = await stranger()
    const doc = await page(boss, { privateTop: true })
    assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
    const [request] = await requestsOf(doc)
    assert.ok(request)

    assert.deepEqual(await ignoreAccessRequest(boss.ctx, request.id), { ok: true, value: null })
    assert.deepEqual(await notified(doc, 'access_granted'), [])
    assert.equal(await membershipOf(ws, outside.userId), null)
    assert.deepEqual(await outsiderNoAccessState(outside.outsider, doc), { requested: true })
    assert.deepEqual(await requestAccessAsOutsider(outside.outsider, doc), { ok: true, value: { sent: false } })
    assert.equal((await requestsOf(doc)).length, 1)
  })
})

// ── ⑩ ─────────────────────────────────────────────────────────────────

describe('⑩ 정책', () => {
  test('owner 만 읽고 바꾼다 · 행이 없으면 켜짐 · 모양이 아니면 invalid_policy', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const admin = await person('관리자', 'membership_admin')
    const member = await person('멤버')

    assert.deepEqual(await getSecurityPolicy(boss.ctx), { ok: true, value: { allowNonmemberPageAccessRequest: true } })
    assert.equal((await query(`SELECT 1 FROM security_policy WHERE workspace_id = $1`, [ws])).length, 0, '읽기만 했는데 행이 생겼다')
    for (const who of [admin, member]) {
      assert.deepEqual(await getSecurityPolicy(who.ctx), { ok: false, reason: 'forbidden' })
      assert.deepEqual(await updateSecurityPolicy(who.ctx, { allowNonmemberPageAccessRequest: false }), { ok: false, reason: 'forbidden' })
    }
    for (const bad of [null, {}, { allowNonmemberPageAccessRequest: 'false' }, { allowNonmemberPageAccessRequest: 0 }]) {
      assert.deepEqual(await updateSecurityPolicy(boss.ctx, bad), { ok: false, reason: 'invalid_policy' }, JSON.stringify(bad))
    }
    assert.equal((await query(`SELECT 1 FROM security_policy WHERE workspace_id = $1`, [ws])).length, 0)

    await setPolicy(boss, false)
    assert.deepEqual(await getSecurityPolicy(boss.ctx), { ok: true, value: { allowNonmemberPageAccessRequest: false } })
    const row = await queryOne<{ allow_export: boolean; allow_member_invite_guests: boolean }>(
      `SELECT allow_export, allow_member_invite_guests FROM security_policy WHERE workspace_id = $1`,
      [ws],
    )
    assert.deepEqual(row, { allow_export: true, allow_member_invite_guests: true }, '다른 칸이 기본값이 아니다')
  })
})

// ── ⑪ ─────────────────────────────────────────────────────────────────

describe('⑪ 게스트를 들이는 도우미', () => {
  test('이메일 공유와 요청의 허락이 같은 도우미 — 들어온 길만 다르다 · 이미 이 워크스페이스의 사람은 들이지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss, person } = await office()
    const doc = await page(boss, { privateTop: true })
    const invitee = await createUser('이메일로 받는 사람')
    const invited = await inviteGuestToPage(boss.ctx, doc, invitee.email, 'view')
    assert.ok(invited.ok && invited.value.as === 'guest')
    assert.equal((await membershipOf(ws, invitee.userId))?.join_method, 'invite_email')

    const member = await person('멤버')
    await assert.rejects(
      withTransaction((tx) => admitGuestIn(tx, boss.ctx, member.userId, 'access_request')),
      /이미 이 워크스페이스의 사람/,
    )
    assert.deepEqual(
      [(await membershipOf(ws, member.userId))?.role, (await membershipOf(ws, member.userId))?.join_method],
      ['member', null],
      '멤버를 게스트로 내렸다',
    )
  })
})
