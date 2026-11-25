/**
 * 델타의 자리 — 바뀐 행이 그 뷰의 차례에서 어디에 서는가 (DB 실시간 동기화 RT-2조각 · F-05-16, DB 필요)
 *
 *   ① ★ 정렬된 뷰 — 새 행 · 정렬 값이 바뀐 행의 이웃(`before` · `after`)이 행 읽기의 차례 그대로다. 동률(타이브레이커 `order_key`) · 빈 칸
 *      (NULLS LAST)도 — 모든 행의 이웃을 행 읽기의 목록과 견준다
 *   ② ★ 더 보기 커서 — 화면이 읽은 범위 밖으로 옮긴 행 · 밖에 새로 선 행은 `beyond` · 안으로 옮긴 행은 아니다. 커서의 keyset 술어 그대로
 *      (그 커서로 "더 보기"를 읽으면 beyond 인 행이 거기 있다)
 *   ③ 손으로 둔 순서(정렬 없음) — 옮긴 행의 이웃이 새 자리 · `orderChanged`
 *   ④ 뷰에 서지 않는 행(필터 밖 · 휴지통)에는 자리가 없다
 *   ⑤ 자리를 줄 수 없는 뷰 — 하위 항목 트리 · 이 정렬에 맞지 않는 더 보기 커서 → `placed: false`. 묻지 않으면 `placed` 도 `place` 도 없다
 *   ⑥ 열 집계 — 물었고 바뀐 행이 있을 때만
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { createBareWorkspace, createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { grantAccess } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import type { MvpPropertyType } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { moveViewRow } from './row-order.ts'
import { setViewColumn, updateView } from './view.ts'
import { enableSubItems } from './sub-items.ts'
import { currentChangeHorizon, encodeChangeCursor } from './change-log.ts'
import { readRowDelta, type RowDelta } from './row-delta.ts'
import { queryRowNeighbors, queryRows } from './query.ts'
import type { SortKey } from './filter.ts'
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

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  assert.equal(r.ok, true, `실패: ${r.ok === false ? r.reason : ''}`)
  if (!r.ok) throw new Error('unreachable')
  return r.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function table(ctx: SessionContext, name: string) {
  const created = unwrap(await createDatabase(ctx, { name }))
  const ds = created.dataSourceId
  const titleId = unwrap(await getSchema(ctx, ds)).properties.find((p) => p.type === 'title')!.id
  const prop = async (propName: string, type: MvpPropertyType) =>
    unwrap(await addProperty(ctx, ds, { name: propName, type })).properties.find((p) => p.name === propName)!.id
  const row = async (title: string, more: { propertyId: string; value: unknown }[] = []) =>
    unwrap(
      await createRow(ctx, ds, {
        cells: [{ propertyId: titleId, value: { type: 'title', title: [textRun(title)] } }, ...(more as never[])],
      }),
    ).id
  return { db: created.id, ds, viewId: created.defaultViewId, titleId, prop, row }
}

const num = (propertyId: string, n: number | null) => ({ propertyId, value: { type: 'number', number: n } })

/** 이 표의 앞선 쓰기를 모두 지난 커서(change-log.db.test.ts 의 것과 같다 — 다른 검사의 열린 트랜잭션이 지평을 붙잡을 수 있다). */
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

/** 바라는 행이 다 올 때까지(그리고 `also` 가 참일 때까지) 다시 묻는다 — 지평이 지나가야 준다. */
async function deltaWith(read: () => Promise<RowDelta>, want: readonly string[], also: (d: RowDelta) => boolean = () => true): Promise<RowDelta> {
  let last = await read()
  for (let t = 0; t < 8000 && !(want.every((id) => last.rows.some((r) => r.id === id)) && also(last)); t += 100) {
    await sleep(100)
    last = await read()
  }
  return last
}

const placeOf = (d: RowDelta, id: string) => {
  const r = d.rows.find((x) => x.id === id)
  assert.ok(r !== undefined, `델타에 ${id} 가 있다`)
  return r.kind === 'row_upsert' ? r.place : undefined
}

