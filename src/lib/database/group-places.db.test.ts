/**
 * 그룹 안의 자리 — 바뀐 행이 그 그룹의 차례에서 어디에 서는가 (DB 실시간 동기화 RT-5조각 · F-05-16, DB 필요)
 *
 *   ① ★ 손으로 둔 순서 · 정렬 — 모든 행의 그룹 키 · 이웃이 그룹 읽기(`queryGroupRows`)의 차례 그대로다. 값 없음 · 숨긴 그룹 · 동률
 *      (`order_key`) · 빈 칸(NULLS LAST)까지 모든 행을 견준다
 *   ② ★ 더 보기 커서 — 그룹마다의 커서 뒤는 `beyond`(그 커서로 더 읽으면 거기 있다) · 다른 그룹은 아니다
 *   ③ 델타(`group`) — 그룹을 건너간 행의 새 그룹 · 이웃 · 머리(개수)가 그룹 읽기와 같다
 *   ④ ★ 볼 수 없는 행은 이웃 · 멤버 · 개수 어디에도 없다 — "만들기만" 에게 대표의 행은 id 로도 오지 않는다(§3.3-743 ③)
 *   ⑤ 자리를 주지 않는 때 — 여러 값(다중 선택) · 하위 그룹 · 정렬에 맞지 않는 커서
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { grantAccess } from '../permissions/acl.ts'
import { setAccessRule } from '../permissions/access-rule.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import { createRow, updateCells } from './row.ts'
import { createView, updateView } from './view.ts'
import { moveRow, queryGroupPlaces, queryGroupRows, queryGroups, type GroupPlaces } from './group.ts'
import { currentChangeHorizon, encodeChangeCursor } from './change-log.ts'
import { readRowDelta, type RowDelta } from './row-delta.ts'
import type { SessionContext } from '../auth/session-context.ts'

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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string; issues?: readonly unknown[] }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? `${r.reason} ${JSON.stringify(r.issues ?? '')}` : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const placedOf = (p: GroupPlaces) => {
  assert.equal(p.placed, true, `그룹 자리를 줬다: ${JSON.stringify(p)}`)
  if (!p.placed) throw new Error('unreachable')
  return p
}

/** 상태(select · A · B · C) · 수량(number)으로 된 표와 그 상태로 묶인 보드. */
async function board(ctx: SessionContext, name: string) {
  const created = unwrap(await createDatabase(ctx, { name }))
  const ds = created.dataSourceId
  unwrap(await addProperty(ctx, ds, { name: '상태', type: 'select' }))
  unwrap(await addProperty(ctx, ds, { name: '수량', type: 'number' }))
  const schema = unwrap(await getSchema(ctx, ds))
  const statusId = schema.properties.find((p) => p.name === '상태')!.id
  const qtyId = schema.properties.find((p) => p.name === '수량')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const opt = async (n: string) => unwrap(await addSelectOption(ctx, ds, statusId, { name: n })).option.id
  const A = await opt('A')
  const B = await opt('B')
  const C = await opt('C')
  const view = unwrap(await createView(ctx, created.id, { type: 'board' }))
  unwrap(await updateView(ctx, view.id, { groupBy: { property_id: statusId } }))
  const cells = (title: string | null, status: string | null | undefined, qty?: number | null) => [
    ...(title === null ? [] : [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }]),
    ...(status === undefined ? [] : [{ propertyId: statusId, value: { type: 'select', select: status === null ? null : { id: status } } }]),
    ...(qty === undefined ? [] : [{ propertyId: qtyId, value: { type: 'number', number: qty } }]),
  ]
  const row = async (title: string, status: string | null, qty?: number | null) =>
    unwrap(await createRow(ctx, ds, { cells: cells(title, status, qty) as never })).id
  return { db: created.id, ds, viewId: view.id, statusId, qtyId, titleId, A, B, C, cells, row }
}

/** 그룹 읽기의 차례 전부 — 그룹마다(숨긴 그룹도 읽을 수 있다). */
async function listing(ctx: SessionContext, viewId: string, keys: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const key of keys) out.set(key, unwrap(await queryGroupRows(ctx, viewId, key, { limit: 100 })).rows.map((r) => r.id))
  return out
}

