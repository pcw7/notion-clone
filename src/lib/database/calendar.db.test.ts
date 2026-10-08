/**
 * 캘린더 — 레이아웃 · 보이는 기간의 행 (DB 심화 2g-1조각 · F-04-06, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더
 *
 * 이 파일이 지키는 것.
 *
 *   ① 레이아웃 — 만들 때 첫 날짜 속성을 고른다 · 없으면 `date_required` · 표에서 바꿀 때도 · 날짜 속성 바꾸기(날짜가 아니면 거부) ·
 *      다른 `configuration` 키를 덮지 않는다 · 날짜 속성을 지우면 null(저장값은 남아 복원하면 돌아온다)
 *   ② ★ 보이는 기간에 걸친 행만 — 기간 앞에서 시작해 걸치는 범위도 · 기간 밖은 아니다 · 날짜순 · 날짜 없는 행은 개수만
 *   ③ ★ 표와 같은 조건 — 필터 · 뷰 검색 · 템플릿 · 휴지통 · 하위 항목은 부모만
 *   ④ 거부 — 틀린 기간 · 캘린더가 아닌 뷰 · 날짜 속성이 지워진 캘린더
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, deleteProperty, getSchema, restoreProperty } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { createTemplate } from './template.ts'
import { createView, getView, updateView } from './view.ts'
import { queryCalendar } from './calendar-query.ts'
import { enableSubItems } from './sub-items.ts'
import { createSubItem } from './sub-item-rows.ts'
import type { CalendarLayout } from './calendar.ts'

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
 * 마감(날짜) · 시작(날짜) · 메모(글). 행:
 *   이른 일   마감 3/1
 *   걸친 일   마감 2/25 ~ 3/2(기간 앞에서 시작해 걸친다)
 *   중간 일   마감 3/10 · 메모 "보고"
 *   늦은 일   마감 4/20(3월 밖)
 *   날짜 없음 · 날짜 없음 2
 */
