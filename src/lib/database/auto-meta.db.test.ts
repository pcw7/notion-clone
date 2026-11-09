/**
 * 만든 · 마지막 편집 시각과 사람 속성 — 값의 출처 · 필터 · 정렬 · 집계 · 내보내기 · 공개 (DB) — PT-3조각 (F-03-08)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 PT-1] ⑦ · 불변식 C1).
 *
 *   ① ★ 값은 행 페이지 블록의 열이다 — 행을 고치면 last_edited_* 가 바뀌고 created_* 는 그대로다 · 일반 칸 쓰기는 거부된다
 *   ② ★ 필터 — 만든 시각 "지난 1주 안"(상대 날짜) · 마지막 편집 사람 "나" · 포함하지 않음(만든 사람이 없는 행도)
 *   ③ ★ 정렬 — 마지막 편집 시각 · 커서로 넘겨도 순서가 그대로(마이크로초를 잃지 않는다)
 *   ④ ★ 열 집계 — 가장 이른 · 늦은 시각 · 사람 값 세기
 *   ⑤ ★ 공개 표 — 만든 시각은 그리고 만든 사람은 그리지 않는다
 *   ⑥ ★ 내보내기 · 이름표 — 시각 글 · 이름 · 게스트에게는 "멤버"
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { textRun } from '../contracts/rich-text.ts'
import { query } from '../db/pool.ts'
import { withReadTransaction } from '../db/tx.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { cellPlainText } from '../export/csv.ts'
import type { ExportDatabaseNode, ExportPageNode } from '../export/plan.ts'
import { readExportSnapshot } from '../export/snapshot.ts'
import { resolvePublicPageIn } from '../publish/public-access.ts'
import { readPublicTableIn } from '../publish/public-database.ts'
import { publishPage } from '../publish/public-link.ts'
import { computeCalculations } from './calculate.ts'
import { createDatabase } from './database.ts'
import { loadAutoMetaLabels } from './people.ts'
import { addProperty, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import type { FilterNode, SortKey } from './filter.ts'
import { AUTO_META_TYPES } from './property-types.ts'

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

async function setup() {
  const ws = await createBareWorkspace('자동 메타')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const mate = await joinAs(ws, await createUser('동료'), 'member')
  const guest = await joinAs(ws, await createUser('손님'), 'guest')
  const db = unwrap(await createDatabase(boss.ctx, { name: `자동 메타 ${Date.now()}` }))
  const ds = db.dataSourceId
  for (const type of AUTO_META_TYPES) unwrap(await addProperty(boss.ctx, ds, { name: type, type }))
  unwrap(await addProperty(boss.ctx, ds, { name: '메모', type: 'rich_text' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const id = (name: string) => props.find((p) => p.name === name)!.id
  const prop = {
    createdTime: id('created_time'),
    createdBy: id('created_by'),
    editedTime: id('last_edited_time'),
    editedBy: id('last_edited_by'),
    memo: id('메모'),
  }
  const names = new Map<string, string>()
  const row = async (name: string, who = boss) => {
    const created = unwrap(await createRow(who.ctx, ds, { cells: [] }))
    names.set(created.id, name)
    return created.id
  }
  const listed = async (opts: { filter?: FilterNode; sorts?: SortKey[]; limit?: number }) =>
    unwrap(await queryRows(boss.ctx, ds, { limit: 50, ...opts })).rows.map((r) => names.get(r.id)!)
  return { ws, boss, mate, guest, db, ds, prop, row, listed, names }
}

test('① ★ 값은 행 페이지 블록의 열이다 — 고치면 last_edited_* 가 바뀌고 created_* 는 그대로 · 칸 쓰기는 거부', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const before = unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!
  assert.equal(before.createdBy, s.boss.ctx.userId)
  assert.equal(before.lastEditedBy, s.boss.ctx.userId)

  await new Promise((resolve) => setTimeout(resolve, 20))
  unwrap(await updateCells(s.mate.ctx, id, { cells: [{ propertyId: s.prop.memo, value: { type: 'rich_text', rich_text: [textRun('고침')] } }] }))
  const after = unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!
  assert.equal(after.createdBy, s.boss.ctx.userId, '만든 사람은 그대로')
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime(), '만든 시각은 그대로')
  assert.equal(after.lastEditedBy, s.mate.ctx.userId, '마지막 편집 사람이 바뀐다')
  assert.ok(after.lastEditedAt.getTime() > before.lastEditedAt.getTime(), '마지막 편집 시각이 오른다')

  // 일반 칸 쓰기는 이 타입에 닿지 않는다(불변식 C1)
  for (const property of [s.prop.createdTime, s.prop.createdBy, s.prop.editedTime, s.prop.editedBy]) {
    const put = await updateCells(s.boss.ctx, id, { cells: [{ propertyId: property, value: { type: 'date', date: { start: '2026-01-01' } } }] })
    assert.equal(put.ok, false, '자동 메타 칸 쓰기')
  }
  const cells = await query<{ n: string }>(`SELECT count(*) AS n FROM page_property_value WHERE page_id = $1 AND property_id = ANY($2::text[])`, [
    id,
    [s.prop.createdTime, s.prop.createdBy, s.prop.editedTime, s.prop.editedBy],
  ])
  assert.equal(cells[0]!.n, '0', '칸이 만들어지지 않는다')
})

test('② ★ 필터 — 만든 시각 지난 1주 안 · 마지막 편집 사람 = 나 · 포함하지 않음(만든 사람이 없는 행도)', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const fresh = await s.row('새것')
  const old = await s.row('옛것')
  const byMate = await s.row('동료가 만듦', s.mate)
  const anon = await s.row('익명')
  await query(`UPDATE block SET created_at = now() - interval '30 days' WHERE id = $1`, [old])
  await query(`UPDATE block SET created_by = NULL WHERE id = $1`, [anon])
  await query(`UPDATE block SET last_edited_by = $2 WHERE id = $1`, [byMate, s.mate.ctx.userId])
  void fresh

  const leaf = (property_id: string, operator: string, value?: unknown): FilterNode => ({ property_id, operator, ...(value === undefined ? {} : { value }) }) as FilterNode
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.createdTime, 'past_week') })), new Set(['새것', '동료가 만듦', '익명']), '지난 1주 안')
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.createdTime, 'before', '2026-01-01') })), new Set(), '이전(아직 그 날이 오기 전)')
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.createdTime, 'is_not_empty') })).size, 4, '시각은 늘 있다')

  const me = { $context: 'me' }
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.editedBy, 'contains', me) })), new Set(['새것', '옛것', '익명']), '마지막 편집 사람 = 나')
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.editedBy, 'does_not_contain', me) })), new Set(['동료가 만듦']))
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.editedBy, 'contains', s.mate.ctx.userId) })), new Set(['동료가 만듦']), '사람 id 로도')
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.createdBy, 'is_empty') })), new Set(['익명']), '만든 사람이 없는 행')
  assert.deepEqual(new Set(await s.listed({ filter: leaf(s.prop.createdBy, 'does_not_contain', me) })), new Set(['동료가 만듦', '익명']), '익명 행도 포함하지 않는다')
})

test('③ ★ 정렬 — 마지막 편집 시각 · 한 건씩 커서로 넘겨도 순서가 같다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await s.row('ㄱ')
  const b = await s.row('ㄴ')
  const c = await s.row('ㄷ')
  // 마이크로초 차이까지 — 커서가 ms 로 잘리면 같은 값으로 읽혀 행을 건너뛰거나 겹친다
  await query(`UPDATE block SET last_edited_at = timestamptz '2026-03-01 00:00:00.000300+00' WHERE id = $1`, [a])
  await query(`UPDATE block SET last_edited_at = timestamptz '2026-03-01 00:00:00.000100+00' WHERE id = $1`, [b])
  await query(`UPDATE block SET last_edited_at = timestamptz '2026-03-01 00:00:00.000200+00' WHERE id = $1`, [c])
  const asc: SortKey[] = [{ property_id: s.prop.editedTime, direction: 'asc' }]
  const desc: SortKey[] = [{ property_id: s.prop.editedTime, direction: 'desc' }]
  assert.deepEqual(await s.listed({ sorts: asc }), ['ㄴ', 'ㄷ', 'ㄱ'])
  assert.deepEqual(await s.listed({ sorts: desc }), ['ㄱ', 'ㄷ', 'ㄴ'])

  const paged: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 5; i += 1) {
    const page = unwrap(await queryRows(s.boss.ctx, s.ds, { sorts: asc, limit: 1, cursor }))
    paged.push(...page.rows.map((r) => s.names.get(r.id)!))
    cursor = page.nextCursor
    if (!page.hasMore) break
  }
  assert.deepEqual(paged, ['ㄴ', 'ㄷ', 'ㄱ'], '커서로 넘긴 순서')
})

test('④ ★ 열 집계 — 가장 이른 · 늦은 시각 · 만든 사람 값 세기', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const a = await s.row('ㄱ')
  const b = await s.row('ㄴ')
  await s.row('ㄷ')
  await query(`UPDATE block SET created_at = timestamptz '2026-01-02 03:04:05+00' WHERE id = $1`, [a])
  await query(`UPDATE block SET created_at = timestamptz '2026-02-03 04:05:06+00' WHERE id = $1`, [b])
  await query(`UPDATE block SET created_by = NULL WHERE id = $1`, [b])
  const calc = async (propertyId: string, type: string, calculation: string) =>
    (await computeCalculations(s.boss.ctx, s.ds, null, [{ propertyId, type, calculation: calculation as never }]))[propertyId]
  assert.deepEqual(await calc(s.prop.createdTime, 'created_time', 'earliest_date'), { kind: 'date', value: '2026-01-02T03:04:05.000Z' })
  assert.deepEqual(await calc(s.prop.createdBy, 'created_by', 'count_values'), { kind: 'count', value: 2 }, '만든 사람이 있는 행')
  assert.deepEqual(await calc(s.prop.createdBy, 'created_by', 'count_empty'), { kind: 'count', value: 1 }, '익명 행')
})

test('⑤ ★ 공개 표 — 만든 시각은 그리고 만든 사람은 그리지 않는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const token = unwrap(await publishPage(s.boss.ctx, s.db.id)).token!
  const table = await withReadTransaction(async (tx) => {
    const access = await resolvePublicPageIn(tx, token)
    if (!access.ok) throw new Error(access.reason)
    return readPublicTableIn(tx, access.value)
  })
  assert.ok(table !== null)
  const types = table.columns.map((c) => c.type)
  assert.ok(types.includes('created_time') && types.includes('last_edited_time'), `시각 열: ${types.join(',')}`)
  assert.ok(!types.includes('created_by' as never) && !types.includes('last_edited_by' as never), '사람 열은 그리지 않는다')
  const created = table.columns.find((c) => c.type === 'created_time')!
  const stored = (await query<{ created_at: Date }>(`SELECT created_at FROM block WHERE id = $1`, [id]))[0]!.created_at
  assert.deepEqual(table.rows[0]!.cells[created.id], { type: 'created_time', created_time: stored.toISOString() })
  assert.ok(!JSON.stringify(table.rows).includes(s.boss.ctx.userId), '사람 id 가 공개 행에 실리지 않는다')
})

test('⑥ ★ 내보내기 · 이름표 — 시각 글 · 이름 · 게스트에게는 "멤버" · 없는 사람은 "알 수 없는 사람"', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const stored = (await query<{ created_at: Date }>(`SELECT created_at FROM block WHERE id = $1`, [id]))[0]!.created_at
  const snapshot = await readExportSnapshot(s.boss.ctx, { kind: 'workspace' })
  assert.ok(snapshot.ok, JSON.stringify(snapshot))
  const source = (snapshot.value.nodes.get(s.db.id) as ExportDatabaseNode).sources[0]!
  const text = (propertyId: string) => {
    const column = source.columns.find((c) => c.propertyId === propertyId)!
    const row = snapshot.value.nodes.get(id) as ExportPageNode
    return cellPlainText(column, row.cells?.[propertyId])
  }
  assert.equal(text(s.prop.createdTime), stored.toISOString())
  assert.equal(text(s.prop.createdBy), '대표')
  assert.equal(text(s.prop.editedBy), '대표')

  const ghost = crypto.randomUUID()
  assert.deepEqual(await loadAutoMetaLabels(s.boss.ctx, [s.mate.ctx.userId, ghost]), { [s.mate.ctx.userId]: '동료', [ghost]: '알 수 없는 사람' })
  assert.deepEqual(await loadAutoMetaLabels(s.guest.ctx, [s.mate.ctx.userId]), { [s.mate.ctx.userId]: '멤버' }, '게스트에게는 이름이 아니라 멤버')
})
