/**
 * 공개 차트의 집계 → 그릴 자료 (공개 화면의 뷰 PV-3 · F-06-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md [보강 PV-1] ④ · [보강 CH-1] ~ [보강 CH-4]
 *
 * 그룹 짓기는 공개 보드와 같다(`public-board.ts` — 옵션 순서 · 값 없음 "없음" 맨 앞 · 숨긴 그룹 뺌). 값은 집계 질의가 낸 통계에서
 * 앱과 같은 `calculationResult` 로 만든다. 이 파일은 DB 도 React 도 모른다.
 */

import { calculationResult, canCalculate, formatCalculation, type Calculation, type CalculationResult, type ColumnStats } from '../database/calculations.ts'
import type { ChartDatum } from '../database/chart-geometry.ts'
import { isOptionColor } from '../database/property-types.ts'
import { buildBoardColumns, type BoardSpec } from './public-board.ts'

/** 공개 경로가 집계하는 계산 — 개수 · 숫자 속성의 통계. 그 밖(날짜 · 수식 · 롤업 · 다른 타입의 칸 세기)은 표로 그린다. */
const NUMBER_CALCULATIONS: readonly Calculation[] = [
  'count_all', 'count_values', 'count_empty', 'count_unique', 'percent_empty', 'percent_not_empty',
  'sum', 'average', 'median', 'min', 'max', 'range',
]

/**
 * 이 계산을 공개 집계가 낼 수 있나. 계산이 없으면(개수) 참 · `count_all` 은 속성과 무관하게 행 수 · 나머지는 **숫자** 속성에서만.
 * `propertyType` 은 계산 속성의 타입(지웠으면 undefined — 앱의 `liveGroupCalculation` 은 이때 계산을 버리고 개수로 그린다).
 */
export function chartCalculationSupported(fn: Calculation | null, propertyType: string | undefined): boolean {
  if (fn === null || propertyType === undefined) return true
  if (fn === 'count_all') return true
  return propertyType === 'number' && NUMBER_CALCULATIONS.includes(fn) && canCalculate('number', fn)
}

/** 집계 질의의 한 줄(그룹 하나 또는 전체) — 숫자 칸의 통계. */
export type ChartStatRow = {
  /** 그룹 키(전체 한 줄이면 ''). */
  readonly key: string
  readonly n: number
  readonly filled: number
  readonly distinct: number
  readonly sum: number | null
  readonly avg: number | null
  readonly median: number | null
  readonly min: number | null
  readonly max: number | null
}

export type PublicChartGroup = {
  readonly key: string
  readonly name: string
  /** 옵션 색 이름 — 선택 · 상태 옵션만(값 없음 · 체크박스는 null). */
  readonly color: string | null
  /** 그 그룹의 행 수. */
  readonly count: number
  /** 계산의 값 — 계산이 없으면 null(개수로 그린다). */
  readonly value: CalculationResult | null
}

/** 통계 한 줄 → 계산의 값(앱과 같은 `calculationResult`). 날짜 · 체크 칸은 이 경로에 없다. */
export function chartResultOf(fn: Calculation, row: Omit<ChartStatRow, 'key'>): CalculationResult {
  const stats: ColumnStats = {
    total: row.n, filled: row.filled, distinct: row.distinct, sum: row.sum, avg: row.avg, median: row.median, min: row.min, max: row.max,
    dateMin: null, dateMax: null, checked: 0, complete: 0,
  }
  return calculationResult(fn, stats)
}

/**
 * 그룹을 짓는다 — 통계 줄이 없는 그룹은 행이 0개(`hide_empty` 면 빠진다). 숨긴 그룹은 뺀다.
 * 쌓기(`sub_group_by`)는 읽지 않는다 — 공개 차트는 늘 그룹 합계 막대다.
 */
export function buildChartGroups(spec: BoardSpec, rows: readonly ChartStatRow[], fn: Calculation | null): PublicChartGroup[] {
  return buildBoardColumns(spec, rows, (r) => r.key).map((col) => {
    const stat = col.rows[0]
    return {
      key: col.key,
      name: col.name,
      color: col.color,
      count: stat?.n ?? 0,
      value: fn === null ? null : chartResultOf(fn, stat ?? { n: 0, filled: 0, distinct: 0, sum: null, avg: null, median: null, min: null, max: null }),
    }
  })
}

export type PublicChartSeries = {
  readonly data: readonly ChartDatum[]
  /** 그릴 행이 하나도 없다. */
  readonly empty: boolean
  /** Y 가 정수만 내는가(개수) — 눈금이 정수로 나뉜다. */
  readonly integer: boolean
}

const COUNT_FNS: readonly Calculation[] = ['count_all', 'count_values', 'count_empty', 'count_unique']

/** 그룹 → 그릴 자료. 값이 없는 계산(평균 등이 빈 그룹)은 0 으로 그리고 글자는 "—" (앱의 `chartData` 와 같다). */
export function chartSeriesOf(groups: readonly PublicChartGroup[], fn: Calculation | null): PublicChartSeries {
  const data = groups.map((g): ChartDatum => {
    const color = isOptionColor(g.color) ? g.color : null
    if (g.value !== null) {
      const numeric = g.value.kind === 'date' ? null : g.value.value
      return { key: g.key, label: g.name, value: numeric ?? 0, text: formatCalculation(g.value), color }
    }
    return { key: g.key, label: g.name, value: g.count, text: g.count.toLocaleString('ko-KR'), color }
  })
  return { data, empty: groups.every((g) => g.count === 0), integer: fn === null || COUNT_FNS.includes(fn) }
}
