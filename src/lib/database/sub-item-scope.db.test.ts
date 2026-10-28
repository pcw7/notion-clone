/**
 * 하위 항목의 표시 범위 — 필터를 거는 층 · 맞는 자손의 조상은 회색으로 (23번 트랙 P-1 · F-04-22 · F-03-18, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 P-1] 하위 항목의 표시 범위
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 부모와 하위(기본) — 필터가 모든 층에 걸리고, 필터에 걸린 부모가 맞는 자식의 맥락 행으로 선다(조상 강제 포함) · 맞은 것이
 *        없는 행은 서지 않는다
 *   ② ★ 부모만 — 최상위에만 필터 · 자식은 다 선다 · 맥락 행이 없다. 검색어가 있어도 최상위는 필터를 지나야 한다
 *   ③ ★ 하위만 — 최상위는 다 서고 자식에만 필터 · 아래에 맞은 자식이 있는 최상위만 `below`
 *   ④ 저장 — 읽기는 셋 중 하나(기본 `both`) · `both` 는 NULL 로 · 틀린 값은 `invalid_layout`
 *   ⑤ ★ 열 집계는 범위의 층에서 — 부모와 하위: 모든 층 · 부모만: 최상위 · 하위만: 최상위가 아닌 행
 *   ⑥ ★ 필터 · 검색어가 없으면 맞춤이 걸리지 않는다 — 예전 트리 그대로(표시 없음 · 범위마다 · 질의가 죽지 않는다 — e2e 가 잡았다:
 *        쓰지 않는 자리표를 묶으면 Postgres 가 그 타입을 정하지 못한다)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다 — HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { withReadTransaction } from '../db/tx.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { getSchema } from './property.ts'
import { createRow } from './row.ts'
import { queryRows } from './query.ts'
import { linkRows } from './relation.ts'
import { enableSubItems } from './sub-items.ts'
import { getView, updateView } from './view.ts'
import { computeCalculations } from './calculate.ts'
import type { SubItemFilterScope } from './sub-item-scope.ts'

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
 * 가 ─ 가-1 끝 · 가-2 / 나 끝 ─ 나-1 / 다. 필터는 "제목에 끝이 든다".
 * `level(scope, under)` 은 그 층의 [제목, 맞았는가, 아래에 맞은 행이 있는가].
 */
async function forest(name: string) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const { parentPropertyId } = unwrap(await enableSubItems(fx.owner.ctx, ds))
  const row = async (title: string, parent?: string) => {
    const id = unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }] })).id
    if (parent !== undefined) unwrap(await linkRows(fx.owner.ctx, id, parentPropertyId, { add: [parent] }))
    return id
  }
  const ga = await row('가')
  await row('가-1 끝', ga)
  await row('가-2', ga)
  const na = await row('나 끝')
  await row('나-1', na)
  await row('다')
  const filter = { property_id: titleId, operator: 'contains', value: '끝' } as const
  const level = async (scope: SubItemFilterScope, under: string | null, search: string | null = null) =>
    unwrap(
      await queryRows(fx.owner.ctx, ds, { filter, search, tree: { parentPropertyId, under }, treeScope: { parentPropertyId, scope } }),
    ).rows.map((r) => [r.title, r.treeMatch?.matched, r.treeMatch?.below])
  return { ds, viewId: created.defaultViewId, titleId, parentPropertyId, ga, na, filter, level }
}

describe('① 부모와 하위(기본)', () => {
  test('★ 필터가 모든 층에 · 필터에 걸린 부모가 맞는 자식의 맥락 행으로 선다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ①')
    assert.deepEqual(await f.level('both', null), [
      ['가', false, true],
      ['나 끝', true, false],
    ], '가는 맥락 행 · 다는 서지 않는다')
    assert.deepEqual(await f.level('both', f.ga), [['가-1 끝', true, false]], '맞지 않는 자식(가-2)은 서지 않는다')
    assert.deepEqual(await f.level('both', f.na), [], '맞은 부모의 자식이라도 맞지 않으면 서지 않는다')
  })
})

