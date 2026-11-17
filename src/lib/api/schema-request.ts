/**
 * 공개 API 의 구조 쓰기 요청 — 노션 `2025-09-03` 의 property schema(만들기 · 고치기) → 우리 변경의 차례 (API-4b · F-09-01 · F-09-16 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑨ · `schema-object.ts`(읽기의 모양)
 *
 * **쓰기는 읽기가 주는 것을 그대로 받는다** — `GET /v1/data_sources/{id}` 의 `properties` 를 그대로 돌려보내면 아무것도 바뀌지 않는다
 * (`id` · `name` · `type` · `description` · `<type>` 설정 · 상태의 `groups` · relation 의 `dual_property` · rollup 의 이름 칸까지 받는다).
 *
 *   · 열쇠는 이름 또는 id(제목은 `'title'`). `null` 은 지우기 · 다른 타입 열쇠는 타입 바꾸기 · 같은 타입 열쇠는 설정 고치기 · `name` 은
 *     이름 바꾸기 · 없는 이름은 새로 만들기(타입 열쇠가 있어야 한다)
 *   · 선택류의 `options` 는 남길 목록 전부다(노션) — id(만들 때는 무시) 또는 이름(대소문자 · 앞뒤 공백 무시)으로 있는 것을 잡고, 없는 이름은
 *     더하고, 빠진 것은 지운다. id 로 잡은 옵션은 이름도 바꾼다(노션은 못 한다 — 앱은 한다) · 색 · 상태의 범주도
 *   · 받지 않는 것 — 제목의 지우기 · 타입 바꾸기 · 둘째 제목 · 버튼 만들기(동작은 앱에서 짠다) · 앱에 없는 타입(`location` ·
 *     `last_visited_time`) · 숫자의 표시 형식(앱에 없다 — `"number"` 만) · 옵션의 설명
 *
 * 차례는 지우기 → 있는 속성 고치기(이름 · 설명 → 타입 → 설정) → 만들기(일반 → relation → rollup → 수식 — 뒤의 것이 앞의 것을 가리킬 수
 * 있다). 지운 이름을 새 속성이 다시 쓸 수 있다.
 */

import {
  OPTION_COLORS,
  isOptionColor,
  isStatusGroupKind,
  type OptionColor,
  type SelectOption,
  type StatusGroupKind,
} from '../database/property-types.ts'
import { isRollupFunction, ROLLUP_FUNCTIONS, type RollupFunction } from '../database/rollup-functions.ts'
import { canConvert } from '../database/type-conversion.ts'
import { TITLE_PROPERTY_ID } from './property-values.ts'
import { STATUS_GROUP_API } from './schema-object.ts'
import { parseApiId, shownValue } from './v1-protocol.ts'

/** 노션 요청의 옵션 목록 상한(`options` max 100). */
export const MAX_SCHEMA_OPTIONS = 100

/** 설정이 없는 타입(`{}`). 버튼은 읽기의 왕복을 위해 받고 만들기만 거부한다. */
const PLAIN_TYPES = [
  'title',
  'rich_text',
  'checkbox',
  'date',
  'people',
  'files',
  'url',
  'email',
  'phone_number',
  'place',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'verification',
  'button',
] as const
type PlainType = (typeof PLAIN_TYPES)[number]
const OPTION_TYPES = ['select', 'multi_select', 'status'] as const
type OptionType = (typeof OPTION_TYPES)[number]
const SCHEMA_TYPES: readonly string[] = [...PLAIN_TYPES, ...OPTION_TYPES, 'number', 'formula', 'relation', 'rollup', 'unique_id']
/** 노션에는 있지만 앱에 없는 타입. */
const FOREIGN_TYPES: readonly string[] = ['location', 'last_visited_time']

export type OptionRequest = {
  readonly id?: string
  readonly name?: string
  readonly color?: OptionColor
  /** 상태의 범주 — 노션의 이름(`To-do` · `In progress` · `Complete`) · 우리 kind · 범주 id. 맞출 때 푼다. */
  readonly group?: string
}

