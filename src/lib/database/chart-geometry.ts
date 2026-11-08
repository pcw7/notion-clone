/**
 * 차트 그림의 계산 — 눈금 · 도넛 호 · 그룹 → 막대/조각 자료 (38번 트랙 CH-2 · F-04-08 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-2] ①~④
 *
 * 화면(`database-chart.tsx`)은 이 모듈이 낸 좌표 · 글자 · 색만 SVG 로 옮긴다. 라이브러리 없이 손으로 그리므로 수학은 여기서 DOM 없이 검사한다.
 */

import { OPTION_DOT_RGB } from './option-dot.ts'
import { groupLabel } from './board-drag.ts'
import { formatCalculation, calculationsFor, type Calculation, type CalculationResult } from './calculations.ts'
import type { DateUnit } from './date-group.ts'
import { isMvpPropertyType, type GroupableType, type OptionColor, type SelectOption, type StatusGroupKind } from './property-types.ts'
import type { TextMode } from './text-group.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 눈금
// ─────────────────────────────────────────────────────────────────────────────

/** v 이상인 가장 작은 1 · 2 · 5 × 10ⁿ. 0 이하는 1. */
export function niceCeil(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1
  const exp = Math.floor(Math.log10(v))
  const base = 10 ** exp
  const f = v / base
  // 부동소수 오차(0.1 * 3 같은 것)로 1.0000000002 가 2 로 올라가지 않게
  const pick = f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 5 + 1e-9 ? 5 : 10
  return Number((pick * base).toPrecision(12))
}

const clean = (n: number): number => Number(n.toPrecision(12))

export type Scale = {
  /** 눈금 아래 끝 · 위 끝(0 을 늘 품는다). */
  readonly min: number
  readonly max: number
  /** 아래에서 위로 — 다섯 칸 안팎. */
  readonly ticks: readonly number[]
}

/**
 * 값들의 눈금. 최댓값을 1 · 2 · 5 × 10ⁿ 로 올려 다섯 칸 안팎(5 · 4 · 2 · 1 칸)으로 나눈다. 개수처럼 정수만 오는 자료(`integer`)는 눈금도 정수가 되게
 * 나눈다(최댓값 1 이면 0 · 1). 음수가 있으면(합계) 0 아래로도 같은 간격으로 늘린다.
 */
export function niceScale(values: readonly number[], integer = false): Scale {
  const finite = values.filter((v) => Number.isFinite(v))
  const maxV = Math.max(0, ...finite)
  const minV = Math.min(0, ...finite)
  const bound = niceCeil(Math.max(maxV, -minV))
  // 간격도 1 · 2 · 5 × 10ⁿ 가 되게 — 2×10ⁿ 은 4칸(0.5 단위), 그 밖은 5칸
  const preferred = Math.round(bound / 10 ** Math.floor(Math.log10(bound))) === 2 ? 4 : 5
  const divisions = [preferred, 2, 1].find((d) => !integer || Number.isInteger(clean(bound / d))) ?? 1
  const step = clean(bound / divisions)
  const lo = minV < 0 ? clean(Math.floor(minV / step) * step) : 0
  const hi = minV < 0 ? (maxV > 0 ? clean(Math.ceil(maxV / step) * step) : 0) : bound
  const ticks: number[] = []
  for (let t = lo; t <= hi + step * 1e-9; t = clean(t + step)) ticks.push(t)
  return { min: lo, max: hi, ticks }
}

/** 값 → 좌표(눈금의 아래 끝이 `from`, 위 끝이 `to`). 범위가 0 이면 `from`. */
export function scaleLinear(scale: Scale, from: number, to: number): (v: number) => number {
  const span = scale.max - scale.min
  return (v) => (span === 0 ? from : from + ((v - scale.min) / span) * (to - from))
}

// ─────────────────────────────────────────────────────────────────────────────
// 도넛
// ─────────────────────────────────────────────────────────────────────────────

export type Slice = {
  /** 입력의 몇 번째 값인가. */
  readonly index: number
  /** 라디안 — 12시 방향에서 시계 방향. */
  readonly start: number
  readonly end: number
  /** 전체에서의 몫(0~1). */
  readonly fraction: number
}

const TAU = Math.PI * 2

/** 양수인 값만 조각이 된다(0 · 음수는 호가 없다). 합이 0 이면 조각이 없다. */
export function donutSlices(values: readonly number[]): Slice[] {
  const total = values.reduce((sum, v) => (v > 0 && Number.isFinite(v) ? sum + v : sum), 0)
  if (total <= 0) return []
  const out: Slice[] = []
  let at = 0
  values.forEach((v, index) => {
    if (!(v > 0) || !Number.isFinite(v)) return
    const fraction = v / total
    out.push({ index, start: at * TAU, end: (at + fraction) * TAU, fraction })
    at += fraction
  })
  return out
}