/** 행 읽기의 차례 전부 — 그 뷰의 입력으로. */
async function listing(ctx: SessionContext, ds: string, input: { sorts?: SortKey[]; viewId: string }) {
  const page = unwrap(await queryRows(ctx, ds, { sorts: input.sorts ?? [], manualOrderViewId: input.viewId, limit: 100 }))
  return page.rows.map((r) => r.id)
}

describe('① 정렬된 뷰', () => {
  test('★ 새 행 · 옮긴 행의 이웃이 행 읽기의 차례 그대로 — 동률 · 빈 칸까지 모든 행을 견준다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ① ${Date.now()}`)
    const qty = await tb.prop('수량', 'number')
    const sorts: SortKey[] = [{ property_id: qty, direction: 'asc' }]
    unwrap(await updateView(ctx, tb.viewId, { sorts }))
    const a = await tb.row('a', [num(qty, 3)])
    const b = await tb.row('b', [num(qty, 12)])
    const tie = await tb.row('tie', [num(qty, 12)]) // b 와 동률 — 먼저 만든 b 가 앞(order_key)
    const c = await tb.row('c', [num(qty, 30)])
    const e = await tb.row('e') // 빈 칸 — 맨 뒤
    const start = await settledCursor(tb.ds)

    const n = await tb.row('n', [num(qty, 20)])
    unwrap(await updateCells(ctx, a, { cells: [num(qty, 25)] } as never))
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true }).then(unwrap), [n, a])
    assert.equal(d.placed, true)
    // 지금의 차례: b(12) tie(12) n(20) a(25) c(30) e(빈 칸)
    assert.deepEqual(placeOf(d, n), { before: tie, after: a, beyond: false })
    assert.deepEqual(placeOf(d, a), { before: n, after: c, beyond: false })

    // 모든 행 — 창 함수의 이웃 = 행 읽기 목록의 앞뒤
    const order = await listing(ctx, tb.ds, { sorts, viewId: tb.viewId })
    assert.deepEqual(order, [b, tie, n, a, c, e])
    const all = unwrap(await queryRowNeighbors(ctx, tb.ds, { sorts, manualOrderViewId: tb.viewId }, order))
    order.forEach((id, i) => {
      assert.deepEqual(all.get(id), { before: order[i - 1] ?? null, after: order[i + 1] ?? null, beyond: false }, `${i}번째 행`)
    })
  })

  test('★ 볼 수 없는 행은 이웃으로 세지 않는다 — "만들기만" 에게 대표의 행은 이웃의 id 로도 오지 않는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ws = await createBareWorkspace('자리 권한')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const maker = await joinAs(ws, await createUser('제출자'), 'member')
    const db = unwrap(await createDatabase(boss.ctx, { name: `자리 권한 ${Date.now()}`, privateTop: true }))
    const ds = db.dataSourceId
    const titleId = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.type === 'title')!.id
    const title = (s: string) => [{ propertyId: titleId, value: { type: 'title', title: [textRun(s)] } as never }]
    const sorts: SortKey[] = [{ property_id: titleId, direction: 'asc' }]
    const a = unwrap(await createRow(boss.ctx, ds, { cells: title('a') })).id
    const c = unwrap(await createRow(boss.ctx, ds, { cells: title('c') })).id
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: maker.userId }, 'create')).ok)
    const b = unwrap(await createRow(maker.ctx, ds, { cells: title('b') })).id

    const theirs = unwrap(await queryRowNeighbors(boss.ctx, ds, { sorts, manualOrderViewId: db.defaultViewId }, [b]))
    assert.deepEqual(theirs.get(b), { before: a, after: c, beyond: false }, '전제 — 대표에게 b 는 a 와 c 사이')
    const seen = await listing(maker.ctx, ds, { sorts, viewId: db.defaultViewId })
    assert.ok(!seen.includes(a) && !seen.includes(c), `전제 — "만들기만" 은 대표의 행을 보지 못한다: ${JSON.stringify(seen)}`)
    const mine = unwrap(await queryRowNeighbors(maker.ctx, ds, { sorts, manualOrderViewId: db.defaultViewId }, [b]))
    const place = mine.get(b)
    assert.ok(place === undefined || (place.before !== a && place.after !== c), `★ 볼 수 없는 a · c 가 이웃으로 새지 않는다: ${JSON.stringify(place)}`)
    assert.ok(!JSON.stringify([...mine]).includes(a) && !JSON.stringify([...mine]).includes(c), '★ 결과 어디에도 그 id 가 없다')
  })

  test('내림차순 · 같은 값으로 고친 행은 동률 안에서 order_key 의 자리', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ①b ${Date.now()}`)
    const qty = await tb.prop('수량', 'number')
    const sorts: SortKey[] = [{ property_id: qty, direction: 'desc' }]
    unwrap(await updateView(ctx, tb.viewId, { sorts }))
    const x = await tb.row('x', [num(qty, 5)])
    const y = await tb.row('y', [num(qty, 9)])
    const z = await tb.row('z', [num(qty, 1)])
    const start = await settledCursor(tb.ds)
    unwrap(await updateCells(ctx, z, { cells: [num(qty, 5)] } as never)) // x 와 동률 — x 가 먼저 만들어졌다
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true }).then(unwrap), [z])
    assert.deepEqual(placeOf(d, z), { before: x, after: null, beyond: false })
    assert.deepEqual(await listing(ctx, tb.ds, { sorts, viewId: tb.viewId }), [y, x, z])
  })
})

describe('② 더 보기 커서', () => {
  test('★ 읽은 범위 밖으로 옮긴 행 · 밖에 선 새 행은 beyond — 안으로 옮긴 행은 아니다 · 그 커서의 더 보기에 beyond 인 행이 있다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ② ${Date.now()}`)
    const qty = await tb.prop('수량', 'number')
    const sorts: SortKey[] = [{ property_id: qty, direction: 'asc' }]
    unwrap(await updateView(ctx, tb.viewId, { sorts }))
    const a = await tb.row('a', [num(qty, 3)])
    const b = await tb.row('b', [num(qty, 12)])
    const c = await tb.row('c', [num(qty, 30)])
    const d0 = await tb.row('d', [num(qty, 40)])
    // 화면이 읽은 첫 페이지 — a b 까지(커서는 b 의 정렬 값)
    const first = unwrap(await queryRows(ctx, tb.ds, { sorts, manualOrderViewId: tb.viewId, limit: 2 }))
    assert.deepEqual(first.rows.map((r) => r.id), [a, b])
    const page = first.nextCursor!
    const start = await settledCursor(tb.ds)

    unwrap(await updateCells(ctx, a, { cells: [num(qty, 35)] } as never)) // 밖으로
    unwrap(await updateCells(ctx, d0, { cells: [num(qty, 1)] } as never)) // 안으로
    const n = await tb.row('n', [num(qty, 20)]) // 밖에 새로
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true, page }).then(unwrap), [a, d0, n])
    assert.equal(d.placed, true)
    assert.deepEqual(placeOf(d, a), { before: c, after: null, beyond: true })
    assert.deepEqual(placeOf(d, d0), { before: null, after: b, beyond: false })
    assert.deepEqual(placeOf(d, n), { before: b, after: c, beyond: true })

    const more = unwrap(await queryRows(ctx, tb.ds, { sorts, manualOrderViewId: tb.viewId, limit: 100, cursor: page }))
    assert.deepEqual(more.rows.map((r) => r.id), [n, c, a], '더 보기가 beyond 인 행을 가져온다')
  })
})

