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
 * 함수는 23종이고, 대상 타입이 고를 수 있는 것을 정한다 (03 의 22종 = API enum + 완료 비율 · 나머지 11종은 10n-32)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   모든 타입    show_original · show_unique · count · count_values · unique · empty · not_empty · percent_empty · percent_not_empty
 *   number       + sum · average · median · min · max · range
 *   checkbox     + checked · unchecked · percent_checked · percent_unchecked
 *   date         + earliest_date · latest_date · date_range   (시작일만 본다 — 03: 종료일은 rollup 이 직접 읽지 못한다)
 *   status       + percent_complete              (완료 그룹에 든 연결의 비율 — 10n-29 · 그룹은 부르는 쪽이 옵션에서 넘긴다)
 *
 * 고유(`show_unique` · `unique`)는 **적힌 값**으로 가른다(`uniqueKey`) — 선택 · 상태는 옵션 id, 날짜는 적힌 시작 · 끝 그대로.
 * `count_values` 는 값의 수다(칸 하나가 값 여럿이면 하나씩) — 지금 대상이 될 수 있는 타입은 모두 칸당 값 하나라 `not_empty` 와 같다.
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
 *   percent_*           연결 0개면 **없음** — 0 으로 나눈 것을 0% 라고 하면 "아무것도 안 끝났다"로 읽힌다
 *   median · range      값이 없으면 없음 · date_range 는 날짜가 없으면 없음(같은 날 하나뿐이면 0일)
 *
 * checkbox 에는 빈 값이 없다(`isEmptyValue` — `false` 는 값이다). 그래서 체크박스의 count_values 는 count 와 같고 empty 는 늘 0 이다.
 */

import {
  deriveSidecars,
  isEmptyValue,
  isMvpPropertyType,
  type CellValue,
  type MvpPropertyType,
  type SelectOption,
} from './property-types.ts'
import { toPlainText } from '../contracts/rich-text.ts'

export const ROLLUP_FUNCTIONS = [
  'show_original',
  'show_unique',
  'count',
  'count_values',
  'unique',
  'empty',
  'not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
  'percent_complete',
  'earliest_date',
  'latest_date',
  'date_range',
] as const
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number]

export function isRollupFunction(v: unknown): v is RollupFunction {
  return typeof v === 'string' && (ROLLUP_FUNCTIONS as readonly string[]).includes(v)
}

/** 화면에 그리는 이름. 폼의 "계산" 목록과 칸의 설명이 같은 말을 쓴다. */
export const ROLLUP_FUNCTION_LABEL: Readonly<Record<RollupFunction, string>> = Object.freeze({
  show_original: '원본 보기',
  show_unique: '고유 값 보기',
  count: '개수',
  // 10n-32 전에는 "값이 있는 개수" 였다 — 그 이름은 not_empty 가 받는다(03 의 count_values 는 값의 수다)
  count_values: '값 개수',
  unique: '고유 값 개수',
  empty: '빈 칸 개수',
  not_empty: '값이 있는 개수',
  percent_empty: '빈 칸 비율',
  percent_not_empty: '값이 있는 비율',
  sum: '합계',
  average: '평균',
  median: '중앙값',
  min: '최솟값',
  max: '최댓값',
  range: '범위',
  checked: '체크된 개수',
  unchecked: '체크 안 된 개수',
  percent_checked: '체크된 비율',
  percent_unchecked: '체크 안 된 비율',
  percent_complete: '완료 비율',
  earliest_date: '가장 이른 날짜',
  latest_date: '가장 늦은 날짜',
  date_range: '날짜 범위',
})

/** 기본 함수이자, 맞지 않는 함수가 접히는 곳. 어떤 타입에도 된다. */
export const DEFAULT_ROLLUP_FUNCTION: RollupFunction = 'show_original'

const COMMON: readonly RollupFunction[] = [
  'show_original',
  'show_unique',
  'count',
  'count_values',
  'unique',
  'empty',
  'not_empty',
  'percent_empty',
  'percent_not_empty',
]
const EXTRA: Readonly<Partial<Record<MvpPropertyType, readonly RollupFunction[]>>> = Object.freeze({
  number: ['sum', 'average', 'median', 'min', 'max', 'range'],
  checkbox: ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'],
  status: ['percent_complete'],
  date: ['earliest_date', 'latest_date', 'date_range'],
})

/** 이 타입의 프로퍼티를 대상으로 고를 수 있는 함수 — 폼이 보여 주는 순서 그대로. */
export function rollupFunctionsFor(type: MvpPropertyType): readonly RollupFunction[] {
  return [...COMMON, ...(EXTRA[type] ?? [])]
}

