/**
 * 종속 관계의 날짜 자동 이동 — 서버 (40번 트랙 TL-5 · F-04-07, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 TL-5]
 *
 *   ① ★ 방식이 없거나 never 면 옮기지 않는다 · 종속 관계가 꺼져 있으면 방식이 있어도 옮기지 않는다
 *   ② ★ overlap_only — 겹칠 때만 E+1 로 기간을 지켜 민다 · 연쇄
 *   ③ ★ maintain_gap — 앞뒤로 같은 일수 · 연쇄
 *   ④ ★ 옮길 행을 못 고치면 원래 쓰기까지 거부(shift_forbidden) · 방식 PATCH 는 edit_structure
 *
 * ⚠ skip 은 테스트마다 `ctx.skip` 으로 건다(`describe` 의 skip 옵션은 등록 시점에 평가된다).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, createUser, joinAs, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { grantAccess, stopInheriting } from '../permissions/acl.ts'
import { createDatabase, setDependencyShiftMode } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import type { CellValue } from './property-types.ts'
import { createRow, updateCells } from './row.ts'
import { disableDependencies, enableDependencies } from './dependencies.ts'
import { linkRows } from './relation.ts'
import { queryOne } from '../db/pool.ts'

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

const date = (s: string, e?: string): CellValue => ({ type: 'date', date: e === undefined ? { start: s } : { start: s, end: e } })

/** 표 + 날짜 속성 + 종속 관계. A 가 B 를 막고 B 가 C 를 막는다(A → B → C). */
async function chain(opts: { deps?: boolean; privateTop?: boolean } = {}) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `이동 ${Date.now()}`, ...(opts.privateTop ? { privateTop: true } : {}) }))
  const ds = created.dataSourceId
  const due = unwrap(await addProperty(fx.owner.ctx, ds, { name: '일정', type: 'date' })).properties.find((p) => p.name === '일정')!.id
  const titleId = unwrap(await getSchema(fx.owner.ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const row = async (title: string, value: CellValue) =>
    unwrap(await createRow(fx.owner.ctx, ds, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, { propertyId: due, value }] })).id
  const a = await row('A', date('2026-03-01', '2026-03-03'))
  const b = await row('B', date('2026-03-10', '2026-03-12'))
  const c = await row('C', date('2026-03-20'))
  const pair = unwrap(await enableDependencies(fx.owner.ctx, ds))
  // 선행 작업 칸: 막히는 행의 칸에 막는 행을 더한다
  unwrap(await linkRows(fx.owner.ctx, b, pair.blockedByPropertyId, { add: [a] }))
  unwrap(await linkRows(fx.owner.ctx, c, pair.blockedByPropertyId, { add: [b] }))
  if (opts.deps === false) unwrap(await disableDependencies(fx.owner.ctx, ds))
  return { databaseId: created.id, ds, due, a, b, c }
}

/** 저장된 값의 [시작, 끝] 날짜 글자(사이드카가 아니라 값 그대로). */
async function spanOf(id: string, due: string): Promise<(string | null)[] | null> {
  const row = await queryOne<{ s: string | null; e: string | null }>(
    `SELECT value -> 'date' ->> 'start' AS s, value -> 'date' ->> 'end' AS e FROM page_property_value WHERE page_id = $1 AND property_id = $2`,
    [id, due],
  )
  return row === null || row.s === null ? null : [row.s, row.e]
}
const move = (who: Fixture['owner'], id: string, due: string, v: CellValue) => updateCells(who.ctx, id, { cells: [{ propertyId: due, value: v }] })

describe('① 방식이 없으면 · 종속 관계가 꺼지면 옮기지 않는다', () => {
  test('★ NULL(never) · never → 그대로 · 종속 관계 꺼짐 → 방식이 있어도 그대로', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await chain()
    const r1 = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-09', '2026-03-15')))
    assert.equal(r1.shifted, undefined)
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-10', '2026-03-12'])

    unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'never'))
    const r2 = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-10', '2026-03-20')))
    assert.equal(r2.shifted, undefined)
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-10', '2026-03-12'])

    const off = await chain({ deps: false })
    unwrap(await setDependencyShiftMode(fx.owner.ctx, off.databaseId, 'maintain_gap'))
    unwrap(await move(fx.owner, off.a, off.due, date('2026-04-01', '2026-04-03')))
    assert.deepEqual(await spanOf(off.b, off.due), ['2026-03-10', '2026-03-12'])
  })

  test('방식 값 검사 · 같은 값은 그대로 성공', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await chain()
    const bad = await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'sometimes')
    assert.equal(!bad.ok && bad.reason, 'invalid_shift_mode')
    assert.equal(unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'overlap_only')), 'overlap_only')
    assert.equal(unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'overlap_only')), 'overlap_only')
  })
})

