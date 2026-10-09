/**
 * 수식 — 값과 타입 (DB 심화 2i-1조각 · F-03-12 · DB 를 모르는 모듈)
 *
 * 1단계(최소 언어)의 타입은 넷이다 — 수 · 글 · 참거짓 · 날짜. 03 의 `Person` · `Page` · `List<T>` 는 3단계(목록 · relation 순회)다.
 * 값이 없으면 `null` 이다 — **빈 값은 0 도 빈 글도 아니다**(03 *"빈 프로퍼티 — 숫자 연산에서는 0 이 아니라 null 전파를 권고"*).
 *
 * 날짜는 칸 값과 같은 모양 `{ start, end? }` 의 **글자**다(ISO — `YYYY-MM-DD` 또는 시각까지). 날짜의 해 · 달 · 날 · 시 · 분은 **글자에서**
 * 읽는다 — 사람이 고른 그 날 · 그 시각이다(캘린더의 `cellDays` 와 같은 축 · 시간대로 다시 계산하지 않는다).
 */

export type FormulaType = 'number' | 'text' | 'boolean' | 'date'

export const FORMULA_TYPES: readonly FormulaType[] = ['number', 'text', 'boolean', 'date']

export const TYPE_LABEL: Readonly<Record<FormulaType, string>> = { number: '수', text: '글', boolean: '참거짓', date: '날짜' }

export type DateValue = { readonly start: string; readonly end?: string }

export type FormulaValue =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'date'; readonly value: DateValue }
  | null

export const num = (value: number): FormulaValue => (Number.isFinite(value) ? { type: 'number', value } : null)
export const text = (value: string): FormulaValue => ({ type: 'text', value })
export const bool = (value: boolean): FormulaValue => ({ type: 'boolean', value })
export const date = (value: DateValue): FormulaValue => ({ type: 'date', value })

/** 글 결과의 상한(자) — `repeat` 같은 것이 끝없이 늘리지 않게. 넘으면 자른다. */
export const MAX_TEXT_LENGTH = 10_000

// ── 날짜 ──────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

export type DateParts = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** 시각이 없는 날짜인가. */
  readonly dateOnly: boolean
}

/** 날짜 글자를 쪼갠다 — 글자에 적힌 그대로(시간대로 옮기지 않는다). 날짜가 아니면 null. */
export function dateParts(s: string): DateParts | null {
  const d = DATE_ONLY.exec(s)
  if (d) return { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: 0, minute: 0, dateOnly: true }
  const t = DATE_TIME.exec(s)
  if (t) return { year: Number(t[1]), month: Number(t[2]), day: Number(t[3]), hour: Number(t[4]), minute: Number(t[5]), dateOnly: false }
  return null
}

/** 날짜 글자의 순간(ms). 날짜만 있으면 그날 UTC 0시. */
export function dateMillis(s: string): number | null {
  const ms = Date.parse(DATE_ONLY.test(s) ? `${s}T00:00:00Z` : s)
  return Number.isNaN(ms) ? null : ms
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 해 · 달 · 날(필요하면 시 · 분)로 날짜 글자를 만든다. 날 넘침은 `Date.UTC` 가 접는다(1월 32일 → 2월 1일). */
export function ymd(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const DATE_UNITS = ['years', 'quarters', 'months', 'weeks', 'days', 'hours', 'minutes'] as const
export type DateUnit = (typeof DATE_UNITS)[number]

/**
 * 날짜 글자를 단위만큼 옮긴다. 날짜만 있는 값을 일 · 주 · 달 · 해로 옮기면 날짜만 남는다. 시 · 분으로 옮기거나 시각이 있는 값은 UTC 순간으로
 * 옮겨 `Z` 로 적는다. 달 · 해는 달력으로 옮긴다(1월 31일 + 1달 = 2월 마지막 날).
 */
export function shiftDate(s: string, amount: number, unit: DateUnit): string | null {
  const p = dateParts(s)
  if (p === null || !Number.isFinite(amount)) return null
  const whole = Math.trunc(amount)
  if (unit === 'years' || unit === 'quarters' || unit === 'months') {
    const months = unit === 'years' ? whole * 12 : unit === 'quarters' ? whole * 3 : whole
    const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1))
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    const day = Math.min(p.day, last)
    if (p.dateOnly) return ymd(target.getUTCFullYear(), target.getUTCMonth() + 1, day)
    const ms = dateMillis(s)
    if (ms === null) return null
    const dayShift = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day) - Date.UTC(p.year, p.month - 1, p.day)
    return new Date(ms + dayShift).toISOString()
  }
  const msPer = unit === 'weeks' ? 7 * 86_400_000 : unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000
  if (p.dateOnly && (unit === 'weeks' || unit === 'days')) {
    return ymd(p.year, p.month, p.day + whole * (unit === 'weeks' ? 7 : 1))
  }
  const ms = dateMillis(s)
  return ms === null ? null : new Date(ms + whole * msPer).toISOString()
}

