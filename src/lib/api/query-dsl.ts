/**
 * 공개 API 의 질의 DSL — 노션의 `filter` · `sorts` → 앱의 `FilterNode` · `SortKey` (API-4 · F-09-16 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ ⑧ · 09-api-integrations.md F-09-16(타입 → 연산자 표 · compound · 정렬) · F-09-04(커서)
 *
 * **SQL 을 여기서 만들지 않는다** — 노션의 모양을 앱의 필터 트리로 옮길 뿐이고, 컴파일 · 권한 술어 · keyset 커서는 앱의 행 질의
 * (`database/query.ts` `queryRows` + `filter.ts`)가 한다. 그래서 거르는 뜻은 표 화면의 필터와 같다(빈 칸은 `does_not_equal` 에 걸린다 ·
 * 날짜는 하루 단위 · 글은 대소문자를 가리지 않는다).
 *
 *   · 속성은 이름 또는 id 로(페이지 쓰기와 같은 `findProperty` — 제목은 `'title'` 도). 없으면 노션의 글(`Could not find property with name or id`)
 *   · 필터의 열쇠는 속성의 타입이다(`{"property":"점수","number":{…}}`). 글 계열(제목 · URL · 이메일 · 전화)은 `rich_text` 도 · 만든/고친
 *     시각은 `date` 도 · 만든/고친 사람은 `people` 도 받는다(노션 SDK 가 그렇게 보낸다)
 *   · 선택 · 상태 · 다중 선택의 값은 **옵션 이름**(노션) — 그 이름의 옵션 id 로 옮긴다. 없는 이름은 아무 옵션도 아닌 id(같음은 0행 · 같지
 *     않음은 모든 행 — 거부하지 않는다)
 *   · 사람의 `"me"` 는 토큰의 사람(앱의 "나" — `ME_NODE`)
 *   · `timestamp` 필터 · 정렬은 행 자신의 만든 · 고친 시각(`ROW_TIMESTAMP_KEYS` — 속성이 없어도 된다)
 *   · 수식은 결과 타입의 열쇠로(`string` · `number` · `checkbox` · `date`) — 결과 타입과 다르면 거부한다
 *   · **rollup 으로는 거르지 않는다** — 앱의 rollup 은 저장된 값이 없어(정본 D1) 필터 컴파일러가 표현하지 못한다. 400 으로 그렇다고 말한다
 *     (장소 · 버튼도 노션에 필터가 없다)
 *   · compound(`and` · `or`)는 두 겹까지(노션 *"up to two levels deep"* — 앱의 `MAX_FILTER_DEPTH` 3 은 잎까지 센 같은 깊이다) · 배열마다 100개
 *   · 상대 날짜(`past_week: {}` …)는 앱의 상대 날짜 연산자 그대로 — 오늘은 앱처럼 보는 사람의 시간대지만 토큰에는 쿠키가 없어 UTC 다
 *
 * 커서는 노션처럼 속을 보이지 않는 글자다 — 속은 앱의 keyset 커서 · 지금까지 준 행 수(10,000 상한을 센다) · **질의의 지문**(소스 · 옮긴
 * 필터 · 정렬 · 휴지통 여부의 해시). 다른 질의의 커서는 400 이다. 서명은 하지 않는다 — 커서를 고쳐도 볼 수 있는 행 밖으로 나갈 수 없다
 * (권한 술어가 커서보다 먼저다).
 */

import { createHash } from 'node:crypto'

import {
  MAX_FILTER_GROUP_ITEMS,
  ME_NODE,
  ROW_TIMESTAMP_KEYS,
  type FilterLeaf,
  type FilterNode,
  type SortKey,
} from '../database/filter.ts'
import { readFormulaConfig } from '../database/formula-schema.ts'
import { RELATIVE_DATE_OPERATORS } from '../database/relative-date.ts'
import type { SelectOption } from '../database/property-types.ts'
import { findProperty, type ApiProperty } from './property-values.ts'
import { parseApiId, shownValue } from './v1-protocol.ts'

