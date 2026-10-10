/**
 * 액션의 저장 · 읽기 — 버튼 속성과 DB automation 이 함께 쓴다 (자동화 5b-1 · F-08-07)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 ⑥ ⑨ · [보강] DB automation ④
 *
 *   - `checkActions` — 셀이 쓰일 표의 스키마에 대어 본다. `edit_property` 는 그 automation 의 표, `add_page_to` 는 대상 표(저장하는 사람이 볼 수
 *     있어야 한다 — 아니면 없는 표와 같은 답). 셀은 살아 있는 셀 속성 · 읽기 전용이 아님 · 값이 그 타입의 모양. 템플릿은 그 표의 살아 있는 것.
 *   - `writeActions` — 통째로 바꿔 쓴다(순서는 0부터의 네 자리 글자).
 *   - `readActions` — 저장한 것을 모양만 다시 맞춘다(지금 실행할 수 없는 종류는 빠진다).
 *
 * 실행 때 다시 본다(엔진 — 그 사이 속성이 사라질 수 있다). 여기는 틀린 정의를 저장하지 않으려는 것이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { isRowFailure, openDataSource, type RowCell } from '../database/row.ts'
import { isMvpPropertyType, validateCellValue } from '../database/property-types.ts'
import { readLiveTemplate } from '../database/template.ts'
import { parseActions, type ActionInput } from './actions.ts'

/** 액션이 그 표에 맞지 않는 까닭(모양은 `ActionProblem` — `actions.ts`). */
export type ActionSchemaProblem =
  | 'unknown_property'
  | 'readonly_property'
  | 'invalid_value'
  /** `add_page_to` 의 대상 표를 저장하는 사람이 볼 수 없다 — 없는 표와 같은 답(정본 ⑨). */
  | 'unknown_data_source'
  /** `add_page_to` 의 템플릿이 그 표의 살아 있는 템플릿이 아니다. */
  | 'unknown_template'

/** 그 표의 속성들 — `openDataSource` 의 문이 준다. */
export type SchemaGate = {
  readonly dataSourceId: string
  readonly properties: ReadonlyMap<string, { readonly type: string; readonly writable: string }>
}

/** 셀들이 그 표에 맞는가 — 맞으면 null. */
export function cellProblem(gate: SchemaGate, cells: readonly RowCell[], index: number): ActionSchemaProblem | null {
  for (const cell of cells) {
    const meta = gate.properties.get(cell.propertyId)
    if (meta === undefined || !isMvpPropertyType(meta.type)) return 'unknown_property'
    if (meta.writable === 'readonly') return 'readonly_property'
    if (validateCellValue(meta.type, cell.value, `actions.${index}.${cell.propertyId}`).length > 0) return 'invalid_value'
  }
  return null
}

/** 액션들을 그 automation 의 표(`gate`)와 대상 표에 대어 본다. 맞으면 null. */
export async function checkActions(
  tx: Tx,
  ctx: SessionContext,
  gate: SchemaGate,
  actions: readonly ActionInput[],
): Promise<{ readonly problem: ActionSchemaProblem; readonly index: number } | null> {
  for (const [index, action] of actions.entries()) {
    let target: SchemaGate = gate
    if (action.type === 'add_page_to' && action.config.dataSourceId !== gate.dataSourceId) {
      const other = await openDataSource(tx, ctx, action.config.dataSourceId, 'view')
      if (isRowFailure(other)) return { problem: 'unknown_data_source', index }
      target = other
    }
    const problem = cellProblem(target, action.config.cells, index)
    if (problem !== null) return { problem, index }
    if (action.type === 'add_page_to' && action.config.templateId !== null) {
      if ((await readLiveTemplate(tx, ctx, target.dataSourceId, action.config.templateId)) === null) return { problem: 'unknown_template', index }
    }
  }
  return null
}

/** 액션을 통째로 바꿔 쓴다. */
export async function writeActions(tx: Tx, automationId: string, actions: readonly ActionInput[]): Promise<void> {
  await tx.query(`DELETE FROM automation_action WHERE automation_id = $1`, [automationId])
  for (const [index, action] of actions.entries()) {
    await tx.query(
      `INSERT INTO automation_action (id, automation_id, order_idx, type, config) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
      [automationId, String(index).padStart(4, '0'), action.type, JSON.stringify(action.config)],
    )
  }
}

/** 저장한 액션 — 모양만 다시 맞춘다(지금 실행할 수 없는 종류는 빠진다). */
export async function readActions(tx: Tx, automationId: string): Promise<ActionInput[]> {
  const rows = await tx.query<{ type: string; config: unknown }>(
    `SELECT type, config FROM automation_action WHERE automation_id = $1 ORDER BY order_idx`,
    [automationId],
  )
  const parsed = parseActions(rows.map((r) => ({ type: r.type, config: r.config })))
  return parsed.ok ? [...parsed.actions] : []
}
