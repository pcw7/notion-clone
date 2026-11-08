/**
 * 자동화 액션 — 종류 · 설정의 모양 (자동화 5a-1 · 5c-1 · 5d-1 · F-08-07 · F-08-11 · F-08-13 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥ ⑫ ⑯
 *
 * 종류는 처음부터 상위집합이다(`ck_automation_action_type`) — 버튼 · DB automation 이 같은 등록부를 쓴다(08 F-08-07 *"버튼·automation 공통
 * 액션 목록"*). 실행하는 것은 `edit_property`(그 행의 셀을 고정 값으로 · 5a-1) · `add_page_to`(그 표에 행을 하나 · 5a-2) · `send_webhook`
 * (그 행의 고른 속성을 바깥으로 · 5c-1)이다. 나머지는 그 조각이 올 때 `IMPLEMENTED_ACTIONS` 에 더한다.
 *
 * `send_notification`(AN-1 · 정본 [보강 AN-1] ①)은 받는 것과 저장하는 것이 같다 — 받는 사람(멤버 · 그 행의 사람 칸)과 메시지(값 슬롯 `{{row:속성id}}`).
 *
 * `send_webhook` 은 모양이 셋이다(정본 ⑫) — **받는 것**(`SendWebhookInput` — 평문 URL · 헤더 값, 또는 이전 액션에서 옮기라는 `keep`) ·
 * **저장하는 것**(`SendWebhookStored` — 봉인) · 읽어 주는 것(`action-check.ts` `readPublicActions` — 힌트 · 헤더 이름만). 받는 것은
 * `parseActions`, 저장한 것은 `parseStoredActions` 가 읽는다. 나머지 종류는 받는 것과 저장하는 것이 같다.
 *
 * 셀은 고정 값(`{ propertyId, value }`) 또는 동적 값(`{ propertyId, from }` — 지금 · 일하는 행의 속성 · ⑯)이다. 동적 값은 실행할 때 엔진이 푼다.
 *
 * 이 파일은 **모양만** 본다(어떤 속성 · 어떤 값인가는 저장할 때 그 표의 스키마에 대어 본다 — `action-check.ts`).
 */

import type { RowCell } from '../database/row.ts'
import { checkOutboundUrl } from '../net/outbound.ts'
import { validateDoc, type EditorBlock } from '../editor/document.ts'
import { sanitizeRichText, toPlainText, validateRichText, type RichTextRun } from '../contracts/rich-text.ts'

/** 정본 CHECK 와 같은 목록. */
export const ACTION_TYPES = ['edit_property', 'add_page_to', 'insert_blocks', 'send_webhook', 'define_variables', 'show_confirmation', 'send_notification'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** 지금 실행할 수 있는 종류 — 조각마다 늘린다(5a-2 `add_page_to` · 5c `send_webhook` · 5d `define_variables` · 5e `insert_blocks`). */
export const IMPLEMENTED_ACTIONS: readonly ActionType[] = ['edit_property', 'add_page_to', 'send_webhook', 'insert_blocks', 'send_notification']

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
/** `insert_blocks` 의 블록 상한(자식 포함) · 깊이 상한(정본 ⑱). */
export const MAX_INSERT_BLOCKS = 50
export const MAX_INSERT_DEPTH = 3
/** 넣을 수 있는 타입 — 글 계열(정본 ⑱). 하위 페이지 · DB · 이미지 · 버튼 · 표 · 컬럼 · 목차 · 이동 경로는 못 넣는다. */
export const INSERTABLE_BLOCK_TYPES: readonly string[] = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'equation',
]
/** 블록을 넣는 자리 — 버튼 아래 · 페이지 끝(08 클론 대안의 둘). */
export const INSERT_POSITIONS = ['below', 'bottom'] as const
export type InsertPosition = (typeof INSERT_POSITIONS)[number]

/** `send_notification` 의 고른 멤버 · 사람 칸 상한 · 메시지 상한(정본 [보강 AN-1] ① ②). */
export const MAX_NOTIFY_USERS = 20
export const MAX_NOTIFY_PEOPLE_PROPERTIES = 20
export const MAX_NOTIFY_RUNS = 20
export const MAX_NOTIFY_MESSAGE = 500
/** 한 번 실행이 알리는 사람의 상한 — 고정 멤버 + 사람 칸의 값(정본 [보강 AN-1] ②). */
export const MAX_NOTIFY_RECIPIENTS = 100
/** 메시지의 값 슬롯 — `{{row:속성id}}`. 실행할 때 그 행의 그 칸을 글자로 푼다. */
export const NOTIFY_SLOT = /\{\{row:([^{}\s]{1,64})\}\}/g