/** compound 를 몇 겹까지 — 노션의 두 겹. */
export const API_FILTER_MAX_DEPTH = 2
/** compound 배열 · 정렬 배열의 상한 — 노션의 `maxItems: 100`. */
export const API_FILTER_MAX_ITEMS = MAX_FILTER_GROUP_ITEMS
export const API_MAX_SORTS = 100

/** 아무 옵션도 아닌 id — 없는 옵션 이름으로 거를 때(같음은 0행 · 같지 않음은 모든 행). */
const NO_OPTION = '00000000-0000-0000-0000-000000000000'

export type DslResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }
const ok = <T>(value: T): DslResult<T> => ({ ok: true, value })
const no = <T>(message: string): DslResult<T> => ({ ok: false, message })

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── 조건의 모양 ───────────────────────────────────────────────────────

/** 값의 모양 — 연산자마다 하나. */
type ValueKind = 'string' | 'number' | 'boolean' | 'true' | 'empty_object' | 'date' | 'option' | 'person' | 'uuid' | 'verification'

type Family = Readonly<Record<string, ValueKind>>

const TEXT: Family = {
  equals: 'string',
  does_not_equal: 'string',
  contains: 'string',
  does_not_contain: 'string',
  starts_with: 'string',
  ends_with: 'string',
  is_empty: 'true',
  is_not_empty: 'true',
}
const COMPARE: Family = {
  equals: 'number',
  does_not_equal: 'number',
  greater_than: 'number',
  greater_than_or_equal_to: 'number',
  less_than: 'number',
  less_than_or_equal_to: 'number',
}
const NUMBER: Family = { ...COMPARE, is_empty: 'true', is_not_empty: 'true' }
const CHECKBOX: Family = { equals: 'boolean', does_not_equal: 'boolean' }
const SELECT: Family = { equals: 'option', does_not_equal: 'option', is_empty: 'true', is_not_empty: 'true' }
const MULTI_SELECT: Family = { contains: 'option', does_not_contain: 'option', is_empty: 'true', is_not_empty: 'true' }
const DATE: Family = {
  equals: 'date',
  before: 'date',
  after: 'date',
  on_or_before: 'date',
  on_or_after: 'date',
  is_empty: 'true',
  is_not_empty: 'true',
  ...Object.fromEntries(RELATIVE_DATE_OPERATORS.map((op) => [op, 'empty_object' as const])),
}
const PEOPLE: Family = { contains: 'person', does_not_contain: 'person', is_empty: 'true', is_not_empty: 'true' }
const RELATION: Family = { contains: 'uuid', does_not_contain: 'uuid', is_empty: 'true', is_not_empty: 'true' }
const FILES: Family = { is_empty: 'true', is_not_empty: 'true' }
const VERIFICATION: Family = { status: 'verification', does_not_equal: 'verification' }

/** 속성 타입 → 조건의 모양 · 받는 열쇠(첫째가 노션의 이름). */
const BY_TYPE: Readonly<Record<string, { readonly family: Family; readonly keys: readonly string[] }>> = {
  title: { family: TEXT, keys: ['title', 'rich_text'] },
  rich_text: { family: TEXT, keys: ['rich_text'] },
  url: { family: TEXT, keys: ['url', 'rich_text'] },
  email: { family: TEXT, keys: ['email', 'rich_text'] },
  phone_number: { family: TEXT, keys: ['phone_number', 'rich_text'] },
  number: { family: NUMBER, keys: ['number'] },
  checkbox: { family: CHECKBOX, keys: ['checkbox'] },
  select: { family: SELECT, keys: ['select'] },
  status: { family: SELECT, keys: ['status'] },
  multi_select: { family: MULTI_SELECT, keys: ['multi_select'] },
  date: { family: DATE, keys: ['date'] },
  created_time: { family: DATE, keys: ['created_time', 'date'] },
  last_edited_time: { family: DATE, keys: ['last_edited_time', 'date'] },
  people: { family: PEOPLE, keys: ['people'] },
  created_by: { family: PEOPLE, keys: ['created_by', 'people'] },
  last_edited_by: { family: PEOPLE, keys: ['last_edited_by', 'people'] },
  relation: { family: RELATION, keys: ['relation'] },
  files: { family: FILES, keys: ['files'] },
  unique_id: { family: COMPARE, keys: ['unique_id'] },
  verification: { family: VERIFICATION, keys: ['verification'] },
}

