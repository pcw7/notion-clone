/**
 * 검증 속성 — VF-1조각 (F-03-23 · DB)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 VF-1]).
 *
 *   ① ★ 칸 가드 — 다섯 키뿐 · verified_by 가 uuid · expires_at 은 verified_at 뒤 · 모르는 상태는 거부(0133)
 *   ② ★ 표마다 검증 속성 하나 · 소유자 사람 속성이 같은 트랜잭션에서 생기거나(없으면) 이어진다(있으면)
 *   ③ ★ 소유자 속성은 검증 속성이 가리키는 동안 지우지 못한다 · 검증 속성은 지울 수 있다
 *   ④ ★ 검증 · 해제는 그 행을 편집할 수 있는 사람 — 보기만 하는 사람은 거부
 *   ⑤ ★ 플랜 — 속성 더하기 · 검증은 Business 이상(plan_required) · 해제는 낮은 플랜에서도 된다
 *   ⑥ 지난 만료는 invalid_value · 다시 검증하면 덮어쓴다
 *   ⑦ ★ 일반 칸 쓰기는 검증 칸을 받지 않는다 · 복제 · 템플릿은 검증 칸을 옮기지 않는다
 *   ⑧ 읽을 때 만료를 정한다 — expired 는 저장되지 않는다
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { setWorkspacePlan } from '../billing/plan.ts'
import { grantAccess, revokeAccess } from '../permissions/acl.ts'
import { createDatabase } from './database.ts'
import { duplicateDatabase } from './duplicate-database.ts'
import { addProperty, deleteProperty, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createRow, listRows, updateCells } from './row.ts'
import { createRowFromTemplate, createTemplate } from './template.ts'
import { unverifyRow, verifyRow } from './verification.ts'

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

/** Business 워크스페이스의 표 하나 + 검증 속성 + 행 하나. */
async function setup() {
  const ws = await createBareWorkspace('검증')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  await setWorkspacePlan(ws, 'business')
  const db = unwrap(await createDatabase(boss.ctx, { name: '위키' }))
  const added = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '검증', type: 'verification' }))
  const prop = added.properties.find((p) => p.type === 'verification')!.id
  const row = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
  return { ws, boss, db, prop, row }
}

