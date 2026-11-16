/**
 * 공개 API 의 속성 값 — 우리 칸 ↔ 노션의 page property value (API-2 · F-09-17 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ · 09-api-integrations.md F-09-17(타입별 JSON 모양 · 쓸 수 있는 것)
 *
 * 내보내기(`propertyValueToApi`) — 속성 하나를 `{ id, type, <type>: 값 }` 으로. 값의 재료(칸 · 옵션 · 보이는 연결 · rollup · 수식 · 고유 번호 ·
 * 만든/고친 사람과 시각)는 DB 쪽(`page-object.ts`)이 이 사람의 권한으로 모아 넘긴다. 읽기는 관대하게 — 칸이 계약을 어기면(타입을 바꾼 뒤의
 * 옛 값 등) 빈 값으로 읽는다(`validateCellValue` 로 거른다).
 *
 *   · 제목 속성의 id 는 노션처럼 늘 `'title'` 이다(받을 때는 우리 id 도 받는다 · `findProperty`)
 *   · select · status · multi_select — `{id, name, color}`(지운 옵션을 가리키면 빠진다)
 *   · files — 올린 파일은 짧게 사는 주소를 만들 길이 없다(서명 URL 이 없다 — `file/storage.ts`). 그래서 노션의 **요청** 모양
 *     `{name, type:'file_upload', file_upload:{id}}` 으로 준다(그대로 다시 보내면 같은 값이다)
 *   · place — 노션의 `{lat, lon, name, address, aws_place_id, google_place_id}`(뒤의 둘은 우리에게 없다 — null)
 *   · rollup — 숫자(세기 · 비율 · 기간의 일수) · 날짜 · 배열(원본 보기) · 계산할 수 없으면 `unsupported`
 *   · verification — 만료는 읽을 때 판정한다(`expired`)
 *
 * 받기(`parsePropertyWrite`) — 노션의 값 하나를 우리 칸(`CellValue`) 또는 연결 목록으로. 모양 · 옵션 이름은 여기서 영어로 거부하고, 나머지
 * (사람 · 파일이 이 워크스페이스의 것인가 · 잠금 · 권한)는 앱의 칸 쓰기가 다시 본다. 계산 · 읽기 전용 속성(수식 · rollup · 고유 ID · 만든/고친
 * 사람과 시각 · 버튼 · 검증)은 받지 않는다 — 검증은 앱도 칸 쓰기로 받지 않는다(전용 명령 · 정본 [보강 VF-1] ⑨).
 */

import { readFormulaConfig } from '../database/formula-schema.ts'
import {
  emptyValue,
  isMvpPropertyType,
  validateCellValue,
  type CellValue,
  type DateValue,
  type MvpPropertyType,
  type SelectOption,
} from '../database/property-types.ts'
import { readRollupConfig, type RollupCell, type RollupColumnInfo } from '../database/rollup-functions.ts'
import { toVerificationCell } from '../database/verification-cell.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import type { FormulaType, FormulaValue } from '../formula/values.ts'
import { parseApiRichText, toApiRichText, type ApiLinks } from './rich-text.ts'
import { parseApiId, shownValue } from './v1-protocol.ts'

/** 속성 하나 — 스키마의 줄(이름 · 타입 · 설정). */
export type ApiProperty = { readonly id: string; readonly name: string; readonly type: string; readonly config: unknown }

/** 노션의 제목 속성 id — 어느 데이터베이스에서나 같다. */
export const TITLE_PROPERTY_ID = 'title'

/** 응답에 싣는 속성 id — 제목은 `'title'`, 나머지는 우리 id(이름이 바뀌어도 그대로다 · 정본 P2). */
export function apiPropertyId(property: Pick<ApiProperty, 'id' | 'type'>): string {
  return property.type === 'title' ? TITLE_PROPERTY_ID : property.id
}

/** 요청의 열쇠 → 속성 — 이름이 먼저(노션의 `properties` 는 이름 또는 id), 그다음 우리 id · `'title'`. 없으면 null. */
export function findProperty(properties: readonly ApiProperty[], key: string): ApiProperty | null {
  return (
    properties.find((p) => p.name === key) ??
    properties.find((p) => p.id === key) ??
    (key === TITLE_PROPERTY_ID ? properties.find((p) => p.type === 'title') : undefined) ??
    null
  )
}

/** property item 주소의 id → 속성 — id 만(이름은 받지 않는다). */
export function findPropertyById(properties: readonly ApiProperty[], id: string): ApiProperty | null {
  return properties.find((p) => apiPropertyId(p) === id || p.id === id) ?? null
}

