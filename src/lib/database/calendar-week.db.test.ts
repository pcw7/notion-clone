/**
 * 캘린더의 주 시작 요일 · 주말 숨기기 — 캘린더의 나머지 트랙 C-3 (F-04-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 ⑦ · 0117
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 읽기는 늘 두 값(없으면 일요일 · 그린다) · 저장은 기본값이면 싣지 않는다 · 바꿀 키만(날짜 속성은 그대로)
 *   ② 모르는 값은 거부(명령 · CHECK)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { query } from '../db/pool.ts'
import { createDatabase } from './database.ts'
import { addProperty } from './property.ts'
import { createView, getView, updateView } from './view.ts'

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

async function calendarView() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `주의 시작 ${Date.now()}` }))
  const due = unwrap(await addProperty(fx.owner.ctx, created.dataSourceId, { name: '마감', type: 'date' })).properties.find((p) => p.name === '마감')!.id
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'calendar' }))
  const stored = async () =>
    ((await query<{ configuration: { calendar?: Record<string, unknown> } }>(`SELECT configuration FROM view WHERE id = $1`, [view.id]))[0]!.configuration.calendar ?? {})
  return { viewId: view.id, due, stored }
}

describe('① 읽기 · 저장', () => {
  test('★ 읽기는 늘 두 값 · 저장은 기본값이면 싣지 않는다 · 바꿀 키만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const v = await calendarView()
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, v.viewId)).calendar, { date_property_id: v.due, view_range: 'month', week_start: 'sunday', show_weekends: true })
    assert.deepEqual(await v.stored(), { date_property_id: v.due, view_range: 'month' }, '만들 때 — 기본값은 없다')

    const saved = unwrap(await updateView(fx.owner.ctx, v.viewId, { calendar: { week_start: 'monday', show_weekends: false } }))
    assert.deepEqual(saved.calendar, { date_property_id: v.due, view_range: 'month', week_start: 'monday', show_weekends: false })
    assert.deepEqual(await v.stored(), { date_property_id: v.due, view_range: 'month', week_start: 'monday', show_weekends: false })

    // 일요일로 돌리면 그 키만 빠진다 — 주말 숨김은 그대로
    unwrap(await updateView(fx.owner.ctx, v.viewId, { calendar: { week_start: 'sunday' } }))
    assert.deepEqual(await v.stored(), { date_property_id: v.due, view_range: 'month', show_weekends: false })
    unwrap(await updateView(fx.owner.ctx, v.viewId, { calendar: { show_weekends: true } }))
    assert.deepEqual(await v.stored(), { date_property_id: v.due, view_range: 'month' })
  })
})

describe('② 거부', () => {
  test('모르는 주의 시작 · 참 거짓이 아닌 주말 — 명령이 거부한다 · CHECK 도', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const v = await calendarView()
    assert.equal((await updateView(fx.owner.ctx, v.viewId, { calendar: { week_start: 'friday' as 'monday' } })).ok, false)
    assert.equal((await updateView(fx.owner.ctx, v.viewId, { calendar: { show_weekends: 'no' as unknown as boolean } })).ok, false)
    await assert.rejects(
      query(`UPDATE view SET configuration = jsonb_set(configuration, '{calendar,week_start}', '"friday"') WHERE id = $1`, [v.viewId]),
      /ck_view_calendar_layout/,
    )
  })
})
