/**
 * 리마인더 — 데이터베이스 날짜 속성 · 히스토리 · 활동 4c-1 (F-11-10, DB 필요)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 걸기 — 날짜만이면 그날 09:00(건 사람의 타임존) · 오프셋이 있는 시각은 그대로 · 없는 시각은 타임존으로 · 값의 타임존이 먼저 · 칸마다
 *      하나(다시 걸면 바뀐다) · 받는 사람은 건 사람
 *   ② 거부 — 날짜 속성이 아님 · 날짜가 없음 · 값의 모양에 없는 리드 · 모르는 타임존 · 볼 수만 있음 · 볼 수 없음 · 행 잠금
 *   ③ 셀과 함께 움직인다(0072 트리거) — 날짜를 옮기면 시각이 따라 · 미래로 옮기면 다시 건다 · 지난 시각이면 "지남" · 날짜를 비우면 풀린다
 *   ④ 지난 시각에 걸면 울리지 않는다("지남") · 풀기는 멱등
 *
 * 반사실(HANDOFF §3.3): 09:00 이 아니면 ①, 값의 타임존을 보지 않으면 ①, 트리거가 없으면 ③, 지난 시각을 보지 않으면 ③ · ④ 가 실패한다.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setPageLock } from '../permissions/lock.ts'
import { createDatabase } from './database.ts'
import { addProperty } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { clearDateReminder, readDateReminders, setDateReminder, type DateReminder } from './reminder.ts'
import { withReadTransaction } from '../db/tx.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let viewer: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  viewer = await joinAs(fx.workspaceId, await createUser('리마인더의 게스트'), 'guest')
})

after(async () => {
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/** 표 하나 — 날짜 속성 '마감' · 행 하나. */
async function table(name: string) {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const due = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
  const title = unwrap(await addProperty(fx.owner.ctx, db.dataSourceId, { name: '메모', type: 'rich_text' })).properties.find((p) => p.name === '메모')!.id
  const row = unwrap(await createRow(fx.owner.ctx, db.dataSourceId)).id
  const setDate = async (date: Record<string, unknown> | null) =>
    unwrap(await updateCells(fx.owner.ctx, row, { cells: [{ propertyId: due, value: { type: 'date', date } }] }))
  return { db, due, title, row, setDate }
}

const iso = (r: DateReminder) => [r.targetAt.toISOString(), r.fireAt.toISOString(), r.firedAt]
const stored = async (row: string) =>
  query<{ property_id: string; fired_at: Date | null; target_at: Date }>(`SELECT property_id, fired_at, target_at FROM reminder WHERE page_id = $1`, [row])

describe('① 걸기', () => {
  test('★ 날짜만이면 그날 09:00 · 오프셋 있는 시각은 그대로 · 없는 시각은 타임존으로 · 값의 타임존이 먼저', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 걸기')
    const set = (leadMinutes: number, timeZone: string) => setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes, timeZone })

    await tb.setDate({ start: '2030-05-01' })
    const dateOnly = unwrap(await set(1440, 'Asia/Seoul'))
    assert.deepEqual(iso(dateOnly), ['2030-05-01T00:00:00.000Z', '2030-04-30T00:00:00.000Z', null], '그날 09:00 KST · 하루 전')
    assert.deepEqual([dateOnly.recipientIds, dateOnly.createdBy, dateOnly.leadMinutes], [[fx.owner.userId], fx.owner.userId, 1440])

    await tb.setDate({ start: '2030-05-01T15:30:00+09:00' })
    assert.deepEqual(iso(unwrap(await set(30, 'Asia/Seoul'))), ['2030-05-01T06:30:00.000Z', '2030-05-01T06:00:00.000Z', null], '오프셋 그대로 · 30분 전')

    await tb.setDate({ start: '2030-05-01T15:30:00' })
    assert.deepEqual(iso(unwrap(await set(0, 'America/New_York'))), ['2030-05-01T19:30:00.000Z', '2030-05-01T19:30:00.000Z', null], '뉴욕의 15:30(EDT)')

    await tb.setDate({ start: '2030-05-01', time_zone: 'Europe/London' })
    assert.deepEqual(iso(unwrap(await set(0, 'Asia/Seoul'))).slice(0, 1), ['2030-05-01T08:00:00.000Z'], '값의 타임존(런던 BST 09:00)이 먼저')

    assert.equal((await stored(tb.row)).length, 1, '칸마다 하나 — 다시 걸면 바뀐다')
    const read = await withReadTransaction((tx) => readDateReminders(tx, [tb.row]))
    assert.equal(read.get(tb.row)?.get(tb.due)?.timeZone, 'Asia/Seoul')
  })
})

