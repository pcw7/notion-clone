/**
 * 날짜로 묶기 — 서버 (그룹 버킷 트랙 B-1 · F-04-11, DB 필요)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] `view.group_by` 의 [보강 B-1]
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 그룹 목록은 데이터에서 — 행이 든 버킷들(날짜 오름차순) · 값 없음이 맨 앞 · 기본 단위는 월 · 결과가 단위를 싣는다
 *   ② ★ 단위(주 · 년) — 주는 월요일에 시작 · 적힌 달력 날짜로 센다(시간대로 옮기지 않는다)
 *   ③ ★ 옮기면 단위만큼 민다 — 시각 · 끝 날짜를 지킨다 · 값이 없던 행은 버킷의 첫 날 · 값 없음 그룹은 비운다 · 빈 달에도 놓는다 ·
 *        버킷 키가 아니면 거부
 *   ④ 단위는 날짜 속성에만 · 일 · 주 · 월 · 년만
 *   ⑤ ★ 상대 날짜(B-3) — 보는 사람의 오늘에서 며칠 · 날짜 순 · 결과가 오늘을 싣는다 · 어제 · 오늘 · 내일로 옮기면 그 날(시각을 지킨다) ·
 *        범위 덩이로는 못 옮긴다 · 오늘이 바뀌면 같은 행의 덩이가 바뀐다
 *   ⑥ 주의 시작 요일(B-3b) — 일요일 시작이면 그 주의 일요일이 키 · 그 키로만 놓는다 · 날짜가 아닌 속성이면 거부
 *
 * ⚠ skip 은 테스트마다 `t.skip` 으로 건다(HANDOFF §5).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { probeDatabase, makeFixture, type Fixture } from '../testing/db-fixtures.ts'
import { textRun } from '../contracts/rich-text.ts'
import { createDatabase } from './database.ts'
import { addProperty, getSchema } from './property.ts'
import type { DateValue } from './property-types.ts'
import { createRow } from './row.ts'
import { createView, updateView } from './view.ts'
import { moveRow, queryGroups, type GroupsPage } from './group.ts'

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

/** 마감(날짜) · 상태(선택)가 있는 표와 그 표의 표 뷰. `rows` 는 [제목, 마감] — 마감이 null 이면 값 없음. */
async function table(rows: readonly (readonly [string, DateValue | null])[]) {
  const created = unwrap(await createDatabase(fx.owner.ctx, { name: `날짜 그룹 ${Date.now()}` }))
  const ds = created.dataSourceId
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '마감', type: 'date' }))
  unwrap(await addProperty(fx.owner.ctx, ds, { name: '상태', type: 'select' }))
  const schema = unwrap(await getSchema(fx.owner.ctx, ds))
  const due = schema.properties.find((p) => p.name === '마감')!.id
  const status = schema.properties.find((p) => p.name === '상태')!.id
  const titleId = schema.properties.find((p) => p.type === 'title')!.id
  const ids: Record<string, string> = {}
  for (const [title, date] of rows) {
    ids[title] = unwrap(
      await createRow(fx.owner.ctx, ds, {
        cells: [
          { propertyId: titleId, value: { type: 'title', title: [textRun(title)] } },
          ...(date === null ? [] : [{ propertyId: due, value: { type: 'date' as const, date } }]),
        ],
      }),
    ).id
  }
  const view = unwrap(await createView(fx.owner.ctx, created.id, { type: 'table' }))
  unwrap(await updateView(fx.owner.ctx, view.id, { groupBy: { property_id: due } }))
  return { viewId: view.id, due, status, ids }
}

const shape = (page: GroupsPage) => page.groups.map((g) => [g.key, g.count, g.rows.map((r) => r.title).join('')])

describe('① 그룹 목록은 데이터에서', () => {
  test('★ 행이 든 버킷들(오름차순) · 값 없음이 맨 앞 · 기본 단위는 월 · 결과가 단위를 싣는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', { start: '2026-12-01T09:00' }],
      ['나', { start: '2026-10-20' }],
      ['다', null],
      ['라', { start: '2026-10-05' }],
    ])
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(page.propertyType, 'date')
    assert.equal(page.dateUnit, 'month')
    assert.deepEqual(shape(page), [
      ['', 1, '다'],
      ['2026-10-01', 2, '나라'],
      ['2026-12-01', 1, '가'],
    ], '11월(행 없음)은 그룹이 아니다')

    // 빈 그룹 숨기기는 값 없음에만 닿는다
    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, hide_empty: true } }))
    const hidden = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.deepEqual(hidden.groups.map((x) => x.key), ['', '2026-10-01', '2026-12-01'])
  })
})