export type RefRequest = { readonly id?: string; readonly name?: string }

export type TypeConfig =
  | { readonly type: PlainType | 'number' }
  | { readonly type: OptionType; readonly options?: readonly OptionRequest[] }
  | { readonly type: 'formula'; readonly expression?: string }
  /** `dual` — 양방향이면 그 짝(이름 · id), 단방향이면 null, 말하지 않았으면 없다. */
  | { readonly type: 'relation'; readonly dataSourceId?: string; readonly dual?: { readonly syncedName?: string; readonly syncedId?: string } | null }
  | { readonly type: 'rollup'; readonly relation?: RefRequest; readonly target?: RefRequest; readonly function?: RollupFunction }
  | { readonly type: 'unique_id'; readonly prefix?: string | null }

export type PropertyRequest = {
  readonly id?: string
  readonly name?: string
  readonly description?: string | null
  readonly config?: TypeConfig
}

/** 요청의 한 줄 — 열쇠 · 오류 글의 자리 · 지우기면 null. */
export type SchemaEntry = { readonly key: string; readonly path: string; readonly request: PropertyRequest | null }

type Parse<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }
const ok = <T>(value: T): Parse<T> => ({ ok: true, value })
const no = <T>(message: string): Parse<T> => ({ ok: false, message })

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 받지 않는 열쇠 — 노션의 말투. 없으면 null. */
function extraKey(raw: Record<string, unknown>, allowed: readonly string[], path: string): string | null {
  const extra = Object.keys(raw).find((k) => !allowed.includes(k))
  return extra === undefined ? null : `${path}.${extra} should be not present, instead was ${shownValue(raw[extra])}.`
}

const optionalString = (raw: unknown, path: string): Parse<string | undefined> =>
  raw === undefined || raw === null ? ok(undefined) : typeof raw === 'string' ? ok(raw) : no(`${path} should be a string, instead was ${shownValue(raw)}.`)

// ── 읽기 ──────────────────────────────────────────────────────────────

function parseOptions(raw: unknown, path: string, type: OptionType): Parse<readonly OptionRequest[] | undefined> {
  if (raw === undefined) return ok(undefined)
  if (!Array.isArray(raw)) return no(`${path} should be an array, instead was ${shownValue(raw)}.`)
  if (raw.length > MAX_SCHEMA_OPTIONS) return no(`${path} should have at most ${MAX_SCHEMA_OPTIONS} items, instead had ${raw.length}.`)
  const out: OptionRequest[] = []
  for (const [i, item] of raw.entries()) {
    const at = `${path}[${i}]`
    if (!isObject(item)) return no(`${at} should be an object, instead was ${shownValue(item)}.`)
    const extra = extraKey(item, type === 'status' ? ['id', 'name', 'color', 'description', 'group'] : ['id', 'name', 'color', 'description'], at)
    if (extra !== null) return no(extra)
    const id = optionalString(item.id, `${at}.id`)
    if (!id.ok) return id
    const name = optionalString(item.name, `${at}.name`)
    if (!name.ok) return name
    if (id.value === undefined && (name.value === undefined || name.value.trim() === '')) return no(`${at} should have an id or a name.`)
    if (item.color !== undefined && item.color !== null && !isOptionColor(item.color)) {
      return no(`${at}.color should be one of ${OPTION_COLORS.map((c) => `"${c}"`).join(', ')}, instead was ${shownValue(item.color)}.`)
    }
    if (item.description !== undefined && item.description !== null && item.description !== '') {
      return no(`${at}.description — option descriptions are not supported by this app. Leave it out.`)
    }
    const group = optionalString(item.group, `${at}.group`)
    if (!group.ok) return group
    out.push({
      ...(id.value === undefined ? {} : { id: id.value }),
      ...(name.value === undefined ? {} : { name: name.value }),
      ...(isOptionColor(item.color) ? { color: item.color } : {}),
      ...(group.value === undefined ? {} : { group: group.value }),
    })
  }
  return ok(out)
}

