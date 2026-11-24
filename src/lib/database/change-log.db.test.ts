/**
 * 표의 변경 기록 · 델타 — RT-1조각 (F-05-16 · F-05-06, DB 필요)
 *
 *   ① 트리거가 쓰기마다 맞는 종류를 쌓는다 — 행 넣기 · 칸 · 휴지통 · 보드 순서 · 옵션 · 속성 · 뷰 · 레이아웃. 한 트랜잭션의 같은 것은 한 줄
 *   ② ★ 안전 지평 — 커밋 차례가 seq 차례와 다를 때
 *      (a) A 가 먼저 쓰고 열린 채 B 가 쓰고 커밋 → A 가 끝나기 전에는 B 도 주지 않는다(behind) · 커서는 A 를 넘지 않는다 · A 가 끝나면 둘 다
 *      (b) C 가 xid 를 먼저 받고 · A 가 seq 를 먼저 받고 · C 가 뒤의 seq 로 커밋 → C 만 주고, A 가 끝나면 A 를 준다
 *          ("xid < 지평 · 커서 = 준 것의 가장 큰 seq" 였다면 A 를 잃는다)
 *   ③ 볼 수 없는 행은 id 도 없다 — "만들기만"(규칙 없음)에게 남의 행의 넣기 · 칸 · 휴지통이 오지 않는다
 *   ④ inView 는 그 뷰의 필터를 따른다 — 필터 밖으로 고친 행은 inView:false(값은 온다) · 안으로 들어온 행은 true · 휴지통은 row_delete
 *   ⑤ reset — 커서 없음 · 앞선 커서 · 24시간 창 밖(지운 자리 이하) · 바뀐 행 상한 초과
 *   ⑥ 보관 정리는 창 밖의 줄만 지우고 표마다 지운 자리를 남긴다
 *   ⑦ 구독이 붙기 전의 틈(changedSinceCursor) — 커서 뒤에 바뀐 표만 참 · 지운 자리 아래의 커서는 참
 *
 * ⚠ 다른 검사 파일이 동시에 돈다 — 그쪽의 열린 트랜잭션이 지평을 붙잡을 수 있다. "아직 주지 않는다"는 늘 참이고, "이제 준다"는 지평이
 *   지나갈 때까지 잠깐 다시 묻는다(`eventually`).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { createBareWorkspace, createUser, joinAs, makeFixture, probeDatabase, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { grantAccess } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, getSchema } from './property.ts'
import type { MvpPropertyType } from './property-types.ts'
import { createRow, trashRow, updateCells } from './row.ts'
import { moveViewRow } from './row-order.ts'
import { updateView } from './view.ts'
import { applyRecordLayout } from './layout.ts'
import {
  changedSinceCursor,
  collectChangeLog,
  currentChangeCursor,
  currentChangeHorizon,
  decodeChangeCursor,
  encodeChangeCursor,
  readChangeWindow,
  CHANGE_LOG_WINDOW_MS,
  DELTA_ROW_CAP,
} from './change-log.ts'
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

/** 이 표의 기록 — `mark`(seq) 뒤의 것. */
async function logAfter(ds: string, mark: string) {
  const { query } = await import('../db/pool.ts')
  return query<{ kind: string; row_id: string | null; view_id: string | null }>(
    `SELECT kind, row_id, view_id FROM data_source_change WHERE data_source_id = $1 AND seq > $2::bigint ORDER BY seq`,
    [ds, mark],
  )
}
async function mark(): Promise<string> {
  const { query } = await import('../db/pool.ts')
  return (await query<{ m: string }>(`SELECT COALESCE(max(seq), 0)::text AS m FROM data_source_change`))[0]!.m
}

/** 이 일이 이 표에 남긴 기록. */
async function logged(ds: string, work: () => Promise<unknown>) {
  const m = await mark()
  await work()
  return logAfter(ds, m)
}

/** 지평이 지나갈 때까지 다시 묻는다 — 다른 검사의 열린 트랜잭션이 잠깐 붙잡을 수 있다. */
async function eventually(read: () => Promise<RowDelta>, ok: (d: RowDelta) => boolean, ms = 8000): Promise<RowDelta> {
  let last = await read()
  for (let t = 0; t < ms && !ok(last); t += 100) {
    await sleep(100)
    last = await read()
  }
  return last
}