describe('② 단위', () => {
  test('★ 주는 월요일에 시작 · 년 · 적힌 달력 날짜로 센다(시간대로 옮기지 않는다)', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['월', { start: '2026-10-05' }],
      ['화', { start: '2026-10-20' }],
      ['일', { start: '2026-11-01' }],
      // 서울 11월 1일 새벽 1시 — UTC 로는 10월 31일. 적힌 날짜(11월 1일)로 센다
      ['새벽', { start: '2026-11-01T01:00:00+09:00', time_zone: 'Asia/Seoul' }],
    ])
    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'week' } }))
    const weeks = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.equal(weeks.dateUnit, 'week')
    assert.deepEqual(shape(weeks), [
      ['', 0, ''],
      ['2026-10-05', 1, '월'],
      ['2026-10-19', 1, '화'],
      ['2026-10-26', 2, '일새벽'],
    ], '일요일(11월 1일)은 10월 26일(월)의 주')

    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'month' } }))
    const months = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.deepEqual(months.groups.map((x) => [x.key, x.count]), [['', 0], ['2026-10-01', 2], ['2026-11-01', 2]], '새벽은 11월 — UTC 의 10월이 아니다')

    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'year' } }))
    assert.deepEqual(unwrap(await queryGroups(fx.owner.ctx, g.viewId)).groups.map((x) => [x.key, x.count]), [['', 0], ['2026-01-01', 4]])
  })
})

describe('③ 옮기기', () => {
  test('★ 단위만큼 민다 · 시각 · 끝을 지킨다 · 값이 없던 행 · 값 없음 그룹 · 빈 달 · 버킷 키가 아니면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['가', { start: '2026-10-15' }],
      ['나', { start: '2026-10-10T09:30', end: '2026-10-12T18:00', time_zone: 'Asia/Seoul' }],
      ['다', null],
    ])
    const dateOf = (r: { properties: Record<string, unknown> }) => (r.properties[g.due] as { date: DateValue | null }).date

    const a = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '2026-12-01' }))
    assert.deepEqual(dateOf(a.row), { start: '2026-12-15' }, '두 달 뒤 — 날은 그대로')

    const b = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '2026-11-01' }))
    assert.deepEqual(dateOf(b.row), { start: '2026-11-10T09:30', end: '2026-11-12T18:00', time_zone: 'Asia/Seoul' }, '시각 · 끝 · 시간대를 지킨다')

    const c = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['다']!, groupKey: '2027-03-01' }))
    assert.deepEqual(dateOf(c.row), { start: '2027-03-01' }, '값이 없던 행은 그 버킷의 첫 날 — 행이 없는 달에도 놓는다')

    const cleared = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['가']!, groupKey: '' }))
    assert.equal(dateOf(cleared.row), null, '값 없음 그룹은 비운다')

    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId))
    assert.deepEqual(shape(page), [
      ['', 1, '가'],
      ['2026-11-01', 1, '나'],
      ['2027-03-01', 1, '다'],
    ])

    const bad = await Promise.all([
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '2026-11-02' }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '2026-13-01' }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나']!, groupKey: '11월' }),
    ])
    assert.deepEqual(bad.map((r) => (r.ok ? 'ok' : r.reason)), ['invalid_value', 'invalid_value', 'invalid_value'], '그 단위의 버킷 키가 아니다')
  })
})

describe('④ 단위는 날짜 속성에만', () => {
  test('날짜가 아닌 속성 · 모르는 단위는 거부 · 저장하면 단위가 남는다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([['가', { start: '2026-10-15' }]])
    const onSelect = await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.status, date_unit: 'month' } })
    assert.equal(onSelect.ok, false)
    const hour = await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'hour' } })
    assert.equal(hour.ok, false)
    const saved = unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'day' } }))
    assert.deepEqual(saved.groupBy, { property_id: g.due, date_unit: 'day' })
  })
})

