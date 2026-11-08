/**
 * 타임라인 좌표 (TL-2 · F-04-07 · DB 도 DOM 도 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 TL-2] ② ③
 *
 * 날짜는 `YYYY-MM-DD` 글자이고 셈은 UTC 로 한다(날짜 글자에는 시간대가 없다 — 캘린더의 `addDays` · `daysBetween` 을 그대로 쓴다).
 * 하루의 폭은 줌마다 고정이고, 창(서버에 묻는 기간)은 줌마다 한 화면 남짓이다. 모든 창은 서버 상한(`MAX_TIMELINE_SPAN_DAYS`) 안이다.
 */

import { addDays, daysBetween, resizeDateValue, shiftDateValue, weekStartOf } from './calendar.ts'
import { MAX_TIMELINE_SPAN_DAYS, type TimelineZoom } from './timeline.ts'

/** 하루의 폭(px) — day 넓음 → year 좁음. */
export const DAY_PX: Readonly<Record<TimelineZoom, number>> = { day: 36, week: 14, month: 5, quarter: 2, year: 1 }

/** 한 창의 길이(일) — 한 화면 남짓. 어느 줌도 상한(732) 이하다. */
export const WINDOW_DAYS: Readonly<Record<TimelineZoom, number>> = {
  day: 42,
  week: 112,
  month: 365,
  quarter: 640,
  year: MAX_TIMELINE_SPAN_DAYS,
}

/** 창의 시작을 오늘보다 앞에 두는 일수 — 오늘이 왼쪽 가까이에 서고 앞날이 넓게 보인다. */
const LEAD_DAYS: Readonly<Record<TimelineZoom, number>> = { day: 7, week: 28, month: 90, quarter: 160, year: 180 }

export type TimelineWindow = { readonly from: string; readonly to: string }

/** 창의 끝(포함) — 시작에서 창의 길이만큼. */
export const windowEnd = (from: string, zoom: TimelineZoom): string => addDays(from, WINDOW_DAYS[zoom] - 1)

/** 오늘 근처에서 시작하는 창. */
export function windowForToday(today: string, zoom: TimelineZoom): TimelineWindow {
  const from = addDays(today, -LEAD_DAYS[zoom])
  return { from, to: windowEnd(from, zoom) }
}

/** 같은 시작을 줌의 길이로 다시 편 창(줌을 바꿀 때). */
export function windowFrom(from: string, zoom: TimelineZoom): TimelineWindow {
  return { from, to: windowEnd(from, zoom) }
}

/** 한 화면(창의 길이)만큼 옮긴 창. `direction` 은 -1(이전) · 1(다음). */
export function shiftWindow(win: TimelineWindow, zoom: TimelineZoom, direction: -1 | 1): TimelineWindow {
  const from = addDays(win.from, direction * WINDOW_DAYS[zoom])
  return { from, to: windowEnd(from, zoom) }
}

/** 창이 그리는 일수(양끝 포함). */
export const windowDays = (win: TimelineWindow): number => daysBetween(win.from, win.to) + 1

/** 창 전체의 폭(px). */
export const windowWidth = (win: TimelineWindow, zoom: TimelineZoom): number => windowDays(win) * DAY_PX[zoom]

export type BarPlacement = { readonly left: number; readonly width: number; readonly clippedStart: boolean; readonly clippedEnd: boolean }

/**
 * 막대의 자리 — 시작일의 왼쪽 끝부터 끝일(포함)의 오른쪽 끝까지. 창 밖으로 걸치면 잘라 그린다. 창과 겹치지 않으면 null.
 * 하루짜리(시작 = 끝)는 하루 폭이다.
 */
export function placeBar(start: string, end: string, win: TimelineWindow, zoom: TimelineZoom): BarPlacement | null {
  const last = end < start ? start : end
  if (last < win.from || start > win.to) return null
  const s = start < win.from ? win.from : start
  const e = last > win.to ? win.to : last
  const px = DAY_PX[zoom]
  return {
    left: daysBetween(win.from, s) * px,
    width: (daysBetween(s, e) + 1) * px,
    clippedStart: start < win.from,
    clippedEnd: last > win.to,
  }
}