describe('② overlap_only', () => {
  test('★ 겹치지 않으면 그대로 · 겹치면 E+1 로 기간을 지켜 밀고 연쇄한다 · 당겨오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await chain()
    unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'overlap_only'))
    const clear = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-02', '2026-03-05')))
    assert.equal(clear.shifted, undefined)
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-10', '2026-03-12'])

    // A 끝 3-11 → B(3-10~3-12) 는 3-12~3-14 → C(3-20) 는 겹치지 않는다
    const hit = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-05', '2026-03-11')))
    assert.deepEqual(hit.shifted, [f.b])
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-12', '2026-03-14'])
    assert.deepEqual(await spanOf(f.c, f.due), ['2026-03-20', null])

    // A 끝 3-25 → B 3-26~3-28 → C(3-20) 는 3-29
    const chained = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-20', '2026-03-25')))
    assert.deepEqual([...(chained.shifted ?? [])].sort(), [f.b, f.c].sort())
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-26', '2026-03-28'])
    assert.deepEqual(await spanOf(f.c, f.due), ['2026-03-29', null])

    // 앞으로 돌아와도 당겨오지 않는다
    unwrap(await move(fx.owner, f.a, f.due, date('2026-03-01', '2026-03-02')))
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-26', '2026-03-28'])
  })
})

describe('③ maintain_gap', () => {
  test('★ 앞뒤로 같은 일수 · 연쇄 · 빈 후행은 건드리지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await chain()
    unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'maintain_gap'))
    const fwd = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-04', '2026-03-06')))
    assert.deepEqual([...(fwd.shifted ?? [])].sort(), [f.b, f.c].sort())
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-13', '2026-03-15'])
    assert.deepEqual(await spanOf(f.c, f.due), ['2026-03-23', null])

    unwrap(await move(fx.owner, f.a, f.due, date('2026-03-01', '2026-03-03')))
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-10', '2026-03-12'])
    assert.deepEqual(await spanOf(f.c, f.due), ['2026-03-20', null])

    // 후행 B 를 비우면 A 의 이동은 B 에서 멈춘다(C 는 그대로)
    unwrap(await move(fx.owner, f.b, f.due, { type: 'date', date: null }))
    const stop = unwrap(await move(fx.owner, f.a, f.due, date('2026-03-05', '2026-03-07')))
    assert.equal(stop.shifted, undefined)
    assert.deepEqual(await spanOf(f.c, f.due), ['2026-03-20', null])
  })
})

describe('④ 권한', () => {
  test('★ 옮길 행을 못 고치면 원래 쓰기까지 거부 · 방식은 edit_structure', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const f = await chain({ privateTop: true })
    unwrap(await setDependencyShiftMode(fx.owner.ctx, f.databaseId, 'maintain_gap'))
    const mate = await joinAs(fx.workspaceId, await createUser('동료'), 'member')
    unwrap(await grantAccess(fx.owner.ctx, f.databaseId, { type: 'user', id: mate.userId }, 'edit_content'))

    const mode = await setDependencyShiftMode(mate.ctx, f.databaseId, 'never')
    assert.equal(!mode.ok && mode.reason, 'forbidden')

    // 되는 경우: 동료는 모두 고칠 수 있다
    const ok = unwrap(await move(mate, f.a, f.due, date('2026-03-02', '2026-03-04')))
    assert.deepEqual([...(ok.shifted ?? [])].sort(), [f.b, f.c].sort())

    // C 를 동료에게서 닫는다 → A 를 옮기면 통째로 거부
    unwrap(await stopInheriting(fx.owner.ctx, f.c))
    unwrap(await grantAccess(fx.owner.ctx, f.c, { type: 'user', id: mate.userId }, 'view'))
    const denied = await move(mate, f.a, f.due, date('2026-03-10', '2026-03-12'))
    assert.equal(!denied.ok && denied.reason, 'shift_forbidden')
    assert.deepEqual(await spanOf(f.a, f.due), ['2026-03-02', '2026-03-04'], '막는 행의 값도 그대로')
    assert.deepEqual(await spanOf(f.b, f.due), ['2026-03-11', '2026-03-13'])
  })
})
