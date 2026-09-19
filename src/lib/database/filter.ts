/**
 * 필터 · 정렬 컴파일러 — W8-b (F-03-17 · F-04-09 · F-04-10)
 *
 * 정본: 00-canonical-data-model.md §3.6 (`view.filter` 는 FilterNode 트리) ·
 *       §3.5 DB 상수(`MAX_FILTER_DEPTH=3`, `MAX_FILTER_GROUP_ITEMS=100`) · 판결 C-15
 *       03-database-core.md F-03-17 (연산자 전수표 · 컴파일 규칙)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 사용자 입력이 SQL 문법에 닿지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17: *"`filter_ast` 는 사용자 입력이다. **절대 문자열 연결로 SQL 을 만들지
 * 말고** 파라미터 바인딩 + 화이트리스트 연산자 매핑으로만 컴파일하라."*
 *
 * 이 파일이 SQL 문자열에 끼워 넣는 것은 **두 종류뿐**이다:
 *   ① `OPERATORS` 맵의 리터럴 조각 (이 파일에 적힌 상수)
 *   ② `$1`, `$2` … 플레이스홀더 번호
 *
 * `property_id` 도, 값도, 연산자 이름도 **문자열로 들어가지 않는다.** property_id
 * 는 nanoid 라 안전해 보이지만 예외를 하나 두면 그 예외가 기준이 된다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 카탈로그는 DB 에, SQL 은 여기에 — 둘의 일치는 테스트가 강제한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마이그레이션 0015 의 `filter_operator` 표는 `(타입, 연산자)` 쌍과 UI 메타데이터를
 * 담고 **SQL 을 담지 않는다**(그 머리말에 근거가 있다). SQL 조각은 아래
 * `OPERATORS` 맵이고, 두 곳이 어긋나지 않게 하는 것은 `filter.db.test.ts` 다 —
 * `level_capability`(DB) ↔ `levels.ts`(TS) 를 `levels.db.test.ts` 가 맞추는 것과
 * 같은 패턴이고 이 저장소에 선례가 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * EAV 에서 "같지 않음"은 NOT EXISTS 다 — 이게 이 파일의 가장 미묘한 지점
 * ──────────────────────────────────────────────────────────────────────
 *
 * 셀이 **없는** 행은 `does_not_equal 5` 에 걸려야 한다(빈 칸은 5가 아니다).
 * `EXISTS(… <> 5)` 로 쓰면 셀이 없는 행이 **빠진다** — 사용자는 "분명히 5가
 * 아닌데 안 나오는" 행을 보게 된다.
 *
 * 그래서 부정 연산자(`does_not_*`)는 전부 `NOT EXISTS(… 긍정 조건 …)` 로 컴파일한다.
 * 테스트가 "셀이 없는 행이 걸리는가"를 명시적으로 확인한다.
 */

import { isMvpPropertyType, type MvpPropertyType } from './property-types.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'

/** 정본 §3.5 DB 상수. 루트 객체를 layer 1 로 센다 <C-15>. */
export const MAX_FILTER_DEPTH = 3
export const MAX_FILTER_GROUP_ITEMS = 100
/** F-04-10 다중 정렬. 상한이 없으면 정렬 키마다 상관 서브쿼리가 붙는다. */
export const MAX_SORT_KEYS = 3

// ── AST 계약 ──────────────────────────────────────────────────────────

export type FilterLeaf = {
  readonly property_id: string
  readonly operator: string
  /** `is_empty` · `is_not_empty` 는 값이 없다(카탈로그의 `arity = 0`). */
  readonly value?: unknown
}

export type FilterGroup = {
  readonly op: 'and' | 'or'
  readonly children: readonly FilterNode[]
}

export type FilterNode = FilterGroup | FilterLeaf

export function isGroup(node: FilterNode): node is FilterGroup {
  return 'op' in node
}

export type SortKey = {
  readonly property_id: string
  readonly direction: 'asc' | 'desc'
}

