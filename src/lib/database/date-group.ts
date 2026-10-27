/**
 * 날짜로 묶기 — 버킷 규칙 (그룹 버킷 트랙 B-1 · 정본 §3.6 [보강] `view.group_by` 의 [보강 B-1] · 04 F-04-11, DOM 없음)
 *
 * 04 F-04-11 *"date — `date_granularity` = relative/day/week/month/year"*. 일 · 주 · 월 · 년과 상대 단위(B-3 — 아래).
 *
 * - **키는 버킷의 첫 날**(`YYYY-MM-DD`) — 값에 **적힌 달력 날짜**(`start` 글자의 앞 열 자)로 센다. 시간대로 옮기지 않는다: 사람이
 *   10월 31일이라고 적었으면 그 행은 10월이다(사이드카의 UTC 시각으로 세면 시각이 붙은 값이 하루 밀린다). 값 없음은 `''`.
 * - **주는 월요일에 시작한다**(ISO — `date_trunc('week')` 와 같다). 시작 요일 고르기는 §7.
 * - **옮기면 단위만큼 민다** — 다른 버킷에 놓은 행의 날짜는 그 버킷 차이만큼(일 · 주는 날수, 월 · 년은 달수) 앞뒤로 간다. 시각 · 끝 날짜 ·
 *   시간대는 지킨다(끝도 같은 만큼 — 기간이 그대로다). 달을 밀어 그 날이 없으면 그 달의 끝 날로(1월 31일 + 1달 = 2월 28일).
 * - 서버의 키 식(`group.ts` `keyExprOf`)과 화면의 이름 · 새 행 채우기가 이 규칙 하나를 쓴다.
 *
 * **상대 단위**(B-3 · 정본 [보강 B-3]) — **보는 사람의 오늘**(`todayIn` — 브라우저가 쿠키로 알린 시간대의 날짜)에서 며칠 떨어졌나로 묶는다:
 * 그 전(30일보다 앞) · 지난 30일 · 지난 7일 · 어제 · 오늘 · 내일 · 앞으로 7일 · 앞으로 30일 · 그 뒤(30일보다 뒤). 겹치지 않는다(지난 7일은
 * 2 ~ 7일 전 · 지난 30일은 8 ~ 30일 전). 키는 그 이름(`today` …) — 오늘이 바뀌면 같은 행의 키가 바뀌므로 날짜가 아니다. 어제 · 오늘 · 내일로
 * 옮기면 **그 날이 된다**(시각 · 끝 날짜는 같은 날수만큼 — 단위 "일"의 밀기) · 범위 덩이로는 옮길 수 없다(어느 날인지 정할 수 없다).
 */

import type { DateValue } from './property-types.ts'

export const DATE_UNITS = ['relative', 'day', 'week', 'month', 'year'] as const
export type DateUnit = (typeof DATE_UNITS)[number]

/** 단위를 고르지 않았을 때 — 04 F-04-11 엣지 *"5년치 day 단위 → 버킷 수 폭발 → 기본 granularity 를 month 로"*. */
export const DEFAULT_DATE_UNIT: DateUnit = 'month'

export const DATE_UNIT_LABEL: Readonly<Record<DateUnit, string>> = { relative: '오늘 기준', day: '일', week: '주', month: '월', year: '년' }

/** 상대 단위의 키 — 날짜 순서다(그룹 순서도 이것). */
export const RELATIVE_KEYS = ['earlier', 'last_30', 'last_7', 'yesterday', 'today', 'tomorrow', 'next_7', 'next_30', 'later'] as const
export type RelativeKey = (typeof RELATIVE_KEYS)[number]

export const RELATIVE_LABEL: Readonly<Record<RelativeKey, string>> = {
  earlier: '그 전',
  last_30: '지난 30일',
  last_7: '지난 7일',
  yesterday: '어제',
  today: '오늘',
  tomorrow: '내일',
  next_7: '앞으로 7일',
  next_30: '앞으로 30일',
  later: '그 뒤',
}

/** 하루짜리 상대 키 — 오늘에서 며칠. 이 덩이로만 옮기거나 새로 만들 수 있다(범위 덩이는 어느 날인지 정할 수 없다). */
const RELATIVE_DAY: Readonly<Partial<Record<RelativeKey, number>>> = { yesterday: -1, today: 0, tomorrow: 1 }

export function isRelativeKey(v: unknown): v is RelativeKey {
  return typeof v === 'string' && (RELATIVE_KEYS as readonly string[]).includes(v)
}

export function isDateUnit(v: unknown): v is DateUnit {
  return typeof v === 'string' && (DATE_UNITS as readonly string[]).includes(v)
}

type Ymd = { readonly y: number; readonly m: number; readonly d: number }

