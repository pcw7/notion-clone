/**
 * 별칭의 공유 · 초대 · 멘션 해석 — AC-2 (F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ④ ⑤ (+ [AC-2])
 *
 * 이 파일이 지키는 것.
 *
 *   ① **별칭은 대표와 같다** — 워크스페이스 초대 · 게스트 초대(이메일로 페이지 주기) · 수락 · 수락 화면이 같은 해석(`resolveUserByEmail`)을
 *      지난다 · 저장은 user_id 다(별칭을 빼도 지난 공유 · 멤버십은 남는다) · 같은 사람의 별칭으로 다시 초대해도 멤버가 늘지 않는다
 *   ② **대기 초대의 승계** — 계정 없는 주소로 간 초대는 그 주소를 별칭으로 확인한 계정이 수락으로 받는다 · 남이 걸어 둔 확인 대기는 받지
 *      못한다 · 받기 전에 그 별칭을 빼면 받지 못한다(받는 때는 수락이다)
 *   ③ **다른 사람에게는 대표만** — 멤버 · 게스트 · 공유 패널의 접근 요청 · API person · 멘션 · 사람 고르개 · 감사 어디에도 별칭이 없다 ·
 *      자동완성은 별칭 조각으로 사람을 찾지 않는다
 *   ④ **열거 방지** — 멤버 아닌 계정의 별칭과 아무의 것도 아닌 주소는 초대의 결과가 같다 · 공유할 수 없는 사람에게는 별칭 · 대표 · 없는
 *      주소가 모두 같은 거부다 · 별칭과 대표는 공유의 결과가 같다
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'
process.env.MAIL_TRANSPORT ??= 'console'

import { probeDatabase, createUser, createBareWorkspace, joinAs, type Actor } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import type { BlockId, WorkspaceId } from '../ids.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { searchMentionCandidates } from '../block/mention-candidates.ts'
import { searchPeople } from '../database/people.ts'
import { canViewPage } from '../permissions/effective.ts'
import { listAccessRequests, requestPageAccess } from '../permissions/access-request.ts'
import { listApiUsers, personUser } from '../api/users.ts'
import { listMembers } from '../workspace/list.ts'
import { inviteGuestToPage, listGuests } from '../workspace/guest.ts'
import { acceptInvite, createEmailInvite, isInviteFor, previewInvite } from '../workspace/invite.ts'
import { removeEmail, requestEmailVerification, verifyEmail } from './account-email.ts'
import { resolveUserByEmail } from './resolve-user.ts'
import { resolveSessionContext, type SessionContext } from './session-context.ts'

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

let ipCounter = 0
/** 시험마다 다른 IP(로그인 코드의 IP 상한 — account-email.db.test 와 같은 까닭) · TEST-NET-3 대역. */
const req = () => {
  ipCounter += 1
  return { ip: `203.0.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`, userAgent: 'node:test' }
}
const fresh = (tag = 'alias') => `ac2-${tag}-${randomUUID().slice(0, 8)}@example.com`
let seq = 0
const title = (name: string) => titleFromPlainText(`${name} ${(seq += 1)}`)

/** 자기 워크스페이스가 있는 사람 — 별칭을 더하려면 세션 컨텍스트가 있어야 한다. */
async function personWithHome(name: string): Promise<Actor> {
  const home = await createBareWorkspace(`${name}의 집`)
  return joinAs(home, await createUser(name), 'owner')
}

async function office(name = 'AC-2 사무실') {
  const ws = await createBareWorkspace(name)
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  return { ws, boss }
}

/** 별칭 하나를 확인까지(코드 요청 → 맞히기). */
async function addAlias(who: Actor, email = fresh()): Promise<{ id: string; email: string }> {
  const asked = await requestEmailVerification(who.ctx, { email }, req())
  assert.ok(asked.ok && asked.value.devCode, `코드 요청 실패: ${JSON.stringify(asked)}`)
  const verified = await verifyEmail(who.ctx, { email, code: asked.value.devCode }, req())
  assert.ok(verified.ok, `확인 실패: ${JSON.stringify(verified)}`)
  return { id: verified.value.id, email }
}