describe('② 거부', () => {
  test('★ 날짜 속성이 아님 · 날짜가 없음 · 없는 리드 · 모르는 타임존 · 볼 수만 · 볼 수 없음 · 잠김', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 거부')
    const reason = async (r: Promise<{ ok: boolean; reason?: string }>) => {
      const v = await r
      return v.ok ? 'ok' : v.reason
    }
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.title, { leadMinutes: 0, timeZone: 'Asia/Seoul' })), 'not_date')
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' })), 'no_date')
    await tb.setDate({ start: '2030-06-01' })
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 5, timeZone: 'Asia/Seoul' })), 'invalid_lead', '날짜만에는 분 리드가 없다')
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: '0', timeZone: 'Asia/Seoul' })), 'invalid_lead')
    await tb.setDate({ start: '2030-06-01T10:00:00+09:00' })
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 2880, timeZone: 'Asia/Seoul' })), 'invalid_lead', '시각에는 이틀 리드가 없다')
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Mars/Base' })), 'invalid_time_zone')

    assert.equal(await reason(setDateReminder(viewer.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' })), 'not_found', '볼 수 없다')
    assert.equal((await grantAccess(fx.owner.ctx, tb.db.id, { type: 'user', id: viewer.userId }, 'view')).ok, true)
    assert.equal(await reason(setDateReminder(viewer.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' })), 'forbidden', '볼 수만 있다')
    assert.equal(await reason(clearDateReminder(viewer.ctx, tb.row, tb.due)), 'forbidden')

    assert.equal((await setPageLock(fx.owner.ctx, tb.row, true)).ok, true)
    assert.equal(await reason(setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' })), 'locked')
    assert.equal((await stored(tb.row)).length, 0, '거부는 아무것도 쓰지 않는다')
  })
})

describe('③ 셀과 함께 움직인다', () => {
  test('★ 날짜를 옮기면 시각이 따라 · 미래로 옮기면 다시 걸고 · 지난 시각이면 "지남" · 비우면 풀린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 동기')
    await tb.setDate({ start: '2030-07-01' })
    unwrap(await setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))

    await tb.setDate({ start: '2030-07-02' })
    assert.deepEqual((await stored(tb.row)).map((r) => [r.target_at.toISOString(), r.fired_at]), [['2030-07-02T00:00:00.000Z', null]], '시각이 따라 옮긴다')

    await tb.setDate({ start: '2020-01-01' })
    const past = await stored(tb.row)
    assert.ok(past[0]?.fired_at instanceof Date, '지난 시각으로 옮기면 "지남"(울리지 않는다)')

    await tb.setDate({ start: '2031-01-01' })
    assert.equal((await stored(tb.row))[0]?.fired_at, null, '미래로 옮기면 다시 건다')

    // 셀과 상관없는 칸을 고쳐도 그대로다
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.title, value: { type: 'rich_text', rich_text: [] } }] }))
    assert.equal((await stored(tb.row)).length, 1)

    await tb.setDate(null)
    assert.deepEqual(await stored(tb.row), [], '날짜를 비우면 풀린다')
  })
})

describe('④ 지난 시각 · 풀기', () => {
  test('★ 지난 시각에 걸면 "지남"(울리지 않는다) · 풀기는 멱등', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table('리마인더 지남')
    await tb.setDate({ start: '2020-01-01' })
    const passed = unwrap(await setDateReminder(fx.owner.ctx, tb.row, tb.due, { leadMinutes: 0, timeZone: 'Asia/Seoul' }))
    assert.ok(passed.firedAt instanceof Date, '지난 시각 — 건 시각에 "지남"')

    assert.equal((await clearDateReminder(fx.owner.ctx, tb.row, tb.due)).ok, true)
    assert.deepEqual(await stored(tb.row), [])
    assert.equal((await clearDateReminder(fx.owner.ctx, tb.row, tb.due)).ok, true, '이미 풀렸어도 성공')
  })
})
