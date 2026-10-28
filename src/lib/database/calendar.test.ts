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
  eventsOn,
  isValidSpan,
  isYm,
  isYmd,
  layoutWeek,
  monthGrid,
  resizeDateValue,
  visibleDays,
  weekdayLabels,
  weekGrid,
  weekStartOf,
  weekTitle,
  readCalendarLayout,
  shiftDateValue,
  shiftMonth,
  validateCalendarPatch,
} from './calendar.ts'

const TYPES = new Map([['pDate', 'date'], ['pText', 'rich_text']])

describe('① 읽기', () => {
  test('없으면 null · 달 — 모르는 단위는 달', () => {
    // 주의 시작 · 주말(C-3)도 읽는다 — 없으면 일요일 · 그린다
    const week = { week_start: 'sunday', show_weekends: true }
    assert.deepEqual(readCalendarLayout({}), { date_property_id: null, view_range: 'month', ...week })
    assert.deepEqual(readCalendarLayout({ calendar: { date_property_id: 'pDate', view_range: 'year' } }), { date_property_id: 'pDate', view_range: 'month', ...week })
    assert.deepEqual(
      readCalendarLayout({ calendar: { date_property_id: 'pDate', view_range: 'month', week_start: 'monday', show_weekends: false } }),
      { date_property_id: 'pDate', view_range: 'month', week_start: 'monday', show_weekends: false },
    )
    assert.equal(readCalendarLayout({ calendar: { date_property_id: 'pDate', week_start: 'friday', show_weekends: 'no' } }).show_weekends, true, '모르는 값은 기본')
  })
})

describe('② 바꿀 키만', () => {
  test('날짜 속성 · 단위 · 모르는 키 · 빈 객체', () => {
    assert.deepEqual(validateCalendarPatch({ date_property_id: 'pDate', view_range: 'week' }, TYPES), [])
    assert.equal(validateCalendarPatch({ date_property_id: 'pText' }, TYPES)[0]?.path, 'calendar.date_property_id')
    assert.equal(validateCalendarPatch({ date_property_id: 'nope' }, TYPES)[0]?.path, 'calendar.date_property_id')
    assert.equal(validateCalendarPatch({ view_range: 'day' }, TYPES)[0]?.path, 'calendar.view_range')
    assert.equal(validateCalendarPatch({ color: 'red' }, TYPES)[0]?.path, 'calendar.color')
    assert.deepEqual(validateCalendarPatch({ week_start: 'monday', show_weekends: false }, TYPES), [], 'C-3 의 두 키')
    assert.equal(validateCalendarPatch({ week_start: 'friday' }, TYPES)[0]?.path, 'calendar.week_start')
    assert.equal(validateCalendarPatch({ show_weekends: 'no' }, TYPES)[0]?.path, 'calendar.show_weekends')
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

describe('⑨ 주의 시작 · 주말 숨기기 (C-3)', () => {
  test('★ 월요일 시작이면 격자가 그 달 1일 앞의 월요일부터 · 머리의 요일도 그 차례', () => {
    // 2026-03-01 은 일요일 — 일요일 시작이면 그날, 월요일 시작이면 2/23(월)
    assert.equal(monthGrid('2026-03').from, '2026-03-01')
    const monday = monthGrid('2026-03', 'monday')
    assert.deepEqual([monday.from, monday.to, monday.weeks[0]![0]], ['2026-02-23', '2026-04-05', '2026-02-23'])
    assert.equal(monthGrid('2026-04', 'monday').from, '2026-03-30', '4/1 은 수요일 — 그 주의 월요일')
    assert.deepEqual(weekdayLabels('monday', true), ['월', '화', '수', '목', '금', '토', '일'])
    assert.deepEqual(weekdayLabels('sunday', false), ['월', '화', '수', '목', '금'])
  })

  test('★ 주말을 숨기면 다섯 칸 — 금 ~ 월 일정은 금 · 월 두 칸에 이어 그리고 주말에만 걸친 일정은 그리지 않는다', () => {
    const week = visibleDays(monthGrid('2026-03', 'monday').weeks[2]!, false) // 3/9(월) ~ 3/13(금) · 3/16(월) 은 다음 주
    assert.deepEqual(week, ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'])
    const { placed, hidden } = layoutWeek(
      week,
      [
        { id: 'friToMon', start: '2026-03-13', end: '2026-03-16' },
        { id: 'weekend', start: '2026-03-14', end: '2026-03-15' },
        { id: 'wed', start: '2026-03-11', end: '2026-03-11' },
      ],
      3,
    )
    const by = Object.fromEntries(placed.map((p) => [p.id, p]))
    assert.deepEqual([by.friToMon?.col, by.friToMon?.span, by.friToMon?.continuesAfter], [4, 1, true], '금요일 칸 · 다음 주로 이어진다')
    assert.equal(by.weekend, undefined, '숨긴 주말에만 걸친 일정')
    assert.deepEqual([by.wed?.col, by.wed?.span], [2, 1])
    assert.deepEqual(hidden, [0, 0, 0, 0, 0])
    // 일요일 시작 · 주말 숨김 — 금(3/13) ~ 월(3/16)이 같은 주에 없으므로 다음 주에서 월요일 칸 하나로 이어 받는다
    const next = visibleDays(monthGrid('2026-03').weeks[2]!, false) // 3/16(월) ~ 3/20(금)
    const cont = layoutWeek(next, [{ id: 'friToMon', start: '2026-03-13', end: '2026-03-16' }], 3).placed[0]
    assert.deepEqual([cont?.col, cont?.span, cont?.continuesBefore], [0, 1, true])
  })
})

describe('⑩ 가장자리로 기간 바꾸기 (C-4)', () => {
  test('★ 끝을 늘이고 줄인다 — 날짜 글자만 · 끝이 없던 값은 시작의 시각을 빌린다 · 시작과 같은 날이면 끝을 지운다', () => {
    assert.deepEqual(resizeDateValue({ start: '2026-03-10' }, 'end', '2026-03-12'), { start: '2026-03-10', end: '2026-03-12' })
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'end', '2026-03-11'), { start: '2026-03-10', end: '2026-03-11' })
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'end', '2026-03-10'), { start: '2026-03-10' }, '같은 날 — 끝을 지운다')
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'end', '2026-03-01'), { start: '2026-03-10' }, '시작 앞 — 시작에서 멈춘다')
    assert.deepEqual(
      resizeDateValue({ start: '2026-03-10T09:30:00+09:00' }, 'end', '2026-03-11'),
      { start: '2026-03-10T09:30:00+09:00', end: '2026-03-11T09:30:00+09:00' },
      '시작의 시각을 빌린다',
    )
    assert.deepEqual(
      resizeDateValue({ start: '2026-03-10T09:00', end: '2026-03-12T18:00' }, 'end', '2026-03-14'),
      { start: '2026-03-10T09:00', end: '2026-03-14T18:00' },
      '끝의 시각은 그대로',
    )
    assert.equal(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'end', '2026-03-12'), null, '바뀌지 않으면 null')
  })

  test('★ 시작을 옮긴다 — 끝을 넘지 않고 · 끝과 같은 날이면 끝을 지운다', () => {
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'start', '2026-03-08'), { start: '2026-03-08', end: '2026-03-12' })
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'start', '2026-03-12'), { start: '2026-03-12' })
    assert.deepEqual(resizeDateValue({ start: '2026-03-10', end: '2026-03-12' }, 'start', '2026-03-20'), { start: '2026-03-12' }, '끝 뒤 — 끝에서 멈춘다')
    assert.deepEqual(resizeDateValue({ start: '2026-03-10' }, 'start', '2026-03-07'), { start: '2026-03-07' }, '하루짜리 값의 시작을 당기면 그 날로 옮긴다')
    assert.deepEqual(resizeDateValue({ start: '2026-03-10T09:30' }, 'start', '2026-03-09'), { start: '2026-03-09T09:30' })
    assert.equal(resizeDateValue({ start: '2026-03-10' }, 'start', '2026-03-10'), null)
  })
})

