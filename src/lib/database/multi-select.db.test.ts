/**
 * 다중 선택 속성 — 쓰기 · 칸 가드 · 필터 · 정렬 · 옵션 지우기 · 집계 (DB) — PT-1조각 (F-03-03 · F-03-04 · F-03-08)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 PT-1] ① ③ ④).
 *
 *   ① ★ 쓰기 · 읽기 — 고른 차례가 그대로 남는다 · 앱이 그 속성의 옵션이 아닌 id · 같은 옵션 두 번을 거부한다
 *   ② ★ 칸 가드(0136) — 앱을 거치지 않은 쓰기도 모양이 틀린 값 · 남의 옵션 · 중복을 DB 가 거부한다
 *   ③ ★ 필터 — 포함 · 포함하지 않음(칸이 없는 행도) · 비어 있음 · 비어 있지 않음
 *   ④ ★ 정렬 — 칸의 옵션 가운데 순서가 가장 앞인 것으로 · 빈 칸은 오름 · 내림 모두 맨 뒤
 *   ⑤ ★ 옵션 지우기 — 그 id 만 칸에서 빠진다(칸은 남는다) · 쓰던 행 수가 센다 · 사이드카가 따라온다
 *   ⑥ ★ 열 집계 — 값 세기는 칩 수의 합
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, addSelectOption, countOptionUsage, deleteSelectOption, getSchema, updateSelectOption } from './property.ts'
import { computeCalculations } from './calculate.ts'
import { queryRows } from './query.ts'
import { createRow, updateCells } from './row.ts'
import type { FilterNode, SortKey } from './filter.ts'
import type { CellValue } from './property-types.ts'

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

const multi = (...ids: string[]): CellValue => ({ type: 'multi_select', multi_select: ids.map((id) => ({ id })) })

/** 표 하나 — 태그(다중 선택 · 옵션 가 나 다 순서로) · 다른(다중 선택 — 남의 옵션 하나). 행은 이름으로 부른다. */
async function setup() {
  const ws = await createBareWorkspace('다중 선택')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `다중 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '태그', type: 'multi_select' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '다른', type: 'multi_select' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const tag = props.find((p) => p.name === '태그')!.id
  const other = props.find((p) => p.name === '다른')!.id
  const option = async (property: string, name: string) => unwrap(await addSelectOption(boss.ctx, ds, property, { name })).option.id
  const [ga, na, da] = [await option(tag, '가'), await option(tag, '나'), await option(tag, '다')]
  const stranger = await option(other, '남')
  const ids = new Map<string, string>()
  const row = async (name: string, ...picked: string[]) => {
    const created = unwrap(await createRow(boss.ctx, ds, { cells: picked.length === 0 ? [] : [{ propertyId: tag, value: multi(...picked) }] }))
    ids.set(created.id, name)
    return created.id
  }
  const names = async (opts: { filter?: FilterNode; sorts?: SortKey[] }) =>
    unwrap(await queryRows(boss.ctx, ds, { ...opts, limit: 50 })).rows.map((r) => ids.get(r.id)!)
  return { boss, ds, tag, other, ga, na, da, stranger, row, names, ids }
}

test('① ★ 쓰기 · 읽기 — 고른 차례가 남는다 · 남의 옵션 · 같은 옵션 두 번은 앱이 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', s.da, s.ga)
  const read = async () => unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[s.tag]
  assert.deepEqual(await read(), multi(s.da, s.ga), '고른 차례(다, 가)')

  const put = (value: CellValue, property = s.tag) => updateCells(s.boss.ctx, id, { cells: [{ propertyId: property, value }] })
  unwrap(await put(multi(s.na)))
  assert.deepEqual(await read(), multi(s.na))
  assert.equal((await put(multi(s.ga, s.stranger))).ok, false, '다른 속성의 옵션')
  assert.equal((await put(multi(s.ga, s.ga))).ok, false, '같은 옵션 두 번')
  assert.equal((await put({ type: 'select', select: { id: s.ga } })).ok, false, '봉투 타입이 다르다')
  assert.deepEqual(await read(), multi(s.na), '거부된 쓰기는 값을 바꾸지 않는다')
  unwrap(await put(multi()))
  assert.deepEqual(await read(), multi(), '비우기')
})

test('② ★ 칸 가드 — 앱을 거치지 않은 쓰기도 DB 가 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const put = (value: unknown) =>
    query(
      `INSERT INTO page_property_value (page_id, property_id, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value`,
      [id, s.tag, JSON.stringify(value)],
    )
  const bad: [string, unknown][] = [
    ['배열이 아님', { type: 'multi_select', multi_select: { id: s.ga } }],
    ['이름 글자', { type: 'multi_select', multi_select: ['가'] }],
    ['같은 옵션 두 번', multi(s.ga, s.ga)],
    ['남의 옵션', multi(s.ga, s.stranger)],
    ['없는 옵션', multi('99999999-9999-4999-8999-999999999999')],
  ]
  for (const [label, value] of bad) {
    await assert.rejects(put(value), (e: { constraint?: string }) => e.constraint === 'tg_ppv_multi_select_shape', label)
  }
  await put(multi(s.na, s.ga))
})

test('③ ★ 필터 — 포함 · 포함하지 않음(칸이 없는 행도) · 비어 있음 · 비어 있지 않음', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('가나', s.ga, s.na)
  await s.row('나', s.na)
  await s.row('다', s.da)
  await s.row('빈')
  const names = async (operator: string, value?: string) =>
    new Set(await s.names({ filter: { property_id: s.tag, operator, ...(value === undefined ? {} : { value }) } }))
  assert.deepEqual(await names('contains', s.na), new Set(['가나', '나']))
  assert.deepEqual(await names('contains', s.da), new Set(['다']))
  assert.deepEqual(await names('does_not_contain', s.na), new Set(['다', '빈']), '칸이 없는 행도 포함하지 않는다')
  assert.deepEqual(await names('is_empty'), new Set(['빈']))
  assert.deepEqual(await names('is_not_empty'), new Set(['가나', '나', '다']))
})

test('④ ★ 정렬 — 옵션 순서가 가장 앞인 값으로 · 빈 칸은 오름 · 내림 모두 맨 뒤', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('ㄱ다만', s.da)
  await s.row('ㄴ나다', s.da, s.na) // 고른 차례는 다 나 — 그래도 가장 앞선 옵션은 나
  await s.row('ㄷ빈')
  await s.row('ㄹ가', s.ga)
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.tag, direction: 'asc' }] }), ['ㄹ가', 'ㄴ나다', 'ㄱ다만', 'ㄷ빈'])
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.tag, direction: 'desc' }] }), ['ㄱ다만', 'ㄴ나다', 'ㄹ가', 'ㄷ빈'])
})

test('⑤ ★ 옵션 지우기 — 그 id 만 칸에서 빠진다 · 쓰던 행 수 · 사이드카 · 이름 바꾸기는 따라온다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const both = await s.row('가나', s.ga, s.na)
  const only = await s.row('나', s.na)
  const none = await s.row('다', s.da)
  assert.equal(unwrap(await countOptionUsage(s.boss.ctx, s.ds, s.tag, s.na)).rows, 2)

  assert.equal(unwrap(await updateSelectOption(s.boss.ctx, s.ds, s.tag, s.na, { name: '둘째' })).option.name, '둘째')
  const removed = unwrap(await deleteSelectOption(s.boss.ctx, s.ds, s.tag, s.na))
  assert.equal(removed.clearedCells, 2)

  const rows = unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows
  const cell = (rowId: string) => rows.find((r) => r.id === rowId)!.properties[s.tag]
  assert.deepEqual(cell(both), multi(s.ga), '남은 옵션은 그대로 · 칸은 남는다')
  assert.deepEqual(cell(only), multi(), '하나뿐이던 칸은 빈 배열')
  assert.deepEqual(cell(none), multi(s.da), '쓰지 않던 행은 그대로')
  const side = await query<{ page_id: string; text_value: string | null }>(
    `SELECT page_id, text_value FROM page_property_value WHERE property_id = $1`,
    [s.tag],
  )
  const text = (rowId: string) => side.find((r) => r.page_id === rowId)?.text_value ?? null
  assert.equal(text(both), s.ga)
  assert.equal(text(only), null, '빈 칸의 사이드카는 NULL — 비어 있음 필터가 따라온다')
  assert.deepEqual(
    new Set(await s.names({ filter: { property_id: s.tag, operator: 'is_empty' } })),
    new Set(['나']),
  )
})

test('⑥ ★ 열 집계 — 값 세기는 칩 수의 합 · 빈 칸 세기는 칸 수', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('셋', s.ga, s.na, s.da)
  await s.row('하나', s.ga)
  await s.row('빈')
  const calc = (calculation: 'count_values' | 'count_empty' | 'count_all') =>
    computeCalculations(s.boss.ctx, s.ds, null, [{ propertyId: s.tag, type: 'multi_select', calculation }]).then((r) => r[s.tag])
  assert.deepEqual(await calc('count_values'), { kind: 'count', value: 4 })
  assert.deepEqual(await calc('count_empty'), { kind: 'count', value: 1 })
  assert.deepEqual(await calc('count_all'), { kind: 'count', value: 3 })
})
