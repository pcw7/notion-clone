/**
 * 검증 만료 알림 — VF-3조각 (F-03-23 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 VF-1] ⑤).
 *
 *   ① ★ 만료가 있는 검증은 한 번짜리 잡 하나를 넣는다(run_at = expires_at · 열쇠) · 무기한은 넣지 않는다 · 다시 검증하면 하나 더(옛 잡은 남는다)
 *   ② ★ 돌면 소유자 칸의 사람들에게 알림 하나씩 · 비었으면 검증한 사람 · 두 번 돌아도 한 번
 *   ③ ★ 아무것도 하지 않는 것 — 다른 만료로 다시 검증 · 해제 · 휴지통 · 아직 때가 아님
 *   ④ ★ 워크스페이스를 떠난 소유자는 거른다
 *
 * 반사실: verifyRow 의 enqueueJob 을 빼면 ①, `!== expiresMs` 비교를 빼면 ③(다시 검증), 멤버 거름을 빼면 ④, 묶음 열쇠 검사를 빼면 ② 가 실패한다.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { asBlockId } from '../ids.ts'
import { trashPage } from '../block/trash.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { unverifyRow, verifyRow } from '../database/verification.ts'
import { runVerificationExpire, verificationExpireDedupeKey, verificationExpiredGroupKey } from './verification-expire.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const DAY = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(Date.now() + n * DAY)
/** 모든 만료가 지난 뒤의 시각 — 실행기의 now. */
const later = () => inDays(400)

/** Business 워크스페이스 · 표 · 검증 속성(소유자 속성 동반) · 행 하나 · 둘째 멤버. */
async function setup() {
  const ws = await createBareWorkspace('검증 만료')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('소유자 후보'), 'member')
  await setWorkspacePlan(ws, 'business')
  const db = unwrap(await createDatabase(boss.ctx, { name: '위키' }))
  const added = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '검증', type: 'verification' }))
  const prop = added.properties.find((p) => p.type === 'verification')!.id
  const owner = added.properties.find((p) => p.type === 'people')!.id
  const row = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
  const setOwners = async (ids: string[]) =>
    unwrap(await updateCells(boss.ctx, row, { cells: [{ propertyId: owner, value: { type: 'people', people: ids.map((id) => ({ id })) } }] }))
  return { ws, boss, mate, prop, owner, row, setOwners }
}

const jobsOf = (row: string) =>
  query<{ run_at: Date; dedupe_key: string; payload: Record<string, string> }>(
    `SELECT run_at, dedupe_key, payload FROM scheduled_job WHERE kind = 'verification_expire' AND payload ->> 'rowId' = $1 ORDER BY run_at`,
    [row],
  )
const notesOf = (row: string) =>
  query<{ recipient_id: string; kind: string }>(
    `SELECT recipient_id, kind FROM notification WHERE page_id = $1 AND kind = 'verification_expired' ORDER BY recipient_id`,
    [row],
  )
const payloadOf = (row: string, prop: string, expiresAt: string) => ({ rowId: row, propertyId: prop, expiresAt })

test('① ★ 만료가 있으면 잡 하나(run_at · 열쇠) · 무기한은 없음 · 다시 검증하면 하나 더', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, prop, row } = await setup()
  const first = inDays(7)
  const cell = unwrap(await verifyRow(boss.ctx, row, prop, first.toISOString()))
  const jobs = await jobsOf(row)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]!.run_at.getTime(), first.getTime())
  assert.equal(jobs[0]!.dedupe_key, verificationExpireDedupeKey(row, prop, first.toISOString()))
  assert.deepEqual(jobs[0]!.payload, payloadOf(row, prop, cell.expires_at!))

  unwrap(await verifyRow(boss.ctx, row, prop, null))
  assert.equal((await jobsOf(row)).length, 1, '무기한은 잡을 넣지 않는다')

  unwrap(await verifyRow(boss.ctx, row, prop, inDays(30).toISOString()))
  assert.equal((await jobsOf(row)).length, 2, '다시 검증하면 하나 더 · 옛 잡은 남는다')
})