function parseRef(idRaw: unknown, nameRaw: unknown, path: string, what: string): Parse<RefRequest | undefined> {
  const id = optionalString(idRaw, `${path}.${what}_id`)
  if (!id.ok) return id
  const name = optionalString(nameRaw, `${path}.${what}_name`)
  if (!name.ok) return name
  if (id.value === undefined && name.value === undefined) return ok(undefined)
  return ok({ ...(id.value === undefined ? {} : { id: id.value }), ...(name.value === undefined ? {} : { name: name.value }) })
}

/** `<type>` 자리의 설정. */
function parseConfig(type: string, raw: unknown, path: string): Parse<TypeConfig> {
  if (raw === undefined) return ok({ type } as TypeConfig)
  if (!isObject(raw)) return no(`${path} should be an object, instead was ${shownValue(raw)}.`)
  switch (type) {
    case 'number': {
      const extra = extraKey(raw, ['format'], path)
      if (extra !== null) return no(extra)
      if (raw.format !== undefined && raw.format !== 'number') {
        return no(`${path}.format ${shownValue(raw.format)} is not supported — numbers have no display format in this app. Use "number" or leave it out.`)
      }
      return ok({ type: 'number' })
    }
    case 'select':
    case 'multi_select':
    case 'status': {
      const extra = extraKey(raw, type === 'status' ? ['options', 'groups'] : ['options'], path)
      if (extra !== null) return no(extra)
      // 상태의 `groups` 는 읽기의 왕복을 위해 받는다 — 범주는 셋으로 고정이다(옵션의 범주는 옵션의 `group` 으로)
      if (raw.groups !== undefined && !Array.isArray(raw.groups)) return no(`${path}.groups should be an array, instead was ${shownValue(raw.groups)}.`)
      const options = parseOptions(raw.options, `${path}.options`, type)
      if (!options.ok) return options
      return ok(options.value === undefined ? { type } : { type, options: options.value })
    }
    case 'formula': {
      const extra = extraKey(raw, ['expression'], path)
      if (extra !== null) return no(extra)
      if (raw.expression !== undefined && typeof raw.expression !== 'string') {
        return no(`${path}.expression should be a string, instead was ${shownValue(raw.expression)}.`)
      }
      return ok(raw.expression === undefined ? { type: 'formula' } : { type: 'formula', expression: raw.expression })
    }
    case 'relation': {
      const extra = extraKey(raw, ['data_source_id', 'type', 'single_property', 'dual_property'], path)
      if (extra !== null) return no(extra)
      let dataSourceId: string | undefined
      if (raw.data_source_id !== undefined && raw.data_source_id !== null) {
        const id = parseApiId(raw.data_source_id)
        if (id === null) return no(`${path}.data_source_id should be a valid uuid, instead was ${shownValue(raw.data_source_id)}.`)
        dataSourceId = id
      }
      const kind = raw.type ?? (raw.dual_property !== undefined ? 'dual_property' : raw.single_property !== undefined ? 'single_property' : undefined)
      if (kind !== undefined && kind !== 'single_property' && kind !== 'dual_property') {
        return no(`${path}.type should be "single_property" or "dual_property", instead was ${shownValue(kind)}.`)
      }
      const other = kind === 'single_property' ? 'dual_property' : 'single_property'
      if (kind !== undefined && raw[other] !== undefined) return no(`${path}.${other} should be not present, instead was ${shownValue(raw[other])}.`)
      let dual: { syncedName?: string; syncedId?: string } | null | undefined
      if (kind === 'single_property') {
        if (raw.single_property !== undefined && (!isObject(raw.single_property) || Object.keys(raw.single_property).length > 0)) {
          return no(`${path}.single_property should be an empty object, instead was ${shownValue(raw.single_property)}.`)
        }
        dual = null
      } else if (kind === 'dual_property') {
        const d = raw.dual_property ?? {}
        if (!isObject(d)) return no(`${path}.dual_property should be an object, instead was ${shownValue(d)}.`)
        const dExtra = extraKey(d, ['synced_property_id', 'synced_property_name'], `${path}.dual_property`)
        if (dExtra !== null) return no(dExtra)
        const syncedId = optionalString(d.synced_property_id, `${path}.dual_property.synced_property_id`)
        if (!syncedId.ok) return syncedId
        const syncedName = optionalString(d.synced_property_name, `${path}.dual_property.synced_property_name`)
        if (!syncedName.ok) return syncedName
        dual = { ...(syncedId.value === undefined ? {} : { syncedId: syncedId.value }), ...(syncedName.value === undefined ? {} : { syncedName: syncedName.value }) }
      }
      return ok({ type: 'relation', ...(dataSourceId === undefined ? {} : { dataSourceId }), ...(dual === undefined ? {} : { dual }) })
    }
    case 'rollup': {
      const extra = extraKey(raw, ['function', 'relation_property_id', 'relation_property_name', 'rollup_property_id', 'rollup_property_name'], path)
      if (extra !== null) return no(extra)
      if (raw.function !== undefined && !isRollupFunction(raw.function)) {
        return no(`${path}.function should be one of ${ROLLUP_FUNCTIONS.map((f) => `"${f}"`).join(', ')}, instead was ${shownValue(raw.function)}.`)
      }
      const relation = parseRef(raw.relation_property_id, raw.relation_property_name, path, 'relation_property')
      if (!relation.ok) return relation
      const target = parseRef(raw.rollup_property_id, raw.rollup_property_name, path, 'rollup_property')
      if (!target.ok) return target
      return ok({
        type: 'rollup',
        ...(relation.value === undefined ? {} : { relation: relation.value }),
        ...(target.value === undefined ? {} : { target: target.value }),
        ...(isRollupFunction(raw.function) ? { function: raw.function } : {}),
      })
    }
    case 'unique_id': {
      const extra = extraKey(raw, ['prefix'], path)
      if (extra !== null) return no(extra)
      if (raw.prefix !== undefined && raw.prefix !== null && typeof raw.prefix !== 'string') {
        return no(`${path}.prefix should be a string or \`null\`, instead was ${shownValue(raw.prefix)}.`)
      }
      return ok(raw.prefix === undefined ? { type: 'unique_id' } : { type: 'unique_id', prefix: raw.prefix as string | null })
    }
    default: {
      const extra = extraKey(raw, [], path)
      return extra === null ? ok({ type } as TypeConfig) : no(extra)
    }
  }
}

