import assert from 'node:assert/strict'
import { test } from 'node:test'

import { daysBetween } from './calendar.ts'
import { MAX_TIMELINE_SPAN_DAYS, TIMELINE_ZOOMS } from './timeline.ts'
import {
  arrowHeadPoints,
  arrowPoints,
  dependencyOverlaps,
  pathOf,
  DAY_PX,
  dayAtX,
  dayDeltaFromPx,
  dragDate,
  headerTicks,
  placeBar,
  shiftWindow,
  todayX,
  windowDays,
  windowForToday,
  windowFrom,
  windowWidth,
  WINDOW_DAYS,
} from './timeline-geometry.ts'

test('줌마다 하루의 폭은 day 가 가장 넓고 year 가 가장 좁다', () => {
  const px = TIMELINE_ZOOMS.map((z) => DAY_PX[z])
  for (let i = 1; i < px.length; i++) assert.ok(px[i]! < px[i - 1]!)
})

test('창은 줌마다 서버 상한(732일) 안이고 오늘을 품는다', () => {
  for (const zoom of TIMELINE_ZOOMS) {
    const win = windowForToday('2026-11-08', zoom)
    assert.equal(windowDays(win), WINDOW_DAYS[zoom])
    assert.ok(daysBetween(win.from, win.to) <= MAX_TIMELINE_SPAN_DAYS)
    assert.ok(win.from < '2026-11-08' && win.to > '2026-11-08')
    assert.equal(windowWidth(win, zoom), WINDOW_DAYS[zoom] * DAY_PX[zoom])
  }
})

test('다음 · 이전은 한 화면씩 옮기고 서로 되돌린다', () => {
  for (const zoom of TIMELINE_ZOOMS) {
    const win = windowForToday('2026-11-08', zoom)
    const next = shiftWindow(win, zoom, 1)
    assert.equal(daysBetween(win.from, next.from), WINDOW_DAYS[zoom])
    assert.ok(daysBetween(next.from, next.to) <= MAX_TIMELINE_SPAN_DAYS)
    assert.deepEqual(shiftWindow(next, zoom, -1), win)
  }
  assert.deepEqual(windowFrom('2026-11-01', 'day'), { from: '2026-11-01', to: '2026-12-12' })
})

test('막대 — 끝일을 포함하고 하루짜리는 하루 폭이다', () => {
  const win = { from: '2026-11-01', to: '2026-11-30' }
  assert.deepEqual(placeBar('2026-11-03', '2026-11-03', win, 'day'), { left: 72, width: 36, clippedStart: false, clippedEnd: false })
  assert.deepEqual(placeBar('2026-11-03', '2026-11-05', win, 'day'), { left: 72, width: 108, clippedStart: false, clippedEnd: false })
})

test('막대 — 창 밖으로 걸치면 자르고 겹치지 않으면 없다', () => {
  const win = { from: '2026-11-01', to: '2026-11-30' }
  assert.deepEqual(placeBar('2026-10-25', '2026-11-02', win, 'day'), { left: 0, width: 72, clippedStart: true, clippedEnd: false })
  assert.deepEqual(placeBar('2026-11-29', '2026-12-10', win, 'day'), { left: 28 * 36, width: 72, clippedStart: false, clippedEnd: true })
  assert.equal(placeBar('2026-10-01', '2026-10-31', win, 'day'), null)
  assert.equal(placeBar('2026-12-01', '2026-12-02', win, 'day'), null)
})

test('오늘 선 — 그날 칸의 가운데 · 창 밖이면 없다', () => {
  const win = { from: '2026-11-01', to: '2026-11-30' }
  assert.equal(todayX('2026-11-01', win, 'day'), 18)
  assert.equal(todayX('2026-11-03', win, 'day'), 72 + 18)
  assert.equal(todayX('2026-12-01', win, 'day'), null)
})

test('눈금 — 줌마다 날 · 주 · 달 · 분기 · 해이고 폭의 합이 창 전체다', () => {
  const win = { from: '2026-11-04', to: '2027-02-10' }
  for (const zoom of TIMELINE_ZOOMS) {
    const ticks = headerTicks(win, zoom)
    assert.equal(
      ticks.reduce((n, t) => n + t.width, 0),
      windowWidth(win, zoom),
    )
    assert.equal(ticks[0]!.left, 0)
  }
  const day = headerTicks({ from: '2026-11-01', to: '2026-11-03' }, 'day')
  assert.deepEqual(
    day.map((t) => t.label),
    ['11/1 일', '11/2 월', '11/3 화'],
  )
  const week = headerTicks(win, 'week')
  assert.equal(week[0]!.label, '11/1') // 일요일로 시작 — 첫 눈금은 잘라 그린다
  assert.equal(week[0]!.width, 4 * DAY_PX.week) // 11/4(수) ~ 11/7(토)
  assert.deepEqual(
    headerTicks(win, 'month').map((t) => t.label),
    ['2026년 11월', '2026년 12월', '2027년 1월', '2027년 2월'],
  )
  assert.deepEqual(
    headerTicks(win, 'quarter').map((t) => t.label),
    ['2026 4분기', '2027 1분기'],
  )
  assert.deepEqual(
    headerTicks(win, 'year').map((t) => t.label),
    ['2026년', '2027년'],
  )
})

