/**
 * 요금제 게이트 — 잔여 묶음 8k-2 (F-13-18 · F-06-09 · F-06-04)
 *
 *   ① 게스트 한도(Free 10) — 열째까지는 들이고 열한째는 `guest_limit` · 아무것도 쓰지 않는다 · 이미 게스트인 사람에게 페이지를 더 주는
 *     것은 된다 · 요금제를 올리면 들인다 · 내려도 있는 게스트는 그대로(새로 들이는 것만 막는다)
 *   ② 대기 초대는 자리를 잡는다 — 같은 이메일의 둘째 대기 초대는 자리를 더 쓰지 않는다
 *   ③ 접근 요청의 허락 — 밖의 사람을 들여야 하는데 한도면 `guest_limit` · 요청은 대기 중으로 남는다 · 멤버십도 부여도 없다
 *   ④ private teamspace — Free · Plus 는 만들거나 바꿀 수 없다(`plan_required`) · Business 는 된다 · 내려도 있는 것은 그대로이고 고칠 수
 *     있다 · 넓히는 것은 늘 된다
 *   ⑤ 한도 바로 밑에서 동시에 둘 — 하나만 들어온다(워크스페이스마다 advisory 잠금으로 줄을 세운다)
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createPage, titleFromPlainText } from '../block/page.ts'
import { query } from '../db/pool.ts'
import { requestAccessAsOutsider, approveAccessRequest } from '../permissions/access-request.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, visitAsOutsider, type Actor } from '../testing/db-fixtures.ts'
import { inviteGuestToPage } from '../workspace/guest.ts'
import { createTeamspace, updateTeamspace } from '../workspace/teamspace.ts'
import { setWorkspacePlan } from './plan.ts'

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

let seq = 0
async function office() {
  const ws = await createBareWorkspace('요금제 게이트')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const doc = (await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText(`문서 ${(seq += 1)}`) })).id
  return { ws, boss, doc }
}
const invite = async (boss: Actor, doc: string, email: string) => inviteGuestToPage(boss.ctx, doc, email, 'view')
const guestCount = async (ws: string) =>
  Number((await query<{ n: number }>(`SELECT count(*)::int AS n FROM workspace_member WHERE workspace_id = $1 AND role = 'guest' AND status = 'active'`, [ws]))[0]?.n)
const pendingCount = async (ws: string) =>
  Number((await query<{ n: number }>(`SELECT count(*)::int AS n FROM workspace_invite WHERE workspace_id = $1 AND role = 'guest' AND accepted_at IS NULL AND revoked_at IS NULL`, [ws]))[0]?.n)
/** 계정이 있는 사람 n명을 게스트로 들인다. */
async function admitGuests(boss: Actor, doc: string, n: number) {
  const people = []
  for (let i = 0; i < n; i += 1) {
    const person = await createUser(`게스트 ${(seq += 1)}`)
    const result = await invite(boss, doc, person.email)
    assert.ok(result.ok && result.value.as === 'guest', JSON.stringify(result))
    people.push(person)
  }
  return people
}

test('★ ① 게스트 한도 — 열째까지 · 열한째는 guest_limit(아무것도 쓰지 않는다) · 있는 게스트에게 더 주기 · 올리면 · 내려도 그대로', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, doc } = await office()
  const guests = await admitGuests(boss, doc, 10)
  const eleventh = await createUser('열한째')
  assert.deepEqual(await invite(boss, doc, eleventh.email), { ok: false, reason: 'guest_limit' })
  assert.equal(await guestCount(ws), 10)
  const grants = await query(`SELECT 1 FROM acl_entry WHERE principal_type = 'user' AND principal_id = $1`, [eleventh.userId])
  assert.equal(grants.length, 0, '막힌 초대가 부여를 남겼다')

  // 이미 게스트인 사람에게 다른 페이지를 더 주는 것은 자리를 더 쓰지 않는다
  const other = (await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText('다른 문서') })).id
  const more = await invite(boss, other, guests[0]!.email)
  assert.ok(more.ok && more.value.as === 'guest' && !more.value.joined, JSON.stringify(more))

  await setWorkspacePlan(ws, 'plus')
  const admitted = await invite(boss, doc, eleventh.email)
  assert.ok(admitted.ok && admitted.value.as === 'guest', '올리면 들인다')
  const twelfth = await createUser('열두째')
  assert.ok((await invite(boss, doc, twelfth.email)).ok)

  await setWorkspacePlan(ws, 'free')
  assert.equal(await guestCount(ws), 12, '내려도 있는 게스트는 그대로다')
  const thirteenth = await createUser('열셋째')
  assert.deepEqual(await invite(boss, doc, thirteenth.email), { ok: false, reason: 'guest_limit' }, '내린 뒤에는 새로 들이는 것만 막는다')
})