/** 모든 행 — 서버의 그룹 자리 = 그룹 읽기 목록의 그룹 · 앞뒤. */
async function assertMatchesListing(ctx: SessionContext, viewId: string, keys: readonly string[]) {
  const order = await listing(ctx, viewId, keys)
  const all = [...order.values()].flat()
  const places = placedOf(unwrap(await queryGroupPlaces(ctx, viewId, all))).places
  assert.equal(places.size, all.length, '그룹에 서는 행은 모두 자리가 있다')
  for (const [key, ids] of order) {
    ids.forEach((id, i) => {
      assert.deepEqual(places.get(id), { key, before: ids[i - 1] ?? null, after: ids[i + 1] ?? null, beyond: false }, `그룹 ${JSON.stringify(key)} 의 ${i}번째`)
    })
  }
  return order
}

/** 이 표의 앞선 쓰기를 모두 지난 커서(row-delta-place.db.test.ts 와 같다). */
async function settledCursor(ds: string): Promise<string> {
  const { query } = await import('../db/pool.ts')
  const top = (await query<{ x: string | null }>(`SELECT max(xid)::text AS x FROM data_source_change WHERE data_source_id = $1`, [ds]))[0]!.x
  let horizon = await currentChangeHorizon()
  for (let t = 0; top !== null && horizon <= BigInt(top) && t < 15_000; t += 100) {
    await sleep(100)
    horizon = await currentChangeHorizon()
  }
  if (top !== null) assert.ok(horizon > BigInt(top), '전제 — 지평이 이 표의 앞선 쓰기를 지나갔다')
  return encodeChangeCursor(horizon)
}

async function deltaWith(read: () => Promise<RowDelta>, want: readonly string[]): Promise<RowDelta> {
  let last = await read()
  for (let t = 0; t < 8000 && !want.every((id) => last.rows.some((r) => r.id === id)); t += 100) {
    await sleep(100)
    last = await read()
  }
  return last
}

describe('① 그룹 읽기의 차례 그대로', () => {
  test('★ 손으로 둔 순서 — 옮긴 카드 · 값 없음 · 숨긴 그룹까지 모든 행의 그룹 · 이웃이 그룹 읽기와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const b = await board(ctx, `그룹 자리 ① ${Date.now()}`)
    const a1 = await b.row('a1', b.A)
    const a2 = await b.row('a2', b.A)
    const a3 = await b.row('a3', b.A)
    const b1 = await b.row('b1', b.B)
    const b2 = await b.row('b2', b.B)
    await b.row('n1', null)
    await b.row('n2', null)
    // 손으로 둔 자리 — a3 를 맨 앞으로 · b2 를 A 의 a2 앞으로(다른 그룹에서 옮겨 온 카드)
    unwrap(await moveRow(ctx, b.viewId, { rowId: a3, groupKey: b.A, beforeRowId: a1 }))
    unwrap(await moveRow(ctx, b.viewId, { rowId: b2, groupKey: b.A, beforeRowId: a2, fromGroupKey: b.B }))
    // B 를 숨긴다 — 숨긴 그룹의 행도 자리(키)를 받는다(화면이 뺀다)
    unwrap(await updateView(ctx, b.viewId, { groupBy: { property_id: b.statusId, hidden: [b.B] } }))
    const order = await assertMatchesListing(ctx, b.viewId, ['', b.A, b.B, b.C])
    assert.deepEqual(order.get(b.A), [a3, a1, b2, a2], '전제 — 손으로 둔 차례')
    assert.deepEqual(order.get(b.B), [b1])

    // 머리 — 그룹 읽기(`queryGroups`)의 목록 · 차례 · 숨김 · 개수와 같다
    const heads = placedOf(unwrap(await queryGroupPlaces(ctx, b.viewId, []))).heads
    const page = unwrap(await queryGroups(ctx, b.viewId))
    assert.deepEqual(heads.map((h) => [h.key, h.count, h.hidden]), page.groups.map((g) => [g.key, g.count, g.hidden]))
  })

  test('★ 정렬 — 동률(order_key) · 빈 칸(NULLS LAST) · 내림차순까지 모든 행이 그룹 읽기와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const b = await board(ctx, `그룹 자리 ①b ${Date.now()}`)
    unwrap(await updateView(ctx, b.viewId, { sorts: [{ property_id: b.qtyId, direction: 'desc' }] }))
    await b.row('a-5', b.A, 5)
    await b.row('a-9', b.A, 9)
    await b.row('a-5b', b.A, 5) // 동률 — 먼저 만든 a-5 가 앞
    await b.row('a-빈', b.A, null) // 빈 칸 — 맨 뒤(내림차순도)
    await b.row('b-1', b.B, 1)
    await b.row('n-3', null, 3)
    const moved = await b.row('b-7', b.B, 7)
    // 그룹을 건너가며 정렬 값도 바뀐 행
    unwrap(await updateCells(ctx, moved, { cells: b.cells(null, b.A, 6) } as never))
    const order = await assertMatchesListing(ctx, b.viewId, ['', b.A, b.B, b.C])
    assert.equal(order.get(b.A)!.length, 5)
  })
})

