/**
 * 캘린더의 날짜 없는 행 — 캘린더의 나머지 트랙 C-2 (F-04-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 ⑥
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 수(`undated`)와 같은 조건의 행 — 뷰의 필터를 지나고 날짜가 비었다 · 템플릿은 없다 · 날짜 있는 행은 없다
 *   ② ★ 50개씩 커서로 이어 읽는다 — 겹치거나 빠지는 행이 없다
 *   ③ 캘린더가 아닌 뷰 · 없는 뷰는 거부
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow } from './row.ts'
import { createTemplate } from './template.ts'
import { createView, updateView } from './view.ts'
import { queryCalendar, queryUndatedRows, UNDATED_PAGE_SIZE } from './calendar-query.ts'

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

async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `날짜 없음 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '마감', type: 'date' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '분류', type: 'select' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const due = schema.properties.find((p) => p.name === '마감')!.id
  const kind = schema.properties.find((p) => p.name === '분류')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const ga = unwrap(await addSelectOption(fx.owner.ctx, ds, kind, { name: '가' })).option.id
  const na = unwrap(await addSelectOption(fx.owner.ctx, ds, kind, { name: '나' })).option.id
  const row = async (title: string, date: string | null, option: string) =>
    unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          { propertyId: kind, value: { type: 'select', select: { id: option } } },
          ...(date === null ? [] : [{ propertyId: due, value: { type: 'date' as const, date: { start: date } } }]),
        ],
      }),
    ).id
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'calendar' }))
  return { databaseId: created.id, ds, due, kind, ga, na, row, viewId: view.id }
}

describe('① 수와 같은 조건', () => {
  test('★ 뷰의 필터를 지나고 날짜가 빈 행만 — 템플릿 · 날짜 있는 행은 없다 · 개수는 머리의 수와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    await tb.row('날짜 있음', '2026-03-18', tb.ga)
    const b = await tb.row('비', null, tb.ga)
    const c = await tb.row('씨', null, tb.ga)
    await tb.row('나의 것', null, tb.na)
    unwrap(await createTemplate(fx.owner.ctx, tb.ds, { title: '틀' }))
    unwrap(await updateView(fx.owner.ctx, tb.viewId, { filter: { property_id: tb.kind, operator: 'equals', value: tb.ga } }))

    const page = unwrap(await queryUndatedRows(fx.owner.ctx, tb.viewId))
    assert.deepEqual(page.rows.map((r) => r.id).sort(), [b, c].sort())
    assert.equal(page.hasMore, false)
    const calendar = unwrap(await queryCalendar(fx.owner.ctx, tb.viewId, { from: '2026-03-01', to: '2026-03-31' }))
    assert.equal(calendar.undated, page.rows.length, '머리의 수와 같다')
    // 뷰 검색어도 같은 술어
    assert.deepEqual(unwrap(await queryUndatedRows(fx.owner.ctx, tb.viewId, { search: '씨' })).rows.map((r) => r.id), [c])
  })
})

describe('② 커서', () => {
  test(`★ ${UNDATED_PAGE_SIZE}개씩 이어 읽는다 — 겹치거나 빠지는 행이 없다`, async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const ids: string[] = []
    for (let i = 0; i < UNDATED_PAGE_SIZE + 2; i += 1) ids.push(await tb.row(`행 ${i}`, null, tb.ga))
    const first = unwrap(await queryUndatedRows(fx.owner.ctx, tb.viewId))
    assert.equal(first.rows.length, UNDATED_PAGE_SIZE)
    assert.equal(first.hasMore, true)
    const second = unwrap(await queryUndatedRows(fx.owner.ctx, tb.viewId, { cursor: first.nextCursor }))
    assert.equal(second.rows.length, 2)
    assert.equal(second.hasMore, false)
    assert.deepEqual([...first.rows, ...second.rows].map((r) => r.id).sort(), [...ids].sort())
  })
})

describe('③ 거부', () => {
  test('캘린더가 아닌 뷰 · 없는 뷰', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const tb = await table()
    const asTable = unwrap(await createView(fx.owner.ctx, tb.databaseId, { type: 'table' }))
    assert.deepEqual(await queryUndatedRows(fx.owner.ctx, asTable.id), { ok: false, reason: 'not_calendar' })
    assert.deepEqual(await queryUndatedRows(fx.owner.ctx, randomUUID()), { ok: false, reason: 'not_found' })
  })
})