/**
 * 이 표들의 지금까지의 기록을 모두 지난 커서 — 출발점. 그냥 받은 커서는 다른 검사의 열린 트랜잭션이 지평을 붙잡으면 이 표의 앞선 쓰기(표 ·
 * 행 만들기)보다 낮을 수 있고, 그러면 그것들이 다시 온다(커서의 뜻 그대로 — 두 번 올 수 있다). 검사가 "그 뒤의 것만"을 보려면 지평이
 * 그것들을 지나갈 때까지 기다린다.
 */
async function settledCursor(...sources: string[]): Promise<string> {
  const { query } = await import('../db/pool.ts')
  const top = (await query<{ x: string | null }>(`SELECT max(xid)::text AS x FROM data_source_change WHERE data_source_id = ANY($1::uuid[])`, [sources]))[0]!.x
  let horizon = await currentChangeHorizon()
  for (let t = 0; top !== null && horizon <= BigInt(top) && t < 15_000; t += 100) {
    await sleep(100)
    horizon = await currentChangeHorizon()
  }
  if (top !== null) assert.ok(horizon > BigInt(top), '전제 — 지평이 이 표의 앞선 쓰기를 지나갔다')
  return encodeChangeCursor(horizon)
}

const delta = async (ctx: SessionContext, ds: string, viewId: string, after: string | null) => unwrap(await readRowDelta(ctx, ds, viewId, after))
const ids = (d: RowDelta) => d.rows.map((r) => r.id).sort()

describe('① 트리거가 맞는 종류를 쌓는다', () => {
  test('★ 행 넣기 · 칸 · 보드 순서 · 휴지통 · 옵션 · 속성 · 뷰 · 레이아웃', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '기록 종류')
    const qty = await t.prop('수량', 'number')
    const stage = await t.prop('단계', 'select')
    const b = await t.row('나')

    let a = ''
    const made = await logged(t.ds, async () => (a = await t.row('가')))
    assert.ok(made.length > 0 && made.every((e) => e.kind === 'row_upsert' && e.row_id === a), `행 넣기: ${JSON.stringify(made)}`)

    const cell = await logged(t.ds, () => updateCells(fx.owner.ctx, a, { cells: [{ propertyId: qty, value: { type: 'number', number: 3 } }] }))
    assert.deepEqual(cell.map((e) => [e.kind, e.row_id]), [['row_upsert', a]], '칸 — 한 트랜잭션의 같은 행은 한 줄')

    const moved = await logged(t.ds, () => moveViewRow(fx.owner.ctx, t.viewId, { rowId: b, beforeRowId: a }))
    assert.ok(moved.some((e) => e.kind === 'position' && e.row_id === b && e.view_id === t.viewId), `보드 순서: ${JSON.stringify(moved)}`)

    const option = await logged(t.ds, () => addSelectOption(fx.owner.ctx, t.ds, stage, { name: '검토' }))
    assert.deepEqual(option.map((e) => [e.kind, e.row_id, e.view_id]), [['schema', null, null]], '옵션')

    const property = await logged(t.ds, () => t.prop('메모', 'rich_text'))
    assert.ok(property.length > 0 && property.some((e) => e.kind === 'schema'), `속성: ${JSON.stringify(property)}`)

    const view = await logged(t.ds, () => updateView(fx.owner.ctx, t.viewId, { filter: { property_id: qty, operator: 'greater_than', value: 1 } }))
    assert.deepEqual(view.map((e) => [e.kind, e.row_id, e.view_id]), [['view', null, t.viewId]], '뷰')

    const layout = await logged(t.ds, async () =>
      unwrap(await applyRecordLayout(fx.owner.ctx, t.ds, { expectedVersion: '0', order: [], hidden: [], settings: { fullWidth: true } })),
    )
    assert.ok(layout.length > 0 && layout.every((e) => e.kind === 'layout'), `레이아웃: ${JSON.stringify(layout)}`)

    const trashed = await logged(t.ds, () => trashRow(fx.owner.ctx, a))
    assert.ok(trashed.some((e) => e.kind === 'row_delete' && e.row_id === a), `휴지통: ${JSON.stringify(trashed)}`)
  })
})