// ── 사이드카 축 ───────────────────────────────────────────────────────
//
// 타입마다 어느 사이드카 컬럼을 보는가. `property-types.ts` 의 `deriveSidecars()`
// 와 **반드시 같은 축**이어야 한다 — 파생은 num 에 쓰는데 필터는 text 를 보면
// 그 타입의 필터가 언제나 0건이다.

type Axis = 'num' | 'text' | 'date' | 'bool'

const AXIS: Readonly<Record<MvpPropertyType, Axis>> = Object.freeze({
  title: 'text',
  rich_text: 'text',
  number: 'num',
  // ★ select 의 사이드카는 **옵션 id** 다(`property-types.ts` 머리말).
  //   그래서 `equals` 는 id 비교이고 이름 비교가 아니다 — 옵션 이름을 바꿔도
  //   필터가 따라오는 이유가 그것이다.
  select: 'text',
  // status 도 옵션 id 다 — select 와 한 규칙(`property-types.ts` `OPTION_TYPES`).
  status: 'text',
  checkbox: 'bool',
  date: 'date',
})

const COLUMN: Readonly<Record<Axis, string>> = Object.freeze({
  num: 'v.num_value',
  text: 'v.text_value',
  date: 'v.date_start',
  bool: 'v.bool_value',
})

/** 사이드카 컬럼의 캐스트. 바인딩된 값이 `text` 로 들어오므로 축에 맞춰 준다. */
const CAST: Readonly<Record<Axis, string>> = Object.freeze({
  num: '::numeric',
  text: '::text',
  date: '::timestamptz',
  bool: '::boolean',
})

// ── 연산자 화이트리스트 ───────────────────────────────────────────────
//
// 값은 **SQL 조각 생성기**다. `col` 은 사이드카 컬럼 이름(이 파일의 상수),
// `param` 은 `$n` 플레이스홀더(번호만). 둘 다 사용자 입력이 아니다.
//
// `negate: true` 면 `NOT EXISTS` 로 감싼다 — 셀이 없는 행이 걸려야 하기 때문이다
// (머리말 참조).

type OperatorSpec = {
  /** 값이 필요한가. 카탈로그의 `arity` 와 같아야 한다(테스트가 확인). */
  readonly arity: 0 | 1
  /** `NOT EXISTS` 로 감싸는가. */
  readonly negate?: true
  /**
   * `EXISTS` 안쪽의 추가 술어. `arity = 0` 이면 `param` 이 없다.
   *
   * ⚠ 반환 문자열에 들어갈 수 있는 것은 `col`·`param`·리터럴뿐이다.
   */
  readonly predicate: (col: string, param: string, cast: string) => string
}

/**
 * 텍스트 축의 연산자 전부. `title` · `rich_text` 가 공유한다.
 *
 * ⚠ **`select` 은 이것을 물려받지 않는다.** 처음에 연산자를 *축*에 달았더니
 *   select 이 `starts_with`·`contains` 까지 갖게 됐고, 테스트가 잡았다.
 *   select 의 `text_value` 는 **옵션 id** 이므로 접두사·부분 문자열 비교가
 *   무의미하다 — `starts_with 'opt'` 는 id 모양을 맞추는 것이지 사용자가 뜻한
 *   것이 아니다. F-03-17 전수표도 select 에 4개만 준다.
 *
 * 그래서 **연산자는 타입에 달리고, 축은 컬럼·캐스트만 정한다.**
 */
