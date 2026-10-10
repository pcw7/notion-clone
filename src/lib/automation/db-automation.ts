/**
 * DB automation — 정의 (자동화 5b-1 · F-08-09)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] DB automation — 정의 · 실행 주체 ② ③ ④ · 마이그레이션 0079
 *
 * 데이터베이스(data_source)에서 일이 생기면 액션을 실행하는 규칙이다. 이 파일은 **정의**만 다룬다 — 일을 받아 실행하는 것은 5b-2.
 *
 *   - 문 — 그 데이터베이스의 **전체 권한**(`manage_perm`). 볼 수 없으면 `not_found`, 볼 수 있지만 전체 권한이 없으면 `forbidden`. 읽기도
 *     같다 — 액션이 남의 권한(만든 사람)으로 돌고 바깥으로 나갈 수 있다(5c).
 *   - 만든 사람(`created_by`)이 실행 주체다(정본 ①) — 고쳐도 바뀌지 않는다.
 *   - 트리거 — `page_added`(조건 없음) · `property_edited`(그 표의 셀 속성 · 조건은 보기의 필터와 같은 잎 하나 — `validateFilter`). 1~5개.
 *     `schedule` · `manual_click` 은 받지 않는다(`unsupported_trigger`).
 *   - 액션 — 버튼과 같은 등록부 · 같은 저장 검사(`action-check.ts` — `edit_property` 는 트리거된 행).
 *   - 표마다 50개 — data_source 행을 잠그고 센다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { isRowFailure, openDataSource } from '../database/row.ts'
import { isMvpPropertyType } from '../database/property-types.ts'
import { validateFilter, type FilterLeaf } from '../database/filter.ts'
import { isUuid } from '../ids.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { parseActions, type ActionInput, type ActionProblem } from './actions.ts'
import { checkActions, readActions, writeActions, type ActionSchemaProblem, type SchemaGate } from './action-check.ts'

export const MAX_DB_AUTOMATIONS = 50
export const MAX_TRIGGERS = 5
export const MAX_AUTOMATION_NAME = 100

export type TriggerInput =
  | { readonly type: 'page_added' }
  | { readonly type: 'property_edited'; readonly propertyId: string; readonly condition: FilterLeaf | null }

export type TriggerProblem = 'invalid' | 'unsupported_trigger' | 'no_triggers' | 'too_many_triggers' | 'unknown_property' | 'invalid_condition'

export type DisabledReason = 'creator_left' | 'trigger_broken' | 'failures'

export type DbAutomation = {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  /** 꺼진 까닭 — 사람이 껐으면 null(정본 0079 ②). */
  readonly disabledReason: DisabledReason | null
  /** 실행 주체(정본 ①). 탈퇴했으면 이름이 빈 글이다. */
  readonly createdBy: { readonly id: string; readonly name: string }
  readonly triggers: readonly TriggerInput[]
  readonly actions: readonly ActionInput[]
  readonly updatedAt: Date
}

export type DbAutomationFailure = 'not_found' | 'forbidden' | 'invalid_name' | 'invalid_trigger' | 'invalid_action' | 'invalid_body' | 'too_many'

export type DbAutomationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: DbAutomationFailure
      readonly problem?: TriggerProblem | ActionProblem | ActionSchemaProblem
      readonly index?: number
    }

const fail = (reason: DbAutomationFailure, problem?: TriggerProblem | ActionProblem | ActionSchemaProblem, index?: number) =>
  ({ ok: false, reason, ...(problem === undefined ? {} : { problem }), ...(index === undefined ? {} : { index }) }) as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 트리거의 모양 — 속성 · 조건이 그 표에 맞는지는 보지 않는다(`checkTriggers`). */
