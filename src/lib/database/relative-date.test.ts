/**
 * 상대 날짜로 거르기 — 범위 규칙 (상대 날짜 필터 트랙 R-1 · 04 F-04-09 · 03 F-03-17)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 R-1] 상대 날짜로 거르기 ①
 *
 * 이 파일이 지키는 것.
 *
 *   ① ★ 지난 · 다음 1주 · 1개월 · 1년 — 오늘을 한 끝으로 양 끝 포함
 *   ② ★ 달 · 해를 넘으면 그 달의 끝으로 맞춘다(3월 31일 − 1개월 · 윤년의 2월 29일)
 *   ③ ★ 이번 주 — 월요일 ~ 일요일(일요일이 오늘이어도 그 주 · 해를 넘는 주)
 *   ④ 오늘이 맞는 모양이 아니면 UTC 의 오늘 · 필터 안의 상대 날짜 규칙 찾기
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { isRelativeDateOperator, relativeRange, RELATIVE_DATE_OPERATORS, todayOrUtc, usesRelativeDate } from './relative-date.ts'
import { todayIn } from './date-group.ts'

describe('① 지난 · 다음', () => {
  test('★ 오늘(2026-03-18)을 한 끝으로 — 양 끝 포함', () => {
    const today = '2026-03-18'
    assert.deepEqual(relativeRange('past_week', today), { from: '2026-03-11', to: today })
    assert.deepEqual(relativeRange('past_month', today), { from: '2026-02-18', to: today })
    assert.deepEqual(relativeRange('past_year', today), { from: '2025-03-18', to: today })
    assert.deepEqual(relativeRange('next_week', today), { from: today, to: '2026-03-25' })
    assert.deepEqual(relativeRange('next_month', today), { from: today, to: '2026-04-18' })
    assert.deepEqual(relativeRange('next_year', today), { from: today, to: '2027-03-18' })
  })

  test('★ 해를 넘는다 — 12월 28일의 다음 1주 · 1월 3일의 지난 1주', () => {
    assert.deepEqual(relativeRange('next_week', '2026-12-28'), { from: '2026-12-28', to: '2027-01-04' })
    assert.deepEqual(relativeRange('past_week', '2027-01-03'), { from: '2026-12-27', to: '2027-01-03' })
  })
})

describe('② 그 달에 없는 날', () => {
  test('★ 그 달의 끝으로 — 3월 31일 − 1개월 = 2월 28일 · 윤년이면 29일 · 1월 31일 + 1개월 = 2월 28일', () => {
    assert.equal(relativeRange('past_month', '2026-03-31').from, '2026-02-28')
    assert.equal(relativeRange('past_month', '2024-03-31').from, '2024-02-29')
    assert.equal(relativeRange('next_month', '2026-01-31').to, '2026-02-28')
    assert.equal(relativeRange('past_month', '2026-01-15').from, '2025-12-15', '해를 넘는 달')
  })

  test('★ 윤년의 2월 29일 ± 1년 = 2월 28일', () => {
    assert.equal(relativeRange('past_year', '2024-02-29').from, '2023-02-28')
    assert.equal(relativeRange('next_year', '2024-02-29').to, '2025-02-28')
  })
})

describe('③ 이번 주', () => {
  test('★ 월요일 ~ 일요일 — 수 · 월 · 일 어느 날이 오늘이어도 같은 주', () => {
    const week = { from: '2026-03-16', to: '2026-03-22' }
    assert.deepEqual(relativeRange('this_week', '2026-03-18'), week, '수요일')
    assert.deepEqual(relativeRange('this_week', '2026-03-16'), week, '월요일')
    assert.deepEqual(relativeRange('this_week', '2026-03-22'), week, '일요일 — 다음 주가 아니다')
  })

  test('해를 넘는 주 — 2027-01-01(금)은 2026-12-28(월) ~ 2027-01-03(일)', () => {
    assert.deepEqual(relativeRange('this_week', '2027-01-01'), { from: '2026-12-28', to: '2027-01-03' })
  })
})

describe('④ 오늘 · 규칙 찾기', () => {
  test('오늘이 맞는 모양이 아니면 UTC 의 오늘', () => {
    assert.equal(todayOrUtc('2026-03-18'), '2026-03-18')
    for (const bad of [null, undefined, '', '2026-3-18', '어제', '2026-03-18T00:00']) assert.equal(todayOrUtc(bad), todayIn('UTC'), String(bad))
    assert.deepEqual(relativeRange('past_week', 'nope').to, todayIn('UTC'))
  })

  test('연산자 일곱 · 안긴 묶음의 상대 날짜 규칙도 찾는다', () => {
    assert.equal(RELATIVE_DATE_OPERATORS.length, 7)
    assert.equal(isRelativeDateOperator('this_week'), true)
    assert.equal(isRelativeDateOperator('equals'), false)
    assert.equal(isRelativeDateOperator(7), false)
    assert.equal(usesRelativeDate(null), false)
    assert.equal(usesRelativeDate({ property_id: 'd', operator: 'equals', value: '2026-03-18' }), false)
    assert.equal(
      usesRelativeDate({ op: 'and', children: [{ property_id: 'n', operator: 'is_empty' }, { op: 'or', children: [{ property_id: 'd', operator: 'next_week' }] }] }),
      true,
    )
  })
})