test('끌기 거리는 줌의 하루 폭으로 반올림한 날수다', () => {
  assert.equal(dayDeltaFromPx(36 * 3 + 10, 'day'), 3)
  assert.equal(dayDeltaFromPx(-(36 * 2 + 20), 'day'), -3)
  assert.equal(dayDeltaFromPx(17, 'day'), 0)
  assert.equal(dayDeltaFromPx(14 * 5, 'week'), 5)
  assert.equal(dayDeltaFromPx(11, 'month'), 2)
  assert.equal(Object.is(dayDeltaFromPx(-1, 'day'), -0), false)
})

test('x 가 가리키는 날 — 창 안만', () => {
  const win = { from: '2026-11-01', to: '2026-11-10' }
  assert.equal(dayAtX(0, win, 'day'), '2026-11-01')
  assert.equal(dayAtX(36 * 2 + 5, win, 'day'), '2026-11-03')
  assert.equal(dayAtX(36 * 10 - 1, win, 'day'), '2026-11-10')
  assert.equal(dayAtX(36 * 10, win, 'day'), null)
  assert.equal(dayAtX(-1, win, 'day'), null)
})

test('옮기기는 기간 · 시각을 지킨다', () => {
  assert.deepEqual(dragDate({ start: '2026-11-03', end: '2026-11-05' }, 'move', 4), { start: '2026-11-07', end: '2026-11-09' })
  assert.deepEqual(dragDate({ start: '2026-11-03T09:00:00+09:00' }, 'move', -1), { start: '2026-11-02T09:00:00+09:00' })
  assert.equal(dragDate({ start: '2026-11-03' }, 'move', 0), null)
})

test('늘이기 — 하루짜리의 오른쪽 끝은 기간이 되고 끝은 시작 앞으로 가지 않는다', () => {
  assert.deepEqual(dragDate({ start: '2026-11-03' }, 'end', 2), { start: '2026-11-03', end: '2026-11-05' })
  assert.deepEqual(dragDate({ start: '2026-11-03', end: '2026-11-05' }, 'end', -9), { start: '2026-11-03' })
  assert.deepEqual(dragDate({ start: '2026-11-03', end: '2026-11-05' }, 'end', -2), { start: '2026-11-03' })
  assert.equal(dragDate({ start: '2026-11-03' }, 'end', -2), null)
  assert.deepEqual(dragDate({ start: '2026-11-03', end: '2026-11-05' }, 'start', 9), { start: '2026-11-05' })
  assert.deepEqual(dragDate({ start: '2026-11-03', end: '2026-11-05' }, 'start', -2), { start: '2026-11-01', end: '2026-11-05' })
})

test('종속 화살표 — 오른쪽 끝에서 왼쪽 끝으로 · 줄이 다르면 한 번 꺾는다', () => {
  const layout = { rowPx: 32, headPx: 32, gap: 8 }
  const a = { place: { left: 0, width: 50, clippedStart: false, clippedEnd: false }, lane: 0 }
  const b = { place: { left: 100, width: 40, clippedStart: false, clippedEnd: false }, lane: 2 }
  assert.deepEqual(arrowPoints(a, b, layout), [
    { x: 50, y: 48 },
    { x: 58, y: 48 },
    { x: 58, y: 112 },
    { x: 100, y: 112 },
  ])
  // 같은 줄이면 곧은 선
  assert.deepEqual(arrowPoints(a, { ...b, lane: 0 }, layout), [{ x: 50, y: 48 }, { x: 100, y: 48 }])
})

test('종속 화살표 — 겹치면(도착점이 출발점 가까이/왼쪽) 줄 사이로 돌아 들어간다 · 마지막 구간은 오른쪽을 향한다', () => {
  const layout = { rowPx: 32, headPx: 32, gap: 8 }
  const a = { place: { left: 100, width: 50, clippedStart: false, clippedEnd: false }, lane: 0 }
  const b = { place: { left: 120, width: 40, clippedStart: false, clippedEnd: false }, lane: 1 }
  const pts = arrowPoints(a, b, layout)
  assert.deepEqual(pts, [
    { x: 150, y: 48 },
    { x: 158, y: 48 },
    { x: 158, y: 64 },
    { x: 112, y: 64 },
    { x: 112, y: 80 },
    { x: 120, y: 80 },
  ])
  // 위쪽 줄로 가면 위로 돈다
  const up = arrowPoints({ ...a, lane: 1 }, { ...b, lane: 0 }, layout)
  assert.ok(up[2]!.y < up[0]!.y)
  assert.equal(pathOf(pts.slice(0, 2)), 'M150 48 L158 48')
  assert.equal(arrowHeadPoints({ x: 20, y: 10 }), '20,10 14,6 14,14')
})

test('종속 겹침 — 막는 행이 막힌 행의 시작보다 늦게 끝날 때만', () => {
  assert.equal(dependencyOverlaps('2026-11-05', '2026-11-06'), false)
  assert.equal(dependencyOverlaps('2026-11-06', '2026-11-06'), false)
  assert.equal(dependencyOverlaps('2026-11-07', '2026-11-06'), true)
  assert.equal(dependencyOverlaps('2026-11-07T09:00:00+09:00', '2026-11-06'), true)
})
