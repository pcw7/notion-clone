/**
 * URL · 이메일 · 전화 속성 — 쓰기 · 칸 가드 · 필터 · 정렬 · 비우기 (DB) — PT-2조각 (F-03-04)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 PT-1] ⑥).
 *
 *   ① ★ 쓰기 · 읽기 — javascript: 글도 저장된다 · 앱이 글이 아닌 값 · 길이를 넘는 글을 거부한다
 *   ② ★ 칸 가드(0137) — 앱을 거치지 않은 쓰기도 글이 아닌 값 · 빈 글 · 상한 넘는 글을 DB 가 거부한다
 *   ③ ★ 필터 — 포함 · 같음 · 비어 있음(칸이 없는 행도)
 *   ④ ★ 정렬 — 글 순서 · 빈 칸은 맨 뒤
 *   ⑤ ★ 비우기 — 빈 글을 쓰면 칸이 지워진다(0137 이 빈 글을 막는다)
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { queryRows } from './query.ts'
import { clearCell, createRow, updateCells } from './row.ts'
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

const url = (text: string): CellValue => ({ type: 'url', url: text })

async function setup() {
  const ws = await createBareWorkspace('연락')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `연락 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '주소', type: 'url' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '메일', type: 'email' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '전화', type: 'phone_number' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const id = (name: string) => props.find((p) => p.name === name)!.id
  const link = id('주소')
  const mail = id('메일')
  const tel = id('전화')
  const ids = new Map<string, string>()
  const row = async (name: string, text?: string) => {
    const created = unwrap(await createRow(boss.ctx, ds, { cells: text === undefined ? [] : [{ propertyId: link, value: url(text) }] }))
    ids.set(created.id, name)
    return created.id
  }
  const names = async (opts: { filter?: FilterNode; sorts?: SortKey[] }) =>
    unwrap(await queryRows(boss.ctx, ds, { ...opts, limit: 50 })).rows.map((r) => ids.get(r.id)!)
  return { boss, ds, link, mail, tel, row, names }
}

test('① ★ 쓰기 · 읽기 — 글이면 저장된다(javascript: 도) · 글이 아닌 값 · 상한 넘는 글은 앱이 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', 'javascript:alert(1)')
  const read = async (property: string) => unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[property]
  assert.deepEqual(await read(s.link), url('javascript:alert(1)'))

  const put = (property: string, value: unknown) => updateCells(s.boss.ctx, id, { cells: [{ propertyId: property, value: value as CellValue }] })
  unwrap(await put(s.mail, { type: 'email', email: '아무 글' }))
  unwrap(await put(s.tel, { type: 'phone_number', phone_number: '+82 10-1234-5678' }))
  assert.deepEqual(await read(s.tel), { type: 'phone_number', phone_number: '+82 10-1234-5678' })
  assert.equal((await put(s.link, { type: 'url', url: 5 })).ok, false, '글이 아니다')
  assert.equal((await put(s.link, url('h'.repeat(2049)))).ok, false, '2049자')
  assert.equal((await put(s.tel, { type: 'phone_number', phone_number: '1'.repeat(65) })).ok, false, '65자')
  assert.equal((await put(s.link, { type: 'email', email: 'a@b.co' })).ok, false, '봉투 타입이 다르다')
  assert.deepEqual(await read(s.link), url('javascript:alert(1)'), '거부된 쓰기는 값을 바꾸지 않는다')
})

test('② ★ 칸 가드 — 앱을 거치지 않은 쓰기도 DB 가 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const put = (property: string, value: unknown) =>
    query(
      `INSERT INTO page_property_value (page_id, property_id, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value`,
      [id, property, JSON.stringify(value)],
    )
  const bad: [string, string, unknown][] = [
    ['숫자', s.link, { type: 'url', url: 5 }],
    ['배열', s.mail, { type: 'email', email: ['a@b.co'] }],
    ['빈 글', s.link, url('')],
    ['모르는 키', s.tel, { type: 'phone_number', phone_number: '1', extra: 1 }],
    ['봉투 타입이 다르다', s.link, { type: 'email', email: 'a@b.co' }],
    ['URL 2049자', s.link, url('h'.repeat(2049))],
    ['이메일 255자', s.mail, { type: 'email', email: 'e'.repeat(255) }],
    ['전화 65자', s.tel, { type: 'phone_number', phone_number: '1'.repeat(65) }],
  ]
  for (const [label, property, value] of bad) {
    await assert.rejects(put(property, value), (e: { constraint?: string }) => e.constraint === 'tg_ppv_contact_shape', label)
  }
  await put(s.link, url('h'.repeat(2048)))
})

test('③ ★ 필터 — 포함 · 같음 · 비어 있음(칸이 없는 행도) · 비어 있지 않음', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('가', 'https://example.com/a')
  await s.row('나', 'https://Example.org/b')
  await s.row('다', 'javascript:alert(1)')
  await s.row('빈')
  const names = async (operator: string, value?: string) =>
    new Set(await s.names({ filter: { property_id: s.link, operator, ...(value === undefined ? {} : { value }) } }))
  assert.deepEqual(await names('contains', 'example'), new Set(['가', '나']), '대소문자를 가리지 않는다')
  assert.deepEqual(await names('equals', 'https://example.com/a'), new Set(['가']))
  assert.deepEqual(await names('starts_with', 'javascript:'), new Set(['다']))
  assert.deepEqual(await names('does_not_contain', 'example'), new Set(['다', '빈']), '칸이 없는 행도 포함하지 않는다')
  assert.deepEqual(await names('is_empty'), new Set(['빈']))
  assert.deepEqual(await names('is_not_empty'), new Set(['가', '나', '다']))
})

test('④ ★ 정렬 — 글 순서 · 빈 칸은 오름 · 내림 모두 맨 뒤', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('ㄱ', 'https://b.co')
  await s.row('ㄴ')
  await s.row('ㄷ', 'https://a.co')
  await s.row('ㄹ', 'https://c.co')
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.link, direction: 'asc' }] }), ['ㄷ', 'ㄱ', 'ㄹ', 'ㄴ'])
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.link, direction: 'desc' }] }), ['ㄹ', 'ㄱ', 'ㄷ', 'ㄴ'])
})

test('⑤ ★ 비우기 — 빈 글을 쓰면 칸이 지워진다 · clearCell 도 같다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', 'https://a.co')
  const count = async () =>
    (await query<{ n: string }>(`SELECT count(*) AS n FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [id, s.link]))[0]!.n
  assert.equal(await count(), '1')
  unwrap(await updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.link, value: url('') }] }))
  assert.equal(await count(), '0', '빈 글 → 칸 없음')
  unwrap(await updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.link, value: url('https://b.co') }] }))
  assert.equal(await count(), '1')
  unwrap(await clearCell(s.boss.ctx, id, s.link))
  assert.equal(await count(), '0', 'clearCell → 칸 없음')
  assert.deepEqual(new Set(await s.names({ filter: { property_id: s.link, operator: 'is_empty' } })), new Set(['ㄱ']))
})
