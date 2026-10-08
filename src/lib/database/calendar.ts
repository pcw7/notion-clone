/**
 * 캘린더 레이아웃 · 기간 (DB 심화 2g-1조각 · F-04-06 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 · 04-database-views.md F-04-06
 *
 * 04: *"`view.configuration = { date_property_id, view_range, show_weekends, properties[] }`"* · *"`date_property_id` 필수"*. 저장은
 * `view.configuration.calendar` 한 키다(갤러리와 같은 규칙 — 2f-2 가 정한 것). 그 안은 두 키를 늘 함께 쓴다:
 *
 *   date_property_id  행을 놓을 날짜 속성. 만들 때 첫 날짜 속성을 고른다(없으면 거부 — 보드의 그룹과 같은 태도 · `date_required`)
 *   view_range        'month' | 'week' — 화면의 단위(주 보기는 다음 조각)
 *
 * `show_weekends` 는 아직 없다(§7). 모양은 CHECK(`ck_view_calendar_layout` · 0058)이 막고, 날짜 속성이 살아 있는지 · 날짜 타입인지는
 * 명령이 고를 때 보고, 읽을 때 아니면 **null**(지워진 속성 — 화면이 "날짜 속성을 고르라"를 그린다 · 04 의 "뷰 삭제 금지").
 *
 * ──────────────────────────────────────────────────────────────────────
 * 기간은 날짜 글자(`YYYY-MM-DD`)다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 화면이 보는 기간(한 달의 격자)을 날짜 글자로 묻는다. 칸에 놓는 기준도 **칸 값의 날짜 글자**다(`start` 의 앞 열 자) — 사람이 고른 그
 * 날이다. 시각이 있는 값은 사이드카(`date_start`)가 순간이라 시간대에 따라 UTC 날짜가 하루 어긋날 수 있다 — 서버는 기간 양끝을 하루씩
 * 넓혀 묻고(놓치지 않게), 칸에 놓는 것은 화면이 날짜 글자로 다시 가른다.
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'

export const CALENDAR_RANGES = ['month', 'week'] as const
export type CalendarRange = (typeof CALENDAR_RANGES)[number]

/** 저장 모양. `date_property_id` 는 늘 있다(만들 때 고른다). */
export type CalendarLayout = {
  readonly date_property_id: string
  readonly view_range: CalendarRange
}

/** 읽은 모양 — 날짜 속성이 살아 있지 않으면 null. */
export type LiveCalendarLayout = {
  readonly date_property_id: string | null
  readonly view_range: CalendarRange
}

/** 한 번에 그리는 기간의 상한(일) — 달 격자는 6주(42일)다. 그보다 긴 기간을 묻는 요청은 거부한다(전체 로드 금지 · 04). */
export const MAX_CALENDAR_SPAN_DAYS = 62

/** 한 기간에서 읽는 행의 상한. 넘으면 `truncated` — 화면이 "더 있다"를 말한다(04 *"하루에 카드 수백 개 → 셀당 렌더 상한"*). */
export const MAX_CALENDAR_ROWS = 1000

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** 저장된 `configuration` 에서 캘린더 레이아웃을 읽는다. 없으면 날짜 속성 null · 달. 살아 있는지는 부르는 쪽이 본다. */
export function readCalendarLayout(configuration: unknown): LiveCalendarLayout {
  const c = (configuration as { calendar?: unknown } | null | undefined)?.calendar as Record<string, unknown> | undefined
  if (typeof c !== 'object' || c === null) return { date_property_id: null, view_range: 'month' }
  return {
    date_property_id: typeof c.date_property_id === 'string' ? c.date_property_id : null,
    view_range: isOneOf(CALENDAR_RANGES, c.view_range) ? c.view_range : 'month',
  }
}

