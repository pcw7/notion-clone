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

import {
  deriveSidecars,
  isEmptyValue,
  isMvpPropertyType,
  type CellValue,
  type MvpPropertyType,
  type SelectOption,
} from './property-types.ts'

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

/** 화면에 그리는 이름. 폼의 "계산" 목록과 칸의 설명이 같은 말을 쓴다. */
export const ROLLUP_FUNCTION_LABEL: Readonly<Record<RollupFunction, string>> = Object.freeze({
  show_original: '원본 보기',
  count: '개수',
  count_values: '값이 있는 개수',
  sum: '합계',
  average: '평균',
  min: '최솟값',
  max: '최댓값',
  checked: '체크된 개수',
  percent_checked: '체크된 비율',
  earliest_date: '가장 이른 날짜',
  latest_date: '가장 늦은 날짜',
})

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
 * rollup 컬럼 하나의 상태 — **행과 무관하다**(스키마의 일이다). 행마다 되풀이하지 않는다.
 *
 * 계산하는 것은 `rollup.ts` 지만 모양은 여기 둔다 — 화면(클라이언트 컴포넌트)이 이 타입들을 읽는데 `rollup.ts` 는
 * `db/tx.ts → pg` 를 끌어온다(`view-columns.ts` 와 같은 이유 · HANDOFF §3.3-163).
 */
export type RollupColumnInfo =
  | {
      readonly state: 'ok'
      /** **실제로 적용한** 함수. 대상 타입에 맞지 않으면 `show_original` 로 접힌 것이다. */
      readonly function: RollupFunction
      readonly relationPropertyId: string
      readonly targetPropertyId: string
      readonly targetType: MvpPropertyType
      /** `show_original` 이 옵션 id 를 이름으로 그릴 때. 대상이 select · status 이고 **그 표를 볼 수 있을 때만** 채운다. */
      readonly targetOptions: readonly SelectOption[]
    }
  /** relation 프로퍼티가 지워졌거나(복원하면 돌아온다) config 가 rollup 의 모양이 아니다. */
  | { readonly state: 'relation_missing' }
  /** 대상 프로퍼티가 지워졌거나 더는 셀 타입이 아니다. */
  | { readonly state: 'target_missing' }

/** 한 칸. `too_many` 는 상한을 넘은 칸이다(`rollup.ts` 머리말 — 틀린 합 대신 그렇다고 말한다). */
export type RollupCell =
  | { readonly state: 'ok'; readonly result: RollupResult; /** 볼 수 없어서 집계에서 뺀 연결의 수. */ readonly hidden: number }
  | { readonly state: 'too_many' }

export type RollupPage = {
  /** rollup 프로퍼티 id → 상태. 이 표의 살아 있는 rollup 전부. */
  readonly columns: Readonly<Record<string, RollupColumnInfo>>
  /** 행 id → rollup 프로퍼티 id → 칸. `state: 'ok'` 인 컬럼만 싣는다. 이 표의 살아 있는 행이 아닌 id 는 키가 없다. */
  readonly values: Readonly<Record<string, Readonly<Record<string, RollupCell>>>>
}

/**
 * 한 번에 계산을 물을 수 있는 행 수. 표 한 화면(50행)과 "더 보기"로 붙인 몇 장을 덮는다.
 *
 * 화면도 이 수를 안다 — 넘는 만큼은 나눠 묻는다(서버가 거부하면 그 행들의 칸이 영영 빈 채로 남는다).
 */
export const MAX_ROLLUP_ROWS = 500

/** 빈 답. 계산할 rollup 이 없을 때 서버도 화면도 이것을 쓴다. */
export const EMPTY_ROLLUP_PAGE: RollupPage = Object.freeze({ columns: {}, values: {} })

/**
 * 그릴 것이 없는 칸인가 — List 가 접을지 정할 때.
 *
 * 아직 받지 못한 칸(`undefined`)도 비어 있다. `0` · `false` 는 **값이다** — 접지 않는다.
 */
export function rollupIsEmpty(cell: RollupCell | undefined): boolean {
  if (cell === undefined) return true
  if (cell.state !== 'ok') return false
  if (cell.hidden > 0) return false
  const r = cell.result
  if (r.kind === 'number') return r.number === null
  if (r.kind === 'percent') return r.percent === null
  if (r.kind === 'date') return r.date === null
  return r.count === 0
}

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