/** 오늘 세로선의 x(그날 칸의 가운데) — 창 밖이면 null. */
export function todayX(today: string, win: TimelineWindow, zoom: TimelineZoom): number | null {
  if (today < win.from || today > win.to) return null
  return daysBetween(win.from, today) * DAY_PX[zoom] + DAY_PX[zoom] / 2
}

export type Tick = { readonly key: string; readonly label: string; readonly left: number; readonly width: number }

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const parts = (ymd: string) => ({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) })
const ymd = (y: number, m: number): string => `${y}-${String(m).padStart(2, '0')}-01`

/** 눈금 하나의 첫 날(`day`)에서 다음 눈금의 첫 날을 낸다. */
function nextStart(day: string, zoom: TimelineZoom): string {
  const { y, m } = parts(day)
  if (zoom === 'day') return addDays(day, 1)
  if (zoom === 'week') return addDays(day, 7)
  if (zoom === 'month') return m === 12 ? ymd(y + 1, 1) : ymd(y, m + 1)
  if (zoom === 'quarter') {
    const next = Math.floor((m - 1) / 3) * 3 + 4
    return next > 12 ? ymd(y + 1, 1) : ymd(y, next)
  }
  return ymd(y + 1, 1)
}

/** 창을 품는 첫 눈금의 첫 날 — 창의 시작보다 앞일 수 있다(그 눈금은 잘라 그린다). */
function firstStart(from: string, zoom: TimelineZoom): string {
  const { y, m } = parts(from)
  if (zoom === 'day') return from
  if (zoom === 'week') return weekStartOf(from, 'sunday')
  if (zoom === 'month') return ymd(y, m)
  if (zoom === 'quarter') return ymd(y, Math.floor((m - 1) / 3) * 3 + 1)
  return ymd(y, 1)
}

function labelOf(day: string, zoom: TimelineZoom): string {
  const { y, m, d } = parts(day)
  if (zoom === 'day') return `${m}/${d} ${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]}`
  if (zoom === 'week') return `${m}/${d}`
  if (zoom === 'month') return `${y}년 ${m}월`
  if (zoom === 'quarter') return `${y} ${Math.floor((m - 1) / 3) + 1}분기`
  return `${y}년`
}

/** 머리의 눈금 — 줌에 맞게 날 · 주(일요일 시작) · 달 · 분기 · 해. 창 밖으로 걸친 눈금은 잘라 그린다(좌우가 창 안). */
export function headerTicks(win: TimelineWindow, zoom: TimelineZoom): Tick[] {
  const px = DAY_PX[zoom]
  const ticks: Tick[] = []
  let start = firstStart(win.from, zoom)
  while (start <= win.to) {
    const next = nextStart(start, zoom)
    const s = start < win.from ? win.from : start
    const lastDay = addDays(next, -1)
    const e = lastDay > win.to ? win.to : lastDay
    ticks.push({ key: start, label: labelOf(start, zoom), left: daysBetween(win.from, s) * px, width: (daysBetween(s, e) + 1) * px })
    start = next
  }
  return ticks
}

/** 끌어 움직인 가로 거리(px)를 온전한 날수로 — 줌이 넓어도 하루의 폭으로 반올림한다(TL-3 ①). */
export const dayDeltaFromPx = (dx: number, zoom: TimelineZoom): number => {
  const d = Math.round(dx / DAY_PX[zoom])
  return d === 0 ? 0 : d
}

/** 시간축 안의 x(창 왼쪽 끝 기준 px)가 가리키는 날 — 창 밖이면 null(TL-3 ③ 날짜 없는 행 놓기). */
export function dayAtX(x: number, win: TimelineWindow, zoom: TimelineZoom): string | null {
  if (x < 0) return null
  const day = addDays(win.from, Math.floor(x / DAY_PX[zoom]))
  return day > win.to ? null : day
}