export type ApiUser = { readonly object: 'user'; readonly id: string }
export const userRef = (id: string): ApiUser => ({ object: 'user', id })

export type ApiOption = { readonly id: string; readonly name: string; readonly color: string }

function optionOut(id: string | null, options: readonly SelectOption[]): ApiOption | null {
  if (id === null) return null
  const found = options.find((o) => o.id === id)
  return found === undefined ? null : { id: found.id, name: found.name, color: found.color }
}

export type ApiDate = { readonly start: string; readonly end: string | null; readonly time_zone: string | null }

export function dateToApi(date: DateValue): ApiDate {
  return { start: date.start, end: date.end ?? null, time_zone: date.time_zone ?? null }
}

/** 칸 타입의 저장된 값 → 노션의 값(`<type>` 자리의 것). 모양이 아니면 빈 값으로 읽는다. */
export function cellToApi(type: MvpPropertyType, raw: unknown, options: readonly SelectOption[], links: ApiLinks): unknown {
  const value = (validateCellValue(type, raw).length === 0 ? raw : emptyValue(type)) as CellValue
  switch (value.type) {
    case 'title':
      return toApiRichText(value.title, links)
    case 'rich_text':
      return toApiRichText(value.rich_text, links)
    case 'number':
      return value.number
    case 'checkbox':
      return value.checkbox
    case 'select':
      return optionOut(value.select?.id ?? null, options)
    case 'status':
      return optionOut(value.status?.id ?? null, options)
    case 'multi_select':
      return value.multi_select.map((o) => optionOut(o.id, options)).filter((o): o is ApiOption => o !== null)
    case 'date':
      return value.date === null ? null : dateToApi(value.date)
    case 'people':
      return value.people.map((p) => userRef(p.id))
    case 'files':
      return value.files.map((f) => ({ name: f.name, type: 'file_upload', file_upload: { id: f.id } }))
    case 'url':
      return value.url === '' ? null : value.url
    case 'email':
      return value.email === '' ? null : value.email
    case 'phone_number':
      return value.phone_number === '' ? null : value.phone_number
    case 'place':
      return value.place.name === ''
        ? null
        : {
            lat: value.place.lat,
            lon: value.place.lng,
            name: value.place.name,
            address: value.place.address === '' ? null : value.place.address,
            aws_place_id: null,
            google_place_id: null,
          }
  }
}

/** 수식의 결과 타입 → 노션의 이름(글은 `string`). */
const FORMULA_TYPE: Readonly<Record<FormulaType, string>> = { number: 'number', text: 'string', boolean: 'boolean', date: 'date' }

export function formulaToApi(resultType: FormulaType | null, value: FormulaValue): Record<string, unknown> {
  if (value === null) {
    const type = resultType === null ? 'string' : FORMULA_TYPE[resultType]
    return { type, [type]: null }
  }
  switch (value.type) {
    case 'number':
      return { type: 'number', number: value.value }
    case 'text':
      return { type: 'string', string: value.value }
    case 'boolean':
      return { type: 'boolean', boolean: value.value }
    case 'date':
      return { type: 'date', date: dateToApi(value.value) }
  }
}

/** rollup 칸 → 노션의 값. 계산할 수 없으면(끊긴 설정 · 연결이 너무 많다 · 표를 볼 수 없다) `unsupported`. */
export function rollupToApi(
  configFunction: string | null,
  info: RollupColumnInfo | undefined,
  cell: RollupCell | undefined,
  links: ApiLinks,
): Record<string, unknown> {
  const fn = info?.state === 'ok' ? info.function : (configFunction ?? 'show_original')
  if (info?.state !== 'ok' || cell === undefined || cell.state !== 'ok') return { type: 'unsupported', unsupported: {}, function: fn }
  const result = cell.result
  switch (result.kind) {
    case 'number':
      return { type: 'number', number: result.number, function: fn }
    case 'percent':
      return { type: 'number', number: result.percent, function: fn }
    case 'days':
      return { type: 'number', number: result.days, function: fn }
    case 'date':
      return { type: 'date', date: result.date === null ? null : { start: result.date, end: null, time_zone: null }, function: fn }
    case 'values':
      return {
        type: 'array',
        array: result.values.map((v) => ({ type: v.type, [v.type]: cellToApi(v.type, v, info.targetOptions, links) })),
        function: fn,
      }
  }
}

export function verificationToApi(raw: unknown, now: Date): Record<string, unknown> {
  const cell = toVerificationCell(raw, now)
  if (cell === null) return { state: 'unverified', verified_by: null, date: null }
  return {
    state: cell.expired ? 'expired' : 'verified',
    verified_by: userRef(cell.verified_by),
    date: { start: cell.verified_at, end: cell.expires_at, time_zone: null },
  }
}

