/**
 * 공개 화면의 날짜 창 — 캘린더(`?m=`) · 타임라인(`?from=`) (공개 화면의 뷰 PV-2 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ③
 *
 * 창은 주소에서 온다. 틀린 값(모양 · 범위)은 오늘이 든 창이다. 오늘은 서버 시각의 UTC 날짜 — 워크스페이스가 시간대를 저장하지 않는다.
 * 이 파일은 DB 도 React 도 모른다 — 앱의 순수 부품(`calendar.ts` · `timeline-geometry.ts`)만 함께 쓴다.
 */

import {
  addDays,
  eventsOn,
  isYm,
  isYmd,
  monthGrid,
  shiftMonth,
  visibleDays,
  type CalendarEvent,
  type CalendarWeekStart,
} from '../database/calendar.ts'
import { todayIn } from '../database/date-group.ts'
import type { TimelineZoom } from '../database/timeline.ts'
import { windowFrom, windowForToday, type TimelineWindow } from '../database/timeline-geometry.ts'

/** 창 안의 행 상한 — 넘으면 `truncated`(공개 화면은 페이지를 넘기지 않는다). */
export const PUBLIC_WINDOW_MAX_ROWS = 200

/** 주소의 창 값 — 모양은 여기서 보지 않는다(`calendarMonth` · `timelineWindow` 가 본다). */
export type WindowQuery = { readonly m?: string | null; readonly from?: string | null }

/** Next 의 `searchParams` 에서 창 값만 — 배열이면 첫 값. */
export function windowQueryOf(searchParams: Readonly<Record<string, string | string[] | undefined>>): WindowQuery {
  const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
  return { m: first(searchParams.m), from: first(searchParams.from) }
}

/** DB 의 date 가 받는 해 — 이 밖은 오늘의 창으로 돌린다. */
const YEAR_MIN = 1900
const YEAR_MAX = 2999
const yearOk = (ymd: string): boolean => Number(ymd.slice(0, 4)) >= YEAR_MIN && Number(ymd.slice(0, 4)) <= YEAR_MAX

/** 오늘(서버 시각 · UTC). */
export const publicToday = (now: Date = new Date()): string => todayIn('UTC', now)

/** 캘린더의 달(`YYYY-MM`) — 틀리면 오늘이 든 달. */
export function calendarMonth(m: string | null | undefined, today: string): string {
  return isYm(m) && yearOk(`${m}-01`) ? m : today.slice(0, 7)
}

/** 달의 첫 날 · 끝 날. */
export function monthSpan(month: string): { readonly from: string; readonly to: string } {
  return { from: `${month}-01`, to: addDays(`${shiftMonth(month, 1)}-01`, -1) }
}

/** 타임라인의 창 — `from` 이 맞으면 그 시작을 뷰의 줌으로 편 창 · 아니면 오늘 근처에서 시작하는 창. */
export function timelineWindow(from: string | null | undefined, zoom: TimelineZoom, today: string): TimelineWindow {
  return isYmd(from) && yearOk(from) ? windowFrom(from, zoom) : windowForToday(today, zoom)
}

/** 달 격자의 칸 하나 — 그 달 밖의 날은 `inMonth` 가 false 이고 일정을 싣지 않는다. */
export type DayCell = { readonly date: string; readonly inMonth: boolean; readonly ids: readonly string[] }

/**
 * 달 격자 — 주 단위 · 주말을 숨기면 토 · 일 칸을 뺀다. 여러 날에 걸친 일정은 걸친 날마다 든다(그 달 안에서만).
 * 일정의 차례는 들어온 차례(서버의 날짜순) 그대로다.
 */
export function monthCells(month: string, weekStart: CalendarWeekStart, showWeekends: boolean, events: readonly CalendarEvent[]): DayCell[][] {
  return monthGrid(month, weekStart).weeks.map((week) =>
    visibleDays(week, showWeekends).map((date) => {
      const inMonth = date.startsWith(month)
      return { date, inMonth, ids: inMonth ? eventsOn(date, events).map((e) => e.id) : [] }
    }),
  )
}

/** 일정이 창과 겹치나 — 양끝 포함(SQL 은 하루씩 넓혀 묻고 여기서 칸의 날짜 글자로 다시 가른다). */
export const overlapsWindow = (start: string, end: string, win: { readonly from: string; readonly to: string }): boolean =>
  start <= win.to && (end < start ? start : end) >= win.from