/** 발송기가 정하는 헤더 — 사람이 덮지 못한다(정본 ⑫). */
export const RESERVED_WEBHOOK_HEADERS: readonly string[] = ['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'user-agent']

/** 동적 값의 출처(정본 ⑯) — 실행한 시각 · 일하는 행(누른 행 · 트리거된 행)의 그 속성. */
export type DynamicSource = { readonly kind: 'now' } | { readonly kind: 'row_property'; readonly propertyId: string }
/** 동적 값의 셀 — 실행할 때 고정 값으로 푼다. */
export type DynamicCell = { readonly propertyId: string; readonly from: DynamicSource }
/** 액션의 셀 — 고정 값(셀 쓰기 API 의 `CellValue` 그대로) 또는 동적 값. */
export type ActionCell = RowCell | DynamicCell

export const isDynamicCell = (cell: ActionCell): cell is DynamicCell => 'from' in cell

/** 그 행의 셀을 바꾼다(정본 ⑥ · 동적 값은 ⑯ · 수식 슬롯은 v2). */
export type EditPropertyConfig = { readonly v: 1; readonly cells: readonly ActionCell[] }

/**
 * 그 데이터 소스에 행을 하나 더한다(정본 ⑨). 셀은 비어도 된다(빈 행). 템플릿을 고르면 템플릿 값이 이긴다.
 */
export type AddPageToConfig = {
  readonly v: 1
  readonly dataSourceId: string
  readonly cells: readonly ActionCell[]
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

/** 미리 적어 둔 블록 묶음을 본문에 복제해 넣는다(정본 ⑱ — 버튼 블록에서만). */
export type InsertBlocksConfig = { readonly v: 1; readonly position: InsertPosition; readonly blocks: readonly EditorBlock[] }

/** 알림을 보낸다(정본 [보강 AN-1] ①) — 받는 사람은 고른 멤버 ∪ 그 행의 사람 칸. 본문의 버튼 블록은 행이 없어 사람 칸을 읽지 않는다. */
export type SendNotificationConfig = {
  readonly v: 1
  readonly to: { readonly users: readonly string[]; readonly people_property_ids: readonly string[] }
  readonly message: readonly RichTextRun[]
}

/** 받는 액션. */
export type ActionInput =
  | { readonly type: 'edit_property'; readonly config: EditPropertyConfig }
  | { readonly type: 'add_page_to'; readonly config: AddPageToConfig }
  | { readonly type: 'send_webhook'; readonly config: SendWebhookInput }
  | { readonly type: 'insert_blocks'; readonly config: InsertBlocksConfig }
  | { readonly type: 'send_notification'; readonly config: SendNotificationConfig }

/** 저장한 액션 — 엔진이 실행하는 것. */
export type StoredAction =
  | { readonly type: 'edit_property'; readonly config: EditPropertyConfig }
  | { readonly type: 'add_page_to'; readonly config: AddPageToConfig }
  | { readonly type: 'send_webhook'; readonly config: SendWebhookStored }
  | { readonly type: 'insert_blocks'; readonly config: InsertBlocksConfig }
  | { readonly type: 'send_notification'; readonly config: SendNotificationConfig }

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
  /** `insert_blocks` 의 블록 — 없다 · 모양이 틀렸다 · 넣을 수 없는 타입 · 50개 · 깊이 3 을 넘는다 · 자리가 틀렸다(정본 ⑱). */
  | 'invalid_blocks'
  /** `send_notification` — 받는 사람이 모두 비었다 · 모양이 틀렸다 · 메시지가 너무 길다(정본 [보강 AN-1] ①). */
  | 'invalid_input'
  /** `send_notification` 의 고른 멤버가 20명을 넘는다. */
  | 'too_many_recipients'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** RFC 9110 의 token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type Parsed<T> = { readonly ok: true; readonly actions: readonly T[] } | { readonly ok: false; readonly problem: ActionProblem; readonly index?: number }

/** 동적 값의 출처 — 모르는 모양이면 null. */
function parseSource(raw: unknown): DynamicSource | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'now') return { kind: 'now' }
  if (raw.kind === 'row_property' && typeof raw.propertyId === 'string' && raw.propertyId !== '') return { kind: 'row_property', propertyId: raw.propertyId }
  return null
}

