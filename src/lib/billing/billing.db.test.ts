/**
 * 요금제 · 엔타이틀먼트 — 잔여 묶음 8k-1 (F-13-18)
 *
 *   ① 시드 — 요금제 넷 · **모든 요금제가 코드의 모든 키를 같은 종류로 갖는다**(`ENTITLEMENTS` 와 표가 맞는다)
 *   ② 조회 — 이 워크스페이스의 요금제의 값(버전 보존 7 · 30 · 90 · 무제한) · 트랜잭션으로도 묻는다
 *   ③ 표에 없는 키는 던진다(조용히 기본값으로 메우지 않는다)
 *   ④ 요금제 바꾸기 — 구독 한 줄 + plan_code 를 함께 · 바꾸면 앞의 것은 취소(이력) · 같은 요금제는 아무것도 쓰지 않는다 · free 는 구독이 없다
 *   ⑤ 거부 — 모르는 요금제 · 없는(지운) 워크스페이스
 *   ⑥ 개요(8k-3) — 소유자 · 멤버 관리자만 · 지금 요금제 · 가격 순 · 값은 표 그대로 · 게스트 쓴 양은 한도 판정과 같은 셈
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, createBareWorkspace, createUser, joinAs, makeFixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { ENTITLEMENTS, entitlement, type EntitlementKey } from './entitlement.ts'
import { planOverview } from './overview.ts'
import { PLAN_CODES, setWorkspacePlan } from './plan.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { inviteGuestToPage } from '../workspace/guest.ts'

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

const subscriptions = (workspaceId: string) =>
  query<{ code: string; status: string; canceled: boolean }>(
    `SELECT p.code, s.status, s.canceled_at IS NOT NULL AS canceled
       FROM billing_subscription s JOIN plan p ON p.id = s.plan_id
      WHERE s.workspace_id = $1 ORDER BY s.created_at, s.status`,
    [workspaceId],
  )
const planOf = async (workspaceId: string) =>
  (await query<{ plan_code: string }>(`SELECT plan_code FROM workspace WHERE id = $1`, [workspaceId]))[0]?.plan_code

test('★ ① 시드 — 요금제 넷 · 모든 요금제가 코드의 모든 키를 같은 종류로 갖는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const plans = await query<{ code: string }>(`SELECT code FROM plan ORDER BY price_monthly NULLS LAST`)
  assert.deepEqual(plans.map((p) => p.code), [...PLAN_CODES])
  const rows = await query<{ code: string; key: string; kind: string }>(
    `SELECT p.code, e.key, e.kind FROM plan_entitlement e JOIN plan p ON p.id = e.plan_id ORDER BY e.key, p.code`,
  )
  for (const [key, kind] of Object.entries(ENTITLEMENTS)) {
    const forKey = rows.filter((r) => r.key === key)
    assert.deepEqual(forKey.map((r) => r.code).sort(), [...PLAN_CODES].sort(), `${key} 가 모든 요금제에 있다`)
    assert.ok(forKey.every((r) => r.kind === kind), `${key} 는 어디서나 ${kind}`)
  }
  // 표에 있는 키는 모두 코드가 안다(쓰지 않는 키가 표에 남지 않는다)
  assert.deepEqual([...new Set(rows.map((r) => r.key))].sort(), Object.keys(ENTITLEMENTS).sort())
})

test('★ ② 조회 — 요금제의 값(버전 보존 · 게스트 한도 · private teamspace) · 트랜잭션으로도', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const ws = await createBareWorkspace('엔타이틀먼트')
  const seen: Array<[number | null, number | null, boolean]> = []
  for (const plan of PLAN_CODES) {
    await setWorkspacePlan(ws, plan)
    seen.push([await entitlement(ws, 'history.days'), await entitlement(ws, 'guests.max'), await entitlement(ws, 'teamspace.private')])
  }
  // 버전 보존 7 · 30 · 90 · 무제한 / 게스트 10 · 무제한 / private teamspace 는 Business 부터(8k-2)
  assert.deepEqual(seen, [
    [7, 10, false],
    [30, null, false],
    [90, null, true],
    [null, null, true],
  ])
  await setWorkspacePlan(ws, 'plus')
  assert.equal(await withTransaction((tx) => entitlement(ws, 'history.days', tx)), 30)
})

test('③ 표에 없는 키 · 없는 워크스페이스는 던진다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const ws = await createBareWorkspace('없는 키')
  await assert.rejects(entitlement(ws, 'charts.max' as EntitlementKey), /charts\.max/)
  await assert.rejects(entitlement('00000000-0000-4000-8000-000000000000', 'history.days'), /history\.days/)
})

test('★ ④ 요금제 바꾸기 — 구독 + plan_code 를 함께 · 앞의 것은 취소 · 같은 요금제는 그대로 · free 는 구독이 없다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const ws = await createBareWorkspace('요금제 바꾸기')
  assert.equal(await planOf(ws), 'free')
  assert.deepEqual(await subscriptions(ws), [])

  assert.deepEqual(await setWorkspacePlan(ws, 'plus'), { ok: true, changed: true, from: 'free', to: 'plus' })
  assert.deepEqual(await subscriptions(ws), [{ code: 'plus', status: 'active', canceled: false }])
  assert.equal(await planOf(ws), 'plus')

  assert.deepEqual(await setWorkspacePlan(ws, 'plus'), { ok: true, changed: false, from: 'plus', to: 'plus' })
  assert.equal((await subscriptions(ws)).length, 1, '같은 요금제는 아무것도 쓰지 않는다')

  await setWorkspacePlan(ws, 'business')
  assert.deepEqual(await subscriptions(ws), [
    { code: 'plus', status: 'canceled', canceled: true },
    { code: 'business', status: 'active', canceled: false },
  ])
  assert.equal(await planOf(ws), 'business')

  assert.deepEqual(await setWorkspacePlan(ws, 'free'), { ok: true, changed: true, from: 'business', to: 'free' })
  assert.ok((await subscriptions(ws)).every((s) => s.status === 'canceled'), 'free 는 살아 있는 구독이 없다')
  assert.equal(await planOf(ws), 'free')
})

test('⑤ 거부 — 모르는 요금제 · 없는(지운) 워크스페이스 · 아무것도 쓰지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const ws = await createBareWorkspace('거부')
  assert.deepEqual(await setWorkspacePlan(ws, 'gold'), { ok: false, reason: 'invalid_plan' })
  assert.deepEqual(await setWorkspacePlan(ws, 7), { ok: false, reason: 'invalid_plan' })
  assert.deepEqual(await setWorkspacePlan('00000000-0000-4000-8000-000000000000', 'plus'), { ok: false, reason: 'not_found' })
  await query(`UPDATE workspace SET deleted_at = now() WHERE id = $1`, [ws])
  assert.deepEqual(await setWorkspacePlan(ws, 'plus'), { ok: false, reason: 'not_found' })
  assert.deepEqual(await subscriptions(ws), [])
  assert.equal(await planOf(ws), 'free')
})

test('★ ⑥ 개요 — 소유자 · 멤버 관리자만 · 가격 순 · 값은 표 그대로 · 게스트 쓴 양', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const fx = await makeFixture()
  const admin = await joinAs(fx.workspaceId, await createUser('요금제의 관리자'), 'membership_admin')
  const member = await joinAs(fx.workspaceId, await createUser('요금제의 멤버'), 'member')
  const guestUser = await createUser('요금제의 게스트')
  const doc = (await createPage(fx.owner.ctx, { privateTop: true, title: titleFromPlainText('개요') })).id
  assert.ok((await inviteGuestToPage(fx.owner.ctx, doc, guestUser.email, 'view')).ok)
  assert.ok((await inviteGuestToPage(fx.owner.ctx, doc, `pending-${Date.now()}@example.com`, 'view')).ok)

  assert.equal(await planOverview(member.ctx), null, '멤버는 보지 않는다')
  const overview = await planOverview(admin.ctx)
  assert.ok(overview !== null)
  assert.equal(overview.current, 'free')
  assert.deepEqual(overview.plans.map((p) => [p.code, p.priceMonthly]), [['free', 0], ['plus', 14000], ['business', 30000], ['enterprise', null]])
  const values = Object.fromEntries(overview.entitlements.map((e) => [e.key, PLAN_CODES.map((c) => e.values[c])]))
  assert.deepEqual(values, {
    'history.days': [7, 30, 90, null],
    'guests.max': [10, null, null, null],
    'teamspace.private': [false, false, true, true],
    'import.max_bytes': [5242880, 52428800, 52428800, 52428800],
    'trash.custom_retention': [false, false, false, true],
    'automation.webhook': [false, true, true, true],
  })
  assert.equal(overview.usage.guests, 2, '활성 게스트 하나 + 대기 초대 하나')

  await setWorkspacePlan(fx.workspaceId, 'business')
  assert.equal((await planOverview(fx.owner.ctx))?.current, 'business')
})
