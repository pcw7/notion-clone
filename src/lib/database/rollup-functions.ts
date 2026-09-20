/**
 * rollup 의 계약과 집계 함수 — rollup 5c-1조각 (F-03-11 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 · 03-database-core.md F-03-11
 *
 * 여기에는 DB 가 없다. 어느 행을 집계에 넣을지(권한 · 휴지통 · 상한)는 `rollup.ts` 가 정하고, 이 파일은 **넘겨받은 값들의
 * 함수**만 안다 — 그래서 엣지 케이스 표(연결 0개 · null 섞임 · 타입에 맞지 않는 함수)를 DB 없이 검사한다. 화면(5c-2)의
 * 속성 추가 폼도 "이 타입에 고를 수 있는 함수"를 여기서 읽는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 함수는 11종이고, 대상 타입이 고를 수 있는 것을 정한다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   모든 타입    show_original · count · count_values
 *   number       + sum · average · min · max
 *   checkbox     + checked · percent_checked
 *   date         + earliest_date · latest_date   (시작일만 본다 — 03: 종료일은 rollup 이 직접 읽지 못한다)
 *
 * 맞지 않는 조합(`sum` × 글)은 만들 때 거부한다. 읽을 때는 **접는다**(`effectiveRollupFunction`) — 03: *"대상 프로퍼티
 * 타입 변경 → 선택된 집계 함수가 무효 → 기본 함수로 폴백."* 읽기가 던지면 표 전체가 안 열린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 빈 것의 답 — 0 과 "없음"은 다르다 (F-03-11 엣지 케이스 표)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   연결 0개            count = 0 · sum = 0 · **average = 없음(0 이 아니다)** · min/max = 없음 · show_original = 빈 목록
 *   null 이 섞였다      sum · average 는 null 을 무시한다 · count 는 전체, count_values 는 빈 값이 아닌 것만
 *   percent_checked     연결 0개면 **없음** — 0 으로 나눈 것을 0% 라고 하면 "아무것도 안 끝났다"로 읽힌다
 *
 * checkbox 에는 빈 값이 없다(`isEmptyValue` — `false` 는 값이다). 그래서 체크박스의 count_values 는 count 와 같다.
 */

import { deriveSidecars, isEmptyValue, isMvpPropertyType, type CellValue, type MvpPropertyType } from './property-types.ts'

export const ROLLUP_FUNCTIONS = [
  'show_original',
  'count',
  'count_values',
  'sum',
  'average',
  'min',
  'max',
  'checked',
  'percent_checked',
  'earliest_date',
  'latest_date',
] as const
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number]

export function isRollupFunction(v: unknown): v is RollupFunction {
  return typeof v === 'string' && (ROLLUP_FUNCTIONS as readonly string[]).includes(v)
}

/** 기본 함수이자, 맞지 않는 함수가 접히는 곳. 어떤 타입에도 된다. */
export const DEFAULT_ROLLUP_FUNCTION: RollupFunction = 'show_original'

const COMMON: readonly RollupFunction[] = ['show_original', 'count', 'count_values']
const EXTRA: Readonly<Partial<Record<MvpPropertyType, readonly RollupFunction[]>>> = Object.freeze({
  number: ['sum', 'average', 'min', 'max'],
  checkbox: ['checked', 'percent_checked'],
  date: ['earliest_date', 'latest_date'],
})

/** 이 타입의 프로퍼티를 대상으로 고를 수 있는 함수 — 폼이 보여 주는 순서 그대로. */
export function rollupFunctionsFor(type: MvpPropertyType): readonly RollupFunction[] {
  return [...COMMON, ...(EXTRA[type] ?? [])]
}

/** rollup 의 대상이 될 수 있는 타입인가 — 셀 타입만. relation · rollup 은 안 된다(정본: 참조 체인이 깊이 1 에 머문다). */
export function isRollupTargetType(type: unknown): type is MvpPropertyType {
  return isMvpPropertyType(type)
}

/** 읽을 때 쓰는 함수. 대상 타입에 맞지 않으면 기본 함수로 접는다(머리말). */
export function effectiveRollupFunction(fn: RollupFunction, type: MvpPropertyType): RollupFunction {
  return rollupFunctionsFor(type).includes(fn) ? fn : DEFAULT_ROLLUP_FUNCTION
}

// ── config ────────────────────────────────────────────────────────────

/** `property.config` — rollup. snake_case 로 저장한다(정본의 키 이름 그대로). */
export type RollupConfig = {
  /** **이 표의** relation 프로퍼티. */
  readonly relation_property_id: string
  /** 그 relation 의 **대상 표의** 프로퍼티. */
  readonly target_property_id: string
  readonly function: RollupFunction
}

