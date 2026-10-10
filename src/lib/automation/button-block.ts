/**
 * 버튼 블록의 액션 — 읽기 · 고치기 · 누르기 (자동화 5e-1 · F-08-06)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑰ · 마이그레이션 0083
 *
 * 버튼 블록(`type = 'button'`)은 페이지 본문(Y.Doc)에 살고, 액션은 `automation(kind = 'button_block', host_page_id = 그 블록)` 에 있다 —
 * 처음 저장하거나 누를 때 만든다(블록마다 하나 · `ux_automation_button_block`).
 *
 *   - 주소는 페이지와 블록이다 — 블록은 **그 페이지의 본문**에 있어야 한다(`ownerPageOf`). 그 페이지가 살아 있어야 한다.
 *   - 문 — 읽기는 그 페이지를 볼 수 있으면, 고치기 · 누르기는 그 페이지의 `edit_content`(잠겼으면 `locked`).
 *   - 투영이 밀려 블록의 행이 아직 없으면 밀린 투영을 먼저 한다 — 편집기는 Y.Doc 을 보므로 방금 만든 블록일 수 있다. 그 페이지를 고칠 수
 *     있는 사람만 투영을 부른다(투영은 권한을 보지 않고 마지막 편집자를 남긴다 — `projectPendingBody`).
 *   - **일하는 행이 없다** — 저장 검사는 빈 표로 본다(값 바꾸기 · 행의 속성 · 보낼 속성이 거절된다). 실행의 `triggerPageId` 는 그 페이지.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { query } from '../db/pool.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { isLocked } from '../permissions/lock.ts'
import { ownerPageOf, projectPendingBody } from '../block/body-write.ts'
import { BUTTON_TYPE } from '../block/button.ts'
import { parseActions, type ActionProblem } from './actions.ts'
import { checkActions, readActions, readPublicActions, writeActions, type ActionSchemaProblem, type PublicAction, type SchemaGate } from './action-check.ts'
import { runAutomation, type RunOutcome } from './engine.ts'

export type ButtonBlockFailure = 'not_found' | 'forbidden' | 'locked' | 'invalid_action' | 'disabled' | 'invalid_key'

export type ButtonBlockResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ButtonBlockFailure; readonly problem?: ActionProblem | ActionSchemaProblem; readonly index?: number }

/** 버튼 블록의 상태 — 아직 저장한 적이 없으면 `automationId` 가 null 이고 액션이 없다. */
export type ButtonBlockState = {
  readonly automationId: string | null
  readonly enabled: boolean
  readonly disabledReason: string | null
  readonly actions: readonly PublicAction[]
}

const fail = (reason: ButtonBlockFailure, problem?: ActionProblem | ActionSchemaProblem, index?: number) =>
  ({ ok: false, reason, ...(problem === undefined ? {} : { problem }), ...(index === undefined ? {} : { index }) }) as const

/** 일하는 행이 없다 — 빈 표(정본 ⑰). */
const NO_TABLE: SchemaGate = { dataSourceId: '', properties: new Map() }

type Need = 'view' | 'edit_content'

/** 그 페이지 본문의 버튼 블록인가 · 문. 통과하면 null. */
async function gate(tx: Tx, ctx: SessionContext, pageId: string, blockId: string, need: Need): Promise<ButtonBlockFailure | null> {
  const page = await tx.queryMaybe<{ lifecycle: string }>(
    `SELECT lifecycle FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page'`,
    [pageId, ctx.workspaceId],
  )
  if (page === null || page.lifecycle !== 'live') return 'not_found'
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'not_found'
  const block = await tx.queryMaybe<{ type: string }>(`SELECT type FROM block WHERE id = $1 AND workspace_id = $2`, [blockId, ctx.workspaceId])
  if (block === null || block.type !== BUTTON_TYPE || (await ownerPageOf(tx, ctx, blockId)) !== pageId) return 'not_found'
  if (need === 'edit_content') {
    if (!can(caps, 'edit_content')) return 'forbidden'
    if (await isLocked(tx, pageId)) return 'locked'
  }
  return null
}

/**
 * 블록의 행이 없으면 밀린 투영을 한 번 한다 — 그 페이지를 고칠 수 있는 사람일 때만(머리말).
 */
async function catchUp(ctx: SessionContext, pageId: string, blockId: string): Promise<void> {
  const [row] = await query<{ one: number }>(`SELECT 1 AS one FROM block WHERE id = $1 AND workspace_id = $2`, [blockId, ctx.workspaceId])
  if (row !== undefined) return
  const editable = await withReadTransaction(async (tx) => can(await effectiveCaps(tx, ctx, pageId), 'edit_content'))
  if (editable) await projectPendingBody(ctx, pageId)
}

async function findAutomation(tx: Tx, blockId: string, lock = false) {
  return tx.queryMaybe<{ id: string; enabled: boolean; disabled_reason: string | null }>(
    `SELECT id, enabled, disabled_reason FROM automation WHERE host_page_id = $1 AND kind = 'button_block' ${lock ? 'FOR UPDATE' : ''}`,
    [blockId],
  )
}