const DAY_MS = 86_400_000

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** 글자의 앞 열 자를 달력 날짜로 — 달력에 없는 날이면 null. */
function ymdOf(s: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (match === null) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')
const format = ({ y, m, d }: Ymd): string => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
const toDays = ({ y, m, d }: Ymd): number => Date.UTC(y, m - 1, d) / DAY_MS
function fromDays(days: number): Ymd {
  const t = new Date(days * DAY_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
/** 달을 민다 — 그 날이 없으면 그 달의 끝 날로. */
function addMonths({ y, m, d }: Ymd, months: number): Ymd {
  const index = y * 12 + (m - 1) + months
  const ny = Math.floor(index / 12)
  const nm = index - ny * 12 + 1
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) }
}

function startOf(date: Ymd, unit: Exclude<DateUnit, 'relative'>): Ymd {
  switch (unit) {
    case 'day':
      return date
    case 'week': {
      // 월요일 = 0
      const days = toDays(date)
      const fromMonday = (new Date(days * DAY_MS).getUTCDay() + 6) % 7
      return fromDays(days - fromMonday)
    }
    case 'month':
      return { y: date.y, m: date.m, d: 1 }
    case 'year':
      return { y: date.y, m: 1, d: 1 }
  }
}

/**
 * 그 날짜(값의 `start` 글자 — 앞 열 자만 본다)가 드는 버킷의 키. 날짜가 아니면 null. 상대 단위는 오늘(`today` — `YYYY-MM-DD`)이 있어야
 * 한다(없으면 null).
 */
export function bucketOf(start: string, unit: DateUnit, today?: string): string | null {
  if (unit === 'relative') return today === undefined ? null : relativeOf(start, today)
  const date = ymdOf(start)
  return date === null ? null : format(startOf(date, unit))
}

/** 오늘에서 며칠 떨어졌나로 — 상대 키. 날짜가 아니면 null. */
export function relativeOf(start: string, today: string): RelativeKey | null {
  const date = ymdOf(start)
  const base = ymdOf(today)
  if (date === null || base === null) return null
  const n = toDays(date) - toDays(base)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n >= 2 && n <= 7) return 'next_7'
  if (n <= -2 && n >= -7) return 'last_7'
  if (n >= 8 && n <= 30) return 'next_30'
  if (n <= -8 && n >= -30) return 'last_30'
  return n > 30 ? 'later' : 'earlier'
}

/** 하루짜리 상대 키(어제 · 오늘 · 내일)의 그 날 — 범위 키 · 모르는 키면 null. */
export function relativeDayOf(key: string, today: string): string | null {
  const base = ymdOf(today)
  const offset = isRelativeKey(key) ? RELATIVE_DAY[key] : undefined
  return base === null || offset === undefined ? null : format(fromDays(toDays(base) + offset))
}

/** 그 시간대의 오늘(`YYYY-MM-DD`). 시간대가 틀리면 UTC 의 오늘. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const read = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  try {
    return read(timeZone)
  } catch {
    return read('UTC')
  }
}

/**
 * 그 단위의 버킷 키인가 — 달력에 있는 날이고 버킷의 첫 날이다 · 상대 단위면 상대 키(`''` 는 아니다 — 값 없음은 부르는 쪽이 따로 본다).
 */
export function isBucketKey(key: string, unit: DateUnit): boolean {
  if (unit === 'relative') return isRelativeKey(key)
  return key.length === 10 && bucketOf(key, unit) === key
}

/**
 * 버킷 `from` 의 값을 버킷 `to` 로 민다 — 일 · 주는 날수, 월 · 년은 달수만큼. 시각 · 시간대 · 끝 날짜를 지킨다(끝도 같은 만큼). 둘 다
 * 그 단위의 버킷 키여야 한다(아니면 그대로 돌려준다).
 */
export function shiftDateValue(value: DateValue, from: string, to: string, unit: Exclude<DateUnit, 'relative'>): DateValue {
  const a = ymdOf(from)
  const b = ymdOf(to)
  if (a === null || b === null) return value
  const shift = (s: string): string => {
    const date = ymdOf(s)
    if (date === null) return s
    const moved = unit === 'day' || unit === 'week' ? fromDays(toDays(date) + (toDays(b) - toDays(a))) : addMonths(date, (b.y - a.y) * 12 + (b.m - a.m))
    return format(moved) + s.slice(10)
  }
  return {
    ...value,
    start: shift(value.start),
    ...(value.end !== undefined && value.end !== null ? { end: shift(value.end) } : {}),
  }
}

/** 그룹 머리의 이름 — 2026년 10월 · 2026년 · 2026년 10월 5일 · 2026년 10월 5일 주 · 상대 단위는 오늘 · 지난 7일 …. 모르는 키면 그대로. */
export function dateGroupLabel(key: string, unit: DateUnit): string {
  if (unit === 'relative') return isRelativeKey(key) ? RELATIVE_LABEL[key] : key
  const date = ymdOf(key)
  if (date === null) return key
  switch (unit) {
    case 'year':
      return `${date.y}년`
    case 'month':
      return `${date.y}년 ${date.m}월`
    case 'day':
      return `${date.y}년 ${date.m}월 ${date.d}일`
    case 'week':
      return `${date.y}년 ${date.m}월 ${date.d}일 주`
  }
}