/** 두 날짜 사이(a − b)를 단위로 — 0 쪽으로 자른다. 달 · 해는 달력으로 센다. */
export function dateDiff(a: string, b: string, unit: DateUnit): number | null {
  const pa = dateParts(a)
  const pb = dateParts(b)
  const ma = dateMillis(a)
  const mb = dateMillis(b)
  if (pa === null || pb === null || ma === null || mb === null) return null
  if (unit === 'years' || unit === 'quarters' || unit === 'months') {
    let months = (pa.year - pb.year) * 12 + (pa.month - pb.month)
    // 아직 그 날에 이르지 않았으면 한 달을 덜 센다(0 쪽으로)
    const restA = ma - Date.UTC(pa.year, pa.month - 1, 1)
    const restB = mb - Date.UTC(pb.year, pb.month - 1, 1)
    if (months > 0 && restA < restB) months -= 1
    if (months < 0 && restA > restB) months += 1
    return unit === 'years' ? Math.trunc(months / 12) : unit === 'quarters' ? Math.trunc(months / 3) : months
  }
  const msPer = unit === 'weeks' ? 7 * 86_400_000 : unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000
  return Math.trunc((ma - mb) / msPer)
}

/** 값을 글로 — `format()` · 글 잇기의 규칙. 빈 값은 빈 글이다. */
export function formatValue(v: FormulaValue): string {
  if (v === null) return ''
  switch (v.type) {
    case 'number':
      return String(v.value)
    case 'text':
      return v.value
    case 'boolean':
      return v.value ? 'true' : 'false'
    case 'date':
      return v.value.end ? `${v.value.start} → ${v.value.end}` : v.value.start
  }
}

/** 같은가 — 같은 타입끼리. 빈 값은 빈 값과만 같다. 날짜는 시작과 끝의 글자로. */
export function sameValue(a: FormulaValue, b: FormulaValue): boolean {
  if (a === null || b === null) return a === b
  if (a.type !== b.type) return false
  if (a.type === 'date' && b.type === 'date') return a.value.start === b.value.start && (a.value.end ?? null) === (b.value.end ?? null)
  return a.value === b.value
}

/** 크기 비교(수 · 글 · 날짜) — 비교할 수 없으면 null. */
export function compareValues(a: FormulaValue, b: FormulaValue): number | null {
  if (a === null || b === null || a.type !== b.type) return null
  if (a.type === 'number' && b.type === 'number') return a.value - b.value
  if (a.type === 'text' && b.type === 'text') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  if (a.type === 'date' && b.type === 'date') {
    const x = dateMillis(a.value.start)
    const y = dateMillis(b.value.start)
    return x === null || y === null ? null : x - y
  }
  return null
}

/** 참으로 읽는가 — 빈 값은 거짓이다(조건 자리). */
export const truthy = (v: FormulaValue): boolean => v !== null && v.type === 'boolean' && v.value