describe('③ 손으로 둔 순서', () => {
  test('★ 정렬 없는 뷰에서 옮긴 행 — 새 자리의 이웃 · orderChanged', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ③ ${Date.now()}`)
    const a = await tb.row('a')
    const b = await tb.row('b')
    const c = await tb.row('c')
    const start = await settledCursor(tb.ds)
    unwrap(await moveViewRow(ctx, tb.viewId, { rowId: c, beforeRowId: a }))
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true }).then(unwrap), [c])
    assert.equal(d.orderChanged, true)
    assert.equal(d.placed, true)
    assert.deepEqual(placeOf(d, c), { before: null, after: a, beyond: false })
    assert.deepEqual(await listing(ctx, tb.ds, { viewId: tb.viewId }), [c, a, b])
  })
})

describe('④ 뷰에 서지 않는 행', () => {
  test('필터 밖으로 고친 행 · 휴지통의 행에는 자리가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ④ ${Date.now()}`)
    const qty = await tb.prop('수량', 'number')
    unwrap(await updateView(ctx, tb.viewId, { filter: { property_id: qty, operator: 'greater_than', value: 10 } }))
    const a = await tb.row('a', [num(qty, 20)])
    const b = await tb.row('b', [num(qty, 30)])
    const start = await settledCursor(tb.ds)
    unwrap(await updateCells(ctx, a, { cells: [num(qty, 1)] } as never))
    unwrap(await trashRow(ctx, b))
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true }).then(unwrap), [a, b])
    const ra = d.rows.find((r) => r.id === a)!
    assert.equal(ra.inView, false)
    assert.equal(placeOf(d, a), undefined)
    assert.equal(d.rows.find((r) => r.id === b)!.kind, 'row_delete')
    assert.equal(d.placed, true, '자리가 필요한 행이 없다 — 줄 수 있다')
  })
})

