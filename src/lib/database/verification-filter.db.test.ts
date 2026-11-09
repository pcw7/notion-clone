/**
 * 검증 속성의 필터 · 정렬 · 공개 칸 — VF-2b조각 (F-03-23 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 VF-1] ⑥).
 *
 *   ① ★ 필터 — 검증됨(만료 안 됨) · 만료(지금과 견준다) · 검증 안 됨(칸이 없는 행도) · 같지 않음은 그 반대 · 저장 검증이 모르는 값을 거부
 *   ② ★ 정렬 — 검증됨 < 만료 < 없음 · 같은 줄 안은 만료 시각 순(무기한은 검증됨의 맨 뒤) · 내림차순에서도 없음은 맨 뒤
 *   ③ ★ 공개 표 — 검증 열이 배지 값으로 서고 검증한 사람(id)이 실리지 않는다 · 검증 필터가 공개 표에도 같은 행을 가른다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { withReadTransaction } from '../db/tx.ts'
import { publishPage } from '../publish/public-link.ts'
import { resolvePublicPageIn } from '../publish/public-access.ts'
import { readPublicTableIn } from '../publish/public-database.ts'
import { createDatabase } from './database.ts'
import { addProperty } from './property.ts'
import { queryRows } from './query.ts'
import { createRow } from './row.ts'
import { updateView } from './view.ts'
import { verifyRow } from './verification.ts'
import { publicCell } from '../../app/p/public-cells.ts'

const REQUIRE_DB = process.env.REQUIRE_DB === '1'
let skipReason = ''

before(async () => {
  const problem = await probeDatabase()
  if (problem) {
    skipReason = problem
    if (REQUIRE_DB) throw new Error(`REQUIRE_DB=1 인데 ${skipReason}`)
  }
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

const DAY = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString()

/**
 * 행 다섯 — 늦게 만료(late: +30일) · 곧 만료(soon: +5일) · 무기한(forever) · 이미 만료(gone: -1일) · 검증 안 됨(none — 칸이 없다).
 */
async function setup() {
  const ws = await createBareWorkspace('검증 필터')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  await setWorkspacePlan(ws, 'business')
  const db = unwrap(await createDatabase(boss.ctx, { name: '위키' }))
  const added = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '검증', type: 'verification' }))
  const prop = added.properties.find((p) => p.type === 'verification')!.id
  const row = async () => unwrap(await createRow(boss.ctx, db.dataSourceId)).id
  const rows = { late: await row(), soon: await row(), forever: await row(), gone: await row(), none: await row() }
  unwrap(await verifyRow(boss.ctx, rows.late, prop, inDays(30)))
  unwrap(await verifyRow(boss.ctx, rows.soon, prop, inDays(5)))
  unwrap(await verifyRow(boss.ctx, rows.forever, prop, null))
  unwrap(await verifyRow(boss.ctx, rows.gone, prop, inDays(2)))
  // 지난 만료는 명령이 거부한다 — 직접 적는다
  await query(`UPDATE page_property_value SET value = value || $3::jsonb WHERE page_id = $1 AND property_id = $2`, [
    rows.gone,
    prop,
    JSON.stringify({ verified_at: inDays(-10), expires_at: inDays(-1) }),
  ])
  return { boss, db, prop, rows }
}

test('① ★ 필터 — 검증됨 · 만료 · 검증 안 됨 · 같지 않음', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop, rows } = await setup()
  const ids = async (operator: string, value: string) =>
    new Set(unwrap(await queryRows(boss.ctx, db.dataSourceId, { filter: { property_id: prop, operator, value } })).rows.map((r) => r.id))
  assert.deepEqual(await ids('is', 'verified'), new Set([rows.late, rows.soon, rows.forever]), '검증됨 — 만료 안 된 것(무기한 포함)')
  assert.deepEqual(await ids('is', 'expired'), new Set([rows.gone]), '만료 — 지난 만료 시각')
  assert.deepEqual(await ids('is', 'unverified'), new Set([rows.none]), '검증 안 됨 — 칸이 없는 행')
  assert.deepEqual(await ids('is_not', 'verified'), new Set([rows.gone, rows.none]))
  assert.deepEqual(await ids('is_not', 'expired'), new Set([rows.late, rows.soon, rows.forever, rows.none]))
  assert.deepEqual(await ids('is_not', 'unverified'), new Set([rows.late, rows.soon, rows.forever, rows.gone]))

  // 저장 검증 — 모르는 값 · 값 없음은 거부한다
  for (const value of ['verifed', undefined, true]) {
    const r = await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: prop, operator: 'is', value } })
    assert.equal(r.ok, false, String(value))
  }
  assert.ok((await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: prop, operator: 'is', value: 'expired' } })).ok)
})

test('② ★ 정렬 — 검증됨 < 만료 < 없음 · 만료 시각 순 · 무기한은 검증됨의 맨 뒤', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop, rows } = await setup()
  const order = async (direction: 'asc' | 'desc') =>
    unwrap(await queryRows(boss.ctx, db.dataSourceId, { sorts: [{ property_id: prop, direction }] })).rows.map((r) => r.id)
  assert.deepEqual(await order('asc'), [rows.soon, rows.late, rows.forever, rows.gone, rows.none])
  assert.deepEqual(await order('desc'), [rows.gone, rows.forever, rows.late, rows.soon, rows.none], '반대로 — 없음은 그래도 맨 뒤')
})

test('③ ★ 공개 표 — 배지 값만 · 검증한 사람이 실리지 않는다 · 필터가 같은 행을 가른다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop, rows } = await setup()
  const token = unwrap(await publishPage(boss.ctx, db.id)).token!
  const tableOf = () =>
    withReadTransaction(async (tx) => {
      const access = await resolvePublicPageIn(tx, token)
      if (!access.ok) throw new Error(access.reason)
      return readPublicTableIn(tx, access.value)
    })
  const table = (await tableOf())!
  const column = table.columns.find((c) => c.id === prop)
  assert.equal(column?.type, 'verification', '검증 열이 공개 표에 선다')
  const text = (id: string) => {
    const cell = publicCell(column!, table.rows.find((r) => r.id === id)!.cells[prop], null)
    return cell.kind === 'text' ? cell.text : ''
  }
  assert.match(text(rows.late), /^✓ 검증됨 · ~\d{4}-\d{2}-\d{2}까지$/)
  assert.equal(text(rows.forever), '✓ 검증됨')
  assert.equal(text(rows.gone), '만료')
  assert.equal(text(rows.none), '')
  assert.ok(!JSON.stringify(table).includes(boss.userId), '검증한 사람의 id 가 공개 표에 없다')

  unwrap(await updateView(boss.ctx, db.defaultViewId, { filter: { property_id: prop, operator: 'is', value: 'verified' } }))
  assert.deepEqual(new Set((await tableOf())!.rows.map((r) => r.id)), new Set([rows.late, rows.soon, rows.forever]))
})
