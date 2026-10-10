/**
 * 자동화 액션 — 종류 · 설정의 모양 (자동화 5a-1 · F-08-07 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 자동화 엔진 · 버튼 속성 ⑥
 *
 * 종류는 처음부터 상위집합이다(`ck_automation_action_type`) — 버튼 · DB automation 이 같은 등록부를 쓴다(08 F-08-07 *"버튼·automation 공통
 * 액션 목록"*). 이 조각이 실행하는 것은 `edit_property` 하나다(그 행의 셀을 고정 값으로). 나머지는 그 조각이 올 때 `IMPLEMENTED` 에 더한다.
 *
 * 이 파일은 **모양만** 본다(어떤 속성 · 어떤 값인가는 저장할 때 그 표의 스키마에 대어 본다 — `button-property.ts`).
 */

import type { RowCell } from '../database/row.ts'

/** 정본 CHECK 와 같은 목록. */
export const ACTION_TYPES = ['edit_property', 'add_page_to', 'insert_blocks', 'send_webhook', 'define_variables', 'show_confirmation'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** 지금 실행할 수 있는 종류 — 조각마다 늘린다(5a-2 `add_page_to` · 5c `send_webhook` · 5d `define_variables` · 5e `insert_blocks`). */
export const IMPLEMENTED_ACTIONS: readonly ActionType[] = ['edit_property']

/** 한 automation 의 액션 상한. */
export const MAX_ACTIONS = 20
/** 한 `edit_property` 가 고치는 셀의 상한. */
export const MAX_CELLS_PER_ACTION = 50

/** 그 행의 셀을 고정 값으로 바꾼다 — 값은 셀 쓰기 API 의 `CellValue` 그대로(정본 ⑥ · 수식 · 멘션 슬롯은 5d). */
export type EditPropertyConfig = { readonly v: 1; readonly cells: readonly RowCell[] }

export type ActionInput = { readonly type: 'edit_property'; readonly config: EditPropertyConfig }

export type ActionProblem = 'invalid' | 'unsupported_action' | 'too_many_actions' | 'too_many_cells' | 'empty_cells'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 받은 액션 목록의 모양을 본다 — 셀의 속성 · 값이 그 표에 맞는지는 보지 않는다. */
export function parseActions(raw: unknown): { readonly ok: true; readonly actions: readonly ActionInput[] } | { readonly ok: false; readonly problem: ActionProblem; readonly index?: number } {
  if (!Array.isArray(raw)) return { ok: false, problem: 'invalid' }
  if (raw.length > MAX_ACTIONS) return { ok: false, problem: 'too_many_actions' }
  const actions: ActionInput[] = []
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item) || typeof item.type !== 'string') return { ok: false, problem: 'invalid', index }
    if (!(IMPLEMENTED_ACTIONS as readonly string[]).includes(item.type)) return { ok: false, problem: 'unsupported_action', index }
    const config = item.config
    if (!isRecord(config) || config.v !== 1 || !Array.isArray(config.cells)) return { ok: false, problem: 'invalid', index }
    if (config.cells.length === 0) return { ok: false, problem: 'empty_cells', index }
    if (config.cells.length > MAX_CELLS_PER_ACTION) return { ok: false, problem: 'too_many_cells', index }
    const cells: RowCell[] = []
    const seen = new Set<string>()
    for (const cell of config.cells) {
      if (!isRecord(cell) || typeof cell.propertyId !== 'string' || !isRecord(cell.value) || seen.has(cell.propertyId)) {
        return { ok: false, problem: 'invalid', index }
      }
      seen.add(cell.propertyId)
      cells.push({ propertyId: cell.propertyId, value: cell.value as RowCell['value'] })
    }
    actions.push({ type: 'edit_property', config: { v: 1, cells } })
  }
  return { ok: true, actions }
}