export function parseTriggers(
  raw: unknown,
): { readonly ok: true; readonly triggers: readonly TriggerInput[] } | { readonly ok: false; readonly problem: TriggerProblem; readonly index?: number } {
  if (!Array.isArray(raw)) return { ok: false, problem: 'invalid' }
  if (raw.length === 0) return { ok: false, problem: 'no_triggers' }
  if (raw.length > MAX_TRIGGERS) return { ok: false, problem: 'too_many_triggers' }
  const triggers: TriggerInput[] = []
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item) || typeof item.type !== 'string') return { ok: false, problem: 'invalid', index }
    if (item.type === 'page_added') {
      triggers.push({ type: 'page_added' })
      continue
    }
    if (item.type === 'schedule' || item.type === 'manual_click') return { ok: false, problem: 'unsupported_trigger', index }
    if (item.type !== 'property_edited' || typeof item.propertyId !== 'string') return { ok: false, problem: 'invalid', index }
    const condition = item.condition ?? null
    if (condition !== null && (!isRecord(condition) || condition.property_id !== item.propertyId || typeof condition.operator !== 'string')) {
      return { ok: false, problem: 'invalid_condition', index }
    }
    triggers.push({
      type: 'property_edited',
      propertyId: item.propertyId,
      condition: condition === null ? null : ({ property_id: item.propertyId, operator: condition.operator, ...('value' in condition ? { value: condition.value } : {}) } as FilterLeaf),
    })
  }
  return { ok: true, triggers }
}

/**
 * 조건 값의 모양 — 그 타입의 값인가. `validateFilter` 는 연산자와 값의 유무만 본다(값의 모양은 질의할 때 맞춘다) — 트리거는 사람이 보지 않는
 * 워커가 판정하므로 숫자 칸에 글이 들어가면 그때 질의가 깨진다. 저장할 때 막는다.
 */
function conditionValueOk(type: string, value: unknown): boolean {
  if (value === undefined) return true // 값이 없는 연산자(is_empty …) — 있어야 하는지는 validateFilter 가 본다
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'checkbox':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    default:
      return typeof value === 'string'
  }
}

/** 트리거를 그 표의 스키마에 대어 본다 — 살아 있는 셀 속성 · 조건은 보기의 필터와 같은 검사 + 값의 모양. 맞으면 null. */
function checkTriggers(gate: SchemaGate, triggers: readonly TriggerInput[]): { readonly problem: TriggerProblem; readonly index: number } | null {
  const types = new Map([...gate.properties].map(([id, meta]) => [id, meta.type]))
  for (const [index, trigger] of triggers.entries()) {
    if (trigger.type !== 'property_edited') continue
    const meta = gate.properties.get(trigger.propertyId)
    if (meta === undefined || !isMvpPropertyType(meta.type)) return { problem: 'unknown_property', index }
    if (trigger.condition !== null && (validateFilter(trigger.condition, types).length > 0 || !conditionValueOk(meta.type, trigger.condition.value))) {
      return { problem: 'invalid_condition', index }
    }
  }
  return null
}

/** 문 — 살아 있는 표 · 볼 수 있음 · 전체 권한. 표의 스키마를 함께 준다. */
async function gate(tx: Tx, ctx: SessionContext, dataSourceId: string, lock: boolean): Promise<SchemaGate | DbAutomationFailure> {
  if (!isUuid(dataSourceId)) return 'not_found'
  const opened = await openDataSource(tx, ctx, dataSourceId, 'view')
  if (isRowFailure(opened)) return 'not_found'
  if (!can(await effectiveCaps(tx, ctx, opened.containerId), 'manage_perm')) return 'forbidden'
  // 상한을 세는 줄을 세운다(만들기)
  if (lock) await tx.query(`SELECT 1 FROM data_source WHERE id = $1 FOR UPDATE`, [dataSourceId])
  return opened
}

type Row = {
  id: string
  name: string
  enabled: boolean
  disabled_reason: DisabledReason | null
  created_by: string
  creator_name: string | null
  creator_deleted: boolean | null
  updated_at: Date
}

