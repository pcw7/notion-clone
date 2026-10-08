/**
 * 열 집계 — 필터를 지난 행 전부의 통계 (DB 심화 2d-1조각 · F-04-16, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 열 집계
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 숫자 열 — 세기 · 합 · 평균 · 중앙값 · 최소 · 최대 · 범위 · 빈 칸 비율이 맞다(빈 칸은 평균에 들지 않는다)
 *   ② ★ 필터를 지난 행만 — 페이지와 무관하게 전부 · 템플릿 · 휴지통은 뺀다
 *   ③ 날짜 · 체크박스 · 선택(고유 값은 옵션 id — 이름을 바꿔도 같다)
 *   ④ ★ 고를 수 없는 함수는 거부한다(`invalid_calculation`) · 타입을 바꾼 뒤 맞지 않는 저장값은 계산에서 빠진다(저장값은 남는다)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow, trashRow } from './row.ts'
import { createTemplate } from './template.ts'
import { getView, setViewColumn } from './view.ts'
import { computeCalculations } from './calculate.ts'
import { convertProperty } from './property-convert.ts'
import type { Calculation } from './calculations.ts'

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

async function table() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `집계 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'number' | 'date' | 'checkbox' | 'select') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const n = await add('수량', 'number')
  const d = await add('마감', 'date')
  const c = await add('완료', 'checkbox')
  const s = await add('상태', 'select')
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, s, { name })).option.id
  const [a, b] = [await opt('가'), await opt('나')]
  const rows: [number | null, string | null, boolean, string | null][] = [
    [10, '2026-03-01', true, a],
    [20, '2026-03-05', false, a],
    [null, null, false, b],
    // 넷째 값은 60 — 평균(30)과 중앙값(20)이 갈리게(같으면 "중앙값을 평균으로" 계산하는 실수를 못 잡는다)
    [60, '2026-03-11', true, null],
  ]
  for (const [num, date, done, option] of rows) {
    const cells: { propertyId: string; value: CellValue }[] = [{ propertyId: c, value: { type: 'checkbox', checkbox: done } }]
    if (num !== null) cells.push({ propertyId: n, value: { type: 'number', number: num } })
    if (date !== null) cells.push({ propertyId: d, value: { type: 'date', date: { start: date } } })
    if (option !== null) cells.push({ propertyId: s, value: { type: 'select', select: { id: option } } })
    unwrap(await createRow(fx.owner.ctx, ds, { cells }))
  }
  return { ds, viewId: created.defaultViewId, n, d, c, s }
}

const calc = (ds: string, propertyId: string, type: string, calculation: Calculation, filter: Parameters<typeof computeCalculations>[2] = null) =>
  computeCalculations(fx.owner.ctx, ds, filter, [{ propertyId, type, calculation }]).then((r) => r[propertyId])

describe('① 숫자 열', () => {
  test('★ 세기 · 합 · 평균 · 중앙값 · 최소 · 최대 · 범위 · 빈 칸 비율 — 빈 칸은 평균에 들지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, n } = await table()
    const expect: [Calculation, unknown][] = [
      ['count_all', { kind: 'count', value: 4 }],
      ['count_values', { kind: 'count', value: 3 }],
      ['count_empty', { kind: 'count', value: 1 }],
      ['sum', { kind: 'number', value: 90 }],
      ['average', { kind: 'number', value: 30 }],
      ['median', { kind: 'number', value: 20 }],
      ['min', { kind: 'number', value: 10 }],
      ['max', { kind: 'number', value: 60 }],
      ['range', { kind: 'number', value: 50 }],
      ['percent_empty', { kind: 'percent', value: 25 }],
    ]
    for (const [fn, value] of expect) assert.deepEqual(await calc(ds, n, 'number', fn), value, fn)
  })
})

describe('② 필터를 지난 행만', () => {
  test('★ 필터 · 템플릿 · 휴지통', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, n } = await table()
    assert.deepEqual(await calc(ds, n, 'number', 'sum', { property_id: n, operator: 'greater_than', value: 15 }), { kind: 'number', value: 80 })
    unwrap(await createTemplate(fx.owner.ctx, ds, { title: '틀' }))
    const extra = unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: n, value: { type: 'number', number: 1000 } }] })).id
    unwrap(await trashRow(fx.owner.ctx, extra))
    assert.deepEqual(await calc(ds, n, 'number', 'count_all'), { kind: 'count', value: 4 }, '템플릿 · 휴지통은 뺀다')
    assert.deepEqual(await calc(ds, n, 'number', 'sum'), { kind: 'number', value: 90 })
  })
})

describe('③ 날짜 · 체크박스 · 선택', () => {
  test('가장 이른 · 늦은 날 · 기간 · 체크 · 고유 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, d, c, s } = await table()
    assert.equal((await calc(ds, d, 'date', 'earliest_date'))?.value?.toString().slice(0, 10), '2026-03-01')
    assert.equal((await calc(ds, d, 'date', 'latest_date'))?.value?.toString().slice(0, 10), '2026-03-11')
    assert.deepEqual(await calc(ds, d, 'date', 'date_range'), { kind: 'days', value: 10 })
    assert.deepEqual(await calc(ds, c, 'checkbox', 'checked'), { kind: 'count', value: 2 })
    assert.deepEqual(await calc(ds, c, 'checkbox', 'percent_checked'), { kind: 'percent', value: 50 })
    assert.deepEqual(await calc(ds, s, 'select', 'count_unique'), { kind: 'count', value: 2 })
    assert.deepEqual(await calc(ds, s, 'select', 'count_values'), { kind: 'count', value: 3 })
  })
})

describe('④ 고를 수 있는 것만', () => {
  test('★ 타입에 맞지 않는 함수는 거부 · 타입을 바꾸면 맞지 않는 저장값은 계산에서 빠진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, viewId, n, s } = await table()
    const refused = await setViewColumn(fx.owner.ctx, viewId, s, { calculation: 'sum' })
    assert.equal(!refused.ok && refused.reason, 'invalid_calculation')
    const bogus = await setViewColumn(fx.owner.ctx, viewId, n, { calculation: 'sum_of_squares' })
    assert.equal(!bogus.ok && bogus.reason, 'invalid_calculation')

    unwrap(await setViewColumn(fx.owner.ctx, viewId, n, { calculation: 'sum' }))
    const view = unwrap(await getView(fx.owner.ctx, viewId))
    assert.equal(view.columns.find((col) => col.propertyId === n)?.calculation, 'sum')
    assert.deepEqual(await computeCalculations(fx.owner.ctx, ds, null, view.columns), { [n]: { kind: 'number', value: 90 } })

    unwrap(await convertProperty(fx.owner.ctx, ds, n, { type: 'rich_text' }))
    const after = unwrap(await getView(fx.owner.ctx, viewId))
    assert.equal(after.columns.find((col) => col.propertyId === n)?.calculation, 'sum', '저장값은 남는다')
    assert.deepEqual(await computeCalculations(fx.owner.ctx, ds, null, after.columns), {}, '맞지 않으면 계산에서 빠진다')

    unwrap(await setViewColumn(fx.owner.ctx, viewId, n, { calculation: null }))
    assert.equal(unwrap(await getView(fx.owner.ctx, viewId)).columns.find((col) => col.propertyId === n)?.calculation, null)
  })
})
