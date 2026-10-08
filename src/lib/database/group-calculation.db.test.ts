/**
 * 그룹 집계 — 보드 그룹 머리의 계산 (DB 심화 2d-3조각 · F-04-16, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 열 집계 ⑤
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹마다 따로 — 합계 · 평균이 그 그룹의 행으로만 나온다 · 행이 없는 그룹은 빈 통계(합 0 · 평균 빈 값)
 *   ② ★ 카드 수와 같은 행들 — 필터 · 템플릿 · 휴지통 · 하위 항목의 "부모만" · 숨긴 그룹도 계산한다
 *   ③ ★ 고를 수 없는 계산은 거부(`invalid_group`) · 없는 속성도 · 타입을 바꾸면 머리는 카드 수로(저장값은 남는다)
 *   ④ 계산만 다시 받기(`queryGroupCalculations`) — 카드를 옮긴 뒤의 값 · 계산이 없으면 빈 답
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { createTemplate } from './template.ts'
import { createView, getView, updateView, type ViewDetail } from './view.ts'
import { moveRow, queryGroupCalculations, queryGroups, type GroupBy } from './group.ts'
import { convertProperty } from './property-convert.ts'
import { enableSubItems } from './sub-items.ts'
import { createSubItem } from './sub-item-rows.ts'
import type { CalculationResult } from './calculations.ts'

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
 * 상태(가 · 나 · 다 · 없음)로 묶는 보드. 수량은 가 = 10 · 20, 나 = (빈 칸), 없음 = 60 — 다는 행이 없다.
 * 가의 합(30)이 표 전체의 합(90)과 갈리고, 평균(15)이 합과 갈린다.
 */