const TEXT_OPERATORS: Readonly<Record<string, OperatorSpec>> = Object.freeze({
    // `lower()` 를 양쪽에 건다. 부분 인덱스가
    // `(property_id, lower(text_value) text_pattern_ops)` 이므로 같은 모양이어야 쓰인다.
    contains: { arity: 1, predicate: (c, p) => `lower(${c}) LIKE '%' || lower(${p}) || '%'` },
    does_not_contain: {
      arity: 1,
      negate: true,
      predicate: (c, p) => `lower(${c}) LIKE '%' || lower(${p}) || '%'`,
    },
    equals: { arity: 1, predicate: (c, p) => `lower(${c}) = lower(${p})` },
    does_not_equal: { arity: 1, negate: true, predicate: (c, p) => `lower(${c}) = lower(${p})` },
    starts_with: { arity: 1, predicate: (c, p) => `lower(${c}) LIKE lower(${p}) || '%'` },
    ends_with: { arity: 1, predicate: (c, p) => `lower(${c}) LIKE '%' || lower(${p})` },
    is_empty: { arity: 0, negate: true, predicate: (c) => `${c} IS NOT NULL` },
    is_not_empty: { arity: 0, predicate: (c) => `${c} IS NOT NULL` },
})

const NUMBER_OPERATORS: Readonly<Record<string, OperatorSpec>> = Object.freeze({
    equals: { arity: 1, predicate: (c, p, k) => `${c} = ${p}${k}` },
    does_not_equal: { arity: 1, negate: true, predicate: (c, p, k) => `${c} = ${p}${k}` },
    greater_than: { arity: 1, predicate: (c, p, k) => `${c} > ${p}${k}` },
    greater_than_or_equal_to: { arity: 1, predicate: (c, p, k) => `${c} >= ${p}${k}` },
    less_than: { arity: 1, predicate: (c, p, k) => `${c} < ${p}${k}` },
    less_than_or_equal_to: { arity: 1, predicate: (c, p, k) => `${c} <= ${p}${k}` },
    is_empty: { arity: 0, negate: true, predicate: (c) => `${c} IS NOT NULL` },
    is_not_empty: { arity: 0, predicate: (c) => `${c} IS NOT NULL` },
})

const CHECKBOX_OPERATORS: Readonly<Record<string, OperatorSpec>> = Object.freeze({
    // ★ `is_empty` 가 **없다**. checkbox 에는 null 상태가 없다(F-03-17 전수표).
    equals: { arity: 1, predicate: (c, p, k) => `${c} = ${p}${k}` },
    // ⚠ 여기서도 `NOT EXISTS` 다. 셀이 없는 행은 "체크 안 함"이므로
    //   `does_not_equal true` 에 걸려야 한다.
    does_not_equal: { arity: 1, negate: true, predicate: (c, p, k) => `${c} = ${p}${k}` },
})

const DATE_OPERATORS: Readonly<Record<string, OperatorSpec>> = Object.freeze({
    // 날짜 비교는 **하루 단위**다. `equals '2026-03-01'` 이 09:30 에 시작하는 일정을
    // 놓치면 안 된다 — 사용자가 고른 것은 날짜이고 시각이 아니다.
    equals: { arity: 1, predicate: (c, p, k) => `date_trunc('day', ${c}) = date_trunc('day', ${p}${k})` },
    before: { arity: 1, predicate: (c, p, k) => `date_trunc('day', ${c}) < date_trunc('day', ${p}${k})` },
    after: { arity: 1, predicate: (c, p, k) => `date_trunc('day', ${c}) > date_trunc('day', ${p}${k})` },
    on_or_before: { arity: 1, predicate: (c, p, k) => `date_trunc('day', ${c}) <= date_trunc('day', ${p}${k})` },
    on_or_after: { arity: 1, predicate: (c, p, k) => `date_trunc('day', ${c}) >= date_trunc('day', ${p}${k})` },
    is_empty: { arity: 0, negate: true, predicate: (c) => `${c} IS NOT NULL` },
    is_not_empty: { arity: 0, predicate: (c) => `${c} IS NOT NULL` },
})

/**
 * ★ select 은 텍스트 축을 쓰지만 연산자는 **4개뿐**이다(F-03-17 전수표).
 *
 * `text_value` 가 옵션 id 라서 부분 문자열·접두사 비교가 뜻을 갖지 않는다.
 * 텍스트 연산자 중 `equals` 계열만 재사용한다 — id 동등 비교는 정확히 맞는 의미다.
 */