describe('② ★ 안전 지평 — 커밋 차례가 seq 차례와 다르다', () => {
  test('★ (a) A 가 seq 를 먼저 받고 열린 채 B 가 커밋 → A 가 끝나기 전에는 B 도 없다 · 끝나면 둘 다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '지평 a')
    const ra = await t.row('A')
    const rb = await t.row('B')
    const { getPool } = await import('../db/pool.ts')
    const start = await settledCursor(t.ds)
    const ca = await getPool().connect()
    const cb = await getPool().connect()
    try {
      await ca.query('BEGIN')
      await ca.query(`UPDATE page SET properties_cache = properties_cache WHERE id = $1`, [ra])
      const seqA = (await ca.query(`SELECT max(seq)::text AS s FROM data_source_change WHERE data_source_id = $1 AND row_id = $2`, [t.ds, ra])).rows[0].s
      const xidA = BigInt((await ca.query(`SELECT pg_current_xact_id()::text AS x`)).rows[0].x)
      await cb.query('BEGIN')
      await cb.query(`UPDATE page SET properties_cache = properties_cache WHERE id = $1`, [rb])
      const seqB = (await cb.query(`SELECT max(seq)::text AS s FROM data_source_change WHERE data_source_id = $1 AND row_id = $2`, [t.ds, rb])).rows[0].s
      await cb.query('COMMIT')
      assert.ok(BigInt(seqA) < BigInt(seqB), `전제 — A 가 앞의 seq(${seqA} < ${seqB})`)

      const held = await delta(fx.owner.ctx, t.ds, t.viewId, start)
      assert.equal(held.reset, false)
      assert.deepEqual(ids(held), [], '★ 지평 뒤의 B 는 아직 주지 않는다(A 가 열려 있다)')
      assert.equal(held.behind, true, '★ B 가 이미 커밋됐다는 것은 알린다(behind)')
      assert.ok(decodeChangeCursor(held.cursor)! <= xidA, '★ 커서는 A 를 넘지 않는다')

      await ca.query('COMMIT')
      const both = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, held.cursor), (d) => ids(d).length === 2)
      assert.deepEqual(ids(both), [ra, rb].sort(), '★ A 가 끝나면 A 와 B 를 함께 — 빠진 것이 없다')
      const next = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, both.cursor), (d) => !d.behind)
      assert.deepEqual(ids(next), [], '그 커서부터는 다시 오지 않는다')
    } finally {
      await ca.query('ROLLBACK').catch(() => undefined)
      await cb.query('ROLLBACK').catch(() => undefined)
      ca.release()
      cb.release()
    }
  })

  test('★ (b) xid 가 앞선 C 가 뒤의 seq 로 커밋 → C 만 주고 · A 가 끝나면 A 를 준다(seq 커서였다면 A 를 잃는다)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '지평 b')
    const ra = await t.row('A')
    const rc = await t.row('C')
    const { getPool } = await import('../db/pool.ts')
    const start = await settledCursor(t.ds)
    const ca = await getPool().connect()
    const cc = await getPool().connect()
    try {
      await cc.query('BEGIN')
      const xidC = BigInt((await cc.query(`SELECT pg_current_xact_id()::text AS x`)).rows[0].x) // C 가 xid 를 먼저 받는다(아직 쓰지 않았다)
      await ca.query('BEGIN')
      await ca.query(`UPDATE page SET properties_cache = properties_cache WHERE id = $1`, [ra]) // A — 뒤의 xid · 앞의 seq
      const xidA = BigInt((await ca.query(`SELECT pg_current_xact_id()::text AS x`)).rows[0].x)
      await cc.query(`UPDATE page SET properties_cache = properties_cache WHERE id = $1`, [rc]) // C — 앞의 xid · 뒤의 seq
      await cc.query('COMMIT')
      const seqOf = async (row: string) =>
        BigInt((await getPool().query(`SELECT max(seq)::text AS s FROM data_source_change WHERE row_id = $1`, [row])).rows[0].s ?? '0')
      assert.ok(xidC < xidA, '전제 — C 의 xid 가 앞선다')
      assert.ok((await seqOf(rc)) > BigInt(0), '전제 — C 의 기록이 커밋됐다')

      const first = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, start), (d) => ids(d).includes(rc))
      assert.deepEqual(ids(first), [rc], '★ C 는 준다 · A 는 아직(열려 있다)')
      assert.ok(decodeChangeCursor(first.cursor)! <= xidA, '★ 커서는 A 의 xid 를 넘지 않는다 — C 의 seq 가 A 의 것보다 커도')

      await ca.query('COMMIT')
      assert.ok((await seqOf(ra)) < (await seqOf(rc)), '전제 — A 의 seq 가 C 의 것보다 앞이다')
      const later = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, first.cursor), (d) => ids(d).includes(ra))
      assert.deepEqual(ids(later), [ra], '★ A 가 끝나면 A 를 준다 — 잃지 않는다')
    } finally {
      await ca.query('ROLLBACK').catch(() => undefined)
      await cc.query('ROLLBACK').catch(() => undefined)
      ca.release()
      cc.release()
    }
  })
})