/** 한 행의 값의 재료 — DB 쪽이 이 사람의 권한으로 모은다(`page-object.ts`). */
export type RowValues = {
  /** 칸(`properties_cache` — 셀 타입 · 검증의 저장된 값). */
  readonly cells: Readonly<Record<string, unknown>>
  /** 옵션을 쓰는 속성의 옵션. */
  readonly options: ReadonlyMap<string, readonly SelectOption[]>
  /** relation 속성마다 **볼 수 있는** 연결의 앞쪽 · 더 있는가. */
  readonly relations: ReadonlyMap<string, { readonly ids: readonly string[]; readonly hasMore: boolean }>
  readonly rollups: { readonly columns: Readonly<Record<string, RollupColumnInfo>>; readonly cells: Readonly<Record<string, RollupCell>> } | null
  readonly formulas: Readonly<Record<string, FormulaValue>>
  readonly uniqueId: { readonly prefix: string | null; readonly number: number | null }
  readonly createdTime: Date
  readonly createdBy: string | null
  readonly lastEditedTime: Date
  readonly lastEditedBy: string | null
  readonly now: Date
}

/** 속성 하나의 값(노션의 property value) — `{ id, type, <type>: 값 }`. relation 은 `has_more` 를 함께. */
export function propertyValueToApi(property: ApiProperty, row: RowValues, links: ApiLinks): Record<string, unknown> {
  const id = apiPropertyId(property)
  const type = property.type
  const out = (value: unknown, extra: Record<string, unknown> = {}) => ({ id, type, [type]: value, ...extra })
  if (isMvpPropertyType(type)) return out(cellToApi(type, row.cells[property.id], row.options.get(property.id) ?? [], links))
  switch (type) {
    case 'relation': {
      const linked = row.relations.get(property.id) ?? { ids: [], hasMore: false }
      return out(linked.ids.map((to) => ({ id: to })), { has_more: linked.hasMore })
    }
    case 'rollup':
      return out(
        rollupToApi(readRollupConfig(property.config)?.function ?? null, row.rollups?.columns[property.id], row.rollups?.cells[property.id], links),
      )
    case 'formula':
      return out(formulaToApi(readFormulaConfig(property.config)?.result_type ?? null, row.formulas[property.id] ?? null))
    case 'unique_id':
      return out({ prefix: row.uniqueId.prefix, number: row.uniqueId.number })
    case 'created_time':
      return out(row.createdTime.toISOString())
    case 'last_edited_time':
      return out(row.lastEditedTime.toISOString())
    case 'created_by':
      return out(row.createdBy === null ? null : userRef(row.createdBy))
    case 'last_edited_by':
      return out(row.lastEditedBy === null ? null : userRef(row.lastEditedBy))
    case 'verification':
      return out(verificationToApi(row.cells[property.id], row.now))
    case 'button':
      return out({})
    default:
      // 모르는 타입 — 노션처럼 값은 null(F-09-17 *"지원되지 않는 타입은 값이 null"*)
      return out(null)
  }
}

/** 데이터베이스 행이 아닌 페이지의 속성 — 제목 하나(노션과 같다). */
export function pageTitleToApi(title: readonly RichTextRun[], links: ApiLinks): Record<string, unknown> {
  return { title: { id: TITLE_PROPERTY_ID, type: 'title', title: toApiRichText(title, links) } }
}

// ── 받기 ──────────────────────────────────────────────────────────────

export type ApiWrite =
  /** 칸 쓰기(`updateCells` · `createRow` 의 `cells`). */
  | { readonly kind: 'cell'; readonly propertyId: string; readonly value: CellValue }
  /** 연결을 통째로 바꾼다(노션의 relation 쓰기 — 배열 전체 교체). */
  | { readonly kind: 'relation'; readonly propertyId: string; readonly ids: readonly string[] }

export type WriteParse = { readonly ok: true; readonly write: ApiWrite } | { readonly ok: false; readonly message: string }

const reject = (message: string): WriteParse => ({ ok: false, message })