/** 셀 목록 — 고정 값 또는 동적 값(둘 다는 안 된다) · 같은 속성 두 번은 안 된다. */
function parseCells(raw: unknown): ActionCell[] | ActionProblem {
  if (!Array.isArray(raw)) return 'invalid'
  if (raw.length > MAX_CELLS_PER_ACTION) return 'too_many_cells'
  const cells: ActionCell[] = []
  const seen = new Set<string>()
  for (const cell of raw) {
    if (!isRecord(cell) || typeof cell.propertyId !== 'string' || seen.has(cell.propertyId)) return 'invalid'
    seen.add(cell.propertyId)
    if ('from' in cell) {
      const from = parseSource(cell.from)
      if (from === null || 'value' in cell) return 'invalid'
      cells.push({ propertyId: cell.propertyId, from })
      continue
    }
    if (!isRecord(cell.value)) return 'invalid'
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

/** 블록 묶음의 크기 — 넣을 수 없는 타입이 있으면 null. */
function insertableShape(blocks: readonly EditorBlock[], depth: number): number | null {
  let count = 0
  for (const block of blocks) {
    if (!INSERTABLE_BLOCK_TYPES.includes(block.type)) return null
    const children = block.children ?? []
    if (children.length > 0 && depth >= MAX_INSERT_DEPTH) return null
    const inner = insertableShape(children, depth + 1)
    if (inner === null) return null
    count += 1 + inner
  }
  return count
}

/** `insert_blocks`(정본 ⑱) — 받는 것과 저장한 것이 같다. */
function parseInsertBlocks(config: Record<string, unknown>): ActionInput | ActionProblem {
  if (typeof config.position !== 'string' || !(INSERT_POSITIONS as readonly string[]).includes(config.position)) return 'invalid_blocks'
  if (!Array.isArray(config.blocks) || config.blocks.length === 0) return 'invalid_blocks'
  const blocks = config.blocks as EditorBlock[]
  if (blocks.some((b) => !isRecord(b)) || validateDoc({ blocks }).length > 0) return 'invalid_blocks'
  const count = insertableShape(blocks, 1)
  if (count === null || count > MAX_INSERT_BLOCKS) return 'invalid_blocks'
  return { type: 'insert_blocks', config: { v: 1, position: config.position as InsertPosition, blocks } }
}

/** 문자열 목록 — 같은 것은 한 번만 · 모양이 틀리면 null. */
function parseIdList(raw: unknown, ok: (v: string) => boolean): string[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every((v): v is string => typeof v === 'string' && ok(v))) return null
  return [...new Set(raw)]
}

/** `send_notification`(정본 [보강 AN-1] ①) — 받는 것과 저장한 것이 같다. 멤버인지 · 사람 칸인지는 저장할 때 DB 에 대어 본다(`action-check.ts`). */
function parseSendNotification(config: Record<string, unknown>): ActionInput | ActionProblem {
  if (!isRecord(config.to)) return 'invalid_input'
  if (Array.isArray(config.to.users) && config.to.users.length > MAX_NOTIFY_USERS) return 'too_many_recipients'
  const users = parseIdList(config.to.users, (v) => UUID.test(v))
  const people = parseIdList(config.to.people_property_ids, (v) => v !== '' && v.length <= 64)
  if (users === null || people === null || people.length > MAX_NOTIFY_PEOPLE_PROPERTIES) return 'invalid_input'
  if (users.length > MAX_NOTIFY_USERS) return 'too_many_recipients'
  if (users.length === 0 && people.length === 0) return 'invalid_input'
  const rawMessage = config.message ?? []
  if (!Array.isArray(rawMessage) || rawMessage.length > MAX_NOTIFY_RUNS || validateRichText(rawMessage).length > 0) return 'invalid_input'
  const message = sanitizeRichText(rawMessage) ?? []
  if (toPlainText(message).length > MAX_NOTIFY_MESSAGE) return 'invalid_input'
  return { type: 'send_notification', config: { v: 1, to: { users, people_property_ids: people }, message } }
}

/** 메시지가 쓰는 `{{row:속성id}}` 슬롯의 속성 id 들. */
export function notifySlotIds(message: readonly RichTextRun[]): string[] {
  return [...new Set([...toPlainText(message).matchAll(NOTIFY_SLOT)].map((m) => m[1]))]
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
    type === 'send_webhook'
      ? parseSendWebhookInput(config)
      : type === 'insert_blocks'
        ? parseInsertBlocks(config)
        : type === 'send_notification'
          ? parseSendNotification(config)
          : parseCellAction(type as 'edit_property' | 'add_page_to', config),
  )
}

/** 저장한 액션 목록 — `send_webhook` 은 봉인된 모양으로 읽는다. */
export function parseStoredActions(raw: unknown): Parsed<StoredAction> {
  return parseList<StoredAction>(raw, (type, config) => {
    if (type === 'send_webhook') return parseSendWebhookStored(config)
    if (type === 'insert_blocks') return parseInsertBlocks(config) as StoredAction | ActionProblem
    if (type === 'send_notification') return parseSendNotification(config) as StoredAction | ActionProblem
    const parsed = parseCellAction(type as 'edit_property' | 'add_page_to', config)
    return typeof parsed === 'string' ? parsed : (parsed as StoredAction)
  })
}