describe('② 부모만', () => {
  test('★ 최상위에만 필터 · 자식은 다 선다 · 맥락 행이 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ②')
    assert.deepEqual(await f.level('parents', null), [['나 끝', undefined, undefined]], '맞춤이 걸리지 않는다 — 표시가 없다')
    assert.deepEqual(await f.level('parents', f.na), [['나-1', undefined, undefined]], '자식은 필터와 상관없이 선다')
  })

  test('검색어가 있어도 최상위는 필터를 지나야 한다 — 자식이 맞아도 끌어올리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ② 검색')
    assert.deepEqual(await f.level('parents', null, '1'), [['나 끝', false, true]], '가-1 끝이 검색어에 맞아도 가는 서지 않는다')
    assert.deepEqual(await f.level('parents', f.na, '1'), [['나-1', true, false]])
  })
})

describe('③ 하위만', () => {
  test('★ 최상위는 다 서고 자식에만 필터', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ③')
    assert.deepEqual(await f.level('sub_items', null), [
      ['가', true, true],
      ['나 끝', true, false],
      ['다', true, false],
    ])
    assert.deepEqual(await f.level('sub_items', f.ga), [['가-1 끝', true, false]])
    assert.deepEqual(await f.level('sub_items', f.na), [])
  })
})

describe('④ 저장', () => {
  test('읽기는 셋 중 하나 · both 는 NULL 로 · 틀린 값은 invalid_layout', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ④')
    const stored = async () =>
      (await withReadTransaction((tx) => tx.queryOne<{ s: string | null }>(`SELECT sub_item_filter_scope AS s FROM view WHERE id = $1`, [f.viewId]))).s
    assert.equal(unwrap(await getView(fx.owner.ctx, f.viewId)).subItemFilterScope, 'both', '기본')
    unwrap(await updateView(fx.owner.ctx, f.viewId, { subItemFilterScope: 'sub_items' }))
    assert.equal(unwrap(await getView(fx.owner.ctx, f.viewId)).subItemFilterScope, 'sub_items')
    assert.equal(await stored(), 'sub_items')
    unwrap(await updateView(fx.owner.ctx, f.viewId, { subItemFilterScope: 'both' }))
    assert.equal(await stored(), null, '기본은 NULL 하나로 적는다')
    const wrong = await updateView(fx.owner.ctx, f.viewId, { subItemFilterScope: 'sideways' as SubItemFilterScope })
    assert.equal(wrong.ok, false)
    assert.equal(wrong.ok === false ? wrong.reason : null, 'invalid_layout')
  })
})

describe('⑤ 열 집계는 범위의 층에서', () => {
  test('★ 부모와 하위: 모든 층 · 부모만: 최상위 · 하위만: 최상위가 아닌 행', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ⑤')
    const count = async (scope: SubItemFilterScope, filter: typeof f.filter | null) => {
      const out = await computeCalculations(fx.owner.ctx, f.ds, filter, [{ propertyId: f.titleId, type: 'title', calculation: 'count_all' }], null, null,
        { parentPropertyId: f.parentPropertyId, scope })
      return (out[f.titleId] as { value?: unknown } | undefined)?.value
    }
    assert.equal(await count('both', f.filter), 2, '가-1 끝 · 나 끝')
    assert.equal(await count('parents', f.filter), 1, '나 끝')
    assert.equal(await count('sub_items', f.filter), 1, '가-1 끝')
    assert.equal(await count('parents', null), 3, '필터가 없어도 결과는 최상위 행')
    assert.equal(await count('sub_items', null), 3, '가-1 끝 · 가-2 · 나-1')
  })
})

describe('⑥ 필터 · 검색어가 없으면 맞춤이 걸리지 않는다', () => {
  test('★ 범위마다 예전 트리 그대로 — 표시가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await forest('표시 범위 ⑥')
    for (const scope of ['both', 'parents', 'sub_items'] as const) {
      const rows = unwrap(
        await queryRows(fx.owner.ctx, f.ds, { tree: { parentPropertyId: f.parentPropertyId, under: null }, treeScope: { parentPropertyId: f.parentPropertyId, scope } }),
      ).rows
      assert.deepEqual(rows.map((r) => [r.title, r.treeMatch]), [['가', undefined], ['나 끝', undefined], ['다', undefined]], scope)
    }
  })
})
