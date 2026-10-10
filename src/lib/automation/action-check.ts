/**
 * 액션의 저장 · 읽기 — 버튼 속성과 DB automation 이 함께 쓴다 (자동화 5b-1 · 5c-1 · F-08-07 · F-08-13)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 ⑥ ⑨ ⑫ · [보강] DB automation ④
 *
 *   - `checkActions` — 셀이 쓰일 표의 스키마에 대어 본다. `edit_property` 는 그 automation 의 표, `add_page_to` 는 대상 표(저장하는 사람이 볼 수
 *     있어야 한다 — 아니면 없는 표와 같은 답). 셀은 살아 있는 셀 속성 · 읽기 전용이 아님 · 값이 그 타입의 모양. 템플릿은 그 표의 살아 있는 것.
 *     `send_webhook` 은 보낼 속성이 그 automation 의 표의 셀 속성인가 · `keep` 이 **같은 automation** 의 `send_webhook` 인가(값을 비운 헤더는
 *     그 액션에 같은 이름이 있는가) · 요금제가 허락하는가(`automation.webhook`).
 *   - `writeActions` — 통째로 바꿔 쓴다(순서는 0부터의 네 자리 글자). `send_webhook` 의 URL · 헤더 값은 **봉인해서** 쓰고, 비운 것은 `keep` 에서
 *     옮긴다(지우기 전에 읽는다).
 *   - `readActions` — 저장한 것(엔진이 실행한다 — 봉인된 채). `readPublicActions` — 화면 · API 에 주는 것(봉인 대신 힌트 · 헤더 이름 ·
 *     `ref`).
 *
 * 실행 때 다시 본다(엔진 — 그 사이 속성이 사라질 수 있다). 여기는 틀린 정의를 저장하지 않으려는 것이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { isRowFailure, openDataSource } from '../database/row.ts'
import { isMvpPropertyType, validateCellValue } from '../database/property-types.ts'
import { readLiveTemplate } from '../database/template.ts'
import { entitlement } from '../billing/entitlement.ts'
import { sealWebhookUrl, webhookUrlHint } from '../net/url-seal.ts'
import {
  isDynamicCell,
  parseStoredActions,
  type ActionCell,
  type ActionInput,
  type SendWebhookInput,
  type SendWebhookStored,
  type StoredAction,
} from './actions.ts'

/** 액션이 그 표에 맞지 않는 까닭(모양은 `ActionProblem` — `actions.ts`). */
export type ActionSchemaProblem =
  | 'unknown_property'
  | 'readonly_property'
  | 'invalid_value'
  /** `add_page_to` 의 대상 표를 저장하는 사람이 볼 수 없다 — 없는 표와 같은 답(정본 ⑨). */
  | 'unknown_data_source'
  /** `add_page_to` 의 템플릿이 그 표의 살아 있는 템플릿이 아니다. */
  | 'unknown_template'
  /** `send_webhook` 의 `keep` 이 같은 automation 의 `send_webhook` 이 아니다 · 값을 비운 헤더를 옮길 곳이 없다(정본 ⑫). */
  | 'unknown_ref'
  /** `send_webhook` 을 이 워크스페이스의 요금제가 허락하지 않는다(`automation.webhook`). */
  | 'plan_required'
  /** 동적 값의 짝이 맞지 않는다 — "지금"은 날짜 속성에만 · 일하는 행의 속성은 같은 타입(선택지 · 상태 제외 · 정본 ⑯). */
  | 'invalid_dynamic'
  /** 이 자리에서 쓸 수 없는 액션 — `insert_blocks` 는 버튼 블록에서만(정본 ⑱). */
  | 'unsupported_here'

/** 그 표의 속성들 — `openDataSource` 의 문이 준다. */
export type SchemaGate = {
  readonly dataSourceId: string
  readonly properties: ReadonlyMap<string, { readonly type: string; readonly writable: string }>
}

/** 일하는 행의 속성으로 채울 수 없는 타입 — 옵션이 속성마다 다르다(이름으로 맞추는 것은 v2 · 정본 ⑯). */
const NOT_COPYABLE: ReadonlySet<string> = new Set(['select', 'status'])

/**
 * 셀들이 그 표에 맞는가 — 맞으면 null.
 *
 * @param source 동적 값 `row_property` 의 원본 속성이 있는 표 — 그 automation 의 표(일하는 행의 표). 받는 표와 같으면 주지 않는다.
 */