export type DragMode = 'move' | 'start' | 'end'
type DateParts = { readonly start: string; readonly end?: string | null }

/**
 * 끌기(또는 키)로 바뀐 날짜 값 — `move` 는 둘 다 `days` 만큼, `start` · `end` 는 그 쪽만(끝은 시작 앞으로, 시작은 끝 뒤로 가지 않고 같아지면 끝을
 * 지운다). 하루짜리의 오른쪽 끝을 늘이면 기간이 된다. 바뀌지 않으면 null(TL-3 ① ②).
 */
export function dragDate(date: DateParts, mode: DragMode, days: number): { start: string; end?: string } | null {
  if (days === 0) return null
  if (mode === 'move') return shiftDateValue(date, days)
  const startDay = date.start.slice(0, 10)
  const endDay = typeof date.end === 'string' ? date.end.slice(0, 10) : startDay
  return resizeDateValue(date, mode, addDays(mode === 'start' ? startDay : endDay, days))
}

export type ArrowEnd = { readonly place: BarPlacement; readonly lane: number }
export type Point = { readonly x: number; readonly y: number }
export type ArrowLayout = { readonly rowPx: number; readonly headPx: number; readonly gap: number }

/** 화살촉의 길이 · 반폭(px) — 마지막 구간(`gap`)이 이보다 길어야 촉이 선 위에 선다. */
export const ARROW_HEAD_LEN = 6
export const ARROW_HEAD_HALF = 4

/**
 * 종속 관계 화살표의 꺾은선(TL-4 ③) — 막는 행 막대의 오른쪽 끝에서 막힌 행 막대의 왼쪽 끝으로. 막대의 세로 가운데를 잇는다(`lane` = 줄 번호).
 * 도착점이 출발점보다 충분히 오른쪽이면 세로 한 번(┐└), 아니면(겹침 · 거꾸로) 줄 사이로 돌아 들어간다. 마지막 구간은 늘 오른쪽을 향한다.
 */
export function arrowPoints(from: ArrowEnd, to: ArrowEnd, layout: ArrowLayout): Point[] {
  const { rowPx, headPx, gap } = layout
  const sx = from.place.left + Math.max(from.place.width, 3)
  const ex = to.place.left
  const sy = headPx + from.lane * rowPx + rowPx / 2
  const ey = headPx + to.lane * rowPx + rowPx / 2
  if (ex - sx >= gap * 2) {
    return sy === ey
      ? [{ x: sx, y: sy }, { x: ex, y: ey }]
      : [{ x: sx, y: sy }, { x: sx + gap, y: sy }, { x: sx + gap, y: ey }, { x: ex, y: ey }]
  }
  const ym = ey >= sy ? sy + rowPx / 2 : sy - rowPx / 2
  return [{ x: sx, y: sy }, { x: sx + gap, y: sy }, { x: sx + gap, y: ym }, { x: ex - gap, y: ym }, { x: ex - gap, y: ey }, { x: ex, y: ey }]
}

/** SVG `points`/`d` 로 쓰는 글자 — `M x y L x y …`. */
export const pathOf = (points: readonly Point[]): string => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')

/** 도착점(막힌 막대의 왼쪽 끝)에 오른쪽을 가리키는 삼각형의 `points`. */
export const arrowHeadPoints = (tip: Point): string =>
  `${tip.x},${tip.y} ${tip.x - ARROW_HEAD_LEN},${tip.y - ARROW_HEAD_HALF} ${tip.x - ARROW_HEAD_LEN},${tip.y + ARROW_HEAD_HALF}`

/** 겹침 — 막는 행이 막힌 행의 시작보다 늦게 끝난다(일정이 어긋났다). 날짜는 `YYYY-MM-DD`. */
export const dependencyOverlaps = (blockerEnd: string, blockedStart: string): boolean => blockerEnd.slice(0, 10) > blockedStart.slice(0, 10)
