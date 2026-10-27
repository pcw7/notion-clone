/**
 * 날짜로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-1 · F-04-11)
 *
 *   ① ★ 버킷의 첫 날이 키 — 일 · 주(월요일) · 월 · 년 · 시각이 붙어도 적힌 날짜로 · 날짜가 아니면 null
 *   ② 그 단위의 버킷 키인가 — 첫 날만 · 달력에 없는 날은 아니다
 *   ③ ★ 옮기면 단위만큼 민다 — 날수 · 달수 · 끝 날짜도 같은 만큼 · 시각 · 시간대를 지킨다 · 없는 날은 그 달의 끝으로
 *   ④ 머리의 이름
 *   ⑤ ★ 상대 단위(B-3) — 오늘에서 며칠 떨어졌나 · 겹치지 않는 경계 · 하루짜리 키의 그 날 · 그 시간대의 오늘
 *   ⑥ 주의 시작 요일(B-3b) — 일요일 시작이면 그 주의 일요일이 키
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { bucketOf, dateGroupLabel, isBucketKey, isDateUnit, isWeekStart, relativeDayOf, relativeOf, shiftDateValue, todayIn } from './date-group.ts'

describe('날짜로 묶기 (B-1)', () => {
  test('★ ① 버킷의 첫 날이 키', () => {
    assert.equal(bucketOf('2026-10-28', 'day'), '2026-10-28')
    // 2026-10-28 은 수요일 — 그 주의 월요일은 10월 26일. 일요일(11월 1일)은 앞 주
    assert.equal(bucketOf('2026-10-28', 'week'), '2026-10-26')
    assert.equal(bucketOf('2026-11-01', 'week'), '2026-10-26', '일요일은 그 앞 월요일의 주')
    assert.equal(bucketOf('2026-11-02', 'week'), '2026-11-02', '월요일은 제 주의 첫 날')
    assert.equal(bucketOf('2027-01-01', 'week'), '2026-12-28', '해를 넘는 주')
    assert.equal(bucketOf('2026-10-28', 'month'), '2026-10-01')
    assert.equal(bucketOf('2026-10-28', 'year'), '2026-01-01')
    assert.equal(bucketOf('2026-10-31T23:30:00+09:00', 'month'), '2026-10-01', '시각이 붙어도 적힌 날짜로 — 시간대로 옮기지 않는다')
    assert.equal(bucketOf('2026-02-30', 'month'), null, '달력에 없는 날')
    assert.equal(bucketOf('어제', 'day'), null)
  })

  test('② 그 단위의 버킷 키인가', () => {
    assert.equal(isBucketKey('2026-10-01', 'month'), true)
    assert.equal(isBucketKey('2026-10-02', 'month'), false, '첫 날이 아니다')
    assert.equal(isBucketKey('2026-10-26', 'week'), true)
    assert.equal(isBucketKey('2026-10-27', 'week'), false)
    assert.equal(isBucketKey('2026-01-01', 'year'), true)
    assert.equal(isBucketKey('2026-02-30', 'day'), false)
    assert.equal(isBucketKey('', 'day'), false, '값 없음은 부르는 쪽이 따로 본다')
    assert.equal(isBucketKey('2026-10-01T00:00', 'day'), false, '키는 날짜 글자 열 자다')
    assert.equal(isDateUnit('month'), true)
    assert.equal(isDateUnit('relative'), true, '상대 단위(B-3)')
    assert.equal(isDateUnit('hour'), false)
  })

  test('★ ③ 옮기면 단위만큼 민다', () => {
    assert.deepEqual(shiftDateValue({ start: '2026-10-15' }, '2026-10-01', '2026-12-01', 'month'), { start: '2026-12-15' })
    assert.deepEqual(
      shiftDateValue({ start: '2026-10-15T09:30', end: '2026-10-20T18:00', time_zone: 'Asia/Seoul' }, '2026-10-01', '2026-09-01', 'month'),
      { start: '2026-09-15T09:30', end: '2026-09-20T18:00', time_zone: 'Asia/Seoul' },
      '시각 · 끝 · 시간대를 지킨다 — 끝도 같은 만큼',
    )
    assert.deepEqual(shiftDateValue({ start: '2026-01-31' }, '2026-01-01', '2026-02-01', 'month'), { start: '2026-02-28' }, '없는 날은 그 달의 끝으로')
    assert.deepEqual(shiftDateValue({ start: '2026-10-28' }, '2026-10-26', '2026-11-09', 'week'), { start: '2026-11-11' }, '두 주 = 14일')
    assert.deepEqual(shiftDateValue({ start: '2026-10-28' }, '2026-10-28', '2026-10-25', 'day'), { start: '2026-10-25' })
    assert.deepEqual(shiftDateValue({ start: '2024-02-29' }, '2024-01-01', '2025-01-01', 'year'), { start: '2025-02-28' }, '윤날 → 평년의 끝 날')
    assert.deepEqual(shiftDateValue({ start: '2026-10-15', end: null }, '2026-10-01', '2026-11-01', 'month'), { start: '2026-11-15', end: null })
  })

  test('④ 머리의 이름', () => {
    assert.equal(dateGroupLabel('2026-10-01', 'month'), '2026년 10월')
    assert.equal(dateGroupLabel('2026-01-01', 'year'), '2026년')
    assert.equal(dateGroupLabel('2026-10-05', 'day'), '2026년 10월 5일')
    assert.equal(dateGroupLabel('2026-10-26', 'week'), '2026년 10월 26일 주')
  })

  test('★ ⑤ 상대 단위(B-3)', () => {
    const today = '2026-10-31'
    const at = (n: number) => {
      const d = new Date(Date.UTC(2026, 9, 31 + n))
      return d.toISOString().slice(0, 10)
    }
    assert.equal(relativeOf(at(0), today), 'today')
    assert.equal(relativeOf(at(1), today), 'tomorrow', '해를 넘지 않아도 달을 넘는다(11월 1일)')
    assert.equal(relativeOf(at(-1), today), 'yesterday')
    assert.equal(relativeOf(at(2), today), 'next_7')
    assert.equal(relativeOf(at(7), today), 'next_7')
    assert.equal(relativeOf(at(8), today), 'next_30')
    assert.equal(relativeOf(at(30), today), 'next_30')
    assert.equal(relativeOf(at(31), today), 'later')
    assert.equal(relativeOf(at(-2), today), 'last_7')
    assert.equal(relativeOf(at(-7), today), 'last_7')
    assert.equal(relativeOf(at(-8), today), 'last_30')
    assert.equal(relativeOf(at(-30), today), 'last_30')
    assert.equal(relativeOf(at(-31), today), 'earlier')
    assert.equal(relativeOf('2026-10-31T23:30:00+09:00', today), 'today', '적힌 날짜로')
    assert.equal(bucketOf(at(1), 'relative', today), 'tomorrow')
    assert.equal(bucketOf(at(1), 'relative'), null, '오늘을 모르면 셀 수 없다')
    assert.equal(isBucketKey('next_7', 'relative'), true)
    assert.equal(isBucketKey('2026-10-01', 'relative'), false)
    assert.equal(relativeDayOf('tomorrow', today), '2026-11-01')
    assert.equal(relativeDayOf('yesterday', today), '2026-10-30')
    assert.equal(relativeDayOf('last_7', today), null, '범위 덩이는 그 날이 없다')
    assert.equal(dateGroupLabel('earlier', 'relative'), '그 전')
    // 2026-10-31 15:30 UTC — 서울은 11월 1일 0시 30분
    const now = new Date('2026-10-31T15:30:00Z')
    assert.equal(todayIn('Asia/Seoul', now), '2026-11-01')
    assert.equal(todayIn('UTC', now), '2026-10-31')
    assert.equal(todayIn('Nowhere/Fake', now), '2026-10-31', '틀린 시간대는 UTC')
  })

  test('⑥ 주의 시작 요일(B-3b)', () => {
    // 2026-10-28 은 수요일 — 월요일 시작이면 26일(월), 일요일 시작이면 25일(일)
    assert.equal(bucketOf('2026-10-28', 'week', undefined, 'sunday'), '2026-10-25')
    assert.equal(bucketOf('2026-10-25', 'week', undefined, 'sunday'), '2026-10-25', '일요일은 제 주의 첫 날')
    assert.equal(bucketOf('2026-10-25', 'week'), '2026-10-19', '월요일 시작이면 일요일은 앞 주')
    assert.equal(isBucketKey('2026-10-25', 'week', 'sunday'), true)
    assert.equal(isBucketKey('2026-10-26', 'week', 'sunday'), false)
    assert.equal(isWeekStart('sunday'), true)
    assert.equal(isWeekStart('saturday'), false)
  })
})