/** 바꿀 키만 — 모르는 키 · 값은 거부. 날짜 속성이 이 표의 살아 있는 날짜 속성인지는 명령이 본다(타입 맵이 필요하다). */
export function validateCalendarPatch(raw: unknown, types: ReadonlyMap<string, string>): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [{ path: 'calendar', message: '객체여야 합니다' }]
  const c = raw as Record<string, unknown>
  const keys = Object.keys(c)
  if (keys.length === 0) return [{ path: 'calendar', message: '바꿀 것이 없습니다' }]
  const issues: ValidationIssue[] = []
  for (const key of keys) {
    if (key === 'date_property_id') {
      if (typeof c.date_property_id !== 'string' || types.get(c.date_property_id) !== 'date') {
        issues.push({ path: 'calendar.date_property_id', message: '이 표의 날짜 속성이어야 합니다' })
      }
    } else if (key === 'view_range') {
      if (!isOneOf(CALENDAR_RANGES, c.view_range)) issues.push({ path: 'calendar.view_range', message: `${CALENDAR_RANGES.join(' · ')} 중 하나여야 합니다` })
    } else {
      issues.push({ path: `calendar.${key}`, message: '모르는 키입니다' })
    }
  }
  return issues
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` 인가 — 달력에 있는 날만(2월 30일은 아니다). */
export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = YMD.exec(s)
  if (m === null) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** 두 날짜 글자 사이의 일수(같으면 0). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 기간이 묻을 만한가 — 둘 다 날짜 · 처음 ≤ 끝 · 상한 이내. */
export function isValidSpan(from: unknown, to: unknown): boolean {
  if (!isYmd(from) || !isYmd(to)) return false
  const span = daysBetween(from, to)
  return span >= 0 && span <= MAX_CALENDAR_SPAN_DAYS
}

/** 칸 값의 날짜 글자(`start` · `end` 의 앞 열 자) — 행을 칸에 놓는 기준. 날짜가 없으면 null. */
export function cellDays(value: unknown): { readonly start: string; readonly end: string } | null {
  const date = (value as { date?: { start?: unknown; end?: unknown } } | null | undefined)?.date
  if (typeof date?.start !== 'string') return null
  const start = date.start.slice(0, 10)
  if (!isYmd(start)) return null
  const end = typeof date.end === 'string' && isYmd(date.end.slice(0, 10)) ? date.end.slice(0, 10) : start
  return { start, end: end < start ? start : end }
}

// ── 달 격자 · 막대 배치 (2g-2 · 화면이 쓴다 · DB 없음) ──────────────────

/** 날짜 글자에 일수를 더한다(UTC 로 셈 — 날짜 글자에는 시간대가 없다). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

const YM = /^(\d{4})-(\d{2})$/

/** `YYYY-MM` 인가. */
export function isYm(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = YM.exec(s)
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** 달을 앞뒤로 옮긴다(`2026-01` 에서 -1 이면 `2025-12`). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * 한 달의 격자 — **일요일에 시작하는 6주**(42칸). 노션 · 한국 달력의 기본처럼 주는 일요일에 시작한다(주 시작 요일 설정은 아직 · §7).
 * 늘 6주라 달마다 격자의 높이가 같다.
 */
export function monthGrid(month: string): { readonly from: string; readonly to: string; readonly weeks: readonly (readonly string[])[] } {
  const first = `${month}-01`
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay()
  const from = addDays(first, -weekday)
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(from, w * 7 + d)))
  return { from, to: addDays(from, 41), weeks }
}

export type CalendarEvent = { readonly id: string; readonly start: string; readonly end: string }

export type PlacedEvent = {
  readonly id: string
  /** 그 주에서의 첫 칸(0 = 일요일). */
  readonly col: number
  /** 그 주에서 차지하는 칸 수. */
  readonly span: number
  readonly lane: number
  /** 주 앞에서 이어져 왔다 · 주 뒤로 이어진다 — 막대의 끝을 열어 그린다. */
  readonly continuesBefore: boolean
  readonly continuesAfter: boolean
}

/**
 * 한 주의 막대 배치 — 그 주에 걸친 일정을 주 안으로 자르고, **시작이 이른 것 · 긴 것 · 들어온 순서**로 줄(lane)을 탐욕적으로 잡는다
 * (04 *"multi-day 이벤트 lane packing"*). `maxLanes` 를 넘는 일정은 그리지 않고 그 날짜마다 센다(`hidden` — 칸의 "+N").
 */
export function layoutWeek(
  week: readonly string[],
  events: readonly CalendarEvent[],
  maxLanes: number,
): { readonly placed: readonly PlacedEvent[]; readonly hidden: readonly number[] } {
  const weekStart = week[0]!
  const weekEnd = week[week.length - 1]!
  const inWeek = events
    .map((e, order) => ({ e, order }))
    .filter(({ e }) => e.start <= weekEnd && e.end >= weekStart)
    .map(({ e, order }) => {
      const start = e.start < weekStart ? weekStart : e.start
      const end = e.end > weekEnd ? weekEnd : e.end
      return { e, order, col: daysBetween(weekStart, start), span: daysBetween(start, end) + 1 }
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || a.order - b.order)

  const laneEnds: number[] = [] // 줄마다 마지막으로 찬 칸
  const placed: PlacedEvent[] = []
  const hidden = Array.from({ length: week.length }, () => 0)
  for (const item of inWeek) {
    let lane = laneEnds.findIndex((endCol) => endCol < item.col)
    if (lane === -1) lane = laneEnds.length
    if (lane >= maxLanes) {
      for (let c = item.col; c < item.col + item.span; c += 1) hidden[c]! += 1
      continue
    }
    laneEnds[lane] = item.col + item.span - 1
    placed.push({
      id: item.e.id,
      col: item.col,
      span: item.span,
      lane,
      continuesBefore: item.e.start < weekStart,
      continuesAfter: item.e.end > weekEnd,
    })
  }
  return { placed, hidden }
}

// ── 끌어 옮기기 (2g-3) ──────────────────────────────────────────────────

/**
 * 날짜 값을 며칠 옮긴다 — **날짜 글자만** 바꾸고 나머지(시각 · 시간대)는 그대로 둔다. 범위면 시작과 끝을 같은 만큼 옮겨 **길이를 지킨다**
 * (04 *"드래그 이동 시 range 의 duration 을 유지하며 start/end 를 동시 이동"*). 칸에 놓는 기준이 날짜 글자라(`cellDays`) 옮기는 기준도
 * 같다 — `09:30+09:00` 은 옮겨도 `09:30+09:00` 이다.
 */
export function shiftDateValue(
  date: { readonly start: string; readonly end?: string | null },
  days: number,
): { start: string; end?: string } {
  const shift = (s: string) => `${addDays(s.slice(0, 10), days)}${s.slice(10)}`
  return typeof date.end === 'string' ? { start: shift(date.start), end: shift(date.end) } : { start: shift(date.start) }
}