export function cellProblem(gate: SchemaGate, cells: readonly ActionCell[], index: number, source: SchemaGate = gate): ActionSchemaProblem | null {
  for (const cell of cells) {
    const meta = gate.properties.get(cell.propertyId)
    if (meta === undefined || !isMvpPropertyType(meta.type)) return 'unknown_property'
    if (meta.writable === 'readonly') return 'readonly_property'
    if (isDynamicCell(cell)) {
      if (cell.from.kind === 'now') {
        if (meta.type !== 'date') return 'invalid_dynamic'
        continue
      }
      const from = source.properties.get(cell.from.propertyId)
      if (from === undefined || from.type !== meta.type || NOT_COPYABLE.has(meta.type)) return 'invalid_dynamic'
      continue
    }
    if (validateCellValue(meta.type, cell.value, `actions.${index}.${cell.propertyId}`).length > 0) return 'invalid_value'
  }
  return null
}

/** 그 automation 의 저장된 `send_webhook` — 액션 id → 봉인된 설정. 새로 만드는 automation 이면 빈 것. */
async function storedWebhooks(tx: Tx, automationId: string | null): Promise<Map<string, SendWebhookStored>> {
  if (automationId === null) return new Map()
  const rows = await tx.query<{ id: string; config: unknown }>(
    `SELECT id, config FROM automation_action WHERE automation_id = $1 AND type = 'send_webhook'`,
    [automationId],
  )
  const out = new Map<string, SendWebhookStored>()
  for (const row of rows) {
    const parsed = parseStoredActions([{ type: 'send_webhook', config: row.config }])
    if (parsed.ok && parsed.actions[0].type === 'send_webhook') out.set(row.id, parsed.actions[0].config)
  }
  return out
}

/** `keep` 과 비운 헤더 값이 옮길 곳을 갖는가. */
function refProblem(config: SendWebhookInput, stored: ReadonlyMap<string, SendWebhookStored>): boolean {
  const from = config.keep === null ? undefined : stored.get(config.keep)
  if (config.keep !== null && from === undefined) return true
  return config.headers.some((h) => h.value === null && !(from?.headers.some((x) => x.name === h.name) ?? false))
}

/**
 * 액션들을 그 automation 의 표(`gate`)와 대상 표에 대어 본다. 맞으면 null.
 *
 * @param automationId 고치는 automation — `send_webhook` 의 `keep` 은 이 automation 의 것만 옮긴다(새로 만들면 null — 옮길 것이 없다)
 * @param options.insertBlocks 블록 넣기를 받는가 — 버튼 블록만(정본 ⑱)
 */
export async function checkActions(
  tx: Tx,
  ctx: SessionContext,
  gate: SchemaGate,
  actions: readonly ActionInput[],
  automationId: string | null = null,
  options: { readonly insertBlocks?: boolean } = {},
): Promise<{ readonly problem: ActionSchemaProblem; readonly index: number } | null> {
  const firstWebhook = actions.findIndex((a) => a.type === 'send_webhook')
  if (firstWebhook >= 0 && !(await entitlement(ctx.workspaceId, 'automation.webhook', tx))) return { problem: 'plan_required', index: firstWebhook }
  const stored = firstWebhook >= 0 ? await storedWebhooks(tx, automationId) : new Map<string, SendWebhookStored>()
  for (const [index, action] of actions.entries()) {
    if (action.type === 'insert_blocks') {
      if (options.insertBlocks !== true) return { problem: 'unsupported_here', index }
      continue
    }
    if (action.type === 'send_webhook') {
      // 보낼 속성은 그 automation 의 표의 셀 속성(버튼 · relation 은 못 고른다 — 08 *"DB 버튼 property 는 전송 필드로 선택 불가"*)
      for (const propertyId of action.config.properties) {
        const meta = gate.properties.get(propertyId)
        if (meta === undefined || !isMvpPropertyType(meta.type)) return { problem: 'unknown_property', index }
      }
      if (refProblem(action.config, stored)) return { problem: 'unknown_ref', index }
      continue
    }
    let target: SchemaGate = gate
    if (action.type === 'add_page_to' && action.config.dataSourceId !== gate.dataSourceId) {
      const other = await openDataSource(tx, ctx, action.config.dataSourceId, 'view')
      if (isRowFailure(other)) return { problem: 'unknown_data_source', index }
      target = other
    }
    const problem = cellProblem(target, action.config.cells, index, gate)
    if (problem !== null) return { problem, index }
    if (action.type === 'add_page_to' && action.config.templateId !== null) {
      if ((await readLiveTemplate(tx, ctx, target.dataSourceId, action.config.templateId)) === null) return { problem: 'unknown_template', index }
    }
  }
  return null
}

