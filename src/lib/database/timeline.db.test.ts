/**
 * 타임라인 뷰 — 서버 (41번 트랙 TL-1 · F-04-07, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 TL-1]
 *
 *   ① ★ 만들면 첫 날짜 속성을 고른다(기본 줌 week · 표 보임) · 없으면 `date_required` · 줌이 남는다 · 모르는 줌은 `invalid_layout`
 *   ② ★ `queryTimeline` — 1년 창(캘린더의 62일보다 넓다)에 걸친 행 · 창 가장자리를 걸친 기간 · 밖은 제외 · 날짜 없음은 센다
 *   ③ ★ 창은 732일까지 · 뷰 종류가 다르면 서로 거부한다 · 날짜 없는 행 목록이 타임라인 뷰에도 열린다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { disableDependencies, enableDependencies } from './dependencies.ts'
import { linkRows } from './relation.ts'
import { queryCalendar, queryTimeline, queryUndatedRows } from './calendar-query.ts'
import type { TimelineLayout } from './timeline.ts'

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
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

/**
 * 일정(날짜). 행:
 *   봄 일    2026-03-10
 *   걸친 일  2025-12-20 ~ 2026-01-05 (창 시작 2026-01-01 을 걸친다)
 *   가을 일  2026-10-15
 *   먼 일    2028-05-01 (창 밖)
 *   옛 일    2024-01-01 (창 밖)
 *   날짜 없음 · 날짜 없음 2
 */
async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `타임라인 ${Date.now()}` }))
  const ds = created.dataSourceId
  const due = unwrap(await addProperty(fx.owner.ctx, ds, { name: '일정', type: 'date' })).properties.find((p) => p.name === '일정')!.id
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string, extra: { propertyId: string; value: CellValue }[] = []) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, ...extra] })).id
  const date = (s: string, e?: string): CellValue => ({ type: 'date', date: e === undefined ? { start: s } : { start: s, end: e } })
  await row('봄 일', [{ propertyId: due, value: date('2026-03-10') }])
  await row('걸친 일', [{ propertyId: due, value: date('2025-12-20', '2026-01-05') }])
  await row('가을 일', [{ propertyId: due, value: date('2026-10-15') }])
  await row('먼 일', [{ propertyId: due, value: date('2028-05-01') }])
  await row('옛 일', [{ propertyId: due, value: date('2024-01-01') }])
  await row('날짜 없음')
  await row('날짜 없음 2')
  return { databaseId: created.id, due }
}

describe('① 레이아웃', () => {
  test('★ 첫 날짜 속성 · 기본 줌 · 없으면 거부 · 줌이 남는다 · 모르는 줌은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, due } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))
    assert.equal(view.type, 'timeline')
    assert.deepEqual(view.timeline, { date_property_id: due, zoom: 'week', show_table: true, color_by: null })

    const bare = unwrap(await createDatabase(fx.owner.ctx, { name: `날짜 없는 표 ${Date.now()}` }))
    const refused = await createView(fx.owner.ctx, bare.id, { type: 'timeline' })
    assert.equal(!refused.ok && refused.reason, 'date_required')
    const refusedSwitch = await updateView(fx.owner.ctx, bare.defaultViewId, { type: 'timeline' })
    assert.equal(!refusedSwitch.ok && refusedSwitch.reason, 'date_required')

    const patched = unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { zoom: 'month', show_table: false } }))
    assert.deepEqual(patched.timeline, { date_property_id: due, zoom: 'month', show_table: false, color_by: null })
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).timeline.zoom, 'month', '저장돼 있다')

    const bad = await updateView(fx.owner.ctx, view.id, { timeline: { zoom: 'hour' as TimelineLayout['zoom'] } })
    assert.equal(!bad.ok && bad.reason, 'invalid_layout')
    const unknown = await updateView(fx.owner.ctx, view.id, { timeline: { color_by: 'x' } as unknown as Partial<TimelineLayout> })
    assert.equal(!unknown.ok && unknown.reason, 'invalid_layout')

    const tbl = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'table' }))
    const switched = unwrap(await updateView(fx.owner.ctx, tbl.id, { type: 'timeline' }))
    assert.equal(switched.timeline.date_property_id, due, '표에서 바꿀 때도 고른다')
  })
})

describe('①-b 막대 색 (TL-7)', () => {
  test('★ 선택 · 상태 속성을 고르고 · null 로 지우고 · 지워진 속성은 null 로 읽고 · 맞지 않는 타입은 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, due } = await table()
    const ds = unwrap(await getView(fx.owner.ctx, unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' })).id)).dataSourceId
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '분류', type: 'select' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '진행', type: 'status' }))
    unwrap(await addProperty(fx.owner.ctx, ds, { name: '메모', type: 'rich_text' }))
    const props = unwrap(await getSchema(fx.owner.ctx, ds)).properties
    const idOf = (name: string) => props.find((p) => p.name === name)!.id
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))

    const set = unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { color_by: idOf('분류') } }))
    assert.deepEqual(set.timeline, { date_property_id: due, zoom: 'week', show_table: true, color_by: idOf('분류') })
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).timeline.color_by, idOf('분류'), '저장돼 있다')
    const other = unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { zoom: 'month' } }))
    assert.equal(other.timeline.color_by, idOf('분류'), '다른 키를 바꿔도 남는다')
    assert.equal(unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { color_by: idOf('진행') } })).timeline.color_by, idOf('진행'), '상태도 된다')

    for (const bad of [idOf('메모'), due, 'nope']) {
      const refused = await updateView(fx.owner.ctx, view.id, { timeline: { color_by: bad } })
      assert.equal(!refused.ok && refused.reason, 'invalid_layout', `거부: ${bad}`)
    }

    const cleared = unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { color_by: null } }))
    assert.equal(cleared.timeline.color_by, null)
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).timeline.color_by, null)

    unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { color_by: idOf('분류') } }))
    unwrap(await deleteProperty(fx.owner.ctx, ds, idOf('분류')))
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).timeline.color_by, null, '지워진 속성은 없는 것과 같다')
    const after = unwrap(await updateView(fx.owner.ctx, view.id, { timeline: { zoom: 'day' } }))
    assert.equal(after.timeline.color_by, null, '다음 저장에서 죽은 키는 떨어진다')
  })
})