/** 수식의 결과 타입 → 노션의 열쇠 · 조건의 모양. */
const FORMULA: Readonly<Record<string, { readonly key: string; readonly family: Family }>> = {
  text: { key: 'string', family: TEXT },
  number: { key: 'number', family: NUMBER },
  boolean: { key: 'checkbox', family: CHECKBOX },
  date: { key: 'date', family: DATE },
}

/** 앱의 연산자 이름 — 대부분 같다. 검증만 다르다(`is` · `is_not`). */
const APP_OPERATOR: Readonly<Record<string, string>> = { status: 'is', does_not_equal: 'is_not' }

/** 노션의 검증 상태 → 앱의 값. */
const VERIFICATION_VALUE: Readonly<Record<string, string>> = { verified: 'verified', expired: 'expired', none: 'unverified' }

/** 거르지 않는 타입과 그 까닭. */
const NOT_FILTERABLE: Readonly<Record<string, string>> = {
  rollup: 'Filtering by a rollup property is not supported: rollup values are computed when read and are not stored for filtering.',
  place: 'Filtering by a place property is not supported.',
  button: 'Filtering by a button property is not supported.',
}

/** ISO 8601 날짜 · 시각 — 하루(`2026-03-01`) · 시각(`2026-03-01T09:00`, 초 · 소수 · 시간대는 고른다). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d && !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v))
}

type Target = {
  /** 앱의 필터가 보는 열쇠 — 속성 id 또는 행 시각의 열쇠. */
  readonly propertyId: string
  readonly label: string
  readonly property: ApiProperty | null
  readonly family: Family
}

/** 조건 하나(`{ "equals": 3 }`) → 앱의 잎. 선택류 이름은 옵션 id 로 — 같은 이름이 여럿이면 묶음. */
function condition(target: Target, raw: unknown, path: string, options: readonly SelectOption[]): DslResult<FilterNode> {
  if (!isObject(raw)) return no(`body failed validation: ${path} should be an object, instead was ${shownValue(raw)}.`)
  const keys = Object.keys(raw)
  if (keys.length !== 1) {
    return no(`body failed validation: ${path} should have exactly one condition (${Object.keys(target.family).join(', ')}), instead had ${keys.length}.`)
  }
  const operator = keys[0]
  const kind = target.family[operator]
  if (kind === undefined) {
    return no(`body failed validation: ${path}.${operator} is not a supported condition for "${target.label}". Use one of: ${Object.keys(target.family).join(', ')}.`)
  }
  const value = raw[operator]
  const at = `${path}.${operator}`
  const appOperator = target.family === VERIFICATION ? APP_OPERATOR[operator] : operator
  const leaf = (v?: unknown): FilterLeaf =>
    v === undefined ? { property_id: target.propertyId, operator: appOperator } : { property_id: target.propertyId, operator: appOperator, value: v }

  switch (kind) {
    case 'string':
      return typeof value === 'string' ? ok(leaf(value)) : no(`body failed validation: ${at} should be a string, instead was ${shownValue(value)}.`)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? ok(leaf(value)) : no(`body failed validation: ${at} should be a number, instead was ${shownValue(value)}.`)
    case 'boolean':
      return typeof value === 'boolean' ? ok(leaf(value)) : no(`body failed validation: ${at} should be a boolean, instead was ${shownValue(value)}.`)
    case 'true':
      return value === true ? ok(leaf()) : no(`body failed validation: ${at} should be \`true\`, instead was ${shownValue(value)}.`)
    case 'empty_object':
      return isObject(value) && Object.keys(value).length === 0 ? ok(leaf()) : no(`body failed validation: ${at} should be an empty object \`{}\`, instead was ${shownValue(value)}.`)
    case 'date':
      return isIsoDate(value) ? ok(leaf(value)) : no(`body failed validation: ${at} should be an ISO 8601 date string, instead was ${shownValue(value)}.`)
    case 'person': {
      if (value === 'me') return ok(leaf(ME_NODE))
      const id = parseApiId(value)
      return id === null ? no(`body failed validation: ${at} should be a valid uuid or "me", instead was ${shownValue(value)}.`) : ok(leaf(id))
    }
    case 'uuid': {
      const id = parseApiId(value)
      return id === null ? no(`body failed validation: ${at} should be a valid uuid, instead was ${shownValue(value)}.`) : ok(leaf(id))
    }
    case 'verification': {
      const mapped = typeof value === 'string' ? VERIFICATION_VALUE[value] : undefined
      return mapped === undefined ? no(`body failed validation: ${at} should be "verified", "expired" or "none", instead was ${shownValue(value)}.`) : ok(leaf(mapped))
    }
    case 'option': {
      if (typeof value !== 'string') return no(`body failed validation: ${at} should be a string, instead was ${shownValue(value)}.`)
      const byName = options.filter((o) => o.name === value)
      const ids = (byName.length > 0 ? byName : options.filter((o) => o.id === value)).map((o) => o.id)
      if (ids.length <= 1) return ok(leaf(ids[0] ?? NO_OPTION))
      // 같은 이름의 옵션이 여럿 — 같음 · 포함은 어느 하나, 같지 않음 · 포함하지 않음은 모두 아니다
      const negative = operator === 'does_not_equal' || operator === 'does_not_contain'
      return ok({ op: negative ? 'and' : 'or', children: ids.map((id) => leaf(id)) })
    }
  }
}