describe('② 더 보기 커서', () => {
  test('★ 그룹의 커서 뒤는 beyond — 그 커서로 더 읽으면 거기 있다 · 다른 그룹은 아니다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const b = await board(ctx, `그룹 자리 ② ${Date.now()}`)
    const ids: string[] = []
    for (const n of [1, 2, 3, 4, 5]) ids.push(await b.row(`a${n}`, b.A))
    const other = await b.row('b1', b.B)
    const first = unwrap(await queryGroupRows(ctx, b.viewId, b.A, { limit: 2 }))
    assert.ok(first.hasMore && first.nextCursor !== null)
    const places = placedOf(unwrap(await queryGroupPlaces(ctx, b.viewId, [...ids, other], { pages: { [b.A]: first.nextCursor! } }))).places
    const rest = unwrap(await queryGroupRows(ctx, b.viewId, b.A, { cursor: first.nextCursor, limit: 100 })).rows.map((r) => r.id)
    for (const id of ids) assert.equal(places.get(id)?.beyond, rest.includes(id), `${id} 의 beyond 는 더 보기가 가져오는가와 같다`)
    assert.deepEqual(first.rows.map((r) => r.id), ids.slice(0, 2))
    assert.equal(places.get(other)?.beyond, false, '다른 그룹의 행은 그 커서로 판정하지 않는다')
  })
})

describe('③ 델타(group)', () => {
  test('그룹을 건너간 행 — 새 그룹 · 그 안의 이웃 · 머리의 개수가 그룹 읽기와 같다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const b = await board(ctx, `그룹 자리 ③ ${Date.now()}`)
    const a1 = await b.row('a1', b.A)
    const x = await b.row('x', b.A)
    const b1 = await b.row('b1', b.B)
    const start = await settledCursor(b.ds)
    unwrap(await updateCells(ctx, x, { cells: b.cells(null, b.B) } as never))
    const d = await deltaWith(() => readRowDelta(ctx, b.ds, b.viewId, start, { group: true }).then(unwrap), [x])
    assert.equal(d.groupPlaced, true)
    const r = d.rows.find((row) => row.id === x)
    assert.ok(r?.kind === 'row_upsert' && r.inView)
    assert.deepEqual(r.group, { key: b.B, before: null, after: b1, beyond: false }, '새 그룹 B 의 b1 앞(자리가 없으면 만든 차례 — x 가 먼저)')
    const page = unwrap(await queryGroups(ctx, b.viewId))
    assert.deepEqual(d.groups?.map((h) => [h.key, h.count]), page.groups.map((g) => [g.key, g.count]), '머리 = 그룹 읽기')
    assert.equal(page.groups.find((g) => g.key === b.A)!.rows[0]!.id, a1)
    // 평평한 자리(`place`)는 묻지 않았다
    assert.equal(d.placed, undefined)
  })
})