describe('② 창의 행', () => {
  test('★ 1년 창 — 걸친 기간 포함 · 밖 제외 · 날짜 없음은 센다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, due } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))
    const page = unwrap(await queryTimeline(fx.owner.ctx, view.id, { from: '2026-01-01', to: '2026-12-31' }))
    assert.equal(page.datePropertyId, due)
    assert.deepEqual(page.rows.map((r) => r.title), ['걸친 일', '봄 일', '가을 일'], '시작일 순')
    assert.equal(page.undated, 2)
    assert.equal(page.truncated, false)
  })
})

describe('③ 창의 상한 · 종류', () => {
  test('★ 732일까지 · 넘으면 invalid_value', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))
    const edge = await queryTimeline(fx.owner.ctx, view.id, { from: '2026-01-01', to: '2028-01-03' }) // 732일
    assert.equal(edge.ok, true)
    const over = await queryTimeline(fx.owner.ctx, view.id, { from: '2026-01-01', to: '2028-01-04' }) // 733일
    assert.equal(!over.ok && over.reason, 'invalid_value')
    const backwards = await queryTimeline(fx.owner.ctx, view.id, { from: '2026-02-01', to: '2026-01-01' })
    assert.equal(!backwards.ok && backwards.reason, 'invalid_value')
  })

  test('★ 종류가 다르면 서로 거부 · 날짜 없는 행 목록은 타임라인에도 열린다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId } = await table()
    const tl = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))
    const cal = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    const a = await queryTimeline(fx.owner.ctx, cal.id, { from: '2026-01-01', to: '2026-01-31' })
    assert.equal(!a.ok && a.reason, 'not_timeline')
    const b = await queryCalendar(fx.owner.ctx, tl.id, { from: '2026-01-01', to: '2026-01-31' })
    assert.equal(!b.ok && b.reason, 'not_calendar')
    // 캘린더는 62일 상한 그대로
    const c = await queryCalendar(fx.owner.ctx, cal.id, { from: '2026-01-01', to: '2026-12-31' })
    assert.equal(!c.ok && c.reason, 'invalid_value')

    const undated = unwrap(await queryUndatedRows(fx.owner.ctx, tl.id))
    assert.deepEqual(undated.rows.map((r) => r.title).sort(), ['날짜 없음', '날짜 없음 2'])
  })
})

describe('④ 종속 관계 간선 (TL-4)', () => {
  test('★ 켜져 있으면 창 안 두 행의 간선이 막는 행 → 막힌 행으로 · 한쪽이 창 밖이면 빠지고 · 꺼지면 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'timeline' }))
    const win = { from: '2026-01-01', to: '2026-12-31' }
    const page0 = unwrap(await queryTimeline(fx.owner.ctx, view.id, win))
    assert.deepEqual(page0.dependencies, [], '꺼져 있으면 없다')
    const ds = unwrap(await getView(fx.owner.ctx, view.id)).dataSourceId
    const pair = unwrap(await enableDependencies(fx.owner.ctx, ds))
    const idOf = (rows: readonly { id: string; title: string }[], title: string) => rows.find((r) => r.title === title)!.id
    const spring = idOf(page0.rows, '봄 일')
    const autumn = idOf(page0.rows, '가을 일')
    const far = unwrap(await queryTimeline(fx.owner.ctx, view.id, { from: '2028-01-01', to: '2028-12-31' })).rows[0]!.id
    // 가을 일은 봄 일에 막힌다(선행 작업 = 봄 일) · 먼 일(창 밖)은 봄 일에 막힌다
    unwrap(await linkRows(fx.owner.ctx, autumn, pair.blockedByPropertyId, { add: [spring] }))
    unwrap(await linkRows(fx.owner.ctx, far, pair.blockedByPropertyId, { add: [spring] }))
    const page = unwrap(await queryTimeline(fx.owner.ctx, view.id, win))
    assert.deepEqual(page.dependencies, [{ from: spring, to: autumn }], '방향 = from 막는 행, to 막힌 행 · 창 밖 끝은 빠진다')
    // 캘린더는 늘 비어 있다
    const cal = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    assert.deepEqual(unwrap(await queryCalendar(fx.owner.ctx, cal.id, { from: '2026-03-01', to: '2026-03-31' })).dependencies, [])
    unwrap(await disableDependencies(fx.owner.ctx, ds))
    assert.deepEqual(unwrap(await queryTimeline(fx.owner.ctx, view.id, win)).dependencies, [], '끄면 간선이 있어도 없다')
  })
})