describe('③ 볼 수 없는 행은 id 도 없다', () => {
  test('★ "만들기만"(규칙 없음)에게 남의 행의 넣기 · 칸 · 휴지통이 오지 않는다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const ws = await createBareWorkspace('델타 권한')
    const boss = await joinAs(ws, await createUser('대표'), 'owner')
    const maker = await joinAs(ws, await createUser('제출자'), 'member')
    const db = unwrap(await createDatabase(boss.ctx, { name: '제출함', privateTop: true }))
    const ds = db.dataSourceId
    const titleId = unwrap(await getSchema(boss.ctx, ds)).properties.find((p) => p.type === 'title')!.id
    const title = (s: string) => [{ propertyId: titleId, value: { type: 'title', title: [textRun(s)] } as never }]
    const old = unwrap(await createRow(boss.ctx, ds, { cells: title('옛 행') })).id
    assert.ok((await grantAccess(boss.ctx, db.id, { type: 'user', id: maker.userId }, 'create')).ok)
    const start = await currentChangeCursor()

    const fresh = unwrap(await createRow(boss.ctx, ds, { cells: title('새 행') })).id
    unwrap(await updateCells(boss.ctx, old, { cells: title('고친 옛 행') }))
    unwrap(await trashRow(boss.ctx, old))

    const theirs = await eventually(() => delta(boss.ctx, ds, db.defaultViewId, start), (d) => d.rows.length === 2)
    assert.deepEqual(
      theirs.rows.map((r) => [r.id, r.kind]).sort(),
      [[fresh, 'row_upsert'], [old, 'row_delete']].sort(),
      '전제 — 대표는 둘을 본다',
    )
    const mine = await delta(maker.ctx, ds, db.defaultViewId, start)
    assert.equal(mine.reset, false)
    assert.deepEqual(mine.rows, [], '★ "만들기만" 에게는 남의 행이 id 로도 오지 않는다(넣기 · 칸 · 휴지통)')
    assert.deepEqual(JSON.stringify(mine).includes(fresh) || JSON.stringify(mine).includes(old), false, '응답 어디에도 그 id 가 없다')

    const stranger = await joinAs(ws, await createUser('남'), 'member')
    assert.deepEqual(await readRowDelta(stranger.ctx, ds, db.defaultViewId, start), { ok: false, reason: 'not_found' }, '표를 열 수 없으면 없다')
  })
})

describe('④ inView 는 뷰의 필터를 따른다', () => {
  test('★ 필터 밖으로 고친 행은 inView:false(값은 온다) · 안으로 들어온 행은 true · 휴지통은 row_delete', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '델타 필터')
    const qty = await t.prop('수량', 'number')
    const n = (v: number) => [{ propertyId: qty, value: { type: 'number', number: v } }]
    const inside = await t.row('안', n(5))
    const outside = await t.row('밖', n(0))
    const gone = await t.row('지울 것', n(9))
    unwrap(await updateView(fx.owner.ctx, t.viewId, { filter: { property_id: qty, operator: 'greater_than', value: 1 } }))
    const start = await settledCursor(t.ds)

    unwrap(await updateCells(fx.owner.ctx, inside, { cells: n(0) as never }))
    unwrap(await updateCells(fx.owner.ctx, outside, { cells: n(7) as never }))
    unwrap(await trashRow(fx.owner.ctx, gone))

    const d = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, start), (x) => x.rows.length === 3)
    const by = new Map(d.rows.map((r) => [r.id, r]))
    const leaving = by.get(inside)!
    assert.equal(leaving.kind, 'row_upsert')
    assert.equal(leaving.inView, false, '★ 필터 밖으로 고친 행 — inView:false')
    assert.equal(leaving.kind === 'row_upsert' ? (leaving.properties[qty] as { number?: number })?.number : null, 0, '값(지금의 것)은 온다')
    assert.equal(by.get(outside)?.inView, true, '★ 필터 안으로 들어온 행 — inView:true')
    assert.deepEqual(by.get(gone), { id: gone, kind: 'row_delete', inView: false }, '★ 휴지통 — 볼 수 있던 행은 id 만')
    assert.equal(d.viewChanged, false, '뷰는 커서 전에 고쳤다')
    assert.equal(d.schemaChanged, false)

    // 같은 커서로 다시 — 뷰를 고치면 viewChanged
    const before = await settledCursor(t.ds)
    unwrap(await updateView(fx.owner.ctx, t.viewId, { filter: null }))
    const v = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, before), (x) => x.viewChanged)
    assert.equal(v.viewChanged, true, '이 뷰를 고치면 viewChanged')
    assert.deepEqual(v.rows, [])
  })
})