async function readAutomations(tx: Tx, dataSourceId: string, only: string | null): Promise<DbAutomation[]> {
  const rows = await tx.query<Row>(
    `SELECT a.id, a.name, a.enabled, a.disabled_reason, a.created_by, a.updated_at,
            u.name AS creator_name, u.deleted_at IS NOT NULL AS creator_deleted
       FROM automation a
       LEFT JOIN "user" u ON u.id = a.created_by
      WHERE a.host_data_source_id = $1 AND a.kind = 'db_automation' AND ($2::uuid IS NULL OR a.id = $2::uuid)
      ORDER BY a.created_at, a.id`,
    [dataSourceId, only],
  )
  const out: DbAutomation[] = []
  for (const r of rows) {
    const triggers = await tx.query<{ type: string; property_id: string | null; condition: FilterLeaf | null }>(
      `SELECT type, property_id, condition FROM automation_trigger WHERE automation_id = $1 ORDER BY type, property_id, id`,
      [r.id],
    )
    out.push({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      disabledReason: r.disabled_reason,
      createdBy: { id: r.created_by, name: r.creator_deleted ? '' : (r.creator_name ?? '') },
      triggers: triggers.flatMap((t): TriggerInput[] =>
        t.type === 'page_added'
          ? [{ type: 'page_added' }]
          : t.type === 'property_edited' && t.property_id !== null
            ? [{ type: 'property_edited', propertyId: t.property_id, condition: t.condition }]
            : [],
      ),
      actions: await readActions(tx, r.id),
      updatedAt: r.updated_at,
    })
  }
  return out
}

async function writeTriggers(tx: Tx, automationId: string, triggers: readonly TriggerInput[]): Promise<void> {
  await tx.query(`DELETE FROM automation_trigger WHERE automation_id = $1`, [automationId])
  for (const trigger of triggers) {
    await tx.query(
      `INSERT INTO automation_trigger (id, automation_id, type, property_id, condition) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
      [
        automationId,
        trigger.type,
        trigger.type === 'property_edited' ? trigger.propertyId : null,
        trigger.type === 'property_edited' && trigger.condition !== null ? JSON.stringify(trigger.condition) : null,
      ],
    )
  }
}

const normalizeName = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  return name.length >= 1 && name.length <= MAX_AUTOMATION_NAME ? name : null
}

/** 그 표의 DB automation — 전체 권한. */
export async function listDbAutomations(ctx: SessionContext, dataSourceId: string): Promise<DbAutomationResult<readonly DbAutomation[]>> {
  return withReadTransaction(async (tx) => {
    const g = await gate(tx, ctx, dataSourceId, false)
    if (typeof g === 'string') return fail(g)
    return { ok: true, value: await readAutomations(tx, dataSourceId, null) } as const
  })
}

export type DbAutomationInput = { readonly name: unknown; readonly triggers: unknown; readonly actions: unknown }

/** 만든다 — 만든 사람이 실행 주체다(정본 ①). */
export async function createDbAutomation(
  ctx: SessionContext,
  dataSourceId: string,
  input: DbAutomationInput,
): Promise<DbAutomationResult<DbAutomation>> {
  return withCommandTransaction(async (tx) => {
    const g = await gate(tx, ctx, dataSourceId, true)
    if (typeof g === 'string') return fail(g)
    const name = normalizeName(input.name)
    if (name === null) return fail('invalid_name')
    const triggers = parseTriggers(input.triggers)
    if (!triggers.ok) return fail('invalid_trigger', triggers.problem, triggers.index)
    const actions = parseActions(input.actions)
    if (!actions.ok) return fail('invalid_action', actions.problem, actions.index)
    const triggerProblem = checkTriggers(g, triggers.triggers)
    if (triggerProblem !== null) return fail('invalid_trigger', triggerProblem.problem, triggerProblem.index)
    const actionProblem = await checkActions(tx, ctx, g, actions.actions)
    if (actionProblem !== null) return fail('invalid_action', actionProblem.problem, actionProblem.index)
    const count = await tx.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM automation WHERE host_data_source_id = $1 AND kind = 'db_automation'`,
      [dataSourceId],
    )
    if (count.n >= MAX_DB_AUTOMATIONS) return fail('too_many')

    const id = randomUUID()
    await tx.query(
      `INSERT INTO automation (id, workspace_id, kind, host_data_source_id, name, created_by) VALUES ($1, $2, 'db_automation', $3, $4, $5)`,
      [id, ctx.workspaceId, dataSourceId, name, ctx.userId],
    )
    await writeTriggers(tx, id, triggers.triggers)
    await writeActions(tx, id, actions.actions)
    const [made] = await readAutomations(tx, dataSourceId, id)
    return { ok: true, value: made } as const
  })
}