test('② ★ 소유자 칸의 사람들에게 하나씩 · 두 번 돌아도 한 번', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, mate, prop, row, setOwners } = await setup()
  await setOwners([mate.userId])
  const cell = unwrap(await verifyRow(boss.ctx, row, prop, inDays(7).toISOString()))
  const payload = payloadOf(row, prop, cell.expires_at!)

  assert.equal(await runVerificationExpire(payload, inDays(1)), 0, '아직 때가 아니다')
  assert.equal(await runVerificationExpire(payload, later()), 1)
  assert.deepEqual(await notesOf(row), [{ recipient_id: mate.userId, kind: 'verification_expired' }], '검증한 대표가 아니라 소유자')
  const group = await query<{ group_key: string }>(`SELECT group_key FROM notification WHERE page_id = $1 AND kind = 'verification_expired'`, [row])
  assert.equal(group[0]!.group_key, verificationExpiredGroupKey(row, prop, cell.expires_at!))
  assert.equal(await runVerificationExpire(payload, later()), 0, '두 번째는 만들지 않는다')
  assert.equal((await notesOf(row)).length, 1)
})

test('② 소유자 칸이 비었으면 검증한 사람에게', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, prop, row } = await setup()
  const cell = unwrap(await verifyRow(boss.ctx, row, prop, inDays(7).toISOString()))
  assert.equal(await runVerificationExpire(payloadOf(row, prop, cell.expires_at!), later()), 1)
  assert.deepEqual(await notesOf(row), [{ recipient_id: boss.userId, kind: 'verification_expired' }])
})

test('③ ★ 다른 만료로 다시 검증 · 해제 · 휴지통이면 아무것도 하지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  // 다시 검증
  const a = await setup()
  const old = unwrap(await verifyRow(a.boss.ctx, a.row, a.prop, inDays(7).toISOString()))
  unwrap(await verifyRow(a.boss.ctx, a.row, a.prop, inDays(60).toISOString()))
  assert.equal(await runVerificationExpire(payloadOf(a.row, a.prop, old.expires_at!), later()), 0, '옛 잡은 새 검증을 만료시키지 않는다')
  assert.equal((await notesOf(a.row)).length, 0)
  // 해제
  const b = await setup()
  const cell = unwrap(await verifyRow(b.boss.ctx, b.row, b.prop, inDays(7).toISOString()))
  unwrap(await unverifyRow(b.boss.ctx, b.row, b.prop))
  assert.equal(await runVerificationExpire(payloadOf(b.row, b.prop, cell.expires_at!), later()), 0)
  assert.equal((await notesOf(b.row)).length, 0)
  // 휴지통
  const c = await setup()
  const cc = unwrap(await verifyRow(c.boss.ctx, c.row, c.prop, inDays(7).toISOString()))
  await trashPage(c.boss.ctx, asBlockId(c.row))
  assert.equal(await runVerificationExpire(payloadOf(c.row, c.prop, cc.expires_at!), later()), 0)
  assert.equal((await notesOf(c.row)).length, 0)
})

test('④ ★ 워크스페이스를 떠난 소유자는 거른다 — 남은 소유자에게만', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, mate, prop, row, setOwners } = await setup()
  const gone = await joinAs(ws, await createUser('떠난 소유자'), 'member')
  await setOwners([mate.userId, gone.userId])
  const cell = unwrap(await verifyRow(boss.ctx, row, prop, inDays(7).toISOString()))
  await query(`UPDATE workspace_member SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`, [ws, gone.userId])
  assert.equal(await runVerificationExpire(payloadOf(row, prop, cell.expires_at!), later()), 1)
  assert.deepEqual(await notesOf(row), [{ recipient_id: mate.userId, kind: 'verification_expired' }])
})
