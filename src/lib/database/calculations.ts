/**
 * 열 집계(Calculations) — 함수 목록 · 타입별 허용 · 결과 만들기 (DB 심화 2d-1조각 · F-04-16 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_property.calculation` · [보강] 열 집계
 *       04-database-views.md F-04-16
 *
 * ──────────────────────────────────────────────────────────────────────
 * 서버가 통계를 내고, 이 파일이 함수의 값을 만든다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 집계 대상은 **필터를 지난 행 전부**다 — 페이지에 들어오지 않은 행도(04 *"반드시 서버측 계산"*). 그래서 서버(`calculate.ts`)가 열마다
 * 한 줄의 통계(`ColumnStats` — 값 있는 칸 수 · 고유 값 수 · 합 · 평균 · 중앙값 · 최소 · 최대 · 날짜의 처음과 끝 · 체크된 칸 수)를 한 질의로
 * 내고, 함수의 값은 여기서 만든다. 함수가 늘어도 SQL 은 그대로다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 0 과 빈 값을 가른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 04 엣지 케이스: *"행 0개 → count 계열 = 0, sum = 0, average/median/min/max = 빈 값. 0 과 빈 값을 구분해야 함"*. 값이 전부 비어 있으면
 * 평균은 0 이 아니라 빈 값이다(SQL `AVG` 가 NULL 인 것과 같은 뜻). 비율은 행이 0개면 빈 값이다(0으로 나누지 않는다).
 */

import { isMvpPropertyType, type MvpPropertyType } from './property-types.ts'

/** 저장되는 함수 이름(마이그레이션 0054 의 CHECK 과 같은 목록 — 순서는 화면의 목록 순서). */
export const CALCULATIONS = [
  'count_all',
  'count_values',
  'count_empty',
  'count_unique',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest_date',
  'latest_date',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
] as const
export type Calculation = (typeof CALCULATIONS)[number]

export function isCalculation(c: unknown): c is Calculation {
  return typeof c === 'string' && (CALCULATIONS as readonly string[]).includes(c)
}

export const CALCULATION_LABEL: Readonly<Record<Calculation, string>> = {
  count_all: '모두 세기',
  count_values: '값 세기',
  count_empty: '빈 칸 세기',
  count_unique: '고유 값 세기',
  percent_empty: '빈 칸 비율',
  percent_not_empty: '값 비율',
  sum: '합계',
  average: '평균',
  median: '중앙값',
  min: '최솟값',
  max: '최댓값',
  range: '범위',
  earliest_date: '가장 이른 날',
  latest_date: '가장 늦은 날',
  date_range: '기간',
  checked: '체크됨',
  unchecked: '체크 안 됨',
  percent_checked: '체크 비율',
  percent_unchecked: '체크 안 됨 비율',
}

const COMMON: readonly Calculation[] = ['count_all', 'count_values', 'count_empty', 'count_unique', 'percent_empty', 'percent_not_empty']