describe('⑤ 상대 날짜 (B-3)', () => {
  test('★ 오늘에서 며칠 · 날짜 순 · 오늘을 싣는다 · 어제 · 오늘 · 내일로 옮기면 그 날 · 범위로는 못 옮긴다 · 오늘이 바뀌면 덩이가 바뀐다', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['오늘', { start: '2026-10-31T09:30' }],
      ['내일', { start: '2026-11-01' }],
      ['어제', { start: '2026-10-30' }],
      ['나흘전', { start: '2026-10-27' }],
      ['닷새뒤', { start: '2026-11-05' }],
      ['스무날전', { start: '2026-10-11' }],
      ['먼옛날', { start: '2026-08-01' }],
      ['먼훗날', { start: '2027-01-01' }],
      ['없음', null],
    ])
    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'relative' } }))
    const today = '2026-10-31'
    const page = unwrap(await queryGroups(fx.owner.ctx, g.viewId, { today }))
    assert.equal(page.dateUnit, 'relative')
    assert.equal(page.today, today)
    assert.deepEqual(shape(page), [
      ['', 1, '없음'],
      ['earlier', 1, '먼옛날'],
      ['last_30', 1, '스무날전'],
      ['last_7', 1, '나흘전'],
      ['yesterday', 1, '어제'],
      ['today', 1, '오늘'],
      ['tomorrow', 1, '내일'],
      ['next_7', 1, '닷새뒤'],
      ['later', 1, '먼훗날'],
    ])

    const dateOf = (r: { properties: Record<string, unknown> }) => (r.properties[g.due] as { date: DateValue | null }).date
    const a = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['나흘전']!, groupKey: 'tomorrow', today }))
    assert.deepEqual(dateOf(a.row), { start: '2026-11-01' }, '내일이 된다')
    const b = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['오늘']!, groupKey: 'yesterday', today }))
    assert.deepEqual(dateOf(b.row), { start: '2026-10-30T09:30' }, '시각을 지킨다')
    const c = unwrap(await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['없음']!, groupKey: 'today', today }))
    assert.deepEqual(dateOf(c.row), { start: '2026-10-31' }, '값이 없던 행은 그 날')
    const refused = await Promise.all([
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['내일']!, groupKey: 'next_7', today }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['내일']!, groupKey: 'earlier', today }),
      moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['내일']!, groupKey: '2026-11-01', today }),
    ])
    assert.deepEqual(refused.map((r) => (r.ok ? 'ok' : r.reason)), ['invalid_value', 'invalid_value', 'invalid_value'], '범위 덩이 · 날짜 키는 받지 않는다')

    // 오늘이 하루 지나면 — 같은 행의 덩이가 바뀐다(내일 → 오늘)
    const next = unwrap(await queryGroups(fx.owner.ctx, g.viewId, { today: '2026-11-01' }))
    assert.deepEqual(next.groups.find((x) => x.key === 'today')!.rows.map((r) => r.title).sort(), ['나흘전', '내일'])
  })
})

describe('⑥ 주의 시작 요일 (B-3b)', () => {
  test('일요일 시작이면 그 주의 일요일이 키 · 그 키로만 놓는다 · 날짜가 아닌 속성이면 거부', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const g = await table([
      ['일', { start: '2026-10-25' }],
      ['월', { start: '2026-10-26' }],
      ['토', { start: '2026-10-31' }],
    ])
    unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'week' } }))
    assert.deepEqual(unwrap(await queryGroups(fx.owner.ctx, g.viewId)).groups.map((x) => [x.key, x.count]), [['', 0], ['2026-10-19', 1], ['2026-10-26', 2]],
      '월요일 시작 — 일요일(25일)은 앞 주')
    const saved = unwrap(await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.due, date_unit: 'week', week_start: 'sunday' } }))
    assert.deepEqual(saved.groupBy, { property_id: g.due, date_unit: 'week', week_start: 'sunday' })
    assert.deepEqual(unwrap(await queryGroups(fx.owner.ctx, g.viewId)).groups.map((x) => [x.key, x.count]), [['', 0], ['2026-10-25', 3]],
      '일요일 시작 — 한 주')
    const ok = await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['토']!, groupKey: '2026-11-01' })
    const bad = await moveRow(fx.owner.ctx, g.viewId, { rowId: g.ids['토']!, groupKey: '2026-11-02' })
    assert.deepEqual([ok.ok, bad.ok === false && bad.reason], [true, 'invalid_value'], '일요일 시작이면 월요일은 키가 아니다')
    assert.equal((await updateView(fx.owner.ctx, g.viewId, { groupBy: { property_id: g.status, week_start: 'sunday' } })).ok, false, '날짜가 아닌 속성')
  })
})