describe('⑤ reset', () => {
  test('★ 커서 없음 · 앞선 커서 · 바뀐 행 상한 초과', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '델타 reset')
    const none = await delta(fx.owner.ctx, t.ds, t.viewId, null)
    assert.equal(none.reset, true)
    assert.equal(none.resetReason, 'no_cursor')
    assert.ok(decodeChangeCursor(none.cursor) !== null, 'reset 도 이어 물을 커서를 준다')
    assert.equal((await delta(fx.owner.ctx, t.ds, t.viewId, 'c1.junk')).resetReason, 'no_cursor', '모양이 틀린 커서')

    const ahead = encodeChangeCursor((await currentChangeHorizon()) + BigInt(1_000_000_000))
    assert.equal((await delta(fx.owner.ctx, t.ds, t.viewId, ahead)).resetReason, 'invalid', '★ 지평보다 앞선 커서 — 이 DB 의 것이 아니다')

    const start = await currentChangeCursor()
    const { query } = await import('../db/pool.ts')
    await query(
      `INSERT INTO data_source_change (data_source_id, kind, row_id) SELECT $1, 'row_upsert', gen_random_uuid() FROM generate_series(1, $2::int)`,
      [t.ds, DELTA_ROW_CAP + 1],
    )
    const many = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, start), (d) => d.reset)
    assert.equal(many.resetReason, 'too_many', `★ 바뀐 행이 ${DELTA_ROW_CAP}개를 넘으면 — 처음부터 다시 읽는다`)
  })

  test('★ 24시간 창 밖의 커서(지운 자리 이하) → reset · 지운 뒤의 커서는 델타', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '델타 창')
    const r = await t.row('가')
    const old = await currentChangeCursor()
    unwrap(await updateCells(fx.owner.ctx, r, { cells: [{ propertyId: t.titleId, value: { type: 'title', title: [textRun('나')] } as never }] }))
    const ok = await eventually(() => delta(fx.owner.ctx, t.ds, t.viewId, old), (d) => d.rows.length === 1)
    assert.equal(ok.reset, false, '전제 — 지우기 전에는 델타')

    // 하루하고 한 시간 뒤의 보관 정리 — 이 표의 줄을 모두 지운다
    const purged = await collectChangeLog(new Date(Date.now() + CHANGE_LOG_WINDOW_MS + 3_600_000), { dataSources: [t.ds] })
    assert.ok(purged >= 1, `지웠다: ${purged}`)
    const expired = await delta(fx.owner.ctx, t.ds, t.viewId, old)
    assert.equal(expired.reset, true)
    assert.equal(expired.resetReason, 'expired', '★ 지운 기록을 넘겨야 하는 커서 — reset')
    assert.equal(await changedSinceCursor(t.ds, decodeChangeCursor(old)!), true, '★ 틈 판정도 모른다(참)')

    const fresh = await currentChangeCursor()
    const after = await delta(fx.owner.ctx, t.ds, t.viewId, fresh)
    assert.equal(after.reset, false, '지운 뒤에 받은 커서는 델타를 받는다')
  })
})

