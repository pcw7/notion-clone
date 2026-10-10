/**
 * 자동화 액션 — 종류 · 설정의 모양 (자동화 5a-1 · 5c-1 · F-08-07 · F-08-13 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑫
 *
 * 종류는 처음부터 상위집합이다(`ck_automation_action_type`) — 버튼 · DB automation 이 같은 등록부를 쓴다(08 F-08-07 *"버튼·automation 공통
 * 액션 목록"*). 실행하는 것은 `edit_property`(그 행의 셀을 고정 값으로 · 5a-1) · `add_page_to`(그 표에 행을 하나 · 5a-2) · `send_webhook`
 * (그 행의 고른 속성을 바깥으로 · 5c-1)이다. 나머지는 그 조각이 올 때 `IMPLEMENTED_ACTIONS` 에 더한다.
 *
 * `send_webhook` 은 모양이 셋이다(정본 ⑫) — **받는 것**(`SendWebhookInput` — 평문 URL · 헤더 값, 또는 이전 액션에서 옮기라는 `keep`) ·
 * **저장하는 것**(`SendWebhookStored` — 봉인) · 읽어 주는 것(`action-check.ts` `readPublicActions` — 힌트 · 헤더 이름만). 받는 것은
 * `parseActions`, 저장한 것은 `parseStoredActions` 가 읽는다. 나머지 종류는 받는 것과 저장하는 것이 같다.
 *
 * 이 파일은 **모양만** 본다(어떤 속성 · 어떤 값인가는 저장할 때 그 표의 스키마에 대어 본다 — `action-check.ts`).
 */

import type { RowCell } from '../database/row.ts'
import { checkOutboundUrl } from '../net/outbound.ts'