const SELECT_OPERATORS: Readonly<Record<string, OperatorSpec>> = Object.freeze({
  equals: TEXT_OPERATORS.equals,
  does_not_equal: TEXT_OPERATORS.does_not_equal,
  is_empty: TEXT_OPERATORS.is_empty,
  is_not_empty: TEXT_OPERATORS.is_not_empty,
})

/** 타입별 연산자. **축이 아니라 타입에 달린다**(select 이 텍스트와 다르기 때문). */
const BY_TYPE: Readonly<Record<MvpPropertyType, Readonly<Record<string, OperatorSpec>>>> =
  Object.freeze({
    title: TEXT_OPERATORS,
    rich_text: TEXT_OPERATORS,
    number: NUMBER_OPERATORS,
    select: SELECT_OPERATORS,
    status: SELECT_OPERATORS,
    checkbox: CHECKBOX_OPERATORS,
    date: DATE_OPERATORS,
  })

/** 이 타입이 노출하는 연산자 목록. 카탈로그와 같아야 한다(테스트가 확인). */
export function operatorsFor(type: MvpPropertyType): string[] {
  return Object.keys(BY_TYPE[type])
}

export function operatorArity(type: MvpPropertyType, operator: string): 0 | 1 | null {
  return BY_TYPE[type][operator]?.arity ?? null
}

// ── 검증 ─────────────────────────────────────────────────────────────

export type PropertyTypes = ReadonlyMap<string, string>

/**
 * AST 를 검증한다. **쓰기 경로에서만** 깊이를 본다.
 *
 * 정본 §3.5: *"필터 깊이 검증은 **쓰기 경로에만** 건다. 읽기 경로에 걸면 나중에
 * 상한을 낮출 때 기존 뷰가 통째로 열리지 않는다."*
 *
 * @param types `property_id → property.type`. **살아있는 프로퍼티만** 담겨야 한다.
 */
export function validateFilter(
  node: unknown,
  types: PropertyTypes,
  path = 'filter',
  depth = 1,
): ValidationIssue[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return [{ path, message: '객체여야 합니다' }]
  }
  if (depth > MAX_FILTER_DEPTH) {
    return [{ path, message: `필터 깊이가 상한(${MAX_FILTER_DEPTH})을 넘습니다` }]
  }

  const obj = node as Record<string, unknown>

  if ('op' in obj) {
    if (obj.op !== 'and' && obj.op !== 'or') {
      return [{ path: `${path}.op`, message: "'and' 또는 'or' 여야 합니다" }]
    }
    if (!Array.isArray(obj.children)) {
      return [{ path: `${path}.children`, message: '배열이어야 합니다' }]
    }
    if (obj.children.length > MAX_FILTER_GROUP_ITEMS) {
      return [
        { path: `${path}.children`, message: `항목이 ${MAX_FILTER_GROUP_ITEMS}개를 넘습니다` },
      ]
    }
    return obj.children.flatMap((child, i) =>
      validateFilter(child, types, `${path}.children[${i}]`, depth + 1),
    )
  }

  // ── 리프 ──
  if (typeof obj.property_id !== 'string') {
    return [{ path: `${path}.property_id`, message: '문자열이어야 합니다' }]
  }
  const rawType = types.get(obj.property_id)
  if (rawType === undefined) {
    // F-03-17 엣지 케이스: *"필터가 참조하던 프로퍼티 삭제 → 규칙이 무효 상태.
    // 결과 0건으로 두면 **데이터 소실로 오인된다** → 규칙을 비활성 표시하고
    // 무시하는 편이 안전."* 읽기 경로는 그렇게 한다(`compileFilter` 가 건너뛴다).
    // 쓰기 경로에서는 거부한다 — 없는 프로퍼티로 규칙을 **새로 만들** 이유가 없다.
    return [{ path: `${path}.property_id`, message: '없는 프로퍼티입니다' }]
  }
  if (!isMvpPropertyType(rawType)) {
    return [{ path: `${path}.property_id`, message: `필터할 수 없는 타입입니다: ${rawType}` }]
  }

  const spec = BY_TYPE[rawType][String(obj.operator)]
  if (spec === undefined) {
    return [
      {
        path: `${path}.operator`,
        message: `${rawType} 에 없는 연산자입니다: ${String(obj.operator)}`,
      },
    ]
  }
  if (spec.arity === 1 && (obj.value === undefined || obj.value === null)) {
    return [{ path: `${path}.value`, message: '값이 필요합니다' }]
  }
  return []
}

