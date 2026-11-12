/**
 * 지도 뷰 — 설정 · 핀 · 권한 (MP-2 · F-04-19, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑥
 *
 *   ① ★ CHECK(0142) — 앱을 거치지 않은 나쁜 `configuration.map` 을 DB 가 거부한다
 *   ② ★ 설정 저장 — 장소 속성이 아닌 · 남의 표의 `map_by` 와 범위 밖 높이는 `invalid_layout` · 저장하면 `configuration.map` 이 남는다
 *   ③ ★ 핀 — 빈 칸 행에는 없다 · 필터를 지난 행만 · `map_by` 를 바꾸면 다른 칸 · 장소 속성이 없으면 `mapBy` null
 *   ④ ★ 상한 — 101개 → 100핀 + truncated · 정확히 100개는 truncated 아님
 *   ⑤ ★ 권한 — 못 보는 사람에게는 존재를 알리지 않는다(404 에 해당하는 `not_found`)
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createUser, joinAs, makeFixture, probeDatabase, type Actor, type Fixture } from '../testing/db-fixtures.ts'
import { grantAccess, revokeAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow } from './row.ts'
import { createView, getView, updateView } from './view.ts'
import { queryMapPins } from './map-query.ts'
import { DEFAULT_MAP_LAYOUT } from './map.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'

let skipReason = ''
let fx: Fixture
let other: Actor

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
    return
  }
  fx = await makeFixture()
  other = await joinAs(fx.workspaceId, await createUser('다른 멤버'), 'member')
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

const place = (name: string, lat = 37.5665, lng = 126.978): CellValue => ({ type: 'place', place: { name, address: '', lat, lng } })

/** 장소 속성 둘(위치 · 지점) + 수 속성(순번)이 있는 표. */
async function fixture(opts: { places?: boolean } = {}) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `지도 ${Date.now()}` }))
  const ds = created.dataSourceId
  const add = async (name: string, type: 'place' | 'number') =>
    unwrap(await addProperty(fx.owner.ctx, ds, { name, type })).properties.find((p) => p.name === name)!.id
  const loc = opts.places === false ? '' : await add('위치', 'place')
  const branch = opts.places === false ? '' : await add('지점', 'place')
  const n = await add('순번', 'number')
  const row = async (cells: { propertyId: string; value: CellValue }[]) => unwrap(await createRow(fx.owner.ctx, ds, { cells })).id
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'map' }))
  return { created, ds, loc, branch, n, row, view }
}

describe('① CHECK (0142)', () => {
  test('★ 나쁜 configuration.map 은 DB 가 거부한다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const set = (json: string) =>
      query(`UPDATE view SET configuration = jsonb_set(configuration, '{map}', $2::jsonb, true) WHERE id = $1`, [f.view.id, json])
    await set(JSON.stringify({ map_by: null, height: 480 }))
    for (const bad of [
      { map_by: null, height: 239 },
      { map_by: null, height: 961 },
      { map_by: null, height: 480.5 },
      { map_by: null },
      { height: 480 },
      { map_by: 5, height: 480 },
      { map_by: null, height: 480, zoom: 1 },
    ]) {
      await assert.rejects(set(JSON.stringify(bad)), (e: { code?: string; constraint?: string }) => e.code === '23514' && e.constraint === 'ck_view_map_layout')
    }
  })
})

describe('② 설정 저장', () => {
  test('★ 지도를 만들면 기본 설정이다 · 저장하면 합쳐서 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    assert.equal(f.view.type, 'map')
    assert.deepEqual(f.view.map, DEFAULT_MAP_LAYOUT)
    const a = unwrap(await updateView(fx.owner.ctx, f.view.id, { map: { height: 720 } }))
    assert.deepEqual(a.map, { map_by: null, height: 720 })
    const b = unwrap(await updateView(fx.owner.ctx, f.view.id, { map: { map_by: f.branch } }))
    assert.deepEqual(b.map, { map_by: f.branch, height: 720 })
    const c = unwrap(await updateView(fx.owner.ctx, f.view.id, { map: { map_by: null } }))
    assert.deepEqual(c.map, { map_by: null, height: 720 })
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, f.view.id)).map, { map_by: null, height: 720 })
  })

  test('★ 장소 속성이 아닌 · 남의 표의 map_by 는 invalid_layout', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const g = await fixture()
    for (const mapBy of [f.n, g.loc, '없는-속성']) {
      const r = await updateView(fx.owner.ctx, f.view.id, { map: { map_by: mapBy } })
      assert.equal(!r.ok && r.reason, 'invalid_layout', String(mapBy))
    }
    assert.deepEqual(unwrap(await getView(fx.owner.ctx, f.view.id)).map, DEFAULT_MAP_LAYOUT)
  })

  test('★ 범위 밖 높이 · 모르는 키 · 빈 바꿈은 invalid_layout', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    for (const bad of [{ height: 100 }, { height: 1000 }, { height: 480.5 }, { zoom: 3 }, {}]) {
      const r = await updateView(fx.owner.ctx, f.view.id, { map: bad as never })
      assert.equal(!r.ok && r.reason, 'invalid_layout', JSON.stringify(bad))
    }
  })

  test('표를 지도로 바꿔도 기본 설정으로 읽는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const table = unwrap(await createView(fx.owner.ctx, f.created.id, {}))
    const back = unwrap(await updateView(fx.owner.ctx, table.id, { type: 'map' }))
    assert.equal(back.type, 'map')
    assert.deepEqual(back.map, DEFAULT_MAP_LAYOUT)
  })
})