/** 같은 세션으로 다른 워크스페이스의 컨텍스트(멤버십을 건드리지 않는다 — `joinAs` 는 역할을 덮어쓴다). */
async function contextIn(who: Actor, ws: WorkspaceId): Promise<SessionContext> {
  const resolved = await resolveSessionContext(who.token, ws)
  if (!resolved.ok) throw new Error(`컨텍스트를 얻지 못했다: ${resolved.reason}`)
  return resolved.context
}

const privatePage = async (by: Actor): Promise<BlockId> => (await createPage(by.ctx, { privateTop: true, title: title('문서') })).id

const userGrantsOn = (pageId: string) =>
  query<{ principal_id: string }>(
    `SELECT principal_id FROM acl_entry WHERE node_kind = 'block' AND node_id = $1 AND principal_type = 'user' ORDER BY principal_id`,
    [pageId],
  )

const membershipOf = async (ws: string, userId: string) =>
  (await query<{ role: string; status: string }>(`SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`, [ws, userId]))[0] ??
  null

// ── ① 별칭은 대표와 같다 ──────────────────────────────────────────────

describe('① 별칭은 대표와 같다 — 초대 · 공유 · 수락', () => {
  test('★ 해석기 — 대표 · 별칭 모두 그 계정 · 대소문자 무시 · 남의 확인 대기는 아무의 것도 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const who = await personWithHome('해석의 사람')
    const { email: alias } = await addAlias(who)
    assert.equal((await resolveUserByEmail(who.email))?.userId, who.userId)
    assert.equal((await resolveUserByEmail(alias))?.userId, who.userId, '별칭도 그 계정')
    assert.equal((await resolveUserByEmail(`  ${alias.toUpperCase()} `))?.userId, who.userId, '대소문자 · 공백')
    assert.deepEqual(Object.keys((await resolveUserByEmail(alias)) ?? {}), ['userId'], '찾은 주소가 별칭인지는 싣지 않는다')

    const other = await personWithHome('남의 주소를 거는 사람')
    const pending = fresh('pending')
    assert.ok((await requestEmailVerification(other.ctx, { email: pending }, req())).ok)
    assert.equal(await resolveUserByEmail(pending), null, '확인 대기는 user_email 이 아니다(①)')
  })

  test('★ 워크스페이스 초대 — 별칭으로 보낸 초대를 그 계정이 받는다(수락 화면도) · 저장은 user_id · 별칭을 빼도 멤버로 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const who = await personWithHome('별칭으로 초대받는 사람')
    const { id: aliasId, email: alias } = await addAlias(who)
    const stranger = await personWithHome('링크를 가진 남')

    const invited = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: alias, role: 'member' })
    assert.ok(invited.ok, JSON.stringify(invited))
    const preview = await previewInvite(invited.token)
    assert.ok(preview)
    assert.equal(await isInviteFor(preview, who.userId), true, '수락 화면 — 별칭 앞의 초대는 이 계정의 것이다')
    assert.equal(await isInviteFor(preview, stranger.userId), false)
    assert.equal((await acceptInvite(invited.token, stranger.userId) as { reason?: string }).reason, 'email_mismatch')

    const accepted = await acceptInvite(invited.token, who.userId)
    assert.ok(accepted.ok, JSON.stringify(accepted))
    assert.deepEqual(await membershipOf(ws, who.userId), { role: 'member', status: 'active' })
    const row = await query<{ accepted_by_user_id: string }>(`SELECT accepted_by_user_id FROM workspace_invite WHERE id = $1`, [invited.inviteId])
    assert.equal(row[0]?.accepted_by_user_id, who.userId, '수락은 계정으로 남는다')

    assert.ok((await removeEmail(who.ctx, { emailId: aliasId })).ok)
    assert.deepEqual(await membershipOf(ws, who.userId), { role: 'member', status: 'active' }, '별칭을 빼도 멤버십은 남는다')
  })

  test('★ 같은 사람의 별칭으로 다시 초대해도 멤버가 늘지 않는다 — 대표와 같은 already_member', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const member = await joinAs(ws, await createUser('이미 멤버'), 'member')
    const { email: alias } = await addAlias(member)
    const byPrimary = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: member.email, role: 'member' })
    const byAlias = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: alias, role: 'member' })
    assert.deepEqual(byAlias, byPrimary)
    assert.deepEqual(byAlias, { ok: false, reason: 'already_member' })
    const invites = await query(`SELECT 1 FROM workspace_invite WHERE workspace_id = $1 AND email = $2`, [ws, alias])
    assert.equal(invites.length, 0, '대기 초대도 남기지 않는다')
  })

  test('★ 게스트 초대(이메일로 공유) — 별칭으로 주면 그 계정의 부여 · 대표로 준 것과 같은 결과 · 별칭을 빼도 공유는 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const who = await personWithHome('별칭으로 공유받는 사람')
    const { id: aliasId, email: alias } = await addAlias(who)

    const first = await privatePage(boss)
    const byAlias = await inviteGuestToPage(boss.ctx, first, alias, 'comment')
    assert.ok(byAlias.ok, JSON.stringify(byAlias))
    assert.deepEqual(byAlias.value, { userId: who.userId, as: 'guest', joined: true }, '별칭은 그 계정 — 대기 초대가 아니다')
    assert.deepEqual((await userGrantsOn(first)).map((r) => r.principal_id).filter((id) => id !== boss.userId), [who.userId], '부여는 user_id 로')
    assert.equal((await query(`SELECT 1 FROM workspace_invite WHERE workspace_id = $1 AND email = $2`, [ws, alias])).length, 0)

    // 같은 사람의 대표로 다른 페이지 — 결과의 모양이 같다(이미 게스트)
    const second = await privatePage(boss)
    const third = await privatePage(boss)
    const byPrimary = await inviteGuestToPage(boss.ctx, second, who.email, 'view')
    const byAliasAgain = await inviteGuestToPage(boss.ctx, third, alias, 'view')
    assert.deepEqual(byAliasAgain, byPrimary, '별칭과 대표는 결과가 같다')

    assert.ok((await removeEmail(who.ctx, { emailId: aliasId })).ok)
    assert.equal(await resolveUserByEmail(alias), null, '뺀 주소는 풀린다')
    assert.deepEqual((await userGrantsOn(first)).map((r) => r.principal_id).filter((id) => id !== boss.userId), [who.userId], '별칭을 빼도 공유는 남는다')
    assert.deepEqual(await membershipOf(ws, who.userId), { role: 'guest', status: 'active' })
    assert.equal(await canViewPage(await contextIn(who, ws), first), true, '그 계정은 여전히 본다')
  })
})