export function validateSorts(sorts: unknown, types: PropertyTypes): ValidationIssue[] {
  if (!Array.isArray(sorts)) return [{ path: 'sorts', message: '배열이어야 합니다' }]
  if (sorts.length > MAX_SORT_KEYS) {
    return [{ path: 'sorts', message: `정렬 키가 ${MAX_SORT_KEYS}개를 넘습니다` }]
  }
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const [i, raw] of sorts.entries()) {
    const key = raw as Record<string, unknown>
    if (typeof key?.property_id !== 'string' || !types.has(key.property_id)) {
      issues.push({ path: `sorts[${i}].property_id`, message: '없는 프로퍼티입니다' })
      continue
    }
    if (key.direction !== 'asc' && key.direction !== 'desc') {
      issues.push({ path: `sorts[${i}].direction`, message: "'asc' 또는 'desc' 여야 합니다" })
    }
    // 같은 프로퍼티로 두 번 정렬하면 두 번째 키가 아무 일도 하지 않는다.
    // 조용히 무시하면 사용자는 자기 설정이 먹은 줄 안다.
    if (seen.has(key.property_id)) {
      issues.push({ path: `sorts[${i}].property_id`, message: '이미 정렬 키로 쓰였습니다' })
    }
    seen.add(key.property_id)
  }
  return issues
}

// ── 컴파일 ────────────────────────────────────────────────────────────

/**
 * 파라미터를 모으는 그릇.
 *
 * `$n` 번호를 발급하고 값을 순서대로 쌓는다. 호출자가 시작 번호를 주므로
 * 바깥 질의의 파라미터와 겹치지 않는다.
 */
export class ParamBag {
  readonly values: unknown[] = []
  private next: number

  constructor(startAt: number) {
    this.next = startAt
  }

  /** 값을 담고 `$n` 을 돌려준다. */
  bind(value: unknown): string {
    this.values.push(value)
    const n = this.next
    this.next += 1
    return `$${n}`
  }
}

/** 사이드카 값으로 바인딩할 모양으로 바꾼다. */
function bindValue(type: MvpPropertyType, value: unknown): unknown {
  switch (AXIS[type]) {
    case 'num':
      return typeof value === 'number' ? value : Number(value)
    case 'bool':
      return value === true || value === 'true'
    case 'date':
      // 문자열 그대로 넘기고 `::timestamptz` 가 해석한다. `Date` 객체면 ISO 로.
      return value instanceof Date ? value.toISOString() : String(value)
    case 'text':
      // select 는 옵션 id, 나머지는 평문. 둘 다 문자열이다.
      return String(value)
  }
}

/**
 * FilterNode 를 SQL 술어로 컴파일한다.
 *
 * 바깥 질의에 `page p` 별칭이 있다고 전제한다 — 상관 서브쿼리가 `p.id` 를 본다.
 *
 * @returns 술어 문자열. 걸릴 것이 없으면 `null`(호출자가 `WHERE` 에서 뺀다).
 */
