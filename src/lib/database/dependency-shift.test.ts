/**
 * 종속 관계 날짜 이동 계획 — 순수 계산 (40번 트랙 TL-5 · 정본 §3.5 [보강 TL-5] ③④)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planShift, MAX_SHIFTED_ROWS, type ShiftEdge } from './dependency-shift.ts'
import type { DateValue } from './property-types.ts'

const d = (start: string, end?: string): DateValue => (end === undefined ? { start } : { start, end })
const vals = (o: Record<string, DateValue | null>) => new Map(Object.entries(o))
const edge = (blocker: string, blocked: string): ShiftEdge => ({ blocker, blocked })
const moves = (p: ReturnType<typeof planShift>) => {
  assert.ok(p.ok)
  return Object.fromEntries(p.moves)
}

test('never · null 은 아무것도 옮기지 않는다', () => {
  for (const mode of ['never', null] as const) {
    const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode, edges: [edge('A', 'B')], values: vals({ B: d('2026-01-05') }) })
    assert.deepEqual(moves(p), {})
  }
})

test('overlap_only — 겹치지 않으면 그대로, 겹치면 E+1 로 기간을 지켜 민다', () => {
  const edges = [edge('A', 'B')]
  const clear = planShift({ rowId: 'A', oldValue: d('2026-01-01', '2026-01-03'), newValue: d('2026-01-02', '2026-01-04'), mode: 'overlap_only', edges, values: vals({ B: d('2026-01-10', '2026-01-12') }) })
  assert.deepEqual(moves(clear), {})
  const hit = planShift({ rowId: 'A', oldValue: d('2026-01-01', '2026-01-03'), newValue: d('2026-01-05', '2026-01-11'), mode: 'overlap_only', edges, values: vals({ B: d('2026-01-10', '2026-01-12') }) })
  assert.deepEqual(moves(hit), { B: { start: '2026-01-12', end: '2026-01-14' } })
  // 끝과 같은 날 시작도 겹침이다 · 당겨오지는 않는다
  const same = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode: 'overlap_only', edges, values: vals({ B: d('2026-01-10') }) })
  assert.deepEqual(moves(same), { B: { start: '2026-01-11' } })
  const back = planShift({ rowId: 'A', oldValue: d('2026-01-20'), newValue: d('2026-01-02'), mode: 'overlap_only', edges, values: vals({ B: d('2026-01-21') }) })
  assert.deepEqual(moves(back), {})
})

test('overlap_only — 연쇄는 민 행이 다시 민다', () => {
  const p = planShift({
    rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode: 'overlap_only',
    edges: [edge('A', 'B'), edge('B', 'C')],
    values: vals({ B: d('2026-01-09', '2026-01-12'), C: d('2026-01-13', '2026-01-14') }),
  })
  assert.deepEqual(moves(p), { B: { start: '2026-01-11', end: '2026-01-14' }, C: { start: '2026-01-15', end: '2026-01-16' } })
})

test('overlap_only — 다이아몬드는 가장 늦은 제약 하나로', () => {
  const edges = [edge('A', 'C'), edge('B', 'C'), edge('A', 'B')]
  // A 끝 10 → B 는 11 로 밀려 끝 14 → C(시작 5) 는 15 로. A 가 직접 닿는 제약(11)보다 B 경유가 늦다
  const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode: 'overlap_only', edges, values: vals({ B: d('2026-01-09', '2026-01-12'), C: d('2026-01-05', '2026-01-06') }) })
  assert.deepEqual(moves(p).C, { start: '2026-01-15', end: '2026-01-16' })
  const order = [edge('B', 'C'), edge('A', 'C'), edge('A', 'B')]
  const q = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode: 'overlap_only', edges: order, values: vals({ B: d('2026-01-09', '2026-01-12'), C: d('2026-01-05', '2026-01-06') }) })
  assert.deepEqual(moves(q).C, { start: '2026-01-15', end: '2026-01-16' })
})

test('빈 값의 후행은 건드리지 않고 거기서 멈춘다', () => {
  for (const mode of ['overlap_only', 'maintain_gap'] as const) {
    const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode, edges: [edge('A', 'B'), edge('B', 'C')], values: vals({ B: null, C: d('2026-01-02') }) })
    assert.deepEqual(moves(p), {})
  }
})

test('maintain_gap — 앞뒤 모두 같은 일수, 연쇄도 같이', () => {
  const edges = [edge('A', 'B'), edge('B', 'C')]
  const values = vals({ B: d('2026-02-01', '2026-02-03'), C: d('2026-03-01') })
  const fwd = planShift({ rowId: 'A', oldValue: d('2026-01-01', '2026-01-02'), newValue: d('2026-01-04', '2026-01-05'), mode: 'maintain_gap', edges, values })
  assert.deepEqual(moves(fwd), { B: { start: '2026-02-04', end: '2026-02-06' }, C: { start: '2026-03-04' } })
  const back = planShift({ rowId: 'A', oldValue: d('2026-01-04'), newValue: d('2026-01-01'), mode: 'maintain_gap', edges, values })
  assert.deepEqual(moves(back), { B: { start: '2026-01-29', end: '2026-01-31' }, C: { start: '2026-02-26' } })
  const still = planShift({ rowId: 'A', oldValue: d('2026-01-04'), newValue: d('2026-01-04'), mode: 'maintain_gap', edges, values })
  assert.deepEqual(moves(still), {})
  // 예전 값이 비어 있었으면 기준이 없다
  const fresh = planShift({ rowId: 'A', oldValue: null, newValue: d('2026-01-04'), mode: 'maintain_gap', edges, values })
  assert.deepEqual(moves(fresh), {})
})

test('maintain_gap — 다이아몬드는 한 번만 옮긴다', () => {
  const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-03'), mode: 'maintain_gap', edges: [edge('A', 'B'), edge('A', 'C'), edge('B', 'C')], values: vals({ B: d('2026-02-01'), C: d('2026-02-10') }) })
  assert.deepEqual(moves(p), { B: { start: '2026-02-03' }, C: { start: '2026-02-12' } })
})

test('시각과 시간대는 그대로', () => {
  const b: DateValue = { start: '2026-01-09T09:00:00', end: '2026-01-09T18:30:00', time_zone: 'Asia/Seoul' }
  const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-10'), mode: 'overlap_only', edges: [edge('A', 'B')], values: vals({ B: b }) })
  assert.deepEqual(moves(p), { B: { start: '2026-01-11T09:00:00', end: '2026-01-11T18:30:00', time_zone: 'Asia/Seoul' } })
})

test('바뀐 행이 비면 옮기지 않는다', () => {
  const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: null, mode: 'maintain_gap', edges: [edge('A', 'B')], values: vals({ B: d('2026-01-05') }) })
  assert.deepEqual(moves(p), {})
})

test('200행을 넘으면 shift_too_large', () => {
  const n = MAX_SHIFTED_ROWS + 1
  const edges: ShiftEdge[] = []
  const values = new Map<string, DateValue | null>()
  for (let i = 0; i < n; i++) {
    edges.push(edge(i === 0 ? 'A' : `R${i - 1}`, `R${i}`))
    values.set(`R${i}`, d('2026-01-02'))
  }
  for (const mode of ['overlap_only', 'maintain_gap'] as const) {
    const p = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-05'), mode, edges, values })
    assert.deepEqual(p, { ok: false, reason: 'shift_too_large' })
  }
  // 정확히 200 은 된다
  const ok = planShift({ rowId: 'A', oldValue: d('2026-01-01'), newValue: d('2026-01-05'), mode: 'maintain_gap', edges: edges.slice(0, MAX_SHIFTED_ROWS), values })
  assert.ok(ok.ok && ok.moves.size === MAX_SHIFTED_ROWS)
})

// 주말 피하기(TL-6) — 2026-01-01 은 목요일: 02 금 · 03 토 · 04 일 · 05 월
test('주말 피하기 — 시작이 토요일이면 월요일로, 기간은 그대로', () => {
  const p = planShift({ rowId: 'A', oldValue: d('2025-12-20'), newValue: d('2026-01-01', '2026-01-02'), mode: 'overlap_only', avoidWeekends: true, edges: [edge('A', 'B')], values: vals({ B: d('2026-01-02', '2026-01-03') }) })
  assert.deepEqual(moves(p), { B: { start: '2026-01-05', end: '2026-01-06' } })
})

test('주말 피하기 — 끝이 일요일에 떨어지면 끝만 월요일로 늘린다', () => {
  const p = planShift({ rowId: 'A', oldValue: d('2025-12-20'), newValue: d('2026-01-01'), mode: 'overlap_only', avoidWeekends: true, edges: [edge('A', 'B')], values: vals({ B: d('2026-01-01', '2026-01-03') }) })
  assert.deepEqual(moves(p), { B: { start: '2026-01-02', end: '2026-01-05' } })
})

test('주말 피하기 — 전파는 조정한 끝으로 본다', () => {
  const input = { rowId: 'A', oldValue: d('2025-12-20'), newValue: d('2026-01-01', '2026-01-02'), mode: 'overlap_only', edges: [edge('A', 'B'), edge('B', 'C')], values: vals({ B: d('2026-01-02', '2026-01-03'), C: d('2026-01-06', '2026-01-07') }) } as const
  assert.deepEqual(moves(planShift({ ...input, avoidWeekends: true })), { B: { start: '2026-01-05', end: '2026-01-06' }, C: { start: '2026-01-07', end: '2026-01-08' } })
  // 끄면 이전 동작 그대로 — B 는 토 · 일에 놓이고 C 는 겹치지 않아 안 움직인다
  assert.deepEqual(moves(planShift({ ...input, avoidWeekends: false })), { B: { start: '2026-01-03', end: '2026-01-04' } })
})

test('주말 피하기 — 사람이 직접 고친 행은 조정하지 않는다', () => {
  const p = planShift({ rowId: 'A', oldValue: d('2025-12-20'), newValue: d('2026-01-03'), mode: 'overlap_only', avoidWeekends: true, edges: [edge('A', 'B')], values: vals({ B: d('2026-01-20') }) })
  assert.deepEqual(moves(p), {})
})