const seal = (plain: string) => sealWebhookUrl(plain).toString('base64')

/** 받은 `send_webhook` 을 저장할 모양으로 — 새 값은 봉인하고 비운 것은 `keep` 에서 옮긴다(`checkActions` 가 옮길 곳을 보았다). */
function toStoredWebhook(config: SendWebhookInput, stored: ReadonlyMap<string, SendWebhookStored>): SendWebhookStored {
  const from = config.keep === null ? undefined : stored.get(config.keep)
  const url = config.url === null ? null : new URL(config.url)
  if (url === null && from === undefined) throw new Error('send_webhook — 옮길 URL 이 없다(checkActions 를 먼저 부른다)')
  return {
    v: 1,
    urlSealed: url === null ? from!.urlSealed : seal(url.href),
    urlHint: url === null ? from!.urlHint : webhookUrlHint(url),
    headers: config.headers.map((h) => {
      if (h.value !== null) return { name: h.name, valueSealed: seal(h.value) }
      const kept = from?.headers.find((x) => x.name === h.name)
      if (kept === undefined) throw new Error('send_webhook — 옮길 헤더 값이 없다(checkActions 를 먼저 부른다)')
      return kept
    }),
    properties: config.properties,
  }
}

/** 액션을 통째로 바꿔 쓴다 — 지우기 전에 옮길 봉인을 읽는다. */
export async function writeActions(tx: Tx, automationId: string, actions: readonly ActionInput[]): Promise<void> {
  const stored = actions.some((a) => a.type === 'send_webhook') ? await storedWebhooks(tx, automationId) : new Map<string, SendWebhookStored>()
  await tx.query(`DELETE FROM automation_action WHERE automation_id = $1`, [automationId])
  for (const [index, action] of actions.entries()) {
    const config = action.type === 'send_webhook' ? toStoredWebhook(action.config, stored) : action.config
    await tx.query(
      `INSERT INTO automation_action (id, automation_id, order_idx, type, config) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
      [automationId, String(index).padStart(4, '0'), action.type, JSON.stringify(config)],
    )
  }
}

/** 저장한 액션 — 엔진이 실행한다(봉인된 채 · 지금 실행할 수 없는 종류는 빠진다). */
export async function readActions(tx: Tx, automationId: string): Promise<StoredAction[]> {
  const rows = await tx.query<{ type: string; config: unknown }>(
    `SELECT type, config FROM automation_action WHERE automation_id = $1 ORDER BY order_idx`,
    [automationId],
  )
  const parsed = parseStoredActions(rows.map((r) => ({ type: r.type, config: r.config })))
  return parsed.ok ? [...parsed.actions] : []
}

/** 화면 · API 에 주는 액션 — `send_webhook` 은 봉인 대신 힌트 · 헤더 이름 · `ref`(고칠 때 `keep` 으로 돌려준다 · 정본 ⑫). */
export type PublicAction = { readonly type: string; readonly config: Readonly<Record<string, unknown>> }

export async function readPublicActions(tx: Tx, automationId: string): Promise<PublicAction[]> {
  const rows = await tx.query<{ id: string; type: string; config: unknown }>(
    `SELECT id, type, config FROM automation_action WHERE automation_id = $1 ORDER BY order_idx`,
    [automationId],
  )
  const out: PublicAction[] = []
  for (const row of rows) {
    const parsed = parseStoredActions([{ type: row.type, config: row.config }])
    if (!parsed.ok) continue
    const action = parsed.actions[0]
    if (action.type !== 'send_webhook') {
      out.push(action)
      continue
    }
    const { urlHint, headers, properties } = action.config
    out.push({ type: 'send_webhook', config: { v: 1, ref: row.id, urlHint, headers: headers.map((h) => ({ name: h.name })), properties } })
  }
  return out
}