export function compileFilter(
  node: FilterNode | null | undefined,
  types: PropertyTypes,
  params: ParamBag,
): string | null {
  if (node === null || node === undefined) return null

  if (isGroup(node)) {
    const parts = node.children
      .map((child) => compileFilter(child, types, params))
      .filter((s): s is string => s !== null)
    if (parts.length === 0) return null
    // 한 항목이면 괄호를 씌우지 않는다 — 읽기 어려운 SQL 이 디버깅을 어렵게 한다.
    if (parts.length === 1) return parts[0]
    return `(${parts.join(node.op === 'and' ? ' AND ' : ' OR ')})`
  }

  const rawType = types.get(node.property_id)
  // ★ F-03-17: 지워진 프로퍼티를 참조하는 규칙은 **무시한다.** 결과 0건으로
  //   만들면 사용자가 데이터 소실로 오인한다.
  if (rawType === undefined || !isMvpPropertyType(rawType)) return null

  const axis = AXIS[rawType]
  const spec = BY_TYPE[rawType][node.operator]
  // 모르는 연산자도 무시한다. 여기서 던지면 카탈로그를 줄이는 날 기존 뷰가
  // 통째로 열리지 않는다(정본: 읽기 경로에 검증을 걸지 않는 이유와 같다).
  if (spec === undefined) return null

  const propParam = params.bind(node.property_id)
  const valueParam = spec.arity === 1 ? params.bind(bindValue(rawType, node.value)) : ''
  const inner = spec.predicate(COLUMN[axis], valueParam, CAST[axis])

  const exists = `EXISTS (SELECT 1 FROM page_property_value v
          WHERE v.page_id = p.id AND v.property_id = ${propParam} AND ${inner})`

  return spec.negate ? `NOT ${exists}` : exists
}

export type CompiledSort = {
  /** `ORDER BY` 에 그대로 넣는 조각들. 마지막에 안정 정렬 타이브레이커가 붙는다. */
  readonly orderBy: string
  /**
   * 커서 비교에 쓰는 정렬 식들. `orderBy` 와 같은 순서다.
   *
   * `cast` 를 함께 들고 다니는 이유: 커서 파라미터가 `IS NOT NULL` 에서 처음
   * 쓰이면 Postgres 가 타입을 추론할 수 없어 **`could not determine data type of
   * parameter` 로 질의가 죽는다.** 실제로 그렇게 실패했다 — 비교 상대가 되는
   * 사이드카 컬럼의 타입을 여기서 알려 줘야 한다.
   */
  readonly keys: readonly {
    readonly expr: string
    readonly direction: 'asc' | 'desc'
    readonly cast: string
  }[]
}

/**
 * 정렬 키를 `ORDER BY` 로 컴파일한다.
 *
 * EAV 라 정렬 값이 다른 표에 있다. 상관 스칼라 서브쿼리로 꺼낸다 —
 * `page_property_value` 의 PK 가 `(page_id, property_id)` 이므로 인덱스 한 번이다.
 *
 * **`NULLS LAST` 로 고정한다.** 빈 칸이 먼저 오면 "정렬했는데 빈 행이 위에
 * 쌓이는" 표가 된다. 내림차순에서도 NULL 을 뒤로 보낸다 — 방향이 바뀌어도
 * "빈 칸은 맨 아래"가 유지되는 편이 예측 가능하다.
 *
 * 마지막에 **`b.order_key` 를 항상 덧붙인다.** F-03-17: *"정렬 키 동률 → 안정
 * 정렬 보장을 위해 마지막 키로 order_idx 또는 page.id 를 항상 덧붙인다."*
 * 없으면 같은 값을 가진 행들의 순서가 질의마다 달라지고, keyset 커서가 행을
 * 건너뛰거나 중복시킨다.
 */