async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `캘린더 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'date' | 'rich_text') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const due = await add('마감', 'date')
  const start = await add('시작', 'date')
  const memo = await add('메모', 'rich_text')
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string, extra: { propertyId: string; value: CellValue }[] = []) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, ...extra] })).id
  const date = (s: string, e?: string): CellValue => ({ type: 'date', date: e === undefined ? { start: s } : { start: s, end: e } })
  const ids = {
    early: await row('이른 일', [{ propertyId: due, value: date('2026-03-01') }]),
    spanning: await row('걸친 일', [{ propertyId: due, value: date('2026-02-25', '2026-03-02') }]),
    middle: await row('중간 일', [{ propertyId: due, value: date('2026-03-10') }, { propertyId: memo, value: { type: 'rich_text', rich_text: [textRun('보고')] } }]),
    late: await row('늦은 일', [{ propertyId: due, value: date('2026-04-20') }]),
    none1: await row('날짜 없음'),
    none2: await row('날짜 없음 2'),
  }
  return { databaseId: created.id, ds, due, start, memo, titleId, row, date, ids }
}

const titlesIn = async (viewId: string, from: string, to: string, search: string | null = null) => {
  const page = unwrap(await queryCalendar(fx.owner.ctx, viewId, { from, to, search }))
  return { titles: page.rows.map((r) => r.title), undated: page.undated, truncated: page.truncated }
}

describe('① 레이아웃', () => {
  test('★ 첫 날짜 속성을 고른다 · 없으면 거부 · 표에서 바꿀 때도 · 날짜 속성 바꾸기 · 다른 키를 덮지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, due, start, memo } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    assert.deepEqual(view.calendar, { date_property_id: due, view_range: 'month' }, '스키마 순서의 첫 날짜 속성')

    const bare = unwrap(await createDatabase(fx.owner.ctx, { name: `날짜 없는 표 ${Date.now()}` }))
    const refused = await createView(fx.owner.ctx, bare.id, { type: 'calendar' })
    assert.equal(!refused.ok && refused.reason, 'date_required')
    const refusedSwitch = await updateView(fx.owner.ctx, bare.defaultViewId, { type: 'calendar' })
    assert.equal(!refusedSwitch.ok && refusedSwitch.reason, 'date_required')

    const table2 = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'table' }))
    unwrap(await updateView(fx.owner.ctx, table2.id, { gallery: { cover_size: 'large' } }))
    const switched = unwrap(await updateView(fx.owner.ctx, table2.id, { type: 'calendar' }))
    assert.equal(switched.calendar.date_property_id, due, '표에서 바꿀 때도 고른다')
    assert.equal(switched.gallery.cover_size, 'large', '다른 configuration 키(갤러리)를 덮지 않는다')

    unwrap(await updateView(fx.owner.ctx, view.id, { calendar: { date_property_id: start } }))
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).calendar.date_property_id, start)
    const notDate = await updateView(fx.owner.ctx, view.id, { calendar: { date_property_id: memo } })
    assert.equal(!notDate.ok && notDate.reason, 'invalid_layout')
    const unknown = await updateView(fx.owner.ctx, view.id, { calendar: { color: 'red' } as unknown as Partial<CalendarLayout> })
    assert.equal(!unknown.ok && unknown.reason, 'invalid_layout')
  })

  test('날짜 속성을 지우면 null — 저장값은 남아 복원하면 돌아온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, ds, due } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    unwrap(await deleteProperty(fx.owner.ctx, ds, due))
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).calendar.date_property_id, null)
    const r = await queryCalendar(fx.owner.ctx, view.id, { from: '2026-03-01', to: '2026-03-31' })
    assert.equal(!r.ok && r.reason, 'no_date_property')
    unwrap(await restoreProperty(fx.owner.ctx, ds, due))
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).calendar.date_property_id, due)
  })
})

describe('② 보이는 기간', () => {
  test('★ 걸친 행만 · 기간 앞에서 시작한 범위도 · 날짜순 · 날짜 없는 행은 개수만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    assert.deepEqual(await titlesIn(view.id, '2026-03-01', '2026-03-31'), {
      titles: ['걸친 일', '이른 일', '중간 일'],
      undated: 2,
      truncated: false,
    })
    assert.deepEqual((await titlesIn(view.id, '2026-04-01', '2026-04-30')).titles, ['늦은 일'])
    assert.deepEqual((await titlesIn(view.id, '2026-03-05', '2026-03-05')).titles, [], '하루도 — 넓혀 묻는 하루에 걸친 행은 화면이 거른다(여기서는 없다)')
  })
})

describe('③ 표와 같은 조건', () => {
  test('★ 필터 · 뷰 검색 · 템플릿 · 휴지통 · 하위 항목은 부모만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId, ds, due, memo, date, ids } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    assert.deepEqual((await titlesIn(view.id, '2026-03-01', '2026-03-31', '보고')).titles, ['중간 일'], '뷰 검색')

    const template = unwrap(await createTemplate(fx.owner.ctx, ds, { title: '틀' }))
    unwrap(await updateCells(fx.owner.ctx, template.id, { cells: [{ propertyId: due, value: date('2026-03-15') }] }))
    unwrap(await trashRow(fx.owner.ctx, ids.early))
    unwrap(await enableSubItems(fx.owner.ctx, ds))
    unwrap(await createSubItem(fx.owner.ctx, ds, ids.middle, { cells: [{ propertyId: due, value: date('2026-03-12') }] }))
    assert.deepEqual((await titlesIn(view.id, '2026-03-01', '2026-03-31')).titles, ['걸친 일', '중간 일'], '템플릿 · 휴지통 · 자식은 없다')

    unwrap(await updateView(fx.owner.ctx, view.id, { filter: { property_id: memo, operator: 'is_not_empty' } }))
    const filtered = await titlesIn(view.id, '2026-03-01', '2026-03-31')
    assert.deepEqual(filtered.titles, ['중간 일'], '필터')
    assert.equal(filtered.undated, 0, '날짜 없는 행의 수도 같은 조건이다')
  })
})

describe('④ 거부', () => {
  test('틀린 기간 · 캘린더가 아닌 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { databaseId } = await table()
    const view = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'calendar' }))
    for (const [from, to] of [['2026-03-31', '2026-03-01'], ['2026-02-30', '2026-03-01'], ['2026-01-01', '2026-06-01'], ['어제', '오늘']]) {
      const r = await queryCalendar(fx.owner.ctx, view.id, { from: from!, to: to! })
      assert.equal(!r.ok && r.reason, 'invalid_value', `${from} ~ ${to}`)
    }
    const table2 = unwrap(await createView(fx.owner.ctx, databaseId, { type: 'table' }))
    const r = await queryCalendar(fx.owner.ctx, table2.id, { from: '2026-03-01', to: '2026-03-31' })
    assert.equal(!r.ok && r.reason, 'not_calendar')
  })
})
