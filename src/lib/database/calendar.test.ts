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

import {
  addDays,
  CALENDAR_RANGES,
  cellDays,
  isValidSpan,
  isYm,
  isYmd,
  layoutWeek,
  monthGrid,
  readCalendarLayout,
  shiftMonth,
  validateCalendarPatch,
} from './calendar.ts'

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

describe('⑥ 달 격자 · 막대 배치 (2g-2)', () => {
  test('일요일에 시작하는 6주 — 달의 1일이 들어 있다', () => {
    const grid = monthGrid('2026-03') // 2026-03-01 은 일요일
    assert.equal(grid.from, '2026-03-01')
    assert.equal(grid.to, '2026-04-11')
    assert.equal(grid.weeks.length, 6)
    assert.deepEqual(grid.weeks[0], ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'])
    const april = monthGrid('2026-04') // 4월 1일은 수요일
    assert.equal(april.from, '2026-03-29')
  })

  test('달 옮기기 · 날짜 더하기 — 해를 넘는다', () => {
    assert.equal(shiftMonth('2026-01', -1), '2025-12')
    assert.equal(shiftMonth('2026-12', 1), '2027-01')
    assert.equal(addDays('2026-02-28', 1), '2026-03-01')
    assert.equal(isYm('2026-13'), false)
    assert.equal(isYm('2026-03'), true)
  })

  test('★ 줄 배치 — 겹치면 다음 줄 · 안 겹치면 같은 줄 · 주를 넘는 것은 잘라 잇는다 · 넘치면 날짜마다 센다', () => {
    const week = monthGrid('2026-03').weeks[1]! // 3/8 ~ 3/14
    const { placed, hidden } = layoutWeek(
      week,
      [
        { id: 'long', start: '2026-03-05', end: '2026-03-10' }, // 앞 주에서 이어진다 — 3/8 ~ 3/10
        { id: 'a', start: '2026-03-09', end: '2026-03-09' },
        { id: 'b', start: '2026-03-11', end: '2026-03-16' }, // 뒤 주로 이어진다
        { id: 'c', start: '2026-03-09', end: '2026-03-09' },
        { id: 'd', start: '2026-03-09', end: '2026-03-09' },
      ],
      3,
    )
    const by = Object.fromEntries(placed.map((p) => [p.id, p]))
    assert.deepEqual([by.long?.col, by.long?.span, by.long?.lane, by.long?.continuesBefore], [0, 3, 0, true])
    assert.equal(by.b?.lane, 0, '긴 막대가 끝난 뒤의 같은 줄')
    assert.equal(by.b?.continuesAfter, true)
    assert.deepEqual([by.a?.lane, by.c?.lane], [1, 2])
    assert.equal(by.d, undefined, '세 줄을 넘는다')
    assert.equal(hidden[1], 1, '3/9 에 하나가 숨었다')
  })
})