// ── ② 대기 초대의 승계 ────────────────────────────────────────────────

describe('② 대기 초대의 승계 — 받는 때는 수락이다', () => {
  test('★ 계정 없는 주소로 간 게스트 초대 — 남의 확인 대기는 받지 못하고, 그 주소를 별칭으로 확인한 계정이 받는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const pageId = await privatePage(boss)
    const address = fresh('later')

    const pended = await inviteGuestToPage(boss.ctx, pageId, address, 'edit')
    assert.ok(pended.ok && pended.value.as === 'pending', JSON.stringify(pended))
    const token = pended.value.token

    // 남(B)이 그 주소를 먼저 확인 대기로 건다 — 코드는 B 의 것이지만 주소는 아직 아무의 것도 아니다
    const squatter = await personWithHome('남의 주소를 거는 사람')
    const squat = await requestEmailVerification(squatter.ctx, { email: address }, req())
    assert.ok(squat.ok && squat.value.devCode)
    const preview = await previewInvite(token)
    assert.ok(preview)
    assert.equal(await isInviteFor(preview, squatter.userId), false, '확인 대기는 그 주소의 주인이 아니다')
    assert.equal((await acceptInvite(token, squatter.userId) as { reason?: string }).reason, 'email_mismatch')
    assert.equal(await membershipOf(ws, squatter.userId), null)

    // 주인(A)이 그 주소를 별칭으로 확인한다 → A 가 받는다
    const owner = await personWithHome('그 주소의 주인')
    await addAlias(owner, address)
    assert.equal(await isInviteFor(preview, owner.userId), true)
    assert.equal((await acceptInvite(token, squatter.userId) as { reason?: string }).reason, 'email_mismatch', '남은 여전히 받지 못한다')
    const accepted = await acceptInvite(token, owner.userId)
    assert.ok(accepted.ok, JSON.stringify(accepted))
    assert.equal(accepted.pageId, pageId)
    assert.deepEqual(await membershipOf(ws, owner.userId), { role: 'guest', status: 'active' })
    assert.ok((await userGrantsOn(pageId)).some((r) => r.principal_id === owner.userId), '부여는 그 계정(user_id)')
    assert.equal(await membershipOf(ws, squatter.userId), null)

    // 남이 늦게 코드를 맞혀도 그 주소는 이미 주인의 것이다
    assert.deepEqual(await verifyEmail(squatter.ctx, { email: address, code: squat.value.devCode }, req()), { ok: false, reason: 'unavailable' })
  })

  test('★ 워크스페이스 초대 — 받기 전에 별칭을 빼면 받지 못한다(초대는 주소로 기다린다 · 다시 더하면 받는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const address = fresh('wait')
    const invited = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email: address, role: 'member' })
    assert.ok(invited.ok)

    const who = await personWithHome('나중에 확인하는 사람')
    const { id } = await addAlias(who, address)
    assert.ok((await removeEmail(who.ctx, { emailId: id })).ok)
    assert.equal((await acceptInvite(invited.token, who.userId) as { reason?: string }).reason, 'email_mismatch', '뺀 주소의 초대는 이 계정의 것이 아니다')

    await addAlias(who, address)
    const accepted = await acceptInvite(invited.token, who.userId)
    assert.ok(accepted.ok, JSON.stringify(accepted))
    assert.deepEqual(await membershipOf(ws, who.userId), { role: 'member', status: 'active' })
  })
})