async function board(groupBy: Omit<GroupBy, 'property_id'> = {}) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `그룹 집계 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'number' | 'select') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const n = await add('수량', 'number')
  const s = await add('상태', 'select')
  const opt = async (name: string) => unwrap(await addSelectOption(fx.owner.ctx, ds, s, { name })).option.id
  const [a, b, c] = [await opt('가'), await opt('나'), await opt('다')]
  const rows: [number | null, string | null][] = [
    [10, a],
    [20, a],
    [null, b],
    [60, null],
  ]
  const ids: string[] = []
  for (const [num, option] of rows) {
    const cells: { propertyId: string; value: CellValue }[] = []
    if (num !== null) cells.push({ propertyId: n, value: { type: 'number', number: num } })
    if (option !== null) cells.push({ propertyId: s, value: { type: 'select', select: { id: option } } })
    ids.push(unwrap(await createRow(fx.owner.ctx, ds, { cells })).id)
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'board', groupBy: { property_id: s, ...groupBy } }))
  return { ds, view, n, s, a, b, c, ids }
}

/** 그룹 키 → 머리 값. */
async function heads(view: ViewDetail): Promise<Record<string, CalculationResult | null>> {
  const page = unwrap(await queryGroups(fx.owner.ctx, view.id))
  return Object.fromEntries(page.groups.map((g) => [g.key, g.calculation]))
}

describe('① 그룹마다 따로', () => {
  test('★ 합계 · 평균이 그 그룹의 행으로만 — 행이 없는 그룹은 합 0 · 평균 빈 값', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const sum = await board()
    unwrap(await updateView(fx.owner.ctx, sum.view.id, { groupBy: { property_id: sum.s, calculation: { property_id: sum.n, function: 'sum' } } }))
    assert.deepEqual(await heads(sum.view), {
      '': { kind: 'number', value: 60 },
      [sum.a]: { kind: 'number', value: 30 },
      [sum.b]: { kind: 'number', value: 0 },
      [sum.c]: { kind: 'number', value: 0 },
    })

    const own = await board()
    unwrap(await updateView(fx.owner.ctx, own.view.id, { groupBy: { property_id: own.s, calculation: { property_id: own.n, function: 'average' } } }))
    const page = unwrap(await queryGroups(fx.owner.ctx, own.view.id))
    assert.deepEqual(page.calculation, { property_id: own.n, function: 'average' })
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g]))
    assert.deepEqual(byKey[own.a]!.calculation, { kind: 'number', value: 15 })
    assert.deepEqual(byKey[own.b]!.calculation, { kind: 'number', value: null }, '값이 전부 빈 그룹의 평균은 빈 값')
    assert.deepEqual(byKey[own.c]!.calculation, { kind: 'number', value: null }, '행이 없는 그룹의 평균은 빈 값')
    assert.equal(byKey[own.a]!.count, 2, '카드 수는 그대로 함께 온다')
    assert.equal(byKey[own.b]!.count, 1, '계산할 칸이 빈 행도 카드다 — 칸을 LEFT JOIN 한다(JOIN 이면 카드 수가 준다)')
  })

  test('계산이 없으면 머리 값은 null(카드 수)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { view } = await board()
    const page = unwrap(await queryGroups(fx.owner.ctx, view.id))
    assert.equal(page.calculation, null)
    assert.ok(page.groups.every((g) => g.calculation === null))
  })
})

describe('② 카드 수와 같은 행들', () => {
  test('★ 필터 · 템플릿 · 휴지통 · 숨긴 그룹', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, view, n, s, a, b, ids } = await board()
    unwrap(
      await updateView(fx.owner.ctx, view.id, {
        filter: { property_id: n, operator: 'greater_than', value: 15 },
        groupBy: { property_id: s, hidden: [a], calculation: { property_id: n, function: 'sum' } },
      }),
    )
    const template = unwrap(await createTemplate(fx.owner.ctx, ds, { title: '틀' }))
    unwrap(
      await updateCells(fx.owner.ctx, template.id, {
        cells: [{ propertyId: n, value: { type: 'number', number: 1000 } }, { propertyId: s, value: { type: 'select', select: { id: a } } }],
      }),
    )
    unwrap(await trashRow(fx.owner.ctx, ids[3]!))
    const page = unwrap(await queryGroups(fx.owner.ctx, view.id))
    const byKey = Object.fromEntries(page.groups.map((g) => [g.key, g]))
    assert.deepEqual(byKey[a]!.calculation, { kind: 'number', value: 20 }, '숨긴 그룹도 계산한다 · 필터를 지난 행만 · 템플릿은 뺀다')
    assert.equal(byKey[a]!.hidden, true)
    assert.deepEqual(byKey['']!.calculation, { kind: 'number', value: 0 }, '휴지통의 행은 뺀다')
    assert.equal(byKey['']!.count, 0)
    assert.deepEqual(byKey[b]!.calculation, { kind: 'number', value: 0 })
  })

  test('★ 하위 항목이 켜진 표 — 보드는 부모만, 머리 값도 부모만', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, view, n, s, a, ids } = await board()
    unwrap(await enableSubItems(fx.owner.ctx, ds))
    unwrap(
      await createSubItem(fx.owner.ctx, ds, ids[0]!, {
        cells: [{ propertyId: n, value: { type: 'number', number: 1000 } }, { propertyId: s, value: { type: 'select', select: { id: a } } }],
      }),
    )
    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } } }))
    const page = unwrap(await queryGroups(fx.owner.ctx, view.id))
    const group = page.groups.find((g) => g.key === a)!
    assert.equal(group.count, 2, '카드는 부모만')
    assert.deepEqual(group.calculation, { kind: 'number', value: 30 }, '자식 행(1000)은 머리 값에 들지 않는다')
  })
})

describe('③ 고를 수 있는 것만', () => {
  test('★ 타입에 맞지 않는 함수 · 없는 속성은 거부 — 타입을 바꾸면 머리는 카드 수로(저장값은 남는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { ds, view, n, s } = await board()
    const wrongFn = await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: s, function: 'sum' } } })
    assert.equal(!wrongFn.ok && wrongFn.reason, 'invalid_group')
    assert.deepEqual(!wrongFn.ok && wrongFn.issues?.map((i) => i.path), ['groupBy.calculation.function'])
    const ghost = await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: 'p'.repeat(21), function: 'count_all' } } })
    assert.equal(!ghost.ok && ghost.reason, 'invalid_group')
    const bogus = await updateView(fx.owner.ctx, view.id, {
      groupBy: { property_id: s, calculation: { property_id: n, function: 'sum_of_squares' } } as unknown as GroupBy,
    })
    assert.equal(!bogus.ok && bogus.reason, 'invalid_group')

    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } } }))
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, view.id)).groupBy?.calculation, { property_id: n, function: 'sum' })

    unwrap(await convertProperty(fx.owner.ctx, ds, n, { type: 'rich_text' }))
    const page = unwrap(await queryGroups(fx.owner.ctx, view.id))
    assert.equal(page.calculation, null, '글이 된 속성의 합계는 계산하지 않는다')
    assert.ok(page.groups.every((g) => g.calculation === null))
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, view.id)).groupBy?.calculation, { property_id: n, function: 'sum' }, '저장값은 남는다')

    // "없음" — null 을 보내면 지운다
    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: null } }))
    assert.equal(unwrap(await getView(fx.owner.ctx, view.id)).groupBy?.calculation, undefined)
  })
})

describe('④ 계산만 다시 받기', () => {
  test('카드를 옮긴 뒤의 값 · 계산이 없으면 빈 답', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const { view, n, s, a, b, c, ids } = await board()
    assert.deepEqual(unwrap(await queryGroupCalculations(fx.owner.ctx, view.id)), { calculation: null, values: {} })

    unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: s, calculation: { property_id: n, function: 'sum' } } }))
    unwrap(await moveRow(fx.owner.ctx, view.id, { rowId: ids[1]!, groupKey: b }))
    const after = unwrap(await queryGroupCalculations(fx.owner.ctx, view.id))
    assert.deepEqual(after.calculation, { property_id: n, function: 'sum' })
    assert.deepEqual(after.values, {
      '': { kind: 'number', value: 60 },
      [a]: { kind: 'number', value: 10 },
      [b]: { kind: 'number', value: 20 },
      [c]: { kind: 'number', value: 0 },
    })
  })
})