describe('③ 핀', () => {
  test('★ 값이 있는 행만 · 첫 장소 속성이 기본 · map_by 를 바꾸면 다른 칸', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const a = await f.row([{ propertyId: f.loc, value: place('A', 10, 20) }])
    const b = await f.row([
      { propertyId: f.loc, value: place('B', 11, 21) },
      { propertyId: f.branch, value: place('B지점', 1, 2) },
    ])
    await f.row([{ propertyId: f.n, value: { type: 'number', number: 1 } }]) // 빈 칸
    const first = unwrap(await queryMapPins(fx.owner.ctx, f.view.id))
    assert.equal(first.mapBy, f.loc)
    assert.deepEqual(first.pins.map((p) => p.rowId).sort(), [a, b].sort())
    assert.equal(first.truncated, false)
    const pinA = first.pins.find((p) => p.rowId === a)!
    assert.deepEqual([pinA.name, pinA.lat, pinA.lng], ['A', 10, 20])

    unwrap(await updateView(fx.owner.ctx, f.view.id, { map: { map_by: f.branch } }))
    const second = unwrap(await queryMapPins(fx.owner.ctx, f.view.id))
    assert.equal(second.mapBy, f.branch)
    assert.deepEqual(second.pins.map((p) => [p.rowId, p.name]), [[b, 'B지점']])
  })

  test('★ 뷰의 필터를 지난 행만 핀이 된다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    const keep = await f.row([
      { propertyId: f.loc, value: place('남김') },
      { propertyId: f.n, value: { type: 'number', number: 20 } },
    ])
    await f.row([
      { propertyId: f.loc, value: place('거름') },
      { propertyId: f.n, value: { type: 'number', number: 5 } },
    ])
    assert.equal(unwrap(await queryMapPins(fx.owner.ctx, f.view.id)).pins.length, 2)
    unwrap(await updateView(fx.owner.ctx, f.view.id, { filter: { property_id: f.n, operator: 'greater_than', value: 10 } }))
    assert.deepEqual(unwrap(await queryMapPins(fx.owner.ctx, f.view.id)).pins.map((p) => p.rowId), [keep])
  })

  test('★ 장소 속성이 없으면 mapBy null · 핀 없음 · 지도 뷰가 아니면 not_map', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture({ places: false })
    assert.deepEqual(unwrap(await queryMapPins(fx.owner.ctx, f.view.id)), { mapBy: null, pins: [], truncated: false })
    const table = unwrap(await createView(fx.owner.ctx, f.created.id, {}))
    const r = await queryMapPins(fx.owner.ctx, table.id)
    assert.equal(!r.ok && r.reason, 'not_map')
  })
})

describe('④ 상한', () => {
  test('★ 101개 → 100핀 + truncated · 정확히 100개는 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    for (let i = 0; i < 100; i += 1) await f.row([{ propertyId: f.loc, value: place(`p${i}`, (i % 80) - 40, (i % 300) - 150) }])
    const exact = unwrap(await queryMapPins(fx.owner.ctx, f.view.id))
    assert.equal(exact.pins.length, 100)
    assert.equal(exact.truncated, false)
    await f.row([{ propertyId: f.loc, value: place('넘침') }])
    const over = unwrap(await queryMapPins(fx.owner.ctx, f.view.id))
    assert.equal(over.pins.length, 100)
    assert.equal(over.truncated, true)
  })
})

describe('⑤ 권한', () => {
  test('★ 못 보는 사람에게는 존재를 알리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await fixture()
    await f.row([{ propertyId: f.loc, value: place('비밀') }])
    assert.equal((await queryMapPins(other.ctx, f.view.id)).ok, true, '처음엔 워크스페이스 전체가 본다')
    assert.equal((await stopInheriting(fx.owner.ctx, f.created.id)).ok, true)
    assert.equal((await grantAccess(fx.owner.ctx, f.created.id, { type: 'user', id: fx.owner.userId }, 'full_access')).ok, true)
    assert.equal((await revokeAccess(fx.owner.ctx, f.created.id, { type: 'workspace_everyone', id: null })).ok, true)
    const r = await queryMapPins(other.ctx, f.view.id)
    assert.equal(!r.ok && r.reason, 'not_found')
    assert.equal((await queryMapPins(fx.owner.ctx, f.view.id)).ok, true)
  })
})