/** 없으면 만든다(블록마다 하나 — 둘이 동시에 만들어도 하나). 만든 사람은 처음 저장하거나 누른 사람이다. */
async function ensureAutomation(tx: Tx, ctx: SessionContext, blockId: string) {
  await tx.query(
    `INSERT INTO automation (id, workspace_id, kind, host_page_id, created_by) VALUES ($1, $2, 'button_block', $3, $4)
     ON CONFLICT (host_page_id) WHERE kind = 'button_block' DO NOTHING`,
    [randomUUID(), ctx.workspaceId, blockId, ctx.userId],
  )
  return (await findAutomation(tx, blockId, true))!
}

const stateOf = async (tx: Tx, a: { id: string; enabled: boolean; disabled_reason: string | null } | null): Promise<ButtonBlockState> =>
  a === null
    ? { automationId: null, enabled: true, disabledReason: null, actions: [] }
    : { automationId: a.id, enabled: a.enabled, disabledReason: a.disabled_reason, actions: await readPublicActions(tx, a.id) }

/** 버튼 블록의 액션 — 그 페이지를 볼 수 있으면. */
export async function readButtonBlock(ctx: SessionContext, pageId: string, blockId: string): Promise<ButtonBlockResult<ButtonBlockState>> {
  if (!isUuid(pageId) || !isUuid(blockId)) return fail('not_found')
  await catchUp(ctx, pageId, blockId)
  return withReadTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, blockId, 'view')
    if (denied !== null) return fail(denied)
    return { ok: true, value: await stateOf(tx, await findAutomation(tx, blockId)) } as const
  })
}

/** 액션을 통째로 바꾼다 — 그 페이지의 `edit_content`. 일하는 행이 없다(빈 표로 본다). */
export async function setButtonBlockActions(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
  rawActions: unknown,
): Promise<ButtonBlockResult<ButtonBlockState>> {
  if (!isUuid(pageId) || !isUuid(blockId)) return fail('not_found')
  const parsed = parseActions(rawActions)
  await catchUp(ctx, pageId, blockId)
  return withCommandTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, blockId, 'edit_content')
    if (denied !== null) return fail(denied)
    if (!parsed.ok) return fail('invalid_action', parsed.problem, parsed.index)
    const existing = await findAutomation(tx, blockId, true)
    const problem = await checkActions(tx, ctx, NO_TABLE, parsed.actions, existing?.id ?? null)
    if (problem !== null) return fail('invalid_action', problem.problem, problem.index)
    const automation = existing ?? (await ensureAutomation(tx, ctx, blockId))
    await writeActions(tx, automation.id, parsed.actions)
    await tx.query(`UPDATE automation SET updated_at = now() WHERE id = $1`, [automation.id])
    return { ok: true, value: await stateOf(tx, automation) } as const
  })
}

/** 버튼 블록을 켜고 끈다 — 고치기와 같은 문 · 켜면 꺼진 까닭이 지워진다(⑮ 와 같다). */
export async function setButtonBlockEnabled(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
  enabled: unknown,
): Promise<ButtonBlockResult<ButtonBlockState>> {
  if (!isUuid(pageId) || !isUuid(blockId)) return fail('not_found')
  if (typeof enabled !== 'boolean') return fail('invalid_action', 'invalid')
  return withCommandTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, blockId, 'edit_content')
    if (denied !== null) return fail(denied)
    const automation = await ensureAutomation(tx, ctx, blockId)
    await tx.query(`UPDATE automation SET enabled = $2, disabled_reason = NULL, updated_at = now() WHERE id = $1`, [automation.id, enabled])
    return { ok: true, value: await stateOf(tx, { ...automation, enabled, disabled_reason: null }) } as const
  })
}

/** 누른다 — 그 페이지의 `edit_content` · 누른 사람으로 실행한다. 액션이 없으면 아무 일도 하지 않은 실행이 남는다(버튼 속성과 같다). */
export async function pressButtonBlock(
  ctx: SessionContext,
  pageId: string,
  blockId: string,
  idempotencyKey: unknown,
): Promise<ButtonBlockResult<RunOutcome>> {
  if (typeof idempotencyKey !== 'string' || !isUuid(idempotencyKey)) return fail('invalid_key')
  if (!isUuid(pageId) || !isUuid(blockId)) return fail('not_found')
  await catchUp(ctx, pageId, blockId)
  const prepared = await withCommandTransaction(async (tx) => {
    const denied = await gate(tx, ctx, pageId, blockId, 'edit_content')
    if (denied !== null) return fail(denied)
    const automation = await ensureAutomation(tx, ctx, blockId)
    if (!automation.enabled) return fail('disabled')
    return { ok: true, value: { automationId: automation.id, actions: await readActions(tx, automation.id) } } as const
  })
  if (!prepared.ok) return prepared
  const outcome = await runAutomation(ctx, {
    automationId: prepared.value.automationId,
    idempotencyKey: `button:${idempotencyKey}`,
    context: { triggerPageId: pageId },
    actions: prepared.value.actions,
    kind: 'button_block',
  })
  if (outcome === null) return fail('invalid_key')
  return { ok: true, value: outcome } as const
}

/** 실패를 HTTP 로 — 버튼 속성과 같다(없음 404 · 권한 403 · 잠김 · 꺼짐 409 · 액션 · 키 400). */
export function buttonBlockFailureStatus(reason: ButtonBlockFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'locked':
    case 'disabled':
      return 409
    default:
      return 400
  }
}
