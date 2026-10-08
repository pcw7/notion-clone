/**
 * 캘린더 — 레이아웃 읽기 · 검증 · 날짜 글자 (DB 심화 2g-1조각 · F-04-06 · DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① 읽기 — 없으면 날짜 속성 null · 달 · 모르는 보기 단위는 달
 *   ② 바꿀 키만 — 날짜 속성은 이 표의 날짜 속성 · 모르는 키 · 값 · 빈 객체는 거부
 *   ③ 기간 — 달력에 있는 날 · 처음 ≤ 끝 · 상한(62일)
 *   ④ 칸에 놓는 날 — 칸 값의 날짜 글자 · 끝이 없으면 시작 · 끝이 앞서면 시작 · 시각이 있어도 날짜만
 *   ⑤ 목록이 저장 CHECK(0058)과 같다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CALENDAR_RANGES, cellDays, isValidSpan, isYmd, readCalendarLayout, validateCalendarPatch } from './calendar.ts'

const TYPES = new Map([['pDate', 'date'], ['pText', 'rich_text']])

describe('① 읽기', () => {
  test('없으면 null · 달 — 모르는 단위는 달', () => {
    assert.deepEqual(readCalendarLayout({}), { date_property_id: null, view_range: 'month' })
    assert.deepEqual(readCalendarLayout({ calendar: { date_property_id: 'pDate', view_range: 'year' } }), { date_property_id: 'pDate', view_range: 'month' })
  })
})

describe('② 바꿀 키만', () => {
  test('날짜 속성 · 단위 · 모르는 키 · 빈 객체', () => {
    assert.deepEqual(validateCalendarPatch({ date_property_id: 'pDate', view_range: 'week' }, TYPES), [])
    assert.equal(validateCalendarPatch({ date_property_id: 'pText' }, TYPES)[0]?.path, 'calendar.date_property_id')
    assert.equal(validateCalendarPatch({ date_property_id: 'nope' }, TYPES)[0]?.path, 'calendar.date_property_id')
    assert.equal(validateCalendarPatch({ view_range: 'day' }, TYPES)[0]?.path, 'calendar.view_range')
    assert.equal(validateCalendarPatch({ color: 'red' }, TYPES)[0]?.path, 'calendar.color')
    assert.equal(validateCalendarPatch({}, TYPES).length, 1)
  })
})

describe('③ 기간', () => {
  test('달력에 있는 날 · 처음 ≤ 끝 · 62일까지', () => {
    assert.equal(isYmd('2026-02-29'), false)
    assert.equal(isYmd('2028-02-29'), true)
    assert.equal(isValidSpan('2026-03-01', '2026-03-01'), true)
    assert.equal(isValidSpan('2026-03-02', '2026-03-01'), false)
    assert.equal(isValidSpan('2026-01-01', '2026-03-04'), true, '62일')
    assert.equal(isValidSpan('2026-01-01', '2026-03-05'), false, '63일')
  })
})

describe('④ 칸에 놓는 날', () => {
  test('날짜 글자 · 끝이 없거나 앞서면 시작 · 시각은 버린다', () => {
    assert.deepEqual(cellDays({ type: 'date', date: { start: '2026-03-01' } }), { start: '2026-03-01', end: '2026-03-01' })
    assert.deepEqual(cellDays({ type: 'date', date: { start: '2026-03-01T23:30:00+09:00', end: '2026-03-03T01:00:00+09:00' } }), { start: '2026-03-01', end: '2026-03-03' })
    assert.deepEqual(cellDays({ type: 'date', date: { start: '2026-03-05', end: '2026-03-01' } }), { start: '2026-03-05', end: '2026-03-05' })
    assert.equal(cellDays(null), null)
    assert.equal(cellDays({ type: 'date', date: null }), null)
  })
})

describe('⑤ 저장 CHECK 과 같은 목록', () => {
  test('0058 의 보기 단위', () => {
    const sql = readFileSync(new URL('../../../db/migrations/0058_calendar_layout.sql', import.meta.url), 'utf8')
    const m = sql.match(/'view_range'\) IN \(([^)]*)\)/)
    assert.ok(m)
    assert.deepEqual([...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), [...CALENDAR_RANGES].sort())
  })
})
