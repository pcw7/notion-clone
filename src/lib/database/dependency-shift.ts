/**
 * 종속 관계의 날짜 자동 이동 — 계획 (40번 트랙 TL-5 · F-04-07, DB 를 모르는 순수 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 TL-5] ③④
 *
 * 막는 행의 날짜를 바꿨을 때 막힌 행들이 어디로 가야 하는지만 계산한다. 읽기 · 쓰기 · 권한은 부르는 쪽(`row.ts`)이 한다.
 *
 *   overlap_only   막힌 행의 시작이 막는 행의 끝(E) 이하일 때만 시작이 E+1일이 되게 기간 그대로 민다(당겨오지 않는다)
 *   maintain_gap   막힌 행을 E − E₀ 일만큼 기간 그대로 옮긴다(앞 · 뒤 모두)
 *   전파           옮겨진 행이 막는 행들에도 같은 규칙. 값이 빈 행은 건드리지 않고 거기서 멈춘다
 *   상한           옮길 행이 200 을 넘으면 거부(`shift_too_large`)
 */

import { addDays, daysBetween, shiftDateValue } from './calendar.ts'
import type { DateValue } from './property-types.ts'

export const DEPENDENCY_SHIFT_MODES = ['overlap_only', 'maintain_gap', 'never'] as const
export type DependencyShiftMode = (typeof DEPENDENCY_SHIFT_MODES)[number]

/** 한 번에 옮길 수 있는 행 수(정본 [보강 TL-5] ④). */
export const MAX_SHIFTED_ROWS = 200

export function isShiftMode(v: unknown): v is DependencyShiftMode {
  return typeof v === 'string' && (DEPENDENCY_SHIFT_MODES as readonly string[]).includes(v)
}

/** 간선 하나 — `blocker` 가 `blocked` 를 막는다. */
export type ShiftEdge = { readonly blocker: string; readonly blocked: string }

export type ShiftPlan =
  | { readonly ok: true; readonly moves: ReadonlyMap<string, DateValue> }
  | { readonly ok: false; readonly reason: 'shift_too_large' }

export type ShiftInput = {
  readonly rowId: string
  /** 바뀌기 전 · 후의 값. 비어 있으면 null. */
  readonly oldValue: DateValue | null
  readonly newValue: DateValue | null
  readonly mode: DependencyShiftMode | null
  readonly edges: readonly ShiftEdge[]
  /** 간선에 닿는 행들의 지금 값(바뀐 행은 쓸 필요 없다). 없거나 null 이면 빈 값이다. */
  readonly values: ReadonlyMap<string, DateValue | null>
  /** 주말 피하기(TL-6) — 자동으로 옮긴 행의 시작 · 끝이 토 · 일이면 다음 월요일로. 사람이 직접 고친 행에는 걸지 않는다. */
  readonly avoidWeekends?: boolean
}

/** 날짜 부분(YYYY-MM-DD)이 토 · 일이면 다음 월요일까지의 날수(아니면 0). UTC 로 센다 — 날짜 값이 이미 그 사람의 날이다. */
function daysToMonday(ymd: string): number {
  const dow = new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay()
  return dow === 6 ? 2 : dow === 0 ? 1 : 0
}

/** 정본 [보강 TL-6] ② — 시작이 주말이면 기간 그대로 월요일로, 그 뒤 끝이 주말이면 끝만 월요일로. */
function avoidWeekend(v: DateValue): DateValue {
  let out = v
  const push = daysToMonday(dayOf(out.start))
  if (push > 0) out = shifted(out, push)
  if (typeof out.end === 'string' && out.end.length > 0) {
    const extend = daysToMonday(dayOf(out.end))
    if (extend > 0) out = { ...out, end: `${addDays(dayOf(out.end), extend)}${out.end.slice(10)}` }
  }
  return out
}

const dayOf = (s: string): string => s.slice(0, 10)
/** 끝 날(없으면 시작 날). */
const endDayOf = (v: DateValue): string => dayOf(typeof v.end === 'string' && v.end.length > 0 ? v.end : v.start)

function shifted(v: DateValue, days: number): DateValue {
  const moved = shiftDateValue(v, days)
  return { ...moved, ...(v.time_zone !== undefined ? { time_zone: v.time_zone } : {}) }
}

export function planShift(input: ShiftInput): ShiftPlan {
  const none: ShiftPlan = { ok: true, moves: new Map() }
  const { mode, newValue, oldValue } = input
  const fix = (v: DateValue): DateValue => (input.avoidWeekends === true ? avoidWeekend(v) : v)
  if (mode === null || mode === 'never' || newValue === null) return none

  const blockedBy = new Map<string, string[]>()
  for (const e of input.edges) {
    const list = blockedBy.get(e.blocker)
    if (list === undefined) blockedBy.set(e.blocker, [e.blocked])
    else list.push(e.blocked)
  }

  const moves = new Map<string, DateValue>()
  const current = (id: string): DateValue | null => moves.get(id) ?? input.values.get(id) ?? null

  if (mode === 'maintain_gap') {
    if (oldValue === null) return none
    const delta = daysBetween(endDayOf(oldValue), endDayOf(newValue))
    if (delta === 0) return none
    const seen = new Set<string>([input.rowId])
    const queue = [input.rowId]
    for (let i = 0; i < queue.length; i++) {
      for (const next of blockedBy.get(queue[i]!) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        const value = input.values.get(next) ?? null
        if (value === null) continue
        moves.set(next, fix(shifted(value, delta)))
        if (moves.size > MAX_SHIFTED_ROWS) return { ok: false, reason: 'shift_too_large' }
        queue.push(next)
      }
    }
    return { ok: true, moves }
  }

  // overlap_only — 앞쪽 제약이 바뀐 행만 다시 본다. 여러 막는 행이 밀면 가장 늦은 끝이 이긴다(민 쪽으로만 가므로 수렴한다).
  const queue: string[] = [input.rowId]
  const endOf = (id: string): string | null => {
    const v = id === input.rowId ? newValue : current(id)
    return v === null ? null : endDayOf(v)
  }
  let guard = 0
  for (let i = 0; i < queue.length; i++) {
    if (++guard > MAX_SHIFTED_ROWS * 25) return { ok: false, reason: 'shift_too_large' }
    const from = queue[i]!
    const end = endOf(from)
    if (end === null) continue
    const floor = addDays(end, 1)
    for (const next of blockedBy.get(from) ?? []) {
      if (next === input.rowId) continue
      const value = current(next)
      if (value === null) continue
      const start = dayOf(value.start)
      if (daysBetween(start, end) < 0) continue // 시작이 E 보다 뒤 — 겹치지 않는다
      moves.set(next, fix(shifted(value, daysBetween(start, floor))))
      if (moves.size > MAX_SHIFTED_ROWS) return { ok: false, reason: 'shift_too_large' }
      queue.push(next)
    }
  }
  return { ok: true, moves }
}