export function compileSorts(
  sorts: readonly SortKey[],
  types: PropertyTypes,
  params: ParamBag,
): CompiledSort {
  const keys: { expr: string; direction: 'asc' | 'desc'; cast: string }[] = []

  for (const sort of sorts) {
    const rawType = types.get(sort.property_id)
    if (rawType === undefined || !isMvpPropertyType(rawType)) continue // 지워진 프로퍼티
    const column = COLUMN[AXIS[rawType]].replace('v.', 'sv.')
    const param = params.bind(sort.property_id)
    keys.push({
      expr: `(SELECT ${column} FROM page_property_value sv
                WHERE sv.page_id = p.id AND sv.property_id = ${param})`,
      direction: sort.direction,
      cast: CAST[AXIS[rawType]],
    })
  }

  const parts = keys.map((k) => `${k.expr} ${k.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`)
  // 타이브레이커. `COLLATE "C"` 는 fractional index 가 이진 순서를 전제하기
  // 때문이다(마이그레이션 0008 과 같은 이유).
  parts.push('b.order_key COLLATE "C" ASC')

  return { orderBy: parts.join(', '), keys }
}

/**
 * keyset 커서 술어.
 *
 * OFFSET 을 쓰지 않는 이유는 정본의 페이지네이션 규칙이다 — 뒤 페이지로 갈수록
 * 느려지고, 순회 중 행이 삽입되면 **항목을 건너뛴다.**
 *
 * 생성 형태(정렬 키 2개 + 타이브레이커):
 *
 *   (k1 이 c1 보다 뒤)
 *   OR (k1 = c1 AND k2 가 c2 보다 뒤)
 *   OR (k1 = c1 AND k2 = c2 AND order_key > ck)
 *
 * **NULL 때문에 `=` 를 쓸 수 없다.** `NULL = NULL` 은 NULL 이라 같은 값(둘 다 빈
 * 칸)인 행이 조건에서 빠지고, 그러면 빈 칸 행들이 **두 번째 페이지에서 통째로
 * 사라진다.** `IS NOT DISTINCT FROM` 이 그 문제를 없앤다.
 *
 * "뒤"의 정의도 NULLS LAST 를 따라야 한다:
 *   · 커서 값이 NULL 이면 그 키로는 더 뒤가 없다(NULL 이 마지막이므로) → false
 *   · 커서 값이 있으면 `k IS NULL`(= 맨 뒤) 이거나 `k <방향> c`
 */
export function compileCursor(
  compiled: CompiledSort,
  cursorValues: readonly unknown[],
  params: ParamBag,
): string | null {
  if (cursorValues.length !== compiled.keys.length + 1) return null

  const bound = cursorValues.map((v) => params.bind(v))
  const clauses: string[] = []

  // 파라미터에 캐스트를 붙인다. 없으면 `IS NOT NULL` 에서 처음 쓰인 파라미터의
  // 타입을 Postgres 가 정하지 못해 질의가 죽는다(`CompiledSort.keys.cast` 주석).
  const typed = compiled.keys.map((k, j) => `${bound[j]}${k.cast}`)

  for (const [i, key] of compiled.keys.entries()) {
    const equals = compiled.keys
      .slice(0, i)
      .map((k, j) => `${k.expr} IS NOT DISTINCT FROM ${typed[j]}`)
    const op = key.direction === 'asc' ? '>' : '<'
    // 커서 값이 NULL 이면 전체가 false 가 된다 — NULLS LAST 에서 NULL 보다 뒤는 없다.
    const after = `(${typed[i]} IS NOT NULL AND (${key.expr} IS NULL OR ${key.expr} ${op} ${typed[i]}))`
    clauses.push([...equals, after].join(' AND '))
  }

  // 모든 정렬 키가 같으면 타이브레이커로 나아간다.
  const tieEquals = compiled.keys.map((k, j) => `${k.expr} IS NOT DISTINCT FROM ${typed[j]}`)
  const last = bound[bound.length - 1]
  clauses.push(
    [...tieEquals, `b.order_key COLLATE "C" > ${last}::text COLLATE "C"`].join(' AND '),
  )

  return `(${clauses.map((c) => `(${c})`).join(' OR ')})`
}
