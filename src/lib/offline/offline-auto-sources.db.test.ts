/**
 * 자동 내려받기의 원천 — OF-5 (F-12-04 · 정본 §3.7 [보강 OF-1] ⑥ · DB)
 *
 *   ① ★ 요금제 — 엔타이틀먼트 `offline.auto_download` 는 Free 만 false · Free 면 `plan_required`(묻지 않는다) · Plus · Business · Enterprise 는 답한다
 *   ② ★ 즐겨찾기(그 차례) · 최근 10개(가장 최근부터) — 사이드바와 같은 목록 · 그 사람의 것만
 *   ③ ★ 볼 수 없게 된 페이지는 빠진다(즐겨찾기 · 최근 모두) · 휴지통의 페이지도
 *   ④ ★ 내보내기 정책을 끄면 멤버에게는 빈 목록 · 소유자는 그대로
 */

process.env.AUTH_SECRET ??= 'test-secret-only-for-unit-tests'

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { entitlement } from '../billing/entitlement.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { createPage, titleFromPlainText } from '../block/page.ts'
import { trashPage } from '../block/trash.ts'
import { query } from '../db/pool.ts'
import type { BlockId } from '../ids.ts'
import { addFavorite, recordVisit } from '../nav/recent.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { updateSetting } from '../settings/settings.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase, type Actor } from '../testing/db-fixtures.ts'
import { AUTO_RECENT_LIMIT } from './offline-auto.ts'
import { offlineAutoSources } from './offline-auto-sources.ts'

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
const unique = (name: string): string => `${name} ${(seq += 1)} ${Date.now()}`

async function office(plan: 'free' | 'plus' | 'business' | 'enterprise') {
  const ws = await createBareWorkspace('자동 내려받기')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  assert.equal((await setWorkspacePlan(ws, plan)).ok, true)
  return { ws, boss, mate }
}

/** 대표의 개인 페이지 — 동료에게 읽기를 준다(거둘 수 있게). */
async function sharedPage(boss: Actor, mate: Actor, name: string): Promise<BlockId> {
  const page = await createPage(boss.ctx, { title: titleFromPlainText(unique(name)), privateTop: true })
  assert.ok((await grantAccess(boss.ctx, page.id, { type: 'user', id: mate.userId }, 'view')).ok)
  return page.id
}

/** 방문 시각을 정한다 — 차례가 시계에 달리지 않게(몇 초 전). */
async function visitedAgo(actor: Actor, pageId: string, seconds: number): Promise<void> {
  await recordVisit(actor.ctx, pageId)
  await query(`UPDATE recent_visit SET last_visited_at = now() - make_interval(secs => $3) WHERE user_id = $1 AND block_id = $2`, [actor.userId, pageId, seconds])
}

async function sourcesOf(actor: Actor) {
  const result = await offlineAutoSources(actor.ctx)
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

test('① ★ 요금제 — Free 만 막는다(plan_required) · Plus · Business · Enterprise 는 답한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, mate } = await office('free')
  assert.equal(await entitlement(ws, 'offline.auto_download'), false)
  assert.deepEqual(await offlineAutoSources(mate.ctx), { ok: false, reason: 'plan_required' })
  for (const plan of ['plus', 'business', 'enterprise'] as const) {
    await setWorkspacePlan(ws, plan)
    assert.equal(await entitlement(ws, 'offline.auto_download'), true, plan)
    assert.deepEqual(await offlineAutoSources(mate.ctx), { ok: true, value: { favorites: [], recent: [] } }, plan)
  }
  await setWorkspacePlan(ws, 'free')
  assert.deepEqual(await offlineAutoSources(mate.ctx), { ok: false, reason: 'plan_required' }, '다시 Free 로 내리면 다시 막는다')
})

test('② ★ 즐겨찾기(그 차례) · 최근 10개(가장 최근부터) — 그 사람의 것만', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, mate } = await office('plus')
  const pages: BlockId[] = []
  for (let i = 0; i < AUTO_RECENT_LIMIT + 2; i += 1) pages.push(await sharedPage(boss, mate, `최근 ${i}`))
  // 0 이 가장 오래전 · 11 이 가장 최근
  for (const [i, id] of pages.entries()) await visitedAgo(mate, id, 1000 - i * 10)
  await addFavorite(mate.ctx, pages[5]!)
  await addFavorite(mate.ctx, pages[1]!)
  // 대표의 즐겨찾기 · 방문은 동료의 원천에 들지 않는다
  const bossOnly = await sharedPage(boss, mate, '대표의 즐겨찾기')
  await addFavorite(boss.ctx, bossOnly)
  await visitedAgo(boss, bossOnly, 1)

  const sources = await sourcesOf(mate)
  assert.deepEqual(sources.favorites, [pages[5], pages[1]], '즐겨찾기는 넣은 차례')
  assert.deepEqual(sources.recent, [...pages].reverse().slice(0, AUTO_RECENT_LIMIT), '최근은 가장 최근부터 10개')
  assert.ok(!sources.favorites.includes(bossOnly) && !sources.recent.includes(bossOnly))
})

test('③ ★ 볼 수 없게 된 페이지 · 휴지통의 페이지는 빠진다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, mate } = await office('business')
  const kept = await sharedPage(boss, mate, '남는 문서')
  const revoked = await sharedPage(boss, mate, '거둘 문서')
  const trashed = await sharedPage(boss, mate, '버릴 문서')
  for (const [i, id] of [kept, revoked, trashed].entries()) {
    await addFavorite(mate.ctx, id)
    await visitedAgo(mate, id, 100 - i)
  }
  assert.deepEqual((await sourcesOf(mate)).favorites, [kept, revoked, trashed])

  assert.ok((await revokeAccess(boss.ctx, revoked, { type: 'user', id: mate.userId })).ok)
  await trashPage(boss.ctx, trashed)
  const sources = await sourcesOf(mate)
  assert.deepEqual(sources.favorites, [kept])
  assert.deepEqual(sources.recent, [kept])
})

test('④ ★ 내보내기 정책을 끄면 멤버에게는 빈 목록 · 소유자는 그대로', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, mate } = await office('enterprise')
  const page = await sharedPage(boss, mate, '정책 문서')
  await addFavorite(mate.ctx, page)
  await addFavorite(boss.ctx, page)
  await visitedAgo(mate, page, 5)
  await visitedAgo(boss, page, 5)
  const setExport = async (value: boolean) => assert.deepEqual(await updateSetting(boss.ctx, 'workspace.allow_export', value), { ok: true, value })

  await setExport(false)
  assert.deepEqual(await sourcesOf(mate), { favorites: [], recent: [] })
  assert.deepEqual(await sourcesOf(boss), { favorites: [page], recent: [page] })
  await setExport(true)
  assert.deepEqual(await sourcesOf(mate), { favorites: [page], recent: [page] })
})