/** 읽기 전용 · 계산 속성 — 쓰기를 받지 않는다. */
export function isWritableType(type: string): boolean {
  return isMvpPropertyType(type) || type === 'relation'
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

type OptionPick = { readonly ok: true; readonly id: string | null } | { readonly ok: false; readonly message: string }

/** 옵션 하나 — `{id}` 또는 `{name}`(대소문자가 같은 것이 먼저). 이 속성에 없으면 거부한다(노션의 select 는 새로 만들지만 우리는 앱에서 만든다). */
function pickOption(raw: unknown, options: readonly SelectOption[], at: string, property: ApiProperty): OptionPick {
  if (raw === null) return { ok: true, id: null }
  if (!isObject(raw)) return { ok: false, message: `${at} should be an object or \`null\`, instead was ${shownValue(raw)}.` }
  if (raw.id !== undefined) {
    const id = typeof raw.id === 'string' ? raw.id : null
    const found = id === null ? undefined : options.find((o) => o.id === id || o.id === id.toLowerCase())
    return found === undefined
      ? { ok: false, message: `${at}.id ${shownValue(raw.id)} is not an option of property "${property.name}".` }
      : { ok: true, id: found.id }
  }
  if (typeof raw.name !== 'string') return { ok: false, message: `${at}.name should be a string, instead was ${shownValue(raw.name)}.` }
  const name = raw.name
  const found = options.find((o) => o.name === name) ?? options.find((o) => o.name.toLowerCase() === name.toLowerCase())
  return found === undefined
    ? { ok: false, message: `${at}.name ${shownValue(name)} is not an option of property "${property.name}". Create the option in the app first.` }
    : { ok: true, id: found.id }
}

/**
 * 노션의 값 하나 → 우리 쓰기. `raw` 는 `properties` 의 값(`{ "title": [...] }` · `{ "type": "number", "number": 3 }`) — 제목 · 글은 배열만
 * 보내도 받는다. `path` 는 오류 글의 자리(`body.properties.Name`).
 */
export function parsePropertyWrite(property: ApiProperty, raw: unknown, path: string, options: readonly SelectOption[]): WriteParse {
  const type = property.type
  if (!isWritableType(type)) return reject(`${path}: property "${property.name}" is a ${type} property and cannot be updated.`)

  let value: unknown
  if (Array.isArray(raw) && (type === 'title' || type === 'rich_text')) {
    value = raw
  } else {
    if (!isObject(raw)) return reject(`${path} should be an object, instead was ${shownValue(raw)}.`)
    if (raw.type !== undefined && raw.type !== type) return reject(`${path}.type should be ${shownValue(type)}, instead was ${shownValue(raw.type)}.`)
    if (!(type in raw)) return reject(`${path}.${type} should be defined, instead was \`undefined\`.`)
    value = raw[type]
  }
  const at = `${path}.${type}`

  if (type === 'relation') {
    if (!Array.isArray(value)) return reject(`${at} should be an array, instead was ${shownValue(value)}.`)
    const ids: string[] = []
    for (const [i, item] of value.entries()) {
      const id = parseApiId(isObject(item) ? item.id : undefined)
      if (id === null) return reject(`${at}[${i}].id should be a valid uuid, instead was ${shownValue(isObject(item) ? item.id : item)}.`)
      if (!ids.includes(id)) ids.push(id)
    }
    return { ok: true, write: { kind: 'relation', propertyId: property.id, ids } }
  }

  const cell = toCellValue(type as MvpPropertyType, value, at, property, options)
  if (typeof cell === 'string') return reject(cell)
  // 마지막 확인은 앱의 칸 계약 — 그 글(한국어)은 싣지 않고 자리만 말한다
  const issues = validateCellValue(type as MvpPropertyType, cell)
  if (issues.length > 0) return reject(`${path}${issues[0].path.slice('value'.length)} is invalid for property "${property.name}".`)
  return { ok: true, write: { kind: 'cell', propertyId: property.id, value: cell } }
}

/** 타입마다 노션의 값 → 우리 칸. 틀리면 오류 글(문자열). */
function toCellValue(type: MvpPropertyType, value: unknown, at: string, property: ApiProperty, options: readonly SelectOption[]): CellValue | string {
  switch (type) {
    case 'title':
    case 'rich_text': {
      const parsed = parseApiRichText(value, at)
      if (!parsed.ok) return parsed.message
      return type === 'title' ? { type: 'title', title: parsed.runs } : { type: 'rich_text', rich_text: parsed.runs }
    }
    case 'number':
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return `${at} should be a number or \`null\`, instead was ${shownValue(value)}.`
      return { type: 'number', number: value as number | null }
    case 'checkbox':
      if (typeof value !== 'boolean') return `${at} should be a boolean, instead was ${shownValue(value)}.`
      return { type: 'checkbox', checkbox: value }
    case 'select':
    case 'status': {
      const picked = pickOption(value, options, at, property)
      if (!picked.ok) return picked.message
      const ref = picked.id === null ? null : { id: picked.id }
      return type === 'select' ? { type: 'select', select: ref } : { type: 'status', status: ref }
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return `${at} should be an array, instead was ${shownValue(value)}.`
      const ids: string[] = []
      for (const [i, item] of value.entries()) {
        const picked = pickOption(item, options, `${at}[${i}]`, property)
        if (!picked.ok) return picked.message
        if (picked.id === null) return `${at}[${i}] should be an object, instead was \`null\`.`
        if (!ids.includes(picked.id)) ids.push(picked.id)
      }
      return { type: 'multi_select', multi_select: ids.map((id) => ({ id })) }
    }
    case 'date': {
      if (value === null) return { type: 'date', date: null }
      if (!isObject(value)) return `${at} should be an object or \`null\`, instead was ${shownValue(value)}.`
      if (typeof value.start !== 'string') return `${at}.start should be a string, instead was ${shownValue(value.start)}.`
      if (value.end !== undefined && value.end !== null && typeof value.end !== 'string') return `${at}.end should be a string or \`null\`, instead was ${shownValue(value.end)}.`
      if (value.time_zone !== undefined && value.time_zone !== null && typeof value.time_zone !== 'string') {
        return `${at}.time_zone should be a string or \`null\`, instead was ${shownValue(value.time_zone)}.`
      }
      return {
        type: 'date',
        date: { start: value.start, end: (value.end as string | null | undefined) ?? null, time_zone: (value.time_zone as string | null | undefined) ?? null },
      }
    }
    case 'people': {
      if (!Array.isArray(value)) return `${at} should be an array, instead was ${shownValue(value)}.`
      const ids: string[] = []
      for (const [i, item] of value.entries()) {
        const id = parseApiId(isObject(item) ? item.id : undefined)
        if (id === null) return `${at}[${i}].id should be a valid uuid, instead was ${shownValue(isObject(item) ? item.id : item)}.`
        if (!ids.includes(id)) ids.push(id)
      }
      return { type: 'people', people: ids.map((id) => ({ id })) }
    }
    case 'files': {
      if (!Array.isArray(value)) return `${at} should be an array, instead was ${shownValue(value)}.`
      const files: { id: string; name: string }[] = []
      for (const [i, item] of value.entries()) {
        const f = `${at}[${i}]`
        if (!isObject(item)) return `${f} should be an object, instead was ${shownValue(item)}.`
        const kind = item.type ?? ('file_upload' in item ? 'file_upload' : 'external' in item ? 'external' : 'file' in item ? 'file' : undefined)
        if (kind !== 'file_upload') {
          return `${f}.type ${shownValue(kind)} is not supported. Upload the file in the app and send {"type":"file_upload","file_upload":{"id":…}}.`
        }
        const id = parseApiId(isObject(item.file_upload) ? item.file_upload.id : undefined)
        if (id === null) return `${f}.file_upload.id should be a valid uuid, instead was ${shownValue(isObject(item.file_upload) ? item.file_upload.id : item.file_upload)}.`
        if (typeof item.name !== 'string' || item.name.trim() === '') return `${f}.name should be a non-empty string, instead was ${shownValue(item.name)}.`
        files.push({ id, name: item.name.trim() })
      }
      return { type: 'files', files }
    }
    case 'url':
    case 'email':
    case 'phone_number': {
      if (value !== null && typeof value !== 'string') return `${at} should be a string or \`null\`, instead was ${shownValue(value)}.`
      const text = value ?? ''
      if (type === 'url') return { type: 'url', url: text }
      if (type === 'email') return { type: 'email', email: text }
      return { type: 'phone_number', phone_number: text }
    }
    case 'place': {
      if (value === null) return emptyValue('place')
      if (!isObject(value)) return `${at} should be an object or \`null\`, instead was ${shownValue(value)}.`
      if (typeof value.lat !== 'number') return `${at}.lat should be a number, instead was ${shownValue(value.lat)}.`
      if (typeof value.lon !== 'number') return `${at}.lon should be a number, instead was ${shownValue(value.lon)}.`
      if (typeof value.name !== 'string' || value.name.trim() === '') return `${at}.name should be a non-empty string, instead was ${shownValue(value.name)}.`
      if (value.address !== undefined && value.address !== null && typeof value.address !== 'string') {
        return `${at}.address should be a string or \`null\`, instead was ${shownValue(value.address)}.`
      }
      return { type: 'place', place: { name: value.name.trim(), address: (value.address as string | null | undefined) ?? '', lat: value.lat, lng: value.lon } }
    }
  }
}