// ── ③ 다른 사람에게는 대표만 ──────────────────────────────────────────

describe('③ 다른 사람에게는 대표만', () => {
  test('★ 멤버 · 게스트 · 접근 요청 · API · 멘션 · 사람 고르개 · 감사 — 별칭은 어디에도 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office('AC-2 별칭 누출')
    const member = await joinAs(ws, await createUser('별칭 있는 멤버'), 'member')
    const { email: memberAlias } = await addAlias(member)
    const guestPerson = await personWithHome('별칭 있는 게스트')
    const { email: guestAlias } = await addAlias(guestPerson)
    const shared = await privatePage(boss)
    const given = await inviteGuestToPage(boss.ctx, shared, guestPerson.email, 'view')
    assert.ok(given.ok && given.value.as === 'guest')
    // 멤버가 볼 수 없는 페이지에 접근을 요청한다 — 공유 패널의 요청 줄이 그 사람의 주소를 싣는다
    const closed = await privatePage(boss)
    assert.ok((await requestPageAccess(member.ctx, closed)).ok)

    const aliases = [memberAlias, guestAlias].map((a) => a.toLowerCase())
    const leaks = (label: string, value: unknown) => {
      const text = JSON.stringify(value).toLowerCase()
      for (const alias of aliases) assert.ok(!text.includes(alias), `${label} 에 별칭(${alias})이 샜다`)
    }

    const members = await listMembers(ws)
    leaks('멤버 목록 · 공유 패널의 사람', members)
    assert.equal(members.find((m) => m.userId === member.userId)?.email, member.email, '멤버 목록은 대표 주소')
    assert.equal(members.filter((m) => m.userId === member.userId).length, 1, '한 사람은 한 줄')

    const guests = await listGuests(boss.ctx)
    assert.ok(guests.ok)
    leaks('게스트 목록', guests.value)
    assert.equal(guests.value.find((g) => g.userId === guestPerson.userId)?.email, guestPerson.email)

    const requests = await listAccessRequests(boss.ctx, closed)
    assert.ok(requests.ok)
    leaks('공유 패널의 접근 요청', requests.value)
    assert.equal(requests.value.find((r) => r.requesterId === member.userId)?.email, member.email)

    const person = await personUser(member.userId)
    assert.equal(person?.person.email, member.email, 'API person.email 은 대표 주소')
    const users = await listApiUsers({ ctx: boss.ctx, request: new Request('http://localhost/v1/users'), params: {}, body: undefined, requestId: 'ac2' })
    assert.ok(users.ok)
    leaks('API 사람 목록', users.json)

    // 자동완성은 이름과 대표 주소로만 — 별칭 조각으로는 그 사람이 나오지 않는다
    const aliasFragment = memberAlias.split('@')[0] as string
    const primaryFragment = member.email.split('@')[0] as string
    assert.ok(!(await searchMentionCandidates(boss.ctx, aliasFragment)).some((c) => c.id === member.userId), '@ 후보 — 별칭 조각으로 찾지 못한다')
    assert.ok((await searchMentionCandidates(boss.ctx, primaryFragment)).some((c) => c.id === member.userId), '@ 후보 — 대표 주소로는 찾는다')
    leaks('@ 후보', await searchMentionCandidates(boss.ctx, ''))
    assert.ok(!(await searchPeople(boss.ctx, aliasFragment)).some((c) => c.id === member.userId), '사람 고르개 — 별칭 조각으로 찾지 못한다')
    assert.ok((await searchPeople(boss.ctx, primaryFragment)).some((c) => c.id === member.userId))

    const audit = await query(`SELECT actor_email, metadata FROM audit_event WHERE actor_user_id = ANY($1::uuid[])`, [[member.userId, guestPerson.userId]])
    assert.ok(audit.length > 0, '감사 줄이 있다(별칭 더하기 · 접근 요청)')
    leaks('감사', audit)
  })
})