const storedCell = async (row: string, prop: string) =>
  (await query<{ value: Record<string, unknown> }>(`SELECT value FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [row, prop]))[0]?.value

test('① ★ 칸 가드 — 모양이 틀린 검증 칸은 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, prop, row } = await setup()
  const good = { type: 'verification', state: 'verified', verified_by: boss.userId, verified_at: '2026-11-01T00:00:00Z', expires_at: null }
  const put = (value: unknown) =>
    query(`INSERT INTO page_property_value (page_id, property_id, value) VALUES ($1, $2, $3::jsonb) ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value`, [
      row,
      prop,
      JSON.stringify(value),
    ])
  await put(good)
  await put({ ...good, expires_at: '2026-12-01T00:00:00Z' })
  const noWho = { type: good.type, state: good.state, verified_at: good.verified_at, expires_at: good.expires_at }
  for (const [label, value] of [
    ['verified_by 없음', noWho],
    ['verified_by 가 uuid 가 아님', { ...good, verified_by: 'someone' }],
    ['모르는 상태', { ...good, state: 'expired' }],
    ['expires_at 이 verified_at 보다 앞', { ...good, expires_at: '2026-10-01T00:00:00Z' }],
    ['expires_at 이 verified_at 과 같음', { ...good, expires_at: good.verified_at }],
    ['모르는 키', { ...good, expired: false }],
    ['시각이 읽히지 않음', { ...good, verified_at: '2026-13-45T00:00:00Z' }],
    ['expires_at 키 없음', { type: good.type, state: good.state, verified_by: good.verified_by, verified_at: good.verified_at }],
  ] as const) {
    await assert.rejects(put(value), (e: { code?: string }) => e.code === '23514', label)
  }
})

test('② ★ 표마다 검증 속성 하나 · 소유자 사람 속성이 생긴다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop } = await setup()
  const schema = unwrap(await getSchema(boss.ctx, db.dataSourceId))
  const owners = schema.properties.filter((p) => p.name === '소유자')
  assert.equal(owners.length, 1)
  assert.equal(owners[0]!.type, 'people')
  const cfg = (await query<{ config: { owner_property_id?: string } }>(`SELECT config FROM property WHERE id = $1`, [prop]))[0]!.config
  assert.deepEqual(cfg, { owner_property_id: owners[0]!.id })

  const second = await addProperty(boss.ctx, db.dataSourceId, { name: '검증 2', type: 'verification' })
  assert.deepEqual(second, { ok: false, reason: 'verification_exists' })
  // 앱이 못 본 길로도 — 부분 UNIQUE 가 막는다
  await assert.rejects(
    query(`INSERT INTO property (id, data_source_id, name, type, config, order_idx) VALUES ($1, $2, 'x', 'verification', $3::jsonb, 'zz')`, [
      'v'.repeat(21),
      db.dataSourceId,
      JSON.stringify({ owner_property_id: owners[0]!.id }),
    ]),
    (e: { code?: string; constraint?: string }) => e.code === '23505' && e.constraint === 'ux_property_verification_one',
  )
  // 설정은 owner_property_id 하나뿐이다
  await assert.rejects(
    query(`UPDATE property SET config = '{}'::jsonb WHERE id = $1`, [prop]),
    (e: { constraint?: string }) => e.constraint === 'ck_property_verification_config',
  )
})

test('② 이미 "소유자" 사람 속성이 있으면 그것을 잇는다 · 다른 타입이면 이름이 겹친다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const ws = await createBareWorkspace('소유자')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  await setWorkspacePlan(ws, 'business')
  const db = unwrap(await createDatabase(boss.ctx, { name: '표' }))
  const owner = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '소유자', type: 'people' })).properties.find((p) => p.name === '소유자')!.id
  const done = unwrap(await addProperty(boss.ctx, db.dataSourceId, { name: '검증', type: 'verification' }))
  assert.equal(done.properties.filter((p) => p.name === '소유자').length, 1, '새로 만들지 않는다')
  const verification = done.properties.find((p) => p.type === 'verification')!.id
  assert.equal((await query<{ o: string }>(`SELECT config ->> 'owner_property_id' AS o FROM property WHERE id = $1`, [verification]))[0]!.o, owner)

  const other = unwrap(await createDatabase(boss.ctx, { name: '다른 표' }))
  unwrap(await addProperty(boss.ctx, other.dataSourceId, { name: '소유자', type: 'rich_text' }))
  const clash = await addProperty(boss.ctx, other.dataSourceId, { name: '검증', type: 'verification' })
  assert.deepEqual(clash, { ok: false, reason: 'duplicate_name' }, '글 속성 "소유자" 가 있으면 이름이 겹친다')
})

test('③ ★ 소유자 속성은 검증 속성이 가리키는 동안 지우지 못한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop } = await setup()
  const owner = unwrap(await getSchema(boss.ctx, db.dataSourceId)).properties.find((p) => p.name === '소유자')!.id
  assert.deepEqual(await deleteProperty(boss.ctx, db.dataSourceId, owner), { ok: false, reason: 'owner_linked' })
  unwrap(await deleteProperty(boss.ctx, db.dataSourceId, prop))
  unwrap(await deleteProperty(boss.ctx, db.dataSourceId, owner))
})

test('④ ★ 편집할 수 있는 사람만 검증 · 해제한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, db, prop, row } = await setup()
  const viewer = await joinAs(ws, await createUser('보는 사람'), 'member')
  const editor = await joinAs(ws, await createUser('고치는 사람'), 'member')
  assert.equal((await grantAccess(boss.ctx, db.id, { type: 'user', id: boss.userId }, 'full_access')).ok, true)
  assert.equal((await revokeAccess(boss.ctx, db.id, { type: 'workspace_everyone', id: null })).ok, true)
  assert.equal((await grantAccess(boss.ctx, db.id, { type: 'user', id: viewer.userId }, 'view')).ok, true)
  assert.equal((await grantAccess(boss.ctx, db.id, { type: 'user', id: editor.userId }, 'edit_content')).ok, true)

  assert.deepEqual(await verifyRow(viewer.ctx, row, prop, null), { ok: false, reason: 'forbidden' })
  const done = unwrap(await verifyRow(editor.ctx, row, prop, inDays(30)))
  assert.equal(done.verified_by, editor.userId, '검증한 사람은 부른 사람이다')
  assert.equal(done.expired, false)
  assert.deepEqual(await unverifyRow(viewer.ctx, row, prop), { ok: false, reason: 'forbidden' })
  assert.ok(await storedCell(row, prop), '거부는 칸을 지우지 않는다')
  unwrap(await unverifyRow(editor.ctx, row, prop))
  assert.equal(await storedCell(row, prop), undefined, '해제는 칸을 지운다')
  unwrap(await unverifyRow(editor.ctx, row, prop))
})

test('⑤ ★ 플랜 — 낮은 플랜은 속성 더하기 · 검증을 거부하고 해제는 된다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { ws, boss, db, prop, row } = await setup()
  unwrap(await verifyRow(boss.ctx, row, prop, null))
  await setWorkspacePlan(ws, 'free')
  assert.deepEqual(await verifyRow(boss.ctx, row, prop, null), { ok: false, reason: 'plan_required' })
  const second = unwrap(await createDatabase(boss.ctx, { name: '다른 표' }))
  assert.deepEqual(await addProperty(boss.ctx, second.dataSourceId, { name: '검증', type: 'verification' }), { ok: false, reason: 'plan_required' })
  assert.notEqual(unwrap(await listRows(boss.ctx, db.dataSourceId)).rows.find((r) => r.id === row)?.properties[prop], undefined, '있던 값은 보인다')
  unwrap(await unverifyRow(boss.ctx, row, prop))
  assert.equal(await storedCell(row, prop), undefined)
})

test('⑥ 지난 만료는 거부 · 다시 검증하면 덮어쓴다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, prop, row } = await setup()
  assert.deepEqual(await verifyRow(boss.ctx, row, prop, inDays(-1)), { ok: false, reason: 'invalid_value' })
  assert.deepEqual(await verifyRow(boss.ctx, row, prop, 'not a date'), { ok: false, reason: 'invalid_value' })
  assert.equal(await storedCell(row, prop), undefined)
  unwrap(await verifyRow(boss.ctx, row, prop, inDays(7)))
  const first = await storedCell(row, prop)
  unwrap(await verifyRow(boss.ctx, row, prop, null))
  const second = await storedCell(row, prop)
  assert.equal(second?.expires_at, null)
  assert.ok(String(second?.verified_at) >= String(first?.verified_at))
  assert.deepEqual(await verifyRow(boss.ctx, row, 'nope', null), { ok: false, reason: 'unknown_property' })
})

test('⑦ ★ 일반 칸 쓰기는 검증 칸을 받지 않는다 · 복제 · 템플릿은 옮기지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop, row } = await setup()
  const forged = { type: 'verification', state: 'verified', verified_by: boss.userId, verified_at: new Date().toISOString(), expires_at: null }
  const patched = await updateCells(boss.ctx, row, { cells: [{ propertyId: prop, value: forged as never }] })
  assert.equal(patched.ok, false)
  assert.equal(!patched.ok && patched.reason, 'unknown_property')
  assert.equal(await storedCell(row, prop), undefined)
  const created = await createRow(boss.ctx, db.dataSourceId, { cells: [{ propertyId: prop, value: forged as never }] })
  assert.equal(created.ok, false, '행 만들기도 같다')

  // 템플릿 행에 검증이 있어도 새 행으로 옮기지 않는다
  const template = unwrap(await createTemplate(boss.ctx, db.dataSourceId, { title: '틀' }))
  unwrap(await verifyRow(boss.ctx, template.id, prop, null))
  assert.ok(await storedCell(template.id, prop))
  const fromTemplate = unwrap(await createRowFromTemplate(boss.ctx, db.dataSourceId, template.id)).row
  assert.equal(await storedCell(fromTemplate.id, prop), undefined)

  // 데이터베이스 복제 — 행(내용 있음)의 검증 칸은 따라가지 않는다
  unwrap(await verifyRow(boss.ctx, row, prop, null))
  const copy = unwrap(await duplicateDatabase(boss.ctx, db.id, { content: true }))
  const copied = await query<{ n: string }>(
    `SELECT count(*) AS n FROM page_property_value v JOIN property pr ON pr.id = v.property_id
      JOIN data_source ds ON ds.id = pr.data_source_id WHERE ds.owner_database_id = $1 AND pr.type = 'verification'`,
    [copy.id],
  )
  assert.equal(Number(copied[0]!.n), 0)
  assert.ok(copy.rows >= 1)
})

test('⑧ 읽을 때 만료를 정한다 — expired 는 저장되지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const { boss, db, prop, row } = await setup()
  const soon = unwrap(await createRow(boss.ctx, db.dataSourceId)).id
  unwrap(await verifyRow(boss.ctx, row, prop, inDays(10)))
  // 시각이 지난 값은 쓰기 없이 만료가 된다 — 지난 날짜로 직접 적는다
  await query(`UPDATE page_property_value SET value = $3::jsonb WHERE page_id = $1 AND property_id = $2`, [
    row,
    prop,
    JSON.stringify({ type: 'verification', state: 'verified', verified_by: boss.userId, verified_at: inDays(-10), expires_at: inDays(-1) }),
  ])
  unwrap(await verifyRow(boss.ctx, soon, prop, inDays(5)))
  const queried = unwrap(await queryRows(boss.ctx, db.dataSourceId, {}))
  const byId = new Map(queried.rows.map((r) => [r.id, r.properties[prop] as { expired?: boolean }]))
  assert.equal(byId.get(row)?.expired, true)
  assert.equal(byId.get(soon)?.expired, false)
  const listed = unwrap(await listRows(boss.ctx, db.dataSourceId))
  assert.equal((listed.rows.find((r) => r.id === row)?.properties[prop] as { expired?: boolean }).expired, true)
  assert.equal('expired' in ((await storedCell(row, prop)) ?? {}), false)
})