/** 속성 하나의 요청(지우기는 null). */
function parsePropertyRequest(raw: unknown, path: string): Parse<PropertyRequest | null> {
  if (raw === null) return ok(null)
  if (!isObject(raw)) return no(`${path} should be an object or \`null\`, instead was ${shownValue(raw)}.`)
  const typeKeys = Object.keys(raw).filter((k) => SCHEMA_TYPES.includes(k) || FOREIGN_TYPES.includes(k))
  const extra = Object.keys(raw).find((k) => !['id', 'name', 'type', 'description'].includes(k) && !typeKeys.includes(k))
  if (extra !== undefined) return no(`${path}.${extra} should be not present, instead was ${shownValue(raw[extra])}.`)
  if (typeKeys.length > 1) return no(`${path} should have one property type, instead had ${typeKeys.map((k) => `"${k}"`).join(' and ')}.`)
  if (raw.type !== undefined && (typeof raw.type !== 'string' || (!SCHEMA_TYPES.includes(raw.type) && !FOREIGN_TYPES.includes(raw.type)))) {
    return no(`${path}.type should be a property type, instead was ${shownValue(raw.type)}.`)
  }
  if (raw.type !== undefined && typeKeys.length === 1 && typeKeys[0] !== raw.type) {
    return no(`${path}.type is "${String(raw.type)}" but the settings given are for "${typeKeys[0]}".`)
  }
  const type = typeKeys[0] ?? (raw.type as string | undefined)
  if (type !== undefined && FOREIGN_TYPES.includes(type)) return no(`${path}: the "${type}" property type is not supported by this app.`)

  const id = optionalString(raw.id, `${path}.id`)
  if (!id.ok) return id
  if (raw.name !== undefined && typeof raw.name !== 'string') return no(`${path}.name should be a string, instead was ${shownValue(raw.name)}.`)
  if (raw.description !== undefined && raw.description !== null && typeof raw.description !== 'string') {
    return no(`${path}.description should be a string or \`null\`, instead was ${shownValue(raw.description)}.`)
  }
  let config: TypeConfig | undefined
  if (type !== undefined) {
    const parsed = parseConfig(type, raw[type], `${path}.${type}`)
    if (!parsed.ok) return parsed
    config = parsed.value
  }
  return ok({
    ...(id.value === undefined ? {} : { id: id.value }),
    ...(raw.name === undefined ? {} : { name: raw.name as string }),
    ...(raw.description === undefined ? {} : { description: raw.description as string | null }),
    ...(config === undefined ? {} : { config }),
  })
}