/** 속성 필터 하나(`{ "property": "점수", "number": { … } }`). */
function propertyFilter(
  raw: Record<string, unknown>,
  path: string,
  schema: readonly ApiProperty[],
  options: ReadonlyMap<string, readonly SelectOption[]>,
): DslResult<FilterNode> {
  if (typeof raw.property !== 'string' || raw.property === '') {
    return no(`body failed validation: ${path}.property should be a string, instead was ${shownValue(raw.property)}.`)
  }
  const property = findProperty(schema, raw.property)
  if (property === null) return no(`Could not find property with name or id: ${raw.property}`)
  const rest = Object.keys(raw).filter((k) => k !== 'property' && k !== 'type')
  if (rest.length !== 1) {
    return no(`body failed validation: ${path} should have exactly one filter condition for property "${property.name}", instead had ${rest.length}.`)
  }
  const key = rest[0]
  if (raw.type !== undefined && raw.type !== key) return no(`body failed validation: ${path}.type should be ${shownValue(key)}, instead was ${shownValue(raw.type)}.`)
  const at = `${path}.${key}`

  const unsupported = NOT_FILTERABLE[property.type]
  if (unsupported !== undefined) return no(`${unsupported} (property "${property.name}")`)

  if (property.type === 'formula') {
    if (key !== 'formula') return no(`body failed validation: property "${property.name}" is a formula property — use the "formula" filter, instead was ${shownValue(key)}.`)
    const resultType = readFormulaConfig(property.config)?.result_type
    const spec = resultType === undefined ? undefined : FORMULA[resultType]
    if (spec === undefined) return no(`Formula property "${property.name}" has no result type that can be filtered.`)
    const inner = raw.formula
    if (!isObject(inner) || Object.keys(inner).length !== 1) {
      return no(`body failed validation: ${at} should be an object with one of "string", "number", "checkbox" or "date".`)
    }
    const innerKey = Object.keys(inner)[0]
    if (innerKey !== spec.key) {
      return no(`body failed validation: formula property "${property.name}" returns ${spec.key} — use ${at}.${spec.key}, instead was ${shownValue(innerKey)}.`)
    }
    return condition({ propertyId: property.id, label: property.name, property, family: spec.family }, inner[innerKey], `${at}.${innerKey}`, [])
  }

  const spec = BY_TYPE[property.type]
  if (spec === undefined) return no(`Filtering by a ${property.type} property is not supported. (property "${property.name}")`)
  if (!spec.keys.includes(key)) {
    return no(`body failed validation: property "${property.name}" is a ${property.type} property — use the "${spec.keys[0]}" filter, instead was ${shownValue(key)}.`)
  }
  return condition({ propertyId: property.id, label: property.name, property, family: spec.family }, raw[key], at, options.get(property.id) ?? [])
}