describe('⑤ 자리를 줄 수 없는 뷰', () => {
  test('★ 하위 항목 트리 · 정렬에 맞지 않는 더 보기 커서 → placed: false · 묻지 않으면 자리가 없다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ⑤ ${Date.now()}`)
    const qty = await tb.prop('수량', 'number')
    const a = await tb.row('a', [num(qty, 1)])
    const start = await settledCursor(tb.ds)
    unwrap(await updateCells(ctx, a, { cells: [num(qty, 2)] } as never))

    // 정렬 없는 뷰의 커서(키 하나 — 수동 순서) 를 정렬이 둘인 뷰에 준다 → 맞지 않는다
    const stalePage = Buffer.from(JSON.stringify(['x']), 'utf8').toString('base64url')
    unwrap(await updateView(ctx, tb.viewId, { sorts: [{ property_id: qty, direction: 'asc' }, { property_id: tb.titleId, direction: 'asc' }] }))
    const stale = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true, page: stalePage }).then(unwrap), [a])
    assert.equal(stale.placed, false)
    assert.equal(placeOf(stale, a), undefined)

    const plain = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start).then(unwrap), [a])
    assert.equal('placed' in plain, false)
    assert.equal(placeOf(plain, a), undefined)

    unwrap(await enableSubItems(ctx, tb.ds))
    // 스키마 기록이 지평 아래로 들어올 때까지 — 다른 검사의 열린 트랜잭션이 지평을 붙잡으면 a 만 먼저 온다
    const tree = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { place: true }).then(unwrap), [a], (d) => d.schemaChanged)
    assert.equal(tree.schemaChanged, true)
    assert.equal(tree.placed, false, '하위 항목을 펴는 트리는 층마다라 한 줄의 이웃이 없다')
  })
})

describe('⑥ 열 집계', () => {
  test('물었고 바뀐 행이 있을 때만 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const ctx = fx.owner.ctx
    const tb = await table(ctx, `자리 ⑥ ${Date.now()}`)
    unwrap(await setViewColumn(ctx, tb.viewId, tb.titleId, { calculation: 'count_all' }))
    await tb.row('a')
    const start = await settledCursor(tb.ds)
    const none = unwrap(await readRowDelta(ctx, tb.ds, tb.viewId, start, { calculations: true }))
    assert.equal(none.calculations, undefined, '바뀐 행이 없으면 싣지 않는다')
    const b = await tb.row('b')
    const d = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start, { calculations: true }).then(unwrap), [b])
    assert.ok(d.calculations?.[tb.titleId] !== undefined, JSON.stringify(d.calculations))
    const plain = await deltaWith(() => readRowDelta(ctx, tb.ds, tb.viewId, start).then(unwrap), [b])
    assert.equal(plain.calculations, undefined, '묻지 않으면 없다')
  })
})
