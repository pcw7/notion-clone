/**
 * 버튼 속성 — 액션 읽기 · 고치기 · 누르기 (자동화 5a-1 · F-03-15 = 08 F-08-08)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ② ③ ⑤ ⑥
 *
 * 버튼 속성마다 automation(kind `button_property`)이 하나 있다 — 속성을 더할 때 함께 생긴다(`property.ts` `addProperty`).
 *
 *   - 읽기 — 그 표를 볼 수 있으면.
 *   - 고치기 — 그 표의 `edit_structure`(속성 설정과 같은 무게 · 잠긴 데이터베이스는 `locked`). 받은 액션을 그 표의 스키마에 대어 본다
 *     (살아 있는 셀 속성인가 · 읽기 전용이 아닌가 · 값이 그 타입의 모양인가) — 실행 때 다시 보지만, 틀린 정의를 저장하지 않는다.
 *   - 누르기 — 그 행의 `edit_content`(03 *"Can edit content 도 클릭 가능"*). 누른 사람으로 실행한다(엔진 · 정본 ③). 멱등 키는 화면이 누를
 *     때마다 만든 uuid 다(정본 ⑤). **템플릿 행은 누를 행이 아니다**(`not_found` — 누르면 템플릿의 값이 바뀐다 · 정본 ⑪).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isRowFailure, openDataSource } from '../database/row.ts'
import { isUuid } from '../ids.ts'
import { parseActions, type ActionProblem } from './actions.ts'
import { checkActions, readActions, readPublicActions, writeActions, type ActionSchemaProblem, type PublicAction } from './action-check.ts'
import { runAutomation, type RunOutcome } from './engine.ts'

export type ButtonFailure = 'not_found' | 'forbidden' | 'locked' | 'invalid_action' | 'disabled' | 'invalid_key'
/** 액션이 맞지 않는 까닭 — 모양(`ActionProblem`) 또는 스키마(`ActionSchemaProblem` — `action-check.ts`). */
export type ButtonActionProblem = ActionProblem | ActionSchemaProblem

export type ButtonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ButtonFailure; readonly problem?: ButtonActionProblem; readonly index?: number }

/** 액션은 화면 · API 에 주는 모양이다(`send_webhook` 의 URL · 헤더 값은 없다 — 정본 ⑫). */
export type ButtonActions = { readonly automationId: string; readonly enabled: boolean; readonly actions: readonly PublicAction[] }

const fail = (reason: ButtonFailure, problem?: ButtonActionProblem, index?: number) =>
  ({ ok: false, reason, ...(problem === undefined ? {} : { problem }), ...(index === undefined ? {} : { index }) }) as const

/** 그 표의 살아 있는 버튼 속성과 그 automation. */
async function findButton(tx: Tx, dataSourceId: string, propertyId: string, lock = false) {
  return tx.queryMaybe<{ automation_id: string; enabled: boolean }>(
    `SELECT a.id AS automation_id, a.enabled
       FROM property p
       JOIN automation a ON a.host_property_id = p.id AND a.kind = 'button_property'
      WHERE p.id = $1 AND p.data_source_id = $2 AND p.type = 'button' AND p.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    [propertyId, dataSourceId],
  )
}


/** 버튼의 액션 — 그 표를 볼 수 있으면. */
export async function readButtonActions(ctx: SessionContext, dataSourceId: string, propertyId: string): Promise<ButtonResult<ButtonActions>> {
  if (!isUuid(dataSourceId)) return fail('not_found')
  return withReadTransaction(async (tx) => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'view')
    if (isRowFailure(gate)) return fail('not_found')
    const button = await findButton(tx, dataSourceId, propertyId)
    if (button === null) return fail('not_found')
    return { ok: true, value: { automationId: button.automation_id, enabled: button.enabled, actions: await readPublicActions(tx, button.automation_id) } } as const
  })
}


/** 버튼의 액션을 통째로 바꾼다 — 그 표의 `edit_structure`. */
export async function setButtonActions(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  rawActions: unknown,
): Promise<ButtonResult<ButtonActions>> {
  if (!isUuid(dataSourceId)) return fail('not_found')
  const parsed = parseActions(rawActions)
  return withCommandTransaction(async (tx) => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'edit_structure')
    if (isRowFailure(gate)) return fail(!gate.ok && (gate.reason === 'forbidden' || gate.reason === 'locked') ? gate.reason : 'not_found')
    const button = await findButton(tx, dataSourceId, propertyId, true)
    if (button === null) return fail('not_found')
    if (!parsed.ok) return fail('invalid_action', parsed.problem, parsed.index)

    // 셀이 쓰일 표의 스키마에 대어 본다(`action-check.ts` — DB automation 과 같은 검사)
    const problem = await checkActions(tx, ctx, gate, parsed.actions, button.automation_id)
    if (problem !== null) return fail('invalid_action', problem.problem, problem.index)
    await writeActions(tx, button.automation_id, parsed.actions)
    await tx.query(`UPDATE automation SET updated_at = now() WHERE id = $1`, [button.automation_id])
    return { ok: true, value: { automationId: button.automation_id, enabled: button.enabled, actions: await readPublicActions(tx, button.automation_id) } } as const
  })
}

/** 그 행의 버튼을 누른다 — 그 행의 `edit_content` · 누른 사람으로 실행한다. */
export async function pressButton(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
  idempotencyKey: unknown,
): Promise<ButtonResult<RunOutcome>> {
  if (typeof idempotencyKey !== 'string' || !isUuid(idempotencyKey)) return fail('invalid_key')
  if (!isUuid(rowId)) return fail('not_found')
  const prepared = await withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ data_source_id: string }>(
      `SELECT p.data_source_id FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND NOT p.is_template`,
      [rowId, ctx.workspaceId],
    )
    if (row === null) return fail('not_found')
    const gate = await openDataSource(tx, ctx, row.data_source_id, 'edit_content')
    if (isRowFailure(gate)) return fail(!gate.ok && gate.reason === 'forbidden' ? 'forbidden' : 'not_found')
    const button = await findButton(tx, row.data_source_id, propertyId)
    if (button === null) return fail('not_found')
    if (!button.enabled) return fail('disabled')
    return { ok: true, value: { automationId: button.automation_id, actions: await readActions(tx, button.automation_id) } } as const
  })
  if (!prepared.ok) return prepared

  const outcome = await runAutomation(ctx, {
    automationId: prepared.value.automationId,
    idempotencyKey: `button:${idempotencyKey}`,
    context: { triggerPageId: rowId },
    actions: prepared.value.actions,
    kind: 'button',
  })
  if (outcome === null) return fail('invalid_key')
  return { ok: true, value: outcome } as const
}

/** 실패를 HTTP 로 — 없음 404 · 권한 403 · 잠김 · 꺼짐 409 · 액션 · 키 400. */
export function buttonFailureStatus(reason: ButtonFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'locked':
    case 'disabled':
      return 409
    case 'invalid_action':
    case 'invalid_key':
      return 400
  }
}