const point = (cx: number, cy: number, r: number, angle: number): [number, number] => [
  clean(cx + r * Math.sin(angle)),
  clean(cy - r * Math.cos(angle)),
]

/** 고리 한 조각의 경로. 한 바퀴 전체(조각이 하나)는 반원 둘로 그린다(호 하나로는 시작 = 끝이라 그려지지 않는다). */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  if (end - start >= TAU - 1e-6) {
    const [ox, oy] = point(cx, cy, rOuter, 0)
    const [ox2, oy2] = point(cx, cy, rOuter, Math.PI)
    const [ix, iy] = point(cx, cy, rInner, 0)
    const [ix2, iy2] = point(cx, cy, rInner, Math.PI)
    return (
      `M${ox} ${oy}A${rOuter} ${rOuter} 0 1 1 ${ox2} ${oy2}A${rOuter} ${rOuter} 0 1 1 ${ox} ${oy}Z` +
      `M${ix} ${iy}A${rInner} ${rInner} 0 1 0 ${ix2} ${iy2}A${rInner} ${rInner} 0 1 0 ${ix} ${iy}Z`
    )
  }
  const large = end - start > Math.PI ? 1 : 0
  const [x1, y1] = point(cx, cy, rOuter, start)
  const [x2, y2] = point(cx, cy, rOuter, end)
  const [x3, y3] = point(cx, cy, rInner, end)
  const [x4, y4] = point(cx, cy, rInner, start)
  return `M${x1} ${y1}A${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}Z`
}

// ─────────────────────────────────────────────────────────────────────────────
// 색
// ─────────────────────────────────────────────────────────────────────────────

/** 옵션 색 → 면 색 — 태그의 점과 같은 표(`option-dot.ts`). */
export const OPTION_FILL: Readonly<Record<OptionColor, string>> = OPTION_DOT_RGB

/** 막대 · 선이 한 색일 때. */
export const ACCENT_FILL = OPTION_FILL.blue

/** 도넛이 차례로 도는 색 — 옵션 색 이름에서(`default` 는 회색과 구분이 안 되어 뺀다). 파랑부터. */
export const DONUT_CYCLE: readonly OptionColor[] = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'brown', 'gray']

const STATUS_GROUP_COLOR: Readonly<Record<StatusGroupKind, OptionColor>> = { todo: 'gray', in_progress: 'blue', complete: 'green' }

// ─────────────────────────────────────────────────────────────────────────────
// 값 · 이름
// ─────────────────────────────────────────────────────────────────────────────

/** 막대로 그릴 수 없는 계산(날짜 · 기간) — Y값 고르개에 내지 않고, 저장된 것이 이런 계산이면 개수로 그린다. */
export const NON_NUMERIC_CALCULATIONS: readonly Calculation[] = ['earliest_date', 'latest_date', 'date_range']

export function isNumericCalculation(fn: Calculation): boolean {
  return !NON_NUMERIC_CALCULATIONS.includes(fn)
}

/** 이 타입의 칸에서 Y값으로 고를 수 있는 함수. */
export function chartCalculationsFor(type: string): readonly Calculation[] {
  return isMvpPropertyType(type) ? calculationsFor(type).filter(isNumericCalculation) : []
}

/** 속성을 처음 골랐을 때 붙는 함수 — 숫자는 합계, 그 밖은 값 세기. */
export function defaultChartCalculation(type: string): Calculation {
  return type === 'number' ? 'sum' : 'count_values'
}

/** 화면이 읽는 그룹(서버 `GroupSummary` 의 모양 그대로 — JSON 으로 건너온다). */
export type SummaryGroup = {
  readonly key: string
  readonly option: SelectOption | null
  readonly statusGroup: StatusGroupKind | null
  readonly count: number
  readonly hidden: boolean
  readonly value: CalculationResult | null
}

export type SummaryInput = {
  readonly propertyType: GroupableType
  readonly propertyName: string
  readonly calculation: { readonly property_id: string; readonly function: Calculation } | null
  readonly dateUnit: DateUnit | null
  readonly numberSize: number | null
  readonly textMode: TextMode | null
  readonly groups: readonly SummaryGroup[]
  /** 값 하나 차트(CH-4)의 값 — 뷰의 모든 행의 계산. */
  readonly total?: CalculationResult
  /** 값 하나 차트의 이름줄에 쓰는 Y 속성의 이름(개수면 null). */
  readonly calculationName?: string | null
}

export type ChartDatum = {
  readonly key: string
  readonly label: string
  /** 그리는 수. */
  readonly value: number
  /** 값의 글자(머리와 같은 `formatCalculation`). */
  readonly text: string
  /** 선택 · 상태 그룹이면 그 옵션의 색 이름 — 아니면 null. */
  readonly color: OptionColor | null
}