/**
 * rollup 의 대상이 될 수 있는 타입인가 — 셀 타입만. relation · rollup 은 안 된다(정본: 참조 체인이 깊이 1 에 머문다). 사람(6g-1)도 아직
 * 아니다(정본 §3.5 [보강] 사람 속성 ⑤ — 원본 보이기에 이름이 든다).
 */
export function isRollupTargetType(type: unknown): type is MvpPropertyType {
  return isMvpPropertyType(type) && type !== 'people'
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
  /** 세기 · sum · average · median · min · max · range. `null` 은 "없음"이다(머리말) — 0 이 아니다. */
  | { readonly kind: 'number'; readonly number: number | null }
  /** percent_*. 0..1. */
  | { readonly kind: 'percent'; readonly percent: number | null }
  /** earliest_date · latest_date. 이긴 값의 `start` 를 **적힌 그대로** 준다(날짜만 적은 값에 시각을 붙이지 않는다). */
  | { readonly kind: 'date'; readonly date: string | null }
  /** date_range. 가장 늦은 시작 − 가장 이른 시작, 일 단위로 반올림(10n-32). */
  | { readonly kind: 'days'; readonly days: number | null }
  /** show_original · show_unique. 빈 값은 뺀다. `values` 는 앞 `ROLLUP_SHOW_LIMIT` 개, `count` 는 빈 값이 아닌(고유한) 것 전체. */
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
  if (r.kind === 'days') return r.days === null
  return r.count === 0
}

/**
 * 카드(보드 · 갤러리)에 rollup 배지를 세우는가(10n-33) — 설정이 살아 있고 그릴 것이 있을 때만. 다른 배지처럼 빈 것은 세우지 않고, 설정이
 * 끊긴 것(관계 · 대상이 지워졌다)도 세우지 않는다 — 표의 칸이 그렇다고 말한다(정본 [보강 10n-33]).
 */
export function showsRollupBadge(info: RollupColumnInfo | undefined, cell: RollupCell | undefined): boolean {
  return info?.state === 'ok' && !rollupIsEmpty(cell)
}

/**
 * 부동소수점 찌꺼기를 턴다 — `0.1 + 0.2` 는 `0.30000000000000004` 다. 유효 숫자 15자리로 자르면 double 이 정확히 담는
 * 범위 안의 값은 그대로이고 덧셈이 만든 끝자리만 사라진다.
 */
const clean = (n: number): number => Number(n.toPrecision(15))

const numbersIn = (values: readonly CellValue[]): number[] =>
  values.flatMap((v) => (v.type === 'number' && v.number !== null ? [v.number] : []))

/** 0 으로 나누지 않는다 — 연결 0개면 없음(머리말). */
const ratio = (part: number, total: number): RollupResult => ({ kind: 'percent', percent: total === 0 ? null : clean(part / total) })

/**
 * 고유 값을 가르는 열쇠 — **적힌 값**으로(정본 [보강 10n-32]). 빈 값은 null — 고유 값에 들지 않는다.
 *
 * 선택 · 상태는 옵션 id 다(이름이 같아도 다른 옵션은 다르다 — 필터 · 그룹이 보는 축과 같다). 날짜는 적힌 시작 · 끝 · 시간대 그대로다 —
 * `2026-01-05` 와 `2026-01-05T00:00:00Z` 는 다르게 그려지므로 하나로 접으면 보이는 것과 세는 것이 어긋난다.
 */
export function uniqueKey(v: CellValue): string | null {
  if (isEmptyValue(v)) return null
  switch (v.type) {
    case 'title':
      return `t:${toPlainText(v.title)}`
    case 'rich_text':
      return `t:${toPlainText(v.rich_text)}`
    case 'number':
      return `n:${v.number}`
    case 'select':
      return `o:${v.select?.id}`
    case 'status':
      return `o:${v.status?.id}`
    case 'checkbox':
      return `b:${v.checkbox}`
    case 'date':
      return `d:${v.date?.start}|${v.date?.end ?? ''}|${v.date?.time_zone ?? ''}`
    case 'people':
      return `p:${v.people.map((p) => p.id).join(' ')}`
  }
}

/** 칸 하나가 담은 값의 수 — `count_values`. 사람(값 여럿)만 하나씩 센다(대상이 될 수 있게 되는 날을 위해 — 지금은 막혀 있다). */
const valuesInCell = (v: CellValue): number => (v.type === 'people' ? v.people.length : isEmptyValue(v) ? 0 : 1)