/** 이 타입이 고를 수 있는 함수(04 *"사용 가능 함수는 프로퍼티 타입에 의존한다"*). 체크박스에는 빈 값이 없어 세기 계열 대신 체크 계열이다. */
export function calculationsFor(type: MvpPropertyType): readonly Calculation[] {
  switch (type) {
    case 'number':
      return [...COMMON, 'sum', 'average', 'median', 'min', 'max', 'range']
    case 'date':
      return [...COMMON, 'earliest_date', 'latest_date', 'date_range']
    case 'checkbox':
      return ['count_all', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked']
    default:
      return COMMON
  }
}

/**
 * 이 타입의 칸으로 이 함수를 계산할 수 있는가 — 고를 때(명령)와 읽을 때(맞지 않게 된 저장값은 무시) 같은 술어다. 셀 타입이 아니면
 * (relation · rollup · 고유 ID — 아직 · §7) 아무것도 고를 수 없다.
 */
export function canCalculate(type: string, fn: Calculation): boolean {
  return isMvpPropertyType(type) && calculationsFor(type).includes(fn)
}

/**
 * 보드 그룹 머리에서 속성을 고르면 처음 붙는 함수(2d-3). 노션 보드의 기본이 카드 수라, 속성을 골랐다면 카드 수와 다른 것을 원한 것이다 —
 * 숫자는 합계, 날짜는 가장 늦은 날, 체크박스는 체크 비율, 그 밖은 값 세기.
 */
export function defaultCalculationFor(type: MvpPropertyType): Calculation {
  switch (type) {
    case 'number':
      return 'sum'
    case 'date':
      return 'latest_date'
    case 'checkbox':
      return 'percent_checked'
    default:
      return 'count_values'
  }
}

/** 열 하나의 통계 — 서버가 한 질의로 낸다(`calculate.ts`). 값이 없으면 null. */
export type ColumnStats = {
  /** 필터를 지난 행 수(열과 무관 — 표 전체에 하나). */
  readonly total: number
  /** 값이 있는 칸 수. */
  readonly filled: number
  readonly distinct: number
  readonly sum: number | null
  readonly avg: number | null
  readonly median: number | null
  readonly min: number | null
  readonly max: number | null
  /** 날짜의 가장 이른 시작 · 가장 늦은 끝(ISO). */
  readonly dateMin: string | null
  readonly dateMax: string | null
  readonly checked: number
}

/** 화면이 그리는 값 — 종류가 모양을 정한다(비율은 %, 날짜는 날짜, 기간은 일). */
export type CalculationResult =
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'number'; readonly value: number | null }
  | { readonly kind: 'percent'; readonly value: number | null }
  | { readonly kind: 'date'; readonly value: string | null }
  | { readonly kind: 'days'; readonly value: number | null }

const percent = (part: number, total: number): CalculationResult => ({ kind: 'percent', value: total === 0 ? null : (part / total) * 100 })

/** 통계 → 함수의 값. */
export function calculationResult(fn: Calculation, s: ColumnStats): CalculationResult {
  switch (fn) {
    case 'count_all':
      return { kind: 'count', value: s.total }
    case 'count_values':
      return { kind: 'count', value: s.filled }
    case 'count_empty':
      return { kind: 'count', value: s.total - s.filled }
    case 'count_unique':
      return { kind: 'count', value: s.distinct }
    case 'percent_empty':
      return percent(s.total - s.filled, s.total)
    case 'percent_not_empty':
      return percent(s.filled, s.total)
    case 'sum':
      // 합은 0 이 자연스럽다(더할 것이 없으면 0) — 04 *"행 0개 → sum = 0"*.
      return { kind: 'number', value: s.sum ?? 0 }
    case 'average':
      return { kind: 'number', value: s.avg }
    case 'median':
      return { kind: 'number', value: s.median }
    case 'min':
      return { kind: 'number', value: s.min }
    case 'max':
      return { kind: 'number', value: s.max }
    case 'range':
      return { kind: 'number', value: s.min === null || s.max === null ? null : s.max - s.min }
    case 'earliest_date':
      return { kind: 'date', value: s.dateMin }
    case 'latest_date':
      return { kind: 'date', value: s.dateMax }
    case 'date_range': {
      if (s.dateMin === null || s.dateMax === null) return { kind: 'days', value: null }
      const days = Math.round((Date.parse(s.dateMax) - Date.parse(s.dateMin)) / 86_400_000)
      return { kind: 'days', value: days }
    }
    case 'checked':
      return { kind: 'count', value: s.checked }
    case 'unchecked':
      return { kind: 'count', value: s.total - s.checked }
    case 'percent_checked':
      return percent(s.checked, s.total)
    case 'percent_unchecked':
      return percent(s.total - s.checked, s.total)
  }
}

/** 화면에 그리는 글자. 빈 값은 `—`(0 과 가른다). 비율은 소수 한 자리까지, 수는 그 나라의 쉼표로. */
export function formatCalculation(result: CalculationResult): string {
  if (result.value === null) return '—'
  switch (result.kind) {
    case 'count':
      return result.value.toLocaleString('ko-KR')
    case 'number':
      return result.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
    case 'percent':
      return `${result.value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`
    case 'date':
      return result.value.slice(0, 10)
    case 'days':
      return `${result.value.toLocaleString('ko-KR')}일`
  }
}