/** 저장된 config 를 읽는다. rollup 의 모양이 아니면 null. 모르는 함수는 기본 함수로 읽는다(카탈로그를 줄이는 날에도 열린다). */
export function readRollupConfig(raw: unknown): RollupConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  if (typeof c.relation_property_id !== 'string' || c.relation_property_id.length === 0) return null
  if (typeof c.target_property_id !== 'string' || c.target_property_id.length === 0) return null
  return {
    relation_property_id: c.relation_property_id,
    target_property_id: c.target_property_id,
    function: isRollupFunction(c.function) ? c.function : DEFAULT_ROLLUP_FUNCTION,
  }
}

// ── 결과 ──────────────────────────────────────────────────────────────

/** `show_original` 이 싣는 값의 수. relation 칸의 캐시(앞 25개)와 같은 크기 — 그 뒤는 개수로만 말한다. */
export const ROLLUP_SHOW_LIMIT = 25

export type RollupResult =
  /** count · count_values · sum · average · min · max · checked. `null` 은 "없음"이다(머리말) — 0 이 아니다. */
  | { readonly kind: 'number'; readonly number: number | null }
  /** percent_checked. 0..1. */
  | { readonly kind: 'percent'; readonly percent: number | null }
  /** earliest_date · latest_date. 이긴 값의 `start` 를 **적힌 그대로** 준다(날짜만 적은 값에 시각을 붙이지 않는다). */
  | { readonly kind: 'date'; readonly date: string | null }
  /** show_original. 빈 값은 뺀다. `values` 는 앞 `ROLLUP_SHOW_LIMIT` 개, `count` 는 빈 값이 아닌 것 전체. */
  | { readonly kind: 'values'; readonly values: readonly CellValue[]; readonly count: number }

/**
 * 부동소수점 찌꺼기를 턴다 — `0.1 + 0.2` 는 `0.30000000000000004` 다. 유효 숫자 15자리로 자르면 double 이 정확히 담는
 * 범위 안의 값은 그대로이고 덧셈이 만든 끝자리만 사라진다.
 */
const clean = (n: number): number => Number(n.toPrecision(15))

const numbersIn = (values: readonly CellValue[]): number[] =>
  values.flatMap((v) => (v.type === 'number' && v.number !== null ? [v.number] : []))

/**
 * 집계한다. `values` 는 **집계에 넣기로 한 연결 행마다 하나**다(칸이 없는 행은 그 타입의 빈 값) — 엣지 순서대로.
 *
 * 함수가 값의 타입과 맞지 않으면(`sum` 에 글) 맞는 값이 하나도 없는 것과 같은 답이 나온다. 그 조합은 호출자가
 * `effectiveRollupFunction` 으로 이미 접었어야 한다 — 여기서 던지지 않는 것은 읽기 경로라서다.
 */
export function aggregate(fn: RollupFunction, values: readonly CellValue[]): RollupResult {
  switch (fn) {
    case 'show_original': {
      const filled = values.filter((v) => !isEmptyValue(v))
      return { kind: 'values', values: filled.slice(0, ROLLUP_SHOW_LIMIT), count: filled.length }
    }
    case 'count':
      return { kind: 'number', number: values.length }
    case 'count_values':
      return { kind: 'number', number: values.filter((v) => !isEmptyValue(v)).length }

    case 'sum':
      return { kind: 'number', number: clean(numbersIn(values).reduce((a, b) => a + b, 0)) }
    case 'average': {
      const ns = numbersIn(values)
      return { kind: 'number', number: ns.length === 0 ? null : clean(ns.reduce((a, b) => a + b, 0) / ns.length) }
    }
    case 'min': {
      const ns = numbersIn(values)
      return { kind: 'number', number: ns.length === 0 ? null : ns.reduce((a, b) => (b < a ? b : a)) }
    }
    case 'max': {
      const ns = numbersIn(values)
      return { kind: 'number', number: ns.length === 0 ? null : ns.reduce((a, b) => (b > a ? b : a)) }
    }

    case 'checked':
      return { kind: 'number', number: values.filter((v) => v.type === 'checkbox' && v.checkbox).length }
    case 'percent_checked': {
      if (values.length === 0) return { kind: 'percent', percent: null }
      const checked = values.filter((v) => v.type === 'checkbox' && v.checkbox).length
      return { kind: 'percent', percent: clean(checked / values.length) }
    }

    case 'earliest_date':
    case 'latest_date': {
      let best: { readonly at: number; readonly start: string } | null = null
      for (const v of values) {
        if (v.type !== 'date' || v.date === null) continue
        // 사이드카와 같은 해석이다 — 필터 · 정렬이 "이르다"고 보는 것과 rollup 이 보는 것이 같아야 한다.
        const at = deriveSidecars(v).dateStart?.getTime()
        if (at === undefined) continue
        // 같은 시각이면 먼저 온(엣지 순서가 앞선) 값이 남는다.
        if (best === null || (fn === 'earliest_date' ? at < best.at : at > best.at)) best = { at, start: v.date.start }
      }
      return { kind: 'date', date: best?.start ?? null }
    }
  }
}