/**
 * 집계한다. `values` 는 **집계에 넣기로 한 연결 행마다 하나**다(칸이 없는 행은 그 타입의 빈 값) — 엣지 순서대로.
 *
 * 함수가 값의 타입과 맞지 않으면(`sum` 에 글) 맞는 값이 하나도 없는 것과 같은 답이 나온다. 그 조합은 호출자가
 * `effectiveRollupFunction` 으로 이미 접었어야 한다 — 여기서 던지지 않는 것은 읽기 경로라서다.
 */
/** 집계에 값 말고 더 필요한 것 — 완료 비율(10n-29)은 어느 옵션이 완료 그룹인지 알아야 한다(값은 옵션 id 뿐이다). */
export type RollupContext = { readonly completeOptionIds?: ReadonlySet<string> }

export function aggregate(fn: RollupFunction, values: readonly CellValue[], context: RollupContext = {}): RollupResult {
  switch (fn) {
    case 'show_original': {
      const filled = values.filter((v) => !isEmptyValue(v))
      return { kind: 'values', values: filled.slice(0, ROLLUP_SHOW_LIMIT), count: filled.length }
    }
    case 'show_unique': {
      // 처음 나온 순서(엣지 순서)로 — 같은 값의 두 번째부터 뺀다
      const seen = new Set<string>()
      const unique = values.filter((v) => {
        const key = uniqueKey(v)
        if (key === null || seen.has(key)) return false
        seen.add(key)
        return true
      })
      return { kind: 'values', values: unique.slice(0, ROLLUP_SHOW_LIMIT), count: unique.length }
    }
    case 'count':
      return { kind: 'number', number: values.length }
    case 'count_values':
      return { kind: 'number', number: values.reduce((n, v) => n + valuesInCell(v), 0) }
    case 'unique':
      return { kind: 'number', number: new Set(values.flatMap((v) => uniqueKey(v) ?? [])).size }
    case 'empty':
      return { kind: 'number', number: values.filter(isEmptyValue).length }
    case 'not_empty':
      return { kind: 'number', number: values.filter((v) => !isEmptyValue(v)).length }
    case 'percent_empty':
      return ratio(values.filter(isEmptyValue).length, values.length)
    case 'percent_not_empty':
      return ratio(values.filter((v) => !isEmptyValue(v)).length, values.length)

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
    case 'median': {
      // 가운데 값 · 짝수면 가운데 둘의 평균
      const ns = numbersIn(values).sort((a, b) => a - b)
      if (ns.length === 0) return { kind: 'number', number: null }
      const mid = Math.floor(ns.length / 2)
      const middle = ns.length % 2 === 1 ? (ns[mid] ?? 0) : ((ns[mid - 1] ?? 0) + (ns[mid] ?? 0)) / 2
      return { kind: 'number', number: clean(middle) }
    }
    case 'range': {
      const ns = numbersIn(values)
      return { kind: 'number', number: ns.length === 0 ? null : clean(Math.max(...ns) - Math.min(...ns)) }
    }

    case 'checked':
      return { kind: 'number', number: values.filter((v) => v.type === 'checkbox' && v.checkbox).length }
    case 'unchecked':
      return { kind: 'number', number: values.filter((v) => v.type === 'checkbox' && !v.checkbox).length }
    case 'percent_checked':
      return ratio(values.filter((v) => v.type === 'checkbox' && v.checkbox).length, values.length)
    case 'percent_unchecked':
      return ratio(values.filter((v) => v.type === 'checkbox' && !v.checkbox).length, values.length)
    case 'percent_complete': {
      // 완료 그룹에 든 연결의 비율(10n-29) — 상태가 빈 연결도 분모에 든다("아직 완료가 아니다") · 연결 0개면 없음
      if (values.length === 0) return { kind: 'percent', percent: null }
      const done = context.completeOptionIds ?? new Set<string>()
      const complete = values.filter((v) => v.type === 'status' && v.status !== null && done.has(v.status.id)).length
      return { kind: 'percent', percent: clean(complete / values.length) }
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
    case 'date_range': {
      // 가장 늦은 시작 − 가장 이른 시작(earliest_date · latest_date 와 같은 축 — 시작일만 본다) · 일 단위로 반올림
      const starts = values.flatMap((v) => {
        const at = v.type === 'date' ? deriveSidecars(v).dateStart?.getTime() : undefined
        return at === undefined ? [] : [at]
      })
      if (starts.length === 0) return { kind: 'days', days: null }
      return { kind: 'days', days: Math.round((Math.max(...starts) - Math.min(...starts)) / 86_400_000) }
    }
  }
}