test('★ ② 대기 초대는 자리를 잡는다 — 같은 이메일의 둘째 대기 초대는 자리를 더 쓰지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, doc } = await office()
  await admitGuests(boss, doc, 9)
  const pendingEmail = `nobody-${Date.now()}@example.com`
  const pending = await invite(boss, doc, pendingEmail)
  assert.ok(pending.ok && pending.value.as === 'pending', JSON.stringify(pending))
  // 아홉 + 대기 하나 = 열 — 계정 있는 새 사람도, 계정 없는 새 이메일도 막힌다
  assert.deepEqual(await invite(boss, doc, (await createUser('막힘')).email), { ok: false, reason: 'guest_limit' })
  assert.deepEqual(await invite(boss, doc, `another-${Date.now()}@example.com`), { ok: false, reason: 'guest_limit' })
  // 같은 이메일을 다른 페이지로 — 한 사람이다
  const other = (await createPage(boss.ctx, { privateTop: true, title: titleFromPlainText('대기의 다른 문서') })).id
  const again = await invite(boss, other, pendingEmail)
  assert.ok(again.ok && again.value.as === 'pending', JSON.stringify(again))
  assert.equal(await pendingCount(ws), 2)
  assert.equal(await guestCount(ws), 9)
})

test('★ ③ 접근 요청의 허락 — 한도면 guest_limit · 요청은 대기 중 · 멤버십도 부여도 없다 · 올리면 허락된다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, doc } = await office()
  assert.ok((await updateSetting(boss.ctx, 'workspace.allow_nonmember_page_access_request', true)).ok)
  await admitGuests(boss, doc, 10)
  const outside = await visitAsOutsider(ws, await createUser('밖의 사람'))
  assert.ok((await requestAccessAsOutsider(outside.outsider, doc)).ok)
  const request = (await query<{ id: string }>(`SELECT id FROM access_request WHERE requester_id = $1 AND node_id = $2`, [outside.userId, doc]))[0]!
  assert.deepEqual(await approveAccessRequest(boss.ctx, request.id, 'view'), { ok: false, reason: 'guest_limit' })
  const state = (await query<{ status: string }>(`SELECT status FROM access_request WHERE id = $1`, [request.id]))[0]?.status
  assert.equal(state, 'pending', '막힌 허락이 요청을 처리했다')
  const membership = await query(`SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`, [ws, outside.userId])
  assert.equal(membership.length, 0, '막힌 허락이 멤버십을 남겼다')

  await setWorkspacePlan(ws, 'business')
  const approved = await approveAccessRequest(boss.ctx, request.id, 'view')
  assert.ok(approved.ok, JSON.stringify(approved))
})

test('★ ④ private teamspace — Free · Plus 는 plan_required · Business 는 된다 · 내려도 있는 것은 그대로 · 넓히기는 늘', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss } = await office()
  assert.deepEqual(await createTeamspace(boss.ctx, { name: '비밀', visibility: 'private' }), { ok: false, reason: 'plan_required' })
  const closed = await createTeamspace(boss.ctx, { name: '닫힌', visibility: 'closed' })
  assert.ok(closed.ok)
  assert.deepEqual(await updateTeamspace(boss.ctx, closed.value.id, { visibility: 'private' }), { ok: false, reason: 'plan_required' })
  const count = async () => Number((await query<{ n: number }>(`SELECT count(*)::int AS n FROM teamspace WHERE workspace_id = $1`, [ws]))[0]?.n)
  assert.equal(await count(), 1, '막힌 만들기가 teamspace 를 남겼다')

  await setWorkspacePlan(ws, 'plus')
  assert.deepEqual(await createTeamspace(boss.ctx, { name: '비밀', visibility: 'private' }), { ok: false, reason: 'plan_required' }, 'Plus 도 안 된다')

  await setWorkspacePlan(ws, 'business')
  const secret = await createTeamspace(boss.ctx, { name: '비밀', visibility: 'private' })
  assert.ok(secret.ok && secret.value.visibility === 'private')
  assert.ok((await updateTeamspace(boss.ctx, closed.value.id, { visibility: 'private' })).ok)

  await setWorkspacePlan(ws, 'free')
  assert.ok((await updateTeamspace(boss.ctx, secret.value.id, { name: '여전히 비밀' })).ok, '내린 뒤에도 이름은 고친다')
  assert.ok((await updateTeamspace(boss.ctx, secret.value.id, { visibility: 'private' })).ok, '이미 private 인 것을 private 로 — 바꾸는 것이 아니다')
  assert.ok((await updateTeamspace(boss.ctx, closed.value.id, { visibility: 'open' })).ok, '넓히기는 늘 된다')
  assert.deepEqual(await updateTeamspace(boss.ctx, closed.value.id, { visibility: 'private' }), { ok: false, reason: 'plan_required' })
})

test('★ ⑤ 한도 바로 밑에서 동시에 둘 — 하나만 들어온다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, doc } = await office()
  await admitGuests(boss, doc, 9)
  const [a, b] = await Promise.all([createUser('동시 A'), createUser('동시 B')])
  const results = await Promise.all([invite(boss, doc, a.email), invite(boss, doc, b.email)])
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true], JSON.stringify(results))
  assert.equal(await guestCount(ws), 10)
})