/** 정본 CHECK 와 같은 목록. */
export const ACTION_TYPES = ['edit_property', 'add_page_to', 'insert_blocks', 'send_webhook', 'define_variables', 'show_confirmation'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** 지금 실행할 수 있는 종류 — 조각마다 늘린다(5a-2 `add_page_to` · 5c `send_webhook` · 5d `define_variables` · 5e `insert_blocks`). */
export const IMPLEMENTED_ACTIONS: readonly ActionType[] = ['edit_property', 'add_page_to', 'send_webhook']

/** 한 automation 의 액션 상한. */
export const MAX_ACTIONS = 20
/** 한 액션이 쓰는 셀의 상한. */
export const MAX_CELLS_PER_ACTION = 50
/** 한 automation 의 `send_webhook` 상한(08 *"automation 당 최대 5개"*). */
export const MAX_WEBHOOK_ACTIONS = 5
/** 한 `send_webhook` 의 헤더 상한 · 값의 길이 상한 · 보낼 속성 상한(정본 ⑫). */
export const MAX_WEBHOOK_HEADERS = 10
export const MAX_WEBHOOK_HEADER_VALUE = 1024
export const MAX_WEBHOOK_PROPERTIES = 50
/** 발송기가 정하는 헤더 — 사람이 덮지 못한다(정본 ⑫). */
export const RESERVED_WEBHOOK_HEADERS: readonly string[] = ['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'user-agent']

/** 그 행의 셀을 고정 값으로 바꾼다 — 값은 셀 쓰기 API 의 `CellValue` 그대로(정본 ⑥ · 수식 · 멘션 슬롯은 5d). */
export type EditPropertyConfig = { readonly v: 1; readonly cells: readonly RowCell[] }

/**
 * 그 데이터 소스에 행을 하나 더한다(정본 ⑨). 셀은 비어도 된다(빈 행). 템플릿을 고르면 템플릿 값이 이긴다.
 */
export type AddPageToConfig = {
  readonly v: 1
  readonly dataSourceId: string
  readonly cells: readonly RowCell[]
  readonly templateId: string | null
}

/** 받는 헤더 — 값이 null 이면 `keep` 의 같은 이름 헤더 값을 옮긴다. 이름은 소문자로 맞춘다. */
export type WebhookHeaderInput = { readonly name: string; readonly value: string | null }

/** 받는 `send_webhook` — URL(https · 검사를 지난 모양) 또는 `keep`(같은 automation 의 이전 `send_webhook` 액션 id) 중 하나 이상. */
export type SendWebhookInput = {
  readonly v: 1
  readonly url: string | null
  readonly keep: string | null
  readonly headers: readonly WebhookHeaderInput[]
  readonly properties: readonly string[]
}

/** 저장한 `send_webhook` — 봉인은 base64(`url-seal.ts` 와 같은 키). */
export type SendWebhookStored = {
  readonly v: 1
  readonly urlSealed: string
  readonly urlHint: string
  readonly headers: readonly { readonly name: string; readonly valueSealed: string }[]
  readonly properties: readonly string[]
}

/** 받는 액션. */
export type ActionInput =
  | { readonly type: 'edit_property'; readonly config: EditPropertyConfig }
  | { readonly type: 'add_page_to'; readonly config: AddPageToConfig }
  | { readonly type: 'send_webhook'; readonly config: SendWebhookInput }

/** 저장한 액션 — 엔진이 실행하는 것. */
export type StoredAction =
  | { readonly type: 'edit_property'; readonly config: EditPropertyConfig }
  | { readonly type: 'add_page_to'; readonly config: AddPageToConfig }
  | { readonly type: 'send_webhook'; readonly config: SendWebhookStored }

export type ActionProblem =
  | 'invalid'
  | 'unsupported_action'
  | 'too_many_actions'
  | 'too_many_cells'
  | 'empty_cells'
  /** `send_webhook` 의 URL 이 바깥으로 보낼 수 있는 모양이 아니다(페이지 웹훅과 같은 검사). */
  | 'invalid_url'
  /** `send_webhook` 의 헤더 — 너무 많다 · 이름이 토큰 글자가 아니다 · 정해진 이름 · 같은 이름 두 번 · 값이 너무 길다. */
  | 'invalid_header'
  /** `send_webhook` 이 automation 마다 5개를 넘는다. */
  | 'too_many_webhooks'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** RFC 9110 의 token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type Parsed<T> = { readonly ok: true; readonly actions: readonly T[] } | { readonly ok: false; readonly problem: ActionProblem; readonly index?: number }

/** 셀 목록 — 같은 속성 두 번은 안 된다. */
function parseCells(raw: unknown): RowCell[] | ActionProblem {
  if (!Array.isArray(raw)) return 'invalid'
  if (raw.length > MAX_CELLS_PER_ACTION) return 'too_many_cells'
  const cells: RowCell[] = []
  const seen = new Set<string>()
  for (const cell of raw) {
    if (!isRecord(cell) || typeof cell.propertyId !== 'string' || !isRecord(cell.value) || seen.has(cell.propertyId)) return 'invalid'
    seen.add(cell.propertyId)
    cells.push({ propertyId: cell.propertyId, value: cell.value as RowCell['value'] })
  }
  return cells
}

/** `edit_property` · `add_page_to` — 받는 것과 저장한 것이 같다. */
function parseCellAction(type: 'edit_property' | 'add_page_to', config: Record<string, unknown>): ActionInput | ActionProblem {
  const cells = parseCells(config.cells)
  if (typeof cells === 'string') return cells
  if (type === 'edit_property') {
    if (cells.length === 0) return 'empty_cells'
    return { type, config: { v: 1, cells } }
  }
  // add_page_to — 대상 표 · 템플릿(없으면 null)
  const templateId = config.templateId ?? null
  if (typeof config.dataSourceId !== 'string' || !UUID.test(config.dataSourceId)) return 'invalid'
  if (templateId !== null && (typeof templateId !== 'string' || !UUID.test(templateId))) return 'invalid'
  return { type, config: { v: 1, dataSourceId: config.dataSourceId, cells, templateId } }
}

/** 보낼 속성 — 글자 id · 50개까지 · 같은 것 두 번은 안 된다. */
function parseProperties(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_WEBHOOK_PROPERTIES) return null
  if (!raw.every((p): p is string => typeof p === 'string' && p !== '') || new Set(raw).size !== raw.length) return null
  return [...raw]
}

/** 헤더 이름 — 토큰 글자 · 정해진 이름이 아님 · 같은 이름 두 번은 안 된다(대소문자 없이). 소문자로 맞춘 이름들. */
function headerNames(raw: readonly unknown[]): string[] | null {
  const names: string[] = []
  for (const h of raw) {
    if (!isRecord(h) || typeof h.name !== 'string' || !HEADER_NAME.test(h.name)) return null
    const name = h.name.toLowerCase()
    if (RESERVED_WEBHOOK_HEADERS.includes(name) || names.includes(name)) return null
    names.push(name)
  }
  return names
}

/** 받는 `send_webhook`(정본 ⑫). */
function parseSendWebhookInput(config: Record<string, unknown>): ActionInput | ActionProblem {
  const url = config.url ?? null
  const keep = config.keep ?? null
  if (url !== null && typeof url !== 'string') return 'invalid'
  if (keep !== null && (typeof keep !== 'string' || !UUID.test(keep))) return 'invalid'
  if (url === null && keep === null) return 'invalid'
  let href: string | null = null
  if (url !== null) {
    const checked = checkOutboundUrl(url)
    if (!checked.ok) return 'invalid_url'
    href = checked.url.href
  }
  const rawHeaders = config.headers ?? []
  if (!Array.isArray(rawHeaders) || rawHeaders.length > MAX_WEBHOOK_HEADERS) return 'invalid_header'
  const names = headerNames(rawHeaders)
  if (names === null) return 'invalid_header'
  const headers: WebhookHeaderInput[] = []
  for (const [i, h] of rawHeaders.entries()) {
    const value = (h as Record<string, unknown>).value ?? null
    if (value !== null && (typeof value !== 'string' || value === '' || value.length > MAX_WEBHOOK_HEADER_VALUE || /[\r\n]/.test(value))) {
      return 'invalid_header'
    }
    headers.push({ name: names[i], value })
  }
  const properties = parseProperties(config.properties ?? [])
  if (properties === null) return 'invalid'
  return { type: 'send_webhook', config: { v: 1, url: href, keep, headers, properties } }
}

/** 저장한 `send_webhook` — 봉인된 모양. */
function parseSendWebhookStored(config: Record<string, unknown>): StoredAction | ActionProblem {
  if (typeof config.urlSealed !== 'string' || typeof config.urlHint !== 'string' || !Array.isArray(config.headers)) return 'invalid'
  const headers: { name: string; valueSealed: string }[] = []
  for (const h of config.headers) {
    if (!isRecord(h) || typeof h.name !== 'string' || typeof h.valueSealed !== 'string') return 'invalid'
    headers.push({ name: h.name, valueSealed: h.valueSealed })
  }
  const properties = parseProperties(config.properties ?? [])
  if (properties === null) return 'invalid'
  return { type: 'send_webhook', config: { v: 1, urlSealed: config.urlSealed, urlHint: config.urlHint, headers, properties } }
}

function parseList<T extends { readonly type: ActionType }>(
  raw: unknown,
  one: (type: ActionType, config: Record<string, unknown>) => T | ActionProblem,
): Parsed<T> {
  if (!Array.isArray(raw)) return { ok: false, problem: 'invalid' }
  if (raw.length > MAX_ACTIONS) return { ok: false, problem: 'too_many_actions' }
  const actions: T[] = []
  let webhooks = 0
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item) || typeof item.type !== 'string') return { ok: false, problem: 'invalid', index }
    if (!(IMPLEMENTED_ACTIONS as readonly string[]).includes(item.type)) return { ok: false, problem: 'unsupported_action', index }
    if (!isRecord(item.config) || item.config.v !== 1) return { ok: false, problem: 'invalid', index }
    if (item.type === 'send_webhook' && ++webhooks > MAX_WEBHOOK_ACTIONS) return { ok: false, problem: 'too_many_webhooks', index }
    const parsed = one(item.type as ActionType, item.config)
    if (typeof parsed === 'string') return { ok: false, problem: parsed, index }
    actions.push(parsed)
  }
  return { ok: true, actions }
}

/** 받은 액션 목록의 모양을 본다 — 셀의 속성 · 값이 그 표에 맞는지는 보지 않는다. */
export function parseActions(raw: unknown): Parsed<ActionInput> {
  return parseList(raw, (type, config) =>
    type === 'send_webhook' ? parseSendWebhookInput(config) : parseCellAction(type as 'edit_property' | 'add_page_to', config),
  )
}

/** 저장한 액션 목록 — `send_webhook` 은 봉인된 모양으로 읽는다. */
export function parseStoredActions(raw: unknown): Parsed<StoredAction> {
  return parseList<StoredAction>(raw, (type, config) => {
    if (type === 'send_webhook') return parseSendWebhookStored(config)
    const parsed = parseCellAction(type as 'edit_property' | 'add_page_to', config)
    return typeof parsed === 'string' ? parsed : (parsed as StoredAction)
  })
}
