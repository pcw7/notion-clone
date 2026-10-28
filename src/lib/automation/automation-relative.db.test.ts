/**
 * 자동화 조건의 상대 날짜 — 저장한 사람의 시간대로 (자동화 조건의 상대 날짜 트랙 A-1 · F-08-09 · F-04-09)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 R-1] ④ · 0118
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 같은 조건(다음 1주 안)이라도 저장한 사람의 시간대의 오늘로 판정한다 — 키리티마티(UTC+14)는 맞고 파고파고(UTC−11)는 아니다
 *   ② 시간대를 적는다 — 만들 때 · 트리거를 다시 저장할 때만 바뀐다(켜고 끄기는 그대로) · 모르는 이름은 UTC
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from '../database/database.ts'
import { addProperty } from '../database/property.ts'
import { createRow, updateCells } from '../database/row.ts'
import { todayIn } from '../database/date-group.ts'
import { createDbAutomation, updateDbAutomation } from './db-automation.ts'
import { runAutomationDispatch } from './dispatch.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${JSON.stringify(r)}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function table() {
  const db = unwrap(await createDatabase(fx.owner.ctx, { name: `시간대 자동화 ${Date.now()}` }))
  const ds = db.dataSourceId
  const id = async (name: string, type: 'date' | 'checkbox') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  return { ds, due: await id('마감', 'date'), east: await id('동쪽', 'checkbox'), west: await id('서쪽', 'checkbox'), row: unwrap(await createRow(fx.owner.ctx, ds)).id }
}

const cellOf = async (row: string, property: string) =>
  (await query<{ value: unknown }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [row, property]))[0]?.value ?? null
const zoneOf = async (id: string) => (await query<{ time_zone: string | null }>(`SELECT time_zone FROM automation WHERE id = $1`, [id]))[0]?.time_zone

describe('① 저장한 사람의 오늘로', () => {
  test('★ 같은 "다음 1주 안" — 키리티마티의 오늘 + 7 은 동쪽(UTC+14)에 맞고 서쪽(UTC−11)에는 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const onDue = (target: string, timeZone: string, name: string) =>
      createDbAutomation(fx.owner.ctx, tb.ds, {
        name,
        triggers: [{ type: 'property_edited', propertyId: tb.due, condition: { property_id: tb.due, operator: 'next_week' } }],
        actions: [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: target, value: { type: 'checkbox', checkbox: true } }] } }],
        timeZone,
      })
    unwrap(await onDue(tb.east, 'Pacific/Kiritimati', '동쪽'))
    unwrap(await onDue(tb.west, 'Pacific/Pago_Pago', '서쪽'))
    const k = todayIn('Pacific/Kiritimati')
    unwrap(await updateCells(fx.owner.ctx, tb.row, { cells: [{ propertyId: tb.due, value: { type: 'date', date: { start: plusDays(k, 7) } } }] }))
    await runAutomationDispatch(new Date(Date.now() + 10_000), { workspaces: [fx.workspaceId] })
    assert.deepEqual(await cellOf(tb.row, tb.east), { type: 'checkbox', checkbox: true }, '키리티마티의 다음 1주 안')
    assert.equal(await cellOf(tb.row, tb.west), null, '파고파고의 오늘은 하루 이상 늦다 — 8일 뒤라 아니다')
  })
})

describe('② 시간대를 적는다', () => {
  test('만들 때 · 트리거를 다시 저장할 때만 바뀐다 — 켜고 끄기는 그대로 · 모르는 이름은 UTC', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const triggers = [{ type: 'property_edited', propertyId: tb.due, condition: { property_id: tb.due, operator: 'this_week' } }]
    const actions = [{ type: 'edit_property', config: { v: 1, cells: [{ propertyId: tb.east, value: { type: 'checkbox', checkbox: true } }] } }]
    const made = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, { name: '이번 주', triggers, actions, timeZone: 'Asia/Seoul' }))
    assert.equal(await zoneOf(made.id), 'Asia/Seoul')
    unwrap(await updateDbAutomation(fx.owner.ctx, tb.ds, made.id, { enabled: false, timeZone: 'Pacific/Kiritimati' }))
    assert.equal(await zoneOf(made.id), 'Asia/Seoul', '켜고 끄기는 시간대를 바꾸지 않는다')
    unwrap(await updateDbAutomation(fx.owner.ctx, tb.ds, made.id, { triggers, timeZone: 'Pacific/Kiritimati' }))
    assert.equal(await zoneOf(made.id), 'Pacific/Kiritimati', '트리거를 다시 저장하면 그 사람의 것')
    const odd = unwrap(await createDbAutomation(fx.owner.ctx, tb.ds, { name: '모르는 곳', triggers, actions, timeZone: 'Mars/Base' }))
    assert.equal(await zoneOf(odd.id), 'UTC')
  })
})