/** `properties` → 줄들. 오류는 `body failed validation:` 뒤에 붙일 글이다. */
export function parseSchemaProperties(raw: unknown, path: string): Parse<SchemaEntry[]> {
  if (!isObject(raw)) return no(`${path} should be an object, instead was ${shownValue(raw)}.`)
  const entries: SchemaEntry[] = []
  for (const [key, value] of Object.entries(raw)) {
    const at = `${path}.${key}`
    const request = parsePropertyRequest(value, at)
    if (!request.ok) return request
    entries.push({ key, path: at, request: request.value })
  }
  return ok(entries)
}

// ── 계획 ──────────────────────────────────────────────────────────────

/** 지금 스키마의 속성 하나(계획이 보는 것). */
export type CurrentProperty = { readonly id: string; readonly name: string; readonly type: string; readonly description: string | null }

export type SchemaStep =
  | { readonly kind: 'delete'; readonly path: string; readonly property: CurrentProperty }
  | {
      readonly kind: 'edit'
      readonly path: string
      readonly property: CurrentProperty
      readonly name?: string
      readonly description?: string | null
      readonly convertTo?: string
      readonly config?: TypeConfig
    }
  | { readonly kind: 'create'; readonly path: string; readonly name: string; readonly description?: string | null; readonly config: TypeConfig }

/** 만들기의 차례 — 일반 → relation → rollup → 수식(뒤의 것이 앞의 것을 가리킬 수 있다). */
const CREATE_ORDER = (type: string) => (type === 'relation' ? 1 : type === 'rollup' ? 2 : type === 'formula' ? 3 : 0)

function findCurrent(properties: readonly CurrentProperty[], key: string): CurrentProperty | null {
  return (
    properties.find((p) => p.name === key) ??
    properties.find((p) => p.id === key) ??
    (key === TITLE_PROPERTY_ID ? properties.find((p) => p.type === 'title') : undefined) ??
    null
  )
}

/**
 * 줄들 → 차례(머리말). `mode` 가 `'create'` 면 새 소스다 — 요청의 제목 타입 속성은 함께 생긴 제목 속성의 이름이 된다. 오류는 400
 * `validation_error` 의 글 그대로다.
 */
