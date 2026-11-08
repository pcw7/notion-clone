/**
 * 차트 뷰 — 서버 (38번 트랙 CH-1 · F-04-08, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-1]
 *
 *   ① ★ 차트를 만들면 보드처럼 묶을 수 있는 첫 속성을 고른다 · 묶을 속성이 없으면 `group_required`
 *   ② ★ `queryGroupSummary` — 그룹마다 개수 · 계산 값(없으면 null) · 숨긴 그룹도 싣는다
 *   ③ ★ 차트 설정 저장 — 종류가 남는다 · 모르는 종류는 `invalid_layout` · 표로 바꿔도 `configuration.chart` 는 남는다
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { createView, updateView } from './view.ts'
import { queryGroupSummary } from './group.ts'
import { DEFAULT_CHART_LAYOUT } from './chart.ts'

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

/** 상태(가 · 나 · 다)로 묶는 표. 수량은 가 = 10 · 20, 나 = 5, 다는 행이 없다. */
async function fixture() {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `차트 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'number' | 'select') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const n = await add('수량', 'number')
  const s = await add('상태', 'select')
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, s, { name })).option.id
  const [a, b, c] = [await opt('가'), await opt('나'), await opt('다')]
  for (const [num, option] of [[10, a], [20, a], [5, b]] as const) {
    const cells: { propertyId: string; value: CellValue }[] = [
      { propertyId: n, value: { type: 'number', number: num } },
      { propertyId: s, value: { type: 'select', select: { id: option } } },
    ]
    unwrap(await createRow(fx.owner.ctx, ds, { cells }))
  }
  return { created, ds, n, s, a, b, c }
}

describe('① 만들 때 그룹', () => {
  test('★ 차트를 만들면 묶을 수 있는 첫 속성을 고른다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart' }))
    assert.equal(view.type, 'chart')
    assert.ok(view.groupBy !== null, '그룹이 있다')
    assert.deepEqual(view.chart, DEFAULT_CHART_LAYOUT)
  })

  test('★ 묶을 속성이 없으면 group_required', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const created = unwrap(await createDatabase(fx.owner.ctx, { name: `빈 차트 ${Date.now()}` }))
    const r = await createView(fx.owner.ctx, created.id, { type: 'chart' })
    assert.deepEqual(r.ok ? null : r.reason, 'group_required')
  })
})

describe('② 그룹 요약', () => {
  test('★ 개수 — 그룹마다, 행이 없는 그룹은 0, 계산이 없으면 value null', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s, a, b, c } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s } }))
    const page = unwrap(await queryGroupSummary(fx.owner.ctx, view.id))
    assert.equal(page.propertyId, s)
    assert.equal(page.calculation, null)
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g]))
    assert.equal(byKey[a]!.count, 2)
    assert.equal(byKey[b]!.count, 1)
    assert.equal(byKey[c]!.count, 0)
    assert.ok(page.groups.every((g) => g.value === null))
    assert.equal(byKey[a]!.option?.name, '가')
  })

  test('★ 합계 — group_by.calculation 의 값이 그룹마다 온다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s, n, a, b, c } = await fixture()
    const view = unwrap(
      await createView(fx.owner.ctx, created.id, {
        type: 'chart',
        groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } },
      }),
    )
    const page = unwrap(await queryGroupSummary(fx.owner.ctx, view.id))
    assert.deepEqual(page.calculation, { property_id: n, function: 'sum' })
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g.value]))
    assert.deepEqual(byKey[a], { kind: 'number', value: 30 })
    assert.deepEqual(byKey[b], { kind: 'number', value: 5 })
    assert.deepEqual(byKey[c], { kind: 'number', value: 0 })
  })

  test('숨긴 그룹도 싣는다(hidden: true) · hide_empty 면 빈 그룹은 뺀다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s, a, b, c } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s, hidden: [a] } }))
    const page = unwrap(await queryGroupSummary(fx.owner.ctx, view.id))
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g]))
    assert.equal(byKey[a]!.hidden, true)
    assert.equal(byKey[a]!.count, 2)
    assert.equal(byKey[b]!.hidden, false)
    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, hide_empty: true } }))
    const slim = unwrap(await queryGroupSummary(fx.owner.ctx, view.id))
    assert.ok(!slim.groups.some((g) => g.key === c), '행이 없는 그룹은 빠진다')
    assert.ok(slim.groups.some((g) => g.key === a))
  })
})

describe('②-2 값 하나(CH-4) — total', () => {
  test('★ 계산이 없으면 total 은 행 개수', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s } }))
    const page = unwrap(await queryGroupSummary(fx.owner.ctx, view.id))
    assert.deepEqual(page.total, { kind: 'count', value: 3 })
  })

  test('★ 합계 · 평균은 모든 행에 한 번 — 그룹 값의 합 · 평균의 평균이 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s, n } = await fixture()
    const view = unwrap(
      await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } } }),
    )
    assert.deepEqual(unwrap(await queryGroupSummary(fx.owner.ctx, view.id)).total, { kind: 'number', value: 35 })
    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: n, function: 'average' } } }))
    const avg = unwrap(await queryGroupSummary(fx.owner.ctx, view.id)).total
    assert.equal(avg.kind, 'number')
    // 가 = 15 · 나 = 5 → 그룹 평균의 평균은 10 이지만 전체 평균은 35 / 3
    assert.ok(Math.abs((avg.value ?? 0) - 35 / 3) < 1e-9, `전체 평균 ${avg.value}`)
  })

  test('★ 뷰의 필터를 지난 행만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s, n, a } = await fixture()
    const view = unwrap(
      await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } } }),
    )
    unwrap(await updateView(fx.owner.ctx, view.id, { filter: { property_id: s, operator: 'equals', value: a } }))
    assert.deepEqual(unwrap(await queryGroupSummary(fx.owner.ctx, view.id)).total, { kind: 'number', value: 30 })
    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s } }))
    assert.deepEqual(unwrap(await queryGroupSummary(fx.owner.ctx, view.id)).total, { kind: 'count', value: 2 })
  })
})

describe('③ 차트 설정', () => {
  test('★ 종류가 남는다 · 모르는 종류는 invalid_layout · 키는 합쳐진다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s } }))
    const donut = unwrap(await updateView(fx.owner.ctx, view.id, { chart: { kind: 'donut' } }))
    assert.deepEqual(donut.chart, { kind: 'donut', data_labels: false, cumulative: false })
    const labeled = unwrap(await updateView(fx.owner.ctx, view.id, { chart: { data_labels: true } }))
    assert.deepEqual(labeled.chart, { kind: 'donut', data_labels: true, cumulative: false })
    const bad = await updateView(fx.owner.ctx, view.id, { chart: { kind: 'pie' as never } })
    assert.deepEqual(bad.ok ? null : bad.reason, 'invalid_layout')
  })

  test('표로 바꿔도 configuration.chart 는 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { created, s } = await fixture()
    const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'chart', groupBy: { property_id: s } }))
    unwrap(await updateView(fx.owner.ctx, view.id, { chart: { kind: 'line' } }))
    const table = unwrap(await updateView(fx.owner.ctx, view.id, { type: 'table' }))
    assert.equal(table.type, 'table')
    assert.equal(table.chart.kind, 'line')
  })
})