export type DbAutomationPatch = {
  readonly name?: unknown
  readonly triggers?: unknown
  readonly actions?: unknown
  readonly enabled?: unknown
}

/** 고친다 — 준 것만. 켜면 꺼진 까닭이 지워지고, 끄면 사람이 끈 것이다(까닭 없음). 실행 주체는 바뀌지 않는다. */
export async function updateDbAutomation(
  ctx: SessionContext,
  dataSourceId: string,
  automationId: string,
  patch: DbAutomationPatch,
): Promise<DbAutomationResult<DbAutomation>> {
  return withCommandTransaction(async (tx) => {
    const g = await gate(tx, ctx, dataSourceId, false)
    if (typeof g === 'string') return fail(g)
    if (!isUuid(automationId)) return fail('not_found')
    const found = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM automation WHERE id = $1 AND host_data_source_id = $2 AND kind = 'db_automation' FOR UPDATE`,
      [automationId, dataSourceId],
    )
    if (found === null) return fail('not_found')

    let name: string | undefined
    if (patch.name !== undefined) {
      const normalized = normalizeName(patch.name)
      if (normalized === null) return fail('invalid_name')
      name = normalized
    }
    let triggers: readonly TriggerInput[] | undefined
    if (patch.triggers !== undefined) {
      const parsed = parseTriggers(patch.triggers)
      if (!parsed.ok) return fail('invalid_trigger', parsed.problem, parsed.index)
      const problem = checkTriggers(g, parsed.triggers)
      if (problem !== null) return fail('invalid_trigger', problem.problem, problem.index)
      triggers = parsed.triggers
    }
    let actions: readonly ActionInput[] | undefined
    if (patch.actions !== undefined) {
      const parsed = parseActions(patch.actions)
      if (!parsed.ok) return fail('invalid_action', parsed.problem, parsed.index)
      const problem = await checkActions(tx, ctx, g, parsed.actions)
      if (problem !== null) return fail('invalid_action', problem.problem, problem.index)
      actions = parsed.actions
    }
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') return fail('invalid_body')

    await tx.query(
      `UPDATE automation
          SET name = coalesce($2, name),
              enabled = coalesce($3::boolean, enabled),
              disabled_reason = CASE WHEN $3::boolean IS NULL THEN disabled_reason ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [automationId, name ?? null, patch.enabled === undefined ? null : patch.enabled],
    )
    if (triggers !== undefined) await writeTriggers(tx, automationId, triggers)
    if (actions !== undefined) await writeActions(tx, automationId, actions)
    const [updated] = await readAutomations(tx, dataSourceId, automationId)
    return { ok: true, value: updated } as const
  })
}

/** 지운다 — 트리거 · 액션 · 실행 기록이 함께 사라진다(FK CASCADE). */
export async function deleteDbAutomation(ctx: SessionContext, dataSourceId: string, automationId: string): Promise<DbAutomationResult<null>> {
  return withCommandTransaction(async (tx) => {
    const g = await gate(tx, ctx, dataSourceId, false)
    if (typeof g === 'string') return fail(g)
    if (!isUuid(automationId)) return fail('not_found')
    const removed = await tx.query<{ id: string }>(
      `DELETE FROM automation WHERE id = $1 AND host_data_source_id = $2 AND kind = 'db_automation' RETURNING id`,
      [automationId, dataSourceId],
    )
    return removed.length === 0 ? fail('not_found') : ({ ok: true, value: null } as const)
  })
}

/** 실패를 HTTP 로 — 없음 404 · 권한 403 · 나머지 400. */
export function dbAutomationFailureStatus(reason: DbAutomationFailure): number {
  return reason === 'not_found' ? 404 : reason === 'forbidden' ? 403 : 400
}