export type ChartData = {
  readonly data: readonly ChartDatum[]
  /** 저장된 Y 계산이 수가 아니라서 개수로 그렸다. */
  readonly yNeedsReselect: boolean
  /** 그릴 행이 하나도 없다. */
  readonly empty: boolean
  /** Y 가 정수만 내는가(개수) — 눈금이 정수로 나뉜다. */
  readonly integer: boolean
}

/** 숨기지 않은 그룹만 · 서버 차례 그대로 → 그릴 자료. */
export function chartData(summary: SummaryInput): ChartData {
  const fn = summary.calculation?.function ?? null
  const useCalc = fn !== null && isNumericCalculation(fn)
  const visible = summary.groups.filter((g) => !g.hidden)
  const data = visible.map((g): ChartDatum => {
    const label = groupLabel(summary.propertyType, summary.propertyName, g, summary)
    const color = g.option !== null ? g.option.color : g.statusGroup !== null ? STATUS_GROUP_COLOR[g.statusGroup] : null
    if (useCalc && g.value !== null) {
      const v = g.value
      const numeric = v.kind === 'date' ? null : v.value
      return { key: g.key, label, value: numeric ?? 0, text: formatCalculation(v), color }
    }
    return { key: g.key, label, value: g.count, text: g.count.toLocaleString('ko-KR'), color }
  })
  return {
    data,
    yNeedsReselect: fn !== null && !useCalc,
    empty: visible.every((g) => g.count === 0),
    integer: !useCalc || fn === 'count_all' || fn === 'count_values' || fn === 'count_empty' || fn === 'count_unique',
  }
}

/**
 * 마크의 색 — 옵션 색이 있으면 그것, 도넛이면 차례로 도는 색, 아니면 한 색. 도넛은 `optionColors`(= `donutUsesOptionColors`)가 거짓이면
 * 옵션 색을 버리고 도는 색으로 — 조각끼리 구분되어야 읽힌다.
 */
export function fillOf(datum: ChartDatum, index: number, cycle: boolean, optionColors = true): string {
  if (datum.color !== null && (!cycle || optionColors)) return OPTION_FILL[datum.color]
  if (cycle) return OPTION_FILL[DONUT_CYCLE[index % DONUT_CYCLE.length]]
  return ACCENT_FILL
}

/**
 * 도넛이 옵션 색을 쓸 수 있는가 — 조각이 모두 옵션 색을 갖고 서로 다를 때만. 겹치면(색을 고르지 않은 옵션 · 같은 색 옵션이 여럿) 조각이
 * 같은 색이라 구분되지 않는다 — 그때는 모두 도는 색(정본 §3.6 [보강 CH-2] ③).
 */
export function donutUsesOptionColors(data: readonly ChartDatum[]): boolean {
  const colors = data.map((d) => d.color)
  return colors.every((c) => c !== null) && new Set(colors).size === colors.length
}

/** 폭에 맞게 줄인 이름(… 으로 끝난다). `max` 는 글자 수. */
export function truncateLabel(label: string, max: number): string {
  const chars = [...label]
  if (chars.length <= max) return label
  return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`
}

export const CHART_KIND_LABEL = { column: '세로 막대', bar: '가로 막대', line: '선', donut: '도넛', number: '숫자' } as const

/** 접근성 한 줄 요약 — `svg role="img"` 의 이름. */
export function chartSummaryLabel(kind: keyof typeof CHART_KIND_LABEL, groupCount: number): string {
  return `${CHART_KIND_LABEL[kind]} · 그룹 ${groupCount}개`
}

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 라벨 · 누적 (CH-3 · 정본 [보강 CH-3])
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 누적을 그릴 수 있는가 — 종류가 도넛이 아니고, Y값이 개수(계산 없음 · `count_all` · `count_values`) 또는 합계(`sum`)이고,
 * 그룹 순서가 내림차순이 아닐 때. 아니면 저장값은 두고 그리지 않는다.
 */
export function cumulativeAllowed(kind: string, calculationFunction: Calculation | null, groupSort: string | null | undefined): boolean {
  if (kind === 'donut' || kind === 'number') return false
  if (groupSort === 'descending') return false
  return calculationFunction === null || calculationFunction === 'count_all' || calculationFunction === 'count_values' || calculationFunction === 'sum'
}

/** 앞 그룹까지의 값을 더해 간다(자료의 차례 그대로 · 숨긴 그룹은 이미 빠져 있다). 글자는 합계 글자와 같은 서식(소수 둘까지 · 쉼표). */
export function accumulate(data: readonly ChartDatum[]): ChartDatum[] {
  let sum = 0
  return data.map((d) => {
    sum = clean(sum + d.value)
    return { ...d, value: sum, text: sum.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) }
  })
}

/** 도넛은 조각이 전체의 이 몫 이상일 때만 조각 안에 값을 적는다. */
export const DONUT_LABEL_MIN_FRACTION = 0.1

export function donutLabelVisible(fraction: number): boolean {
  return fraction >= DONUT_LABEL_MIN_FRACTION - 1e-9
}