describe('⑪ 주 보기 (C-5)', () => {
  test('★ 그 날이 든 한 주 — 주의 시작 요일부터 · 제목은 달 · 해를 넘으면 그것도', () => {
    assert.equal(weekStartOf('2026-03-18'), '2026-03-15', '수요일 → 그 주의 일요일')
    assert.equal(weekStartOf('2026-03-18', 'monday'), '2026-03-16')
    assert.equal(weekStartOf('2026-03-15', 'monday'), '2026-03-09', '일요일은 월요일 시작이면 그 주의 끝')
    const grid = weekGrid('2026-03-18')
    assert.deepEqual([grid.from, grid.to, grid.weeks.length, grid.weeks[0]!.length], ['2026-03-15', '2026-03-21', 1, 7])
    assert.equal(weekTitle('2026-03-15', '2026-03-21'), '2026년 3월 15일 – 21일')
    assert.equal(weekTitle('2026-03-29', '2026-04-04'), '2026년 3월 29일 – 4월 4일')
    assert.equal(weekTitle('2026-12-27', '2027-01-02'), '2026년 12월 27일 – 2027년 1월 2일')
  })
})

describe('⑧ 하루에 넘치는 카드 (C-1)', () => {
  test('★ 그날에 걸친 일정 전부 — 여러 날에 걸친 것도 · 들어온 차례 그대로', () => {
    const events = [
      { id: 'long', start: '2026-03-16', end: '2026-03-20' },
      { id: 'a', start: '2026-03-18', end: '2026-03-18' },
      { id: 'before', start: '2026-03-17', end: '2026-03-17' },
      { id: 'b', start: '2026-03-18', end: '2026-03-18' },
      { id: 'edge', start: '2026-03-18', end: '2026-03-19' },
    ]
    assert.deepEqual(eventsOn('2026-03-18', events).map((e) => e.id), ['long', 'a', 'b', 'edge'])
    assert.deepEqual(eventsOn('2026-03-20', events).map((e) => e.id), ['long'], '끝나는 날도 든다')
    assert.deepEqual(eventsOn('2026-03-21', events), [])
  })
})

describe('⑦ 끌어 옮기기 (2g-3)', () => {
  test('★ 날짜만 옮긴다 — 범위는 길이를 지키고 시각 · 시간대는 그대로', () => {
    assert.deepEqual(shiftDateValue({ start: '2026-03-10' }, 2), { start: '2026-03-12' })
    assert.deepEqual(shiftDateValue({ start: '2026-03-06', end: '2026-03-09' }, 7), { start: '2026-03-13', end: '2026-03-16' })
    assert.deepEqual(shiftDateValue({ start: '2026-03-31T09:30:00+09:00', end: null }, 1), { start: '2026-04-01T09:30:00+09:00' })
    assert.deepEqual(shiftDateValue({ start: '2026-03-01', end: '2026-03-02' }, -1), { start: '2026-02-28', end: '2026-03-01' })
  })
})