export function planSchema(entries: readonly SchemaEntry[], current: readonly CurrentProperty[], mode: 'create' | 'update'): Parse<SchemaStep[]> {
  const deletes: SchemaStep[] = []
  const edits: SchemaStep[] = []
  const creates: Extract<SchemaStep, { kind: 'create' }>[] = []
  const touched = new Map<string, string>()
  const title = current.find((p) => p.type === 'title')

  const claim = (property: CurrentProperty, key: string): string | null => {
    const before = touched.get(property.id)
    if (before !== undefined) return `body.properties: "${before}" and "${key}" are the same property "${property.name}".`
    touched.set(property.id, key)
    return null
  }

  for (const { key, path, request } of entries) {
    const found = findCurrent(current, key)
    if (request === null) {
      if (found === null) return no(`${key} is not a property that exists.`)
      if (found.type === 'title') return no(`${path}: the title property cannot be deleted.`)
      const twice = claim(found, key)
      if (twice !== null) return no(twice)
      deletes.push({ kind: 'delete', path, property: found })
      continue
    }

    const config = request.config
    // 새 소스의 제목 — 함께 생긴 제목 속성의 이름을 바꾼다
    const target = found ?? (mode === 'create' && config?.type === 'title' && title !== undefined ? title : null)
    if (target !== null) {
      if (request.id !== undefined && found !== null && request.id !== found.id && !(found.type === 'title' && request.id === TITLE_PROPERTY_ID)) {
        return no(`${path}.id ${shownValue(request.id)} does not match the property "${found.name}".`)
      }
      const twice = claim(target, key)
      if (twice !== null) return no(twice)
      const wantedName = found === null ? (request.name ?? key) : request.name
      let convertTo: string | undefined
      if (config !== undefined && config.type !== target.type) {
        if (target.type === 'title') return no(`${path}: the title property cannot be converted to another type.`)
        if (config.type === 'title') return no(`${path}: a property cannot become title — a data source has exactly one title property.`)
        if (!canConvert(target.type, config.type)) return no(`${path}: a ${target.type} property cannot be converted to ${config.type} by this app.`)
        convertTo = config.type
      }
      edits.push({
        kind: 'edit',
        path,
        property: target,
        ...(wantedName !== undefined && wantedName !== target.name ? { name: wantedName } : {}),
        ...(request.description !== undefined && (request.description ?? '') !== (target.description ?? '') ? { description: request.description } : {}),
        ...(convertTo === undefined ? {} : { convertTo }),
        ...(config === undefined ? {} : { config }),
      })
      continue
    }

    if (config === undefined) return no(`${key} is not a property that exists. To create it, give its type — e.g. {"rich_text": {}}.`)
    if (config.type === 'title') return no(`${path}: a data source has exactly one title property — rename the existing one instead.`)
    if (config.type === 'button') return no(`${path}: button properties cannot be created through the API — their actions are set up in the app.`)
    if (config.type === 'relation' && config.dataSourceId === undefined) return no(`${path}.relation.data_source_id should be defined.`)
    if (config.type === 'formula' && config.expression === undefined) return no(`${path}.formula.expression should be defined.`)
    if (config.type === 'rollup' && (config.relation === undefined || config.target === undefined || config.function === undefined)) {
      return no(`${path}.rollup should give relation_property_id or relation_property_name, rollup_property_id or rollup_property_name, and function.`)
    }
    creates.push({
      kind: 'create',
      path,
      name: request.name ?? key,
      ...(request.description === undefined ? {} : { description: request.description }),
      config,
    })
  }

  const ordered = creates.map((c, i) => ({ c, i })).sort((a, b) => CREATE_ORDER(a.c.config.type) - CREATE_ORDER(b.c.config.type) || a.i - b.i)
  return ok([...deletes, ...edits, ...ordered.map((x) => x.c)])
}

// ── 옵션 맞추기 ───────────────────────────────────────────────────────

export type OptionPlan = {
  /** 지울 옵션 id. */
  readonly deletes: readonly string[]
  readonly updates: readonly { readonly id: string; readonly name?: string; readonly color?: OptionColor; readonly group?: StatusGroupKind }[]
  readonly adds: readonly { readonly name: string; readonly color?: OptionColor; readonly group?: StatusGroupKind }[]
}