/** 행 시각 필터(`{ "timestamp": "created_time", "created_time": { … } }`). */
function timestampFilter(raw: Record<string, unknown>, path: string): DslResult<FilterNode> {
  const which = raw.timestamp
  if (which !== 'created_time' && which !== 'last_edited_time') {
    return no(`body failed validation: ${path}.timestamp should be "created_time" or "last_edited_time", instead was ${shownValue(which)}.`)
  }
  const extra = Object.keys(raw).find((k) => k !== 'timestamp' && k !== 'type' && k !== which)
  if (extra !== undefined) return no(`body failed validation: ${path}.${extra} should be not present, instead was ${shownValue(raw[extra])}.`)
  if (!(which in raw)) return no(`body failed validation: ${path}.${which} should be defined, instead was \`undefined\`.`)
  return condition({ propertyId: ROW_TIMESTAMP_KEYS[which], label: which, property: null, family: DATE }, raw[which], `${path}.${which}`, [])
}

function node(
  raw: unknown,
  path: string,
  depth: number,
  schema: readonly ApiProperty[],
  options: ReadonlyMap<string, readonly SelectOption[]>,
): DslResult<FilterNode> {
  if (!isObject(raw)) return no(`body failed validation: ${path} should be an object, instead was ${shownValue(raw)}.`)
  const compound = 'and' in raw ? 'and' : 'or' in raw ? 'or' : null
  if (compound !== null) {
    if (Object.keys(raw).length !== 1) return no(`body failed validation: ${path} should have only one of "and" or "or".`)
    if (depth >= API_FILTER_MAX_DEPTH) {
      return no(`body failed validation: ${path}.${compound} is nested too deeply. Compound filters can be nested at most ${API_FILTER_MAX_DEPTH} levels deep.`)
    }
    const items = raw[compound]
    if (!Array.isArray(items)) return no(`body failed validation: ${path}.${compound} should be an array, instead was ${shownValue(items)}.`)
    if (items.length > API_FILTER_MAX_ITEMS) {
      return no(`body failed validation: ${path}.${compound}.length should be ≤ ${API_FILTER_MAX_ITEMS}, instead was ${items.length}.`)
    }
    const children: FilterNode[] = []
    for (const [i, item] of items.entries()) {
      const child = node(item, `${path}.${compound}[${i}]`, depth + 1, schema, options)
      if (!child.ok) return child
      children.push(child.value)
    }
    return ok({ op: compound, children })
  }
  if ('timestamp' in raw) return timestampFilter(raw, path)
  if ('property' in raw) return propertyFilter(raw, path, schema, options)
  return no(`body failed validation: ${path} should have "property", "timestamp", "and" or "or".`)
}

/** `filter` → 앱의 필터 트리. 없으면(`undefined` · `null`) 모든 행. */
export function translateFilter(
  raw: unknown,
  schema: readonly ApiProperty[],
  options: ReadonlyMap<string, readonly SelectOption[]>,
): DslResult<FilterNode | null> {
  if (raw === undefined || raw === null) return ok(null)
  return node(raw, 'body.filter', 0, schema, options)
}

/** 정렬할 수 없는 타입 — 값이 집합이거나(사람 · 연결 · 파일) 저장된 값이 없다(rollup) · 값이 없다(버튼). */
const NOT_SORTABLE = new Set(['people', 'created_by', 'last_edited_by', 'relation', 'files', 'rollup', 'button'])