// ── ④ 열거 방지 ───────────────────────────────────────────────────────

describe('④ 열거 방지', () => {
  test('★ 워크스페이스 초대 — 멤버 아닌 계정의 별칭 · 대표와 아무의 것도 아닌 주소는 결과가 같다(모두 주소로 기다린다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const outsider = await personWithHome('멤버 아닌 계정')
    const { email: alias } = await addAlias(outsider)
    const nobody = fresh('nobody')

    const shapes = []
    for (const email of [alias, outsider.email, nobody]) {
      const result = await createEmailInvite({ workspaceId: ws, inviterUserId: boss.userId, inviterRole: 'owner', email, role: 'member' })
      assert.ok(result.ok, `${email}: ${JSON.stringify(result)}`)
      shapes.push(Object.keys(result).sort().join(','))
      const pending = await query(`SELECT 1 FROM workspace_invite WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL`, [ws, email])
      assert.equal(pending.length, 1, `${email} — 대기 초대가 똑같이 선다`)
    }
    assert.equal(new Set(shapes).size, 1, '응답의 모양이 같다')
  })

  test('★ 공유할 수 없는 사람에게는 별칭 · 대표 · 없는 주소가 모두 같은 거부다(계정이 있는지 말하기 전에 게이트)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ws, boss } = await office()
    const outsider = await personWithHome('멤버 아닌 계정')
    const { email: alias } = await addAlias(outsider)
    const plain = await joinAs(ws, await createUser('공유할 수 없는 멤버'), 'member')
    const closed = await privatePage(boss)

    const results = []
    for (const email of [alias, outsider.email, fresh('nobody')]) results.push(await inviteGuestToPage(plain.ctx, closed, email, 'view'))
    assert.equal(results[0]?.ok, false)
    assert.deepEqual(results[1], results[0])
    assert.deepEqual(results[2], results[0])
    assert.equal(await membershipOf(ws, outsider.userId), null, '아무것도 쓰지 않았다')
  })
})