describe('⑥ 보관 정리는 창 밖의 줄만 지운다', () => {
  test('★ 창 밖 · 창 안 · 창 안 뒤에 넣은 옛 줄 — 앞의 것만 지우고 지운 자리를 남긴다', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const ds = randomUUID()
    const { query } = await import('../db/pool.ts')
    const put = (hoursAgo: number) =>
      query<{ seq: string; xid: string }>(
        `INSERT INTO data_source_change (data_source_id, kind, at) VALUES ($1, 'schema', now() - make_interval(hours => $2)) RETURNING seq::text, xid::text`,
        [ds, hoursAgo],
      )
    const old1 = (await put(30))[0]!
    const old2 = (await put(25))[0]!
    const fresh = (await put(1))[0]!
    const lateOld = (await put(26))[0]! // 창 안의 줄 뒤에 들어온 옛 시각 — 오래 열린 트랜잭션의 것과 같다
    const left = async () =>
      (await query<{ seq: string }>(`SELECT seq::text FROM data_source_change WHERE data_source_id = $1 ORDER BY seq`, [ds])).map((r) => r.seq)

    assert.equal(await collectChangeLog(new Date(), { dataSources: [ds] }), 2)
    assert.deepEqual(await left(), [fresh.seq, lateOld.seq], '★ 창 밖의 앞 줄 둘만 — 창 안의 줄과 그 뒤의 것은 남는다')
    const floor = (await query<{ f: string }>(`SELECT purged_through::text AS f FROM data_source_change_floor WHERE data_source_id = $1`, [ds]))[0]!.f
    assert.equal(BigInt(floor), [old1.xid, old2.xid].map(BigInt).reduce((a, b) => (a > b ? a : b)), '★ 지운 자리 = 지운 것의 가장 큰 xid')

    assert.equal(await collectChangeLog(new Date(), { dataSources: [ds] }), 0, '다시 돌려도 창 안의 줄은 그대로')
    assert.equal(await collectChangeLog(new Date(Date.now() + CHANGE_LOG_WINDOW_MS), { dataSources: [ds] }), 2, '창 안의 줄이 창 밖이 되면 — 경계가 지나가 뒤의 옛 줄도')
    assert.deepEqual(await left(), [])
    assert.equal(await collectChangeLog(new Date(Date.now() + 2 * CHANGE_LOG_WINDOW_MS), { dataSources: [randomUUID()] }), 0, '범위 밖의 표는 건드리지 않는다')
  })
})

describe('⑦ 구독이 붙기 전의 틈 — 기록으로', () => {
  test('★ 커서 뒤에 바뀐 표만 참 · 다른 표 · 그 뒤의 커서는 거짓', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '틈 기록')
    const other = await table(fx.owner.ctx, '틈 다른 표')
    const r = await t.row('가')
    const rendered = decodeChangeCursor(await settledCursor(t.ds, other.ds))!
    assert.equal(await changedSinceCursor(t.ds, rendered), false, '아직 바뀌지 않았다')
    unwrap(await updateCells(fx.owner.ctx, r, { cells: [{ propertyId: t.titleId, value: { type: 'title', title: [textRun('나')] } as never }] }))
    assert.equal(await changedSinceCursor(t.ds, rendered), true, '★ 커서 뒤에 바뀌었다 — 커밋되자마자(지평과 무관하게)')
    assert.equal(await changedSinceCursor(other.ds, rendered), false, '다른 표는 아니다')
    const later = async () => changedSinceCursor(t.ds, decodeChangeCursor(await currentChangeCursor())!)
    let quiet = await later()
    for (let i = 0; i < 80 && quiet; i += 1) {
      await sleep(100)
      quiet = await later()
    }
    assert.equal(quiet, false, '그 뒤에 받은 커서에는 바뀐 것이 없다')
    assert.equal(await changedSinceCursor(t.ds, rendered + BigInt(1_000_000_000)), true, '앞선 커서는 모른다(참)')
  })
})

describe('창 읽기 — 한 스냅샷', () => {
  test('지평 · 기록이 같은 문장에서 온다(지평 아래의 것만)', async (ctx) => {
    if (skipReason) return ctx.skip(skipReason)
    const t = await table(fx.owner.ctx, '창 읽기')
    const start = decodeChangeCursor(await settledCursor(t.ds))!
    await t.row('가')
    let w = await readChangeWindow(t.ds, start)
    for (let i = 0; i < 80 && w.entries.length === 0; i += 1) {
      await sleep(100)
      w = await readChangeWindow(t.ds, start)
    }
    assert.ok(w.entries.length >= 1 && w.entries.every((e) => e.kind === 'row_upsert'))
    assert.ok(w.horizon >= start)
  })
})