/** `sorts` → 앱의 정렬 키(배열의 차례가 우선순위). 같은 속성을 두 번 주면 첫째만 쓴다(둘째는 아무 일도 하지 않는다). */
export function translateSorts(raw: unknown, schema: readonly ApiProperty[]): DslResult<SortKey[]> {
  if (raw === undefined || raw === null) return ok([])
  if (!Array.isArray(raw)) return no(`body failed validation: body.sorts should be an array, instead was ${shownValue(raw)}.`)
  if (raw.length > API_MAX_SORTS) return no(`body failed validation: body.sorts.length should be ≤ ${API_MAX_SORTS}, instead was ${raw.length}.`)
  const out: SortKey[] = []
  for (const [i, item] of raw.entries()) {
    const at = `body.sorts[${i}]`
    if (!isObject(item)) return no(`body failed validation: ${at} should be an object, instead was ${shownValue(item)}.`)
    if (item.direction !== 'ascending' && item.direction !== 'descending') {
      return no(`body failed validation: ${at}.direction should be "ascending" or "descending", instead was ${shownValue(item.direction)}.`)
    }
    const direction = item.direction === 'ascending' ? 'asc' : 'desc'
    const extra = Object.keys(item).find((k) => k !== 'direction' && k !== 'property' && k !== 'timestamp')
    if (extra !== undefined) return no(`body failed validation: ${at}.${extra} should be not present, instead was ${shownValue(item[extra])}.`)
    let propertyId: string
    if (item.timestamp !== undefined) {
      if (item.property !== undefined) return no(`body failed validation: ${at} should have either "property" or "timestamp", not both.`)
      if (item.timestamp !== 'created_time' && item.timestamp !== 'last_edited_time') {
        return no(`body failed validation: ${at}.timestamp should be "created_time" or "last_edited_time", instead was ${shownValue(item.timestamp)}.`)
      }
      propertyId = ROW_TIMESTAMP_KEYS[item.timestamp]
    } else {
      if (typeof item.property !== 'string' || item.property === '') {
        return no(`body failed validation: ${at}.property should be a string, instead was ${shownValue(item.property)}.`)
      }
      const property = findProperty(schema, item.property)
      if (property === null) return no(`Could not find sort property with name or id: ${item.property}`)
      if (NOT_SORTABLE.has(property.type)) return no(`Sorting by a ${property.type} property is not supported. (property "${property.name}")`)
      if (property.type === 'formula' && FORMULA[readFormulaConfig(property.config)?.result_type ?? ''] === undefined) {
        return no(`Formula property "${property.name}" has no result type that can be sorted.`)
      }
      // 장소는 거르지 않지만 이름으로 정렬한다(앱의 정렬과 같다)
      if (property.type !== 'formula' && property.type !== 'place' && BY_TYPE[property.type] === undefined) {
        return no(`Sorting by a ${property.type} property is not supported. (property "${property.name}")`)
      }
      propertyId = property.id
    }
    if (!out.some((s) => s.property_id === propertyId)) out.push({ property_id: propertyId, direction })
  }
  return ok(out)
}

// ── 커서 ──────────────────────────────────────────────────────────────

/** 질의의 지문 — 같은 소스 · 같은 필터(옮긴 뒤 — 이름과 id 는 같은 질의다) · 같은 정렬 · 같은 휴지통 여부. */
export function queryFingerprint(dataSourceId: string, filter: FilterNode | null, sorts: readonly SortKey[], trashed: boolean): string {
  return createHash('sha256').update(JSON.stringify([dataSourceId, filter, sorts, trashed])).digest('hex').slice(0, 24)
}

export type QueryCursor = {
  /** 질의의 지문. */
  readonly fingerprint: string
  /** 지금까지 준 행 수 — 10,000 상한을 센다. */
  readonly consumed: number
  /** 앱의 keyset 커서(`queryRows` 의 `nextCursor`). */
  readonly engine: string
}

export function encodeQueryCursor(cursor: QueryCursor): string {
  return Buffer.from(JSON.stringify({ h: cursor.fingerprint, n: cursor.consumed, c: cursor.engine }), 'utf8').toString('base64url')
}

/** 모양이 아니면 null(400). 지문은 부르는 쪽이 견준다. */
export function decodeQueryCursor(raw: unknown): QueryCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!isObject(parsed)) return null
    const { h, n, c } = parsed
    if (typeof h !== 'string' || !/^[0-9a-f]{24}$/.test(h)) return null
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null
    if (typeof c !== 'string' || c.length === 0 || c.length > 4096) return null
    return { fingerprint: h, consumed: n, engine: c }
  } catch {
    return null
  }
}