describe('④ 권한', () => {
  test('★ 볼 수 없는 행은 그룹의 이웃 · 멤버 · 개수 어디에도 없다 — "만들기만" 에게 대표의 행은 id 로도 오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('그룹 자리 권한')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const maker = await joinAs(ws, await createUser('제출자'), 'member')
    const db = unwrap(await createDatabase(boss.ctx, { name: `그룹 자리 권한 ${Date.now()}`, privateTop: true }))
    const ds = db.dataSourceId
    unwrap(await addProperty(boss.ctx, ds, { name: '상태', type: 'select' }))
    const schema = unwrap(await getSchema(boss.ctx, ds))
    const statusId = schema.properties.find((p) => p.name === '상태')!.id
    const titleId = schema.properties.find((p) => p.type === 'title')!.id
    const A = unwrap(await addSelectOption(boss.ctx, ds, statusId, { name: 'A' })).option.id
    // 표의 기본 뷰를 묶는다(그룹 표 — 보드와 같은 길)
    unwrap(await updateView(boss.ctx, db.defaultViewId, { groupBy: { property_id: statusId } }))
    const cells = (s: string) =>
      [
        { propertyId: titleId, value: { type: 'title', title: [textRun(s)] } },
        { propertyId: statusId, value: { type: 'select', select: { id: A } } },
      ] as never
    const a = unwrap(await createRow(boss.ctx, ds, { cells: cells('a') })).id
    const c = unwrap(await createRow(boss.ctx, ds, { cells: cells('c') })).id
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: maker.userId }, 'create')).ok)
    // 만든 사람 규칙 — "만들기만" 은 자기가 만든 행만 본다
    assert.ok((await setAccessRule(boss.ctx, db.id, { dataSourceId: ds, source: 'created_by', level: 'edit' })).ok)
    const start = await settledCursor(ds)
    const b = unwrap(await createRow(maker.ctx, ds, { cells: cells('b') })).id

    const theirs = placedOf(unwrap(await queryGroupPlaces(boss.ctx, db.defaultViewId, [b]))).places
    assert.deepEqual(theirs.get(b), { key: A, before: c, after: null, beyond: false }, '전제 — 대표에게 b 는 c 뒤')

    const mine = placedOf(unwrap(await queryGroupPlaces(maker.ctx, db.defaultViewId, [a, b, c])))
    assert.deepEqual(mine.places.get(b), { key: A, before: null, after: null, beyond: false }, '★ 이웃은 볼 수 있는 행만')
    assert.equal(mine.places.has(a) || mine.places.has(c), false, '★ 볼 수 없는 행은 멤버로 오지 않는다')
    assert.equal(mine.heads.find((h) => h.key === A)?.count, 1, '★ 개수에도 세지 않는다')
    const blob = JSON.stringify({ places: [...mine.places], heads: mine.heads })
    assert.ok(!blob.includes(a) && !blob.includes(c), '★ 결과 어디에도 그 id 가 없다')

    // 델타도 — 대표가 a 를 고쳐도 "만들기만" 의 델타에는 a 가 없다
    unwrap(await updateCells(boss.ctx, a, { cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun('a2')] } }] } as never))
    const d = await deltaWith(() => readRowDelta(maker.ctx, ds, db.defaultViewId, start, { group: true }).then(unwrap), [b])
    assert.equal(d.groupPlaced, true)
    assert.ok(!JSON.stringify(d).includes(a) && !JSON.stringify(d).includes(c), `★ 델타 어디에도 대표의 행이 없다: ${JSON.stringify(d.rows.map((r) => r.id))}`)
    assert.equal(d.groups?.find((h) => h.key === A)?.count, 1)
  })
})

describe('⑤ 자리를 주지 않는 때', () => {
  test('여러 값(다중 선택) · 하위 그룹 · 정렬에 맞지 않는 커서 → placed: false', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const b = await board(ctx, `그룹 자리 ⑤ ${Date.now()}`)
    const x = await b.row('x', b.A)
    // 정렬에 맞지 않는 커서(손상)
    assert.deepEqual(unwrap(await queryGroupPlaces(ctx, b.viewId, [x], { pages: { [b.A]: 'zzz' } })), { placed: false, why: 'stale_page' })
    // 하위 그룹 — 칸의 차례
    unwrap(await addProperty(ctx, b.ds, { name: '팀', type: 'select' }))
    const teamId = unwrap(await getSchema(ctx, b.ds)).properties.find((p) => p.name === '팀')!.id
    unwrap(await updateView(ctx, b.viewId, { subGroupBy: { property_id: teamId } }))
    assert.deepEqual(unwrap(await queryGroupPlaces(ctx, b.viewId, [x])), { placed: false, why: 'sub_group' })
    // 여러 값 — 한 행이 여러 그룹에 선다
    unwrap(await updateView(ctx, b.viewId, { subGroupBy: null }))
    unwrap(await addProperty(ctx, b.ds, { name: '태그', type: 'multi_select' }))
    const tagId = unwrap(await getSchema(ctx, b.ds)).properties.find((p) => p.name === '태그')!.id
    unwrap(await updateView(ctx, b.viewId, { groupBy: { property_id: tagId } }))
    assert.deepEqual(unwrap(await queryGroupPlaces(ctx, b.viewId, [x])), { placed: false, why: 'multi_value' })
    // 델타도 — 그룹 자리를 주지 않는다
    const start = await settledCursor(b.ds)
    unwrap(await updateCells(ctx, x, { cells: b.cells('x2', undefined) } as never))
    const d = await deltaWith(() => readRowDelta(ctx, b.ds, b.viewId, start, { group: true }).then(unwrap), [x])
    assert.equal(d.groupPlaced, false)
    assert.equal(d.groups, undefined)
  })
})
