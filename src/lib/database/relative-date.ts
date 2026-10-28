/**
 * 상대 날짜로 거르기 — 범위 규칙 (상대 날짜 필터 트랙 R-1 · 04 F-04-09 · 03 F-03-17)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 R-1] 상대 날짜로 거르기
 *
 * 연산자마다 **보는 사람의 오늘**에서 펼친 날짜 범위(양 끝 포함)를 준다. 컴파일러(`filter.ts`)가 이 범위를 기존 날짜 연산자와 같은 하루
 * 단위로 비교한다. 순수 함수 — 날짜는 `YYYY-MM-DD` 글자이고 계산은 시각 없는 달력이다(UTC 의 `Date` 로 센다 — 시간대가 끼지 않는다).
 *
 * - 지난 1주 · 1개월 · 1년 안 = [오늘 − 그만큼, 오늘]
 * - 다음 1주 · 1개월 · 1년 안 = [오늘, 오늘 + 그만큼]
 * - 이번 주 = 오늘이 든 주의 월요일 ~ 일요일(ISO — 그룹의 주 기본값과 같다)
 * - 달 · 해를 더하고 빼면 그 달에 없는 날은 그 달의 끝으로 맞춘다(3월 31일 − 1개월 = 2월 28일 · 2월 29일 − 1년 = 2월 28일)
 *
 * 화면(자동화 편집기의 고르개)도 이 목록을 쓰므로 서버 전용 의존을 두지 않는다.
 */

import type { FilterNode } from './filter.ts'
import { todayIn } from './date-group.ts'

export const RELATIVE_DATE_OPERATORS = ['past_week', 'past_month', 'past_year', 'this_week', 'next_week', 'next_month', 'next_year'] as const

export type RelativeDateOperator = (typeof RELATIVE_DATE_OPERATORS)[number]

export function isRelativeDateOperator(operator: unknown): operator is RelativeDateOperator {
  return typeof operator === 'string' && (RELATIVE_DATE_OPERATORS as readonly string[]).includes(operator)
}

/** 양 끝을 포함하는 날짜 범위(`YYYY-MM-DD`). */
export type DateRange = { readonly from: string; readonly to: string }

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** 오늘로 쓸 날짜 — 맞는 모양이면 그대로, 아니면(넘기지 않은 길) UTC 의 오늘. */
export function todayOrUtc(today: string | null | undefined): string {
  return typeof today === 'string' && DAY_KEY.test(today) ? today : todayIn('UTC')
}

function parse(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(key: string, days: number): string {
  const date = parse(key)
  date.setUTCDate(date.getUTCDate() + days)
  return keyOf(date)
}

/** 달을 더한다 — 그 달에 없는 날은 그 달의 끝으로(1월 31일 + 1개월 = 2월 28일 · 29일). */
function addMonths(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return keyOf(first)
}

/** 그 연산자의 범위 — 보는 사람의 오늘(`today`)에서. */
export function relativeRange(operator: RelativeDateOperator, today: string): DateRange {
  const day = todayOrUtc(today)
  switch (operator) {
    case 'past_week':
      return { from: addDays(day, -7), to: day }
    case 'past_month':
      return { from: addMonths(day, -1), to: day }
    case 'past_year':
      return { from: addMonths(day, -12), to: day }
    case 'next_week':
      return { from: day, to: addDays(day, 7) }
    case 'next_month':
      return { from: day, to: addMonths(day, 1) }
    case 'next_year':
      return { from: day, to: addMonths(day, 12) }
    case 'this_week': {
      // 월요일 = 0 … 일요일 = 6
      const back = (parse(day).getUTCDay() + 6) % 7
      const monday = addDays(day, -back)
      return { from: monday, to: addDays(monday, 6) }
    }
  }
}

/** 필터에 상대 날짜 규칙이 있는가 — 화면이 서버의 오늘을 이 기기의 오늘과 맞출지 정한다. */
export function usesRelativeDate(node: FilterNode | null | undefined): boolean {
  if (node === null || node === undefined) return false
  if ('op' in node) return node.children.some((child) => usesRelativeDate(child))
  return isRelativeDateOperator(node.operator)
}