/** 상태의 범주 — 노션의 이름 · 우리 kind · 범주 id. 모르면 null. */
function groupOf(raw: string, groups: ReadonlyMap<string, StatusGroupKind>): StatusGroupKind | null {
  const wanted = raw.trim().toLowerCase()
  for (const [kind, shown] of Object.entries(STATUS_GROUP_API)) {
    if (shown.name.toLowerCase() === wanted && isStatusGroupKind(kind)) return kind
  }
  if (isStatusGroupKind(wanted)) return wanted
  return groups.get(raw) ?? null
}

const optionKey = (name: string) => name.trim().toLowerCase()

/**
 * 남길 옵션 목록 → 지우기 · 고치기 · 더하기(머리말). `matchIds` 가 거짓이면(만들 때) id 를 보지 않고 이름으로만 잡는다 — 다른 표에서 읽은
 * 스키마를 그대로 보내도 된다. `groups` 는 상태의 범주 id → kind.
 */
export function reconcileOptions(
  current: readonly SelectOption[],
  wanted: readonly OptionRequest[],
  type: OptionType,
  path: string,
  options: { readonly matchIds: boolean; readonly groups?: ReadonlyMap<string, StatusGroupKind> },
): Parse<OptionPlan> {
  const used = new Set<string>()
  const finalNames = new Set<string>()
  const updates: { id: string; name?: string; color?: OptionColor; group?: StatusGroupKind }[] = []
  const adds: { name: string; color?: OptionColor; group?: StatusGroupKind }[] = []
  for (const [i, option] of wanted.entries()) {
    const at = `${path}[${i}]`
    let group: StatusGroupKind | undefined
    if (option.group !== undefined) {
      if (type !== 'status') return no(`${at}.group is only for status options.`)
      const resolved = groupOf(option.group, options.groups ?? new Map())
      if (resolved === null) return no(`${at}.group should be "To-do", "In progress" or "Complete", instead was ${shownValue(option.group)}.`)
      group = resolved
    }
    const byId = options.matchIds && option.id !== undefined ? current.find((o) => o.id === option.id) : undefined
    if (options.matchIds && option.id !== undefined && byId === undefined) return no(`${at}.id ${shownValue(option.id)} is not an option of this property.`)
    const match = byId ?? (option.name === undefined ? undefined : current.find((o) => optionKey(o.name) === optionKey(option.name!)))
    if (match !== undefined) {
      if (used.has(match.id)) return no(`${at} names an option that is already given.`)
      used.add(match.id)
      // 이름은 id 로 잡았을 때만 바꾼다(이름으로 잡았으면 그 이름이다)
      const rename = byId !== undefined && option.name !== undefined && option.name.trim() !== match.name ? option.name.trim() : undefined
      const finalName = optionKey(rename ?? match.name)
      if (finalNames.has(finalName)) return no(`${path} has two options named "${rename ?? match.name}".`)
      finalNames.add(finalName)
      const recolor = option.color !== undefined && option.color !== match.color ? option.color : undefined
      const regroup = group !== undefined && group !== match.group ? group : undefined
      if (rename !== undefined || recolor !== undefined || regroup !== undefined) {
        updates.push({ id: match.id, ...(rename === undefined ? {} : { name: rename }), ...(recolor === undefined ? {} : { color: recolor }), ...(regroup === undefined ? {} : { group: regroup }) })
      }
      continue
    }
    if (option.name === undefined || option.name.trim() === '') return no(`${at} should have a name.`)
    const finalName = optionKey(option.name)
    if (finalNames.has(finalName)) return no(`${path} has two options named "${option.name.trim()}".`)
    finalNames.add(finalName)
    adds.push({ name: option.name.trim(), ...(option.color === undefined ? {} : { color: option.color }), ...(group === undefined ? {} : { group }) })
  }
  return ok({ deletes: current.filter((o) => !used.has(o.id)).map((o) => o.id), updates, adds })
}

export function isOptionTypeConfig(config: TypeConfig): config is Extract<TypeConfig, { type: OptionType }> {
  return (OPTION_TYPES as readonly string[]).includes(config.type)
}
