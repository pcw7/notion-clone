/**
 * 장소 속성 — 쓰기 · 칸 가드 · 필터 · 정렬 · 비우기 · 바꾸기 (DB) — MP-1조각 (F-03-04)
 *
 * 이 파일이 지키는 것(정본 §3.5 [보강 MP-1] ① ④ ⑤).
 *
 *   ① ★ 쓰기 · 읽기 — 값이 그대로 돌아온다 · 앱이 모양이 틀린 값을 거부한다
 *   ② ★ 칸 가드(0141) — 앱을 거치지 않은 쓰기도 이름 · 주소 · 좌표 범위 · 키 · 수 타입을 DB 가 거부한다
 *   ③ ★ 필터 — 여덟 연산자 · 포함은 주소도 본다
 *   ④ ★ 정렬 — 이름 순 · 빈 칸은 맨 뒤
 *   ⑤ ★ 비우기 — 지우기(빈 값)를 쓰면 칸이 지워진다
 *   ⑥ ★ 바꾸기 — 장소 → 글은 이름 · 글 → 장소는 칸을 비운다
 *   ⑦ ★ 찾기 — 좌표는 외부에 묻지 않는다 · 끄면 404 에 해당 · 속도 제한 · 외부 실패
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { query } from '../db/pool.ts'
import { createBareWorkspace, createUser, joinAs, probeDatabase } from '../testing/db-fixtures.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import { convertProperty } from './property-convert.ts'
import { queryRows } from './query.ts'
import { clearCell, createRow, updateCells } from './row.ts'
import { searchPlaces } from './place-search.ts'
import type { FilterNode, SortKey } from './filter.ts'
import type { CellValue, PlaceRef } from './property-types.ts'

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
  // 속도 제한(`consume`)이 연 Valkey 연결을 닫는다 — 두면 이 파일의 프로세스가 끝나지 않는다
  const { closeValkey } = await import('../valkey.ts')
  await closeValkey().catch(() => {})
  if (!skipReason) {
    const { closePool } = await import('../db/pool.ts')
    await closePool()
  }
})

function unwrap<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`)
  return r.value
}

const place = (name: string, address = '', lat = 37.5665, lng = 126.978): CellValue => ({ type: 'place', place: { name, address, lat, lng } })

async function setup() {
  const ws = await createBareWorkspace('장소')
  const boss = await joinAs(ws, await createUser('대표'), 'owner')
  const db = unwrap(await createDatabase(boss.ctx, { name: `장소 ${Date.now()}` }))
  const ds = db.dataSourceId
  unwrap(await addProperty(boss.ctx, ds, { name: '위치', type: 'place' }))
  unwrap(await addProperty(boss.ctx, ds, { name: '메모', type: 'rich_text' }))
  const props = unwrap(await getSchema(boss.ctx, ds)).properties
  const id = (name: string) => props.find((p) => p.name === name)!.id
  const loc = id('위치')
  const ids = new Map<string, string>()
  const row = async (name: string, value?: CellValue) => {
    const created = unwrap(await createRow(boss.ctx, ds, { cells: value === undefined ? [] : [{ propertyId: loc, value }] }))
    ids.set(created.id, name)
    return created.id
  }
  const names = async (opts: { filter?: FilterNode; sorts?: SortKey[] }) =>
    unwrap(await queryRows(boss.ctx, ds, { ...opts, limit: 50 })).rows.map((r) => ids.get(r.id)!)
  return { ws, boss, ds, loc, memo: id('메모'), row, names }
}

test('① ★ 쓰기 · 읽기 — 값이 그대로 돌아온다 · 모양이 틀린 값은 앱이 거부한다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', place('서울시청', '서울 중구 세종대로 110', 37.5665, 126.978))
  const read = async () => unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[s.loc]
  assert.deepEqual(await read(), place('서울시청', '서울 중구 세종대로 110', 37.5665, 126.978))

  const put = (value: unknown) => updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.loc, value: value as CellValue }] })
  assert.equal((await put(place('', '주소'))).ok, false, '이름이 비었다')
  assert.equal((await put(place('x', '', 91, 0))).ok, false, 'lat 91')
  assert.equal((await put(place('x', '', 0, -181))).ok, false, 'lng -181')
  assert.equal((await put(place('n'.repeat(256)))).ok, false, '이름 256자')
  assert.equal((await put(place('x', 'a'.repeat(501)))).ok, false, '주소 501자')
  assert.equal((await put({ type: 'place', place: { name: 'x', address: '', lat: '1', lng: 2 } })).ok, false, '좌표가 수가 아니다')
  assert.equal((await put({ type: 'place', place: { name: 'x', address: '', lat: 1, lng: 2, extra: 1 } })).ok, false, '모르는 키')
  assert.equal((await put({ type: 'rich_text', place: { name: 'x', address: '', lat: 1, lng: 2 } })).ok, false, '봉투 타입이 다르다')
  assert.deepEqual(await read(), place('서울시청', '서울 중구 세종대로 110', 37.5665, 126.978), '거부된 쓰기는 값을 바꾸지 않는다')
  unwrap(await put(place('n'.repeat(255), 'a'.repeat(500), -90, 180)))
})

test('② ★ 칸 가드 — 앱을 거치지 않은 쓰기도 DB 가 거부한다 · 정상 값은 받는다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ')
  const put = (property: string, value: unknown) =>
    query(
      `INSERT INTO page_property_value (page_id, property_id, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (page_id, property_id) DO UPDATE SET value = EXCLUDED.value`,
      [id, property, JSON.stringify(value)],
    )
  const p = (over: Record<string, unknown>) => ({ type: 'place', place: { name: '서울시청', address: '', lat: 37.5, lng: 127, ...over } })
  const { name: _name, ...noName } = (p({}) as { place: Record<string, unknown> }).place
  const bad: [string, string, unknown][] = [
    ['이름 없음', s.loc, { type: 'place', place: noName }],
    ['이름 빈 글', s.loc, p({ name: '' })],
    ['주소 501자', s.loc, p({ address: 'a'.repeat(501) })],
    ['lat 91', s.loc, p({ lat: 91 })],
    ['lng 180.5', s.loc, p({ lng: 180.5 })],
    ['lat 글', s.loc, p({ lat: '37.5' })],
    ['모르는 키', s.loc, p({ extra: 1 })],
    ['봉투에 모르는 키', s.loc, { ...p({}), extra: 1 }],
    ['다른 타입의 칸에 장소 값', s.memo, p({})],
  ]
  for (const [label, property, value] of bad) {
    await assert.rejects(put(property, value), (e: { constraint?: string }) => e.constraint === 'tg_ppv_place_shape', label)
  }
  await put(s.loc, p({ address: '', lat: -90, lng: 180 }))
})

test('③ ★ 필터 — 여덟 연산자 · 포함은 주소도 본다(칸이 없는 행은 포함하지 않는다)', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('가', place('서울시청', '서울특별시 중구 세종대로 110'))
  await s.row('나', place('Busan Station', '부산 동구 중앙대로 206'))
  await s.row('다', place('카페', ''))
  await s.row('빈')
  const names = async (operator: string, value?: string) =>
    new Set(await s.names({ filter: { property_id: s.loc, operator, ...(value === undefined ? {} : { value }) } }))
  assert.deepEqual(await names('equals', '서울시청'), new Set(['가']))
  assert.deepEqual(await names('equals', 'busan station'), new Set(['나']), '대소문자를 가리지 않는다')
  assert.deepEqual(await names('does_not_equal', '서울시청'), new Set(['나', '다', '빈']))
  assert.deepEqual(await names('contains', '시청'), new Set(['가']))
  assert.deepEqual(await names('contains', '세종대로'), new Set(['가']), '주소에서 맞는다')
  assert.deepEqual(await names('contains', '중앙대로'), new Set(['나']), '주소에서 맞는다')
  assert.deepEqual(await names('does_not_contain', '세종대로'), new Set(['나', '다', '빈']), '이름도 주소도 아닌 행')
  assert.deepEqual(await names('starts_with', '서울'), new Set(['가']), '시작은 이름만 본다')
  assert.deepEqual(await names('starts_with', '세종'), new Set(), '시작은 주소를 보지 않는다')
  assert.deepEqual(await names('ends_with', 'station'), new Set(['나']))
  assert.deepEqual(await names('contains', '%'), new Set(), '와일드카드는 글자다')
  assert.deepEqual(await names('is_empty'), new Set(['빈']))
  assert.deepEqual(await names('is_not_empty'), new Set(['가', '나', '다']))
})

test('④ ★ 정렬 — 이름 순(ko-KR) · 빈 칸은 오름 · 내림 모두 맨 뒤', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  await s.row('ㄴ', place('나무'))
  await s.row('빈')
  await s.row('ㄱ', place('가게'))
  await s.row('ㄷ', place('다리'))
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.loc, direction: 'asc' }] }), ['ㄱ', 'ㄴ', 'ㄷ', '빈'])
  assert.deepEqual(await s.names({ sorts: [{ property_id: s.loc, direction: 'desc' }] }), ['ㄷ', 'ㄴ', 'ㄱ', '빈'])
})

test('⑤ ★ 비우기 — 지우기 값을 쓰면 칸이 지워진다 · clearCell 도 같다', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', place('서울시청'))
  const count = async () =>
    (await query<{ n: string }>(`SELECT count(*) AS n FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [id, s.loc]))[0]!.n
  assert.equal(await count(), '1')
  unwrap(await updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.loc, value: { type: 'place', place: { name: '', address: '', lat: 0, lng: 0 } } }] }))
  assert.equal(await count(), '0', '빈 값 → 칸 없음')
  unwrap(await updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.loc, value: place('부산') }] }))
  assert.equal(await count(), '1')
  unwrap(await clearCell(s.boss.ctx, id, s.loc))
  assert.equal(await count(), '0', 'clearCell → 칸 없음')
  assert.deepEqual(new Set(await s.names({ filter: { property_id: s.loc, operator: 'is_empty' } })), new Set(['ㄱ']))
})

test('⑥ ★ 바꾸기 — 장소 → 글은 이름 · 글 → 장소는 칸을 비운다(확인을 받아야 한다)', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  const id = await s.row('ㄱ', place('서울시청', '서울 중구'))
  const read = async (property: string) => unwrap(await queryRows(s.boss.ctx, s.ds, {})).rows.find((r) => r.id === id)!.properties[property] as CellValue

  // 장소 → 글 — 이름
  unwrap(await convertProperty(s.boss.ctx, s.ds, s.loc, { type: 'rich_text' }))
  const asText = await read(s.loc)
  assert.equal(asText.type, 'rich_text')
  assert.equal(JSON.stringify(asText).includes('서울시청'), true)
  assert.equal(JSON.stringify(asText).includes('서울 중구'), false, '주소는 따라가지 않는다')

  // 글 → 장소 — 값이 있던 칸은 손실이라 확인을 받는다 · 받으면 칸이 비다
  const refused = await convertProperty(s.boss.ctx, s.ds, s.loc, { type: 'place' })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.equal(refused.reason, 'lossy_conversion')
  unwrap(await convertProperty(s.boss.ctx, s.ds, s.loc, { type: 'place', confirmLoss: true }))
  const left = (await query<{ n: string }>(`SELECT count(*) AS n FROM page_property_value WHERE page_id = $1 AND property_id = $2`, [id, s.loc]))[0]!.n
  assert.equal(left, '0', '칸이 비었다')
  // 장소 칸이 된 뒤에는 장소 값을 받는다
  unwrap(await updateCells(s.boss.ctx, id, { cells: [{ propertyId: s.loc, value: place('부산') }] }))
  // 장소 → 숫자 같은 다른 길은 열지 않는다
  const blocked = await convertProperty(s.boss.ctx, s.ds, s.loc, { type: 'number' })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.reason, 'unsupported_type')
})

test('⑦ ★ 찾기 — 좌표는 외부에 묻지 않는다 · 끄면 막는다 · 외부 실패 · 속도 제한', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const s = await setup()
  let calls = 0
  const urls: string[] = []
  const nominatim = [
    { lat: '37.5666', lon: '126.9784', name: '서울특별시청', display_name: '서울특별시청, 세종대로, 중구, 서울, 대한민국' },
    { lat: '999', lon: '1', name: '틀린 줄', display_name: '버려진다' },
    { lat: 'x', lon: '1', name: '틀린 줄', display_name: '버려진다' },
  ]
  const fetcher = async (url: string) => {
    calls += 1
    urls.push(url)
    return { ok: true as const, status: 200, body: nominatim }
  }
  const rate = { limit: 1000, windowSeconds: 1 }

  const typed = await searchPlaces(s.boss.ctx, ' 37.5665, 126.978 ', { searchUrl: 'https://geo.example.com', fetcher, rate })
  assert.equal(typed.ok && typed.source, 'coordinates')
  assert.equal(calls, 0, '좌표는 묻지 않는다')

  const found = await searchPlaces(s.boss.ctx, '서울시청', { searchUrl: 'https://geo.example.com/', fetcher, rate })
  assert.equal(found.ok && found.places.length, 1, '틀린 줄은 버린다')
  assert.equal(calls, 1)
  const asked = new URL(urls[0]!)
  assert.equal(asked.origin + asked.pathname, 'https://geo.example.com/search')
  assert.equal(asked.searchParams.get('format'), 'jsonv2')
  assert.equal(asked.searchParams.get('limit'), '5')
  assert.equal(asked.searchParams.get('q'), '서울시청')
  assert.equal(asked.searchParams.get('accept-language'), 'ko')

  const off = await searchPlaces(s.boss.ctx, '서울시청', { searchUrl: 'off', fetcher, rate })
  assert.deepEqual(off, { ok: false, reason: 'disabled' })
  const offTyped = await searchPlaces(s.boss.ctx, '1, 2', { searchUrl: 'off', fetcher, rate })
  assert.equal(offTyped.ok, true, '끄면 찾기만 막힌다 — 좌표는 된다')
  assert.deepEqual(await searchPlaces(s.boss.ctx, '   ', { searchUrl: 'https://geo.example.com', fetcher, rate }), { ok: false, reason: 'invalid_query' })

  const broken = await searchPlaces(s.boss.ctx, '서울', {
    searchUrl: 'https://geo.example.com',
    fetcher: async () => ({ ok: false as const, reason: 'timeout' as const, status: null, detail: '5000ms' }),
    rate,
  })
  assert.deepEqual(broken, { ok: false, reason: 'failed' })

  // 사람마다 초당 1번 — 같은 초에 두 번째는 거부
  const tight = { limit: 1, windowSeconds: 60 }
  const user = await joinAs(s.ws, await createUser('둘째'), 'member')
  const first = await searchPlaces(user.ctx, '부산', { searchUrl: 'https://geo.example.com', fetcher, rate: tight })
  const second = await searchPlaces(user.ctx, '부산역', { searchUrl: 'https://geo.example.com', fetcher, rate: tight })
  assert.equal(first.ok, true)
  assert.deepEqual(second, { ok: false, reason: 'rate_limited' })

  const places: PlaceRef[] = found.ok ? [...found.places] : []
  assert.deepEqual(places[0], { name: '서울특별시청', address: '서울특별시청, 세종대로, 중구, 서울, 대한민국', lat: 37.5666, lng: 126.9784 })
})
