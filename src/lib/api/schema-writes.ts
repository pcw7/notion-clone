/**
 * 공개 API 의 구조 쓰기 — `POST /v1/databases` · `PATCH /v1/databases/{id}` · `POST /v1/data_sources` · `PATCH /v1/data_sources/{id}`
 * (API-4b · F-09-01 · F-09-16 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ ⑨ · 공개 API 투영 규칙
 *
 * **모든 쓰기는 앱의 구조 명령을 지난다** — 권한(`lockSchema` · 데이터베이스의 `edit_structure`) · 검사 · 상한 · 딸린 것(뷰의 열 · 수식의 간선 ·
 * 옵션을 쓰는 칸)이 앱과 같다. 여기서 쓰는 SQL 은 없다(상태 범주의 id 를 읽을 뿐):
 *   · 데이터베이스 — 만들기 `createInlineDatabaseIn`(페이지 본문 안 · 부모의 `create_child`) · 이름 `renameDatabaseIn` · 아이콘
 *     `setDatabaseIconIn` · 잠금 `setDatabaseLockIn` · 휴지통 `trashPage` / `restorePage`
 *   · 데이터 소스 — 더하기 `addDataSourceIn` · 이름 `renameDataSourceIn`(소스가 하나면 데이터베이스의 이름 `renameDatabaseIn` — 읽기가
 *     그 이름을 보여 준다) · 휴지통 `trashDataSource` / `restoreDataSource`
 *   · 속성 — `addPropertyIn` · `updatePropertyIn` · `deletePropertyIn` · 옵션 `addSelectOptionIn` · `updateSelectOptionIn` ·
 *     `deleteSelectOptionIn` · 타입 `convertPropertyIn`(노션처럼 묻지 않는다 — `confirmLoss`) · `addRelationPropertyIn` ·
 *     `addRollupPropertyIn` / `updateRollupPropertyIn` · `addFormulaPropertyIn` / `updateFormulaExpressionIn`
 *
 * **한 요청 = 한 명령 트랜잭션**(노션의 PATCH 는 통째로 듣는다) — 속성 하나라도 거부되면 아무것도 바뀌지 않는다. 휴지통 · 되살리기만 따로다
 * (API-2 의 페이지와 같다 — 되살린 뒤 고치고, 고친 뒤 넣는다).
 *
 * 오류 — 볼 수 없으면 404 `object_not_found` · 볼 수만 있고 구조를 못 고치면 403 `restricted_resource` · 잠긴 데이터베이스 · 받지 않는 것은
 * 400 `validation_error`(이유를 말한다) · 동시 쓰기는 409 `conflict_error`. 요청의 모양 · 계획은 `schema-request.ts`(순수).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { restorePage, trashPage, TrashError } from '../block/trash.ts'
import { toPlainText } from '../contracts/rich-text.ts'
import { createInlineDatabaseIn, renameDatabaseIn, setDatabaseIconIn, type DatabaseFailure } from '../database/database.ts'
import {
  addDataSourceIn,
  readDataSources,
  renameDataSourceIn,
  restoreDataSource,
  trashDataSource,
  type DataSourceFailure,
} from '../database/data-source.ts'
import { addFormulaPropertyIn, updateFormulaExpressionIn } from '../database/formula-property.ts'
import { MAX_FORMULA_DEPTH, readFormulaConfig } from '../database/formula-schema.ts'
import {
  addPropertyIn,
  addSelectOptionIn,
  deletePropertyIn,
  deleteSelectOptionIn,
  isSchemaFailure,
  lockSchema,
  MAX_PROPERTIES_PER_DATA_SOURCE,
  MAX_PROPERTY_DESCRIPTION_LENGTH,
  MAX_PROPERTY_NAME_LENGTH,
  normalizePropertyName,
  readSchema,
  updatePropertyIn,
  updateSelectOptionIn,
  type AddPropertyInput,
  type PropertySummary,
} from '../database/property.ts'
import { convertPropertyIn, MAX_CONVERT_CELLS } from '../database/property-convert.ts'
import { isStatusGroupKind, readRelationConfig, type StatusGroupKind } from '../database/property-types.ts'
import { addRelationPropertyIn, canViewDataSource } from '../database/relation.ts'
import { addRollupPropertyIn, updateRollupPropertyIn } from '../database/rollup.ts'
import { readRollupConfig, type RollupFunction } from '../database/rollup-functions.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { displayFormula } from '../formula/formula.ts'
import { asBlockId } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked, setDatabaseLockIn } from '../permissions/lock.ts'
import { databaseReply, dataSourceReply, mistakenIdReply, openDatabaseIn, openSourceIn } from './data-sources.ts'
import { readApiProperties } from './page-object.ts'
import {
  apiLinks,
  bodyInvalid,
  conflict,
  invalid,
  isConflict,
  isObject,
  LOCKED_MESSAGE,
  notFound,
  parseIcon,
  policyBlock,
  restricted,
  unexpectedKey,
} from './pages.ts'
import { TITLE_PROPERTY_ID } from './property-values.ts'
import { parseApiRichText } from './rich-text.ts'
import {
  isOptionTypeConfig,
  parseSchemaProperties,
  planSchema,
  reconcileOptions,
  type OptionRequest,
  type RefRequest,
  type SchemaEntry,
  type SchemaStep,
  type TypeConfig,
} from './schema-request.ts'
import type { V1Handler, V1Reply } from './v1.ts'
import { invalidPathIdMessage, parseApiId, shownValue } from './v1-protocol.ts'

// ── 답 ────────────────────────────────────────────────────────────────

export const DATABASE_LOCKED_MESSAGE = "Can't edit database that is locked. Unlock it in the app (or send is_locked: false) before editing."
const DATABASE_TRASHED_MESSAGE = "Can't edit database that is in trash. Restore it first by setting in_trash to false."
const SOURCE_TRASHED_MESSAGE = "Can't edit data source that is in trash. Restore it first by setting in_trash to false."

type Done = V1Reply | null

/** 명령의 거부 — 속성 명령 · 변환 · 데이터 소스 · 데이터베이스가 돌려주는 모양. */
type Refusal = { readonly ok: false; readonly reason: string; readonly formulaError?: { readonly message: string } }

/** 구조 명령의 거부 → 노션의 답. `path` 는 요청의 그 자리(`body.properties.이름`). */
function schemaRefusal(r: Refusal, path: string, dataSourceId: string): V1Reply {
  switch (r.reason) {
    case 'not_found':
      return notFound('data source', dataSourceId)
    case 'forbidden':
      return restricted()
    case 'locked':
      return invalid(DATABASE_LOCKED_MESSAGE)
    case 'schema_conflict':
      return conflict()
    case 'duplicate_name':
      return invalid(`${path}: the name is already used by another property or option of this data source.`)
    case 'invalid_name':
      return invalid(`${path}: the name is empty or longer than ${MAX_PROPERTY_NAME_LENGTH} characters, or the description is longer than ${MAX_PROPERTY_DESCRIPTION_LENGTH}.`)
    case 'unsupported_type':
      return invalid(`${path}: this property type cannot be changed that way.`)
    case 'title_immutable':
      return invalid(`${path}: the title property cannot be deleted or converted, and no other property can become title.`)
    case 'too_many_properties':
      return invalid(`A data source can have at most ${MAX_PROPERTIES_PER_DATA_SOURCE} properties.`)
    case 'invalid_color':
      return invalid(`${path}: the option color is not valid.`)
    case 'invalid_group':
      return invalid(`${path}: groups are only for status options.`)
    case 'invalid_config':
      return invalid(`${path}: the property settings are not valid.`)
    case 'invalid_target':
      return invalid(`${path}: the related data source or the rollup property was not found, or the token's user cannot see it.`)
    case 'unique_id_exists':
      return invalid(`${path}: a data source can have only one unique_id property.`)
    case 'managed_property':
      return invalid(`${path}: this relation belongs to sub-items or dependencies — turn that feature off in the app instead.`)
    case 'invalid_formula':
      return invalid(`${path}.formula.expression is not valid: ${r.formulaError?.message ?? 'the formula could not be read.'}`)
    case 'formula_cycle':
      return invalid(`${path}: formulas would refer to each other in a cycle.`)
    case 'formula_too_deep':
      return invalid(`${path}: formulas would refer to each other more than ${MAX_FORMULA_DEPTH} levels deep.`)
    case 'plan_required':
      return invalid(`${path}: verification properties need a plan that includes them.`)
    case 'verification_exists':
      return invalid(`${path}: a data source can have only one verification property.`)
    case 'owner_linked':
      return invalid(`${path}: this property is the owner of the verification property — delete the verification property first.`)
    case 'too_large':
      return invalid(`${path}: the property has more than ${MAX_CONVERT_CELLS} values to convert at once.`)
    default:
      return invalid(`${path}: the change was not allowed (${r.reason}).`)
  }
}

function databaseRefusal(reason: DatabaseFailure | DataSourceFailure, id: string, kind: 'database' | 'page'): V1Reply {
  switch (reason) {
    case 'not_found':
      return notFound(kind, id)
    case 'forbidden':
      return restricted()
    case 'locked':
      return invalid(DATABASE_LOCKED_MESSAGE)
    case 'invalid_icon':
      return bodyInvalid('body.icon is not usable — an uploaded image must be an image of this workspace, a custom emoji must exist.')
    case 'too_deep':
      return invalid('The page is nested too deeply. Create the database under a page closer to the top.')
    case 'invalid_name':
      return bodyInvalid('body.title is invalid.')
    case 'last_source':
      return invalid('This is the only data source of its database. Move the database to trash instead.')
    default:
      return invalid(`The change was not allowed (${reason}).`)
  }
}

function trashRefusal(e: TrashError, id: string): V1Reply {
  switch (e.code) {
    case 'not_found':
      return notFound('database', id)
    case 'forbidden':
      return restricted()
    case 'not_a_trash_root':
      return invalid(`This database was moved to trash together with ${e.trashRootId ?? 'its parent'}. Restore that page instead.`)
    case 'source_trashed':
      return invalid('The data source of this database is in trash. Restore the data source first.')
  }
}

type Outcome = { readonly ok: true } | { readonly ok: false; readonly reply: V1Reply }
const DONE: Outcome = { ok: true }
const stop = (reply: V1Reply): Outcome => ({ ok: false, reply })

/** 한 명령 트랜잭션 — 답이 오면 되돌린다. 동시 쓰기의 충돌은 409. */
async function inCommand(run: (tx: Tx) => Promise<Done>): Promise<Outcome> {
  try {
    return await withCommandTransaction(async (tx) => {
      const reply = await run(tx)
      return reply === null ? DONE : stop(reply)
    })
  } catch (e) {
    if (isConflict(e)) return stop(conflict())
    throw e
  }
}

/** 데이터베이스의 휴지통 · 되살리기 — 앱의 페이지 명령(자기 트랜잭션)이 던지는 거부를 노션의 답으로. */
async function trashCommand(id: string, run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run()
    return DONE
  } catch (e) {
    if (e instanceof TrashError) return stop(trashRefusal(e, id))
    if (isConflict(e)) return stop(conflict())
    throw e
  }
}

// ── 받기 ──────────────────────────────────────────────────────────────

/** rich text → 평문(데이터베이스 · 데이터 소스의 이름은 평문이다 — 정본 ⑨). */
function plainOf(raw: unknown, path: string): { ok: true; value: string } | { ok: false; reply: V1Reply } {
  const parsed = parseApiRichText(raw, path)
  return parsed.ok ? { ok: true, value: toPlainText(parsed.runs) } : { ok: false, reply: bodyInvalid(parsed.message) }
}

/** 설명 — 저장하지 않는다. 빈 배열만 받는다(읽기의 왕복). */
function descriptionIssue(raw: unknown): V1Reply | null {
  if (raw === undefined) return null
  const plain = plainOf(raw, 'body.description')
  if (!plain.ok) return plain.reply
  return plain.value.trim() === '' ? null : bodyInvalid('body.description — database descriptions are not supported by this app. Send an empty array or leave it out.')
}

/** 커버 — 데이터베이스에는 없다(페이지에만). `null` 만 받는다. */
function coverIssue(raw: unknown): V1Reply | null {
  return raw === undefined || raw === null ? null : bodyInvalid('body.cover — database covers are not supported by this app. Send null or leave it out.')
}

function booleanIssue(raw: unknown, name: string): V1Reply | null {
  return raw === undefined || typeof raw === 'boolean' ? null : bodyInvalid(`body.${name} should be a boolean, instead was ${shownValue(raw)}.`)
}

// ── 스키마 쓰기 ───────────────────────────────────────────────────────

/** 상태 범주의 id → kind(옵션의 `group` 에 범주 id 를 줄 때 — 읽기의 `groups[].id`). */
async function statusGroupsIn(tx: Tx, propertyId: string): Promise<Map<string, StatusGroupKind>> {
  const rows = await tx.query<{ id: string; kind: string }>(`SELECT id, kind::text AS kind FROM status_group WHERE property_id = $1`, [propertyId])
  return new Map(rows.flatMap((r) => (isStatusGroupKind(r.kind) ? [[r.id, r.kind] as const] : [])))
}

async function propertyIn(tx: Tx, dataSourceId: string, propertyId: string): Promise<PropertySummary | undefined> {
  return (await readSchema(tx, dataSourceId)).properties.find((p) => p.id === propertyId)
}

/** 선택류의 옵션 — 남길 목록에 맞춘다(지우기 → 고치기 → 더하기). 상태는 기본 옵션이 사라졌으면 첫 옵션으로(앱의 규칙). */
async function applyOptionsIn(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  property: PropertySummary,
  wanted: readonly OptionRequest[],
  path: string,
  matchIds: boolean,
): Promise<Done> {
  const type = property.type
  if (type !== 'select' && type !== 'multi_select' && type !== 'status') return null
  const at = `${path}.${type}.options`
  const plan = reconcileOptions(property.options ?? [], wanted, type, at, {
    matchIds,
    groups: type === 'status' ? await statusGroupsIn(tx, property.id) : undefined,
  })
  if (!plan.ok) return bodyInvalid(plan.message)
  for (const optionId of plan.value.deletes) {
    const r = await deleteSelectOptionIn(tx, ctx, dataSourceId, property.id, optionId)
    if (!r.ok) return schemaRefusal(r, at, dataSourceId)
  }
  for (const u of plan.value.updates) {
    const r = await updateSelectOptionIn(tx, ctx, dataSourceId, property.id, u.id, { name: u.name, color: u.color, group: u.group })
    if (!r.ok) return schemaRefusal(r, at, dataSourceId)
  }
  for (const a of plan.value.adds) {
    const r = await addSelectOptionIn(tx, ctx, dataSourceId, property.id, { name: a.name, color: a.color, group: a.group })
    if (!r.ok) return schemaRefusal(r, at, dataSourceId)
  }
  if (type === 'status' && plan.value.deletes.length > 0) {
    const after = await propertyIn(tx, dataSourceId, property.id)
    const options = after?.options ?? []
    const current = (after?.config as { default_option_id?: unknown } | undefined)?.default_option_id
    if (options.length > 0 && !options.some((o) => o.id === current)) {
      const first = options.find((o) => o.group === 'todo') ?? options[0]
      const r = await updatePropertyIn(tx, ctx, dataSourceId, property.id, { defaultOptionId: first.id })
      if (!r.ok) return schemaRefusal(r, at, dataSourceId)
    }
  }
  return null
}

type RollupSetting = { readonly relationPropertyId: string; readonly targetPropertyId: string; readonly fn: RollupFunction }

/**
 * rollup 의 relation · 대상 — id 또는 이름(대상의 제목은 `'title'`). 대상 표를 볼 수 없으면 이름을 찾아 보지 않는다(구조도 그 표의
 * 내용이다 — 명령의 `invalid_target` 과 같은 답). 주지 않은 것은 지금 값.
 */
async function resolveRollupIn(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  path: string,
  config: Extract<TypeConfig, { type: 'rollup' }>,
  current: { relation_property_id: string; target_property_id: string; function: RollupFunction } | null,
): Promise<{ ok: true; value: RollupSetting } | { ok: false; reply: V1Reply }> {
  const at = `${path}.rollup`
  const own = await readApiProperties(tx, dataSourceId)
  const pick = (list: readonly { id: string; name: string; type: string }[], ref: RefRequest, only?: string) =>
    list.find((p) => (only === undefined || p.type === only) && ref.id !== undefined && (p.id === ref.id || (ref.id === TITLE_PROPERTY_ID && p.type === 'title'))) ??
    list.find((p) => (only === undefined || p.type === only) && ref.name !== undefined && p.name === ref.name)
  let relationId = current?.relation_property_id
  if (config.relation !== undefined) {
    const found = pick(own, config.relation, 'relation')
    if (found === undefined) {
      return { ok: false, reply: invalid(`${at}: ${shownValue(config.relation.id ?? config.relation.name)} is not a relation property of this data source.`) }
    }
    relationId = found.id
  }
  const relation = own.find((p) => p.id === relationId)
  const targetSource = relation === undefined ? null : readRelationConfig(relation.config)?.target_data_source_id ?? null
  let targetId = current?.target_property_id
  if (config.target !== undefined) {
    if (targetSource === null || (targetSource !== dataSourceId && !(await canViewDataSource(tx, ctx, targetSource)))) {
      return { ok: false, reply: schemaRefusal({ ok: false, reason: 'invalid_target' }, path, dataSourceId) }
    }
    const found = pick(await readApiProperties(tx, targetSource), config.target)
    if (found === undefined) {
      return { ok: false, reply: invalid(`${at}: ${shownValue(config.target.id ?? config.target.name)} is not a property of the related data source.`) }
    }
    targetId = found.id
  }
  const fn = config.function ?? current?.function
  if (relationId === undefined || targetId === undefined || fn === undefined) {
    return { ok: false, reply: invalid(`${at} should give the relation property, the rollup property and the function.`) }
  }
  return { ok: true, value: { relationPropertyId: relationId, targetPropertyId: targetId, fn } }
}

/** 같은 타입의 설정을 고친다 — 지금과 같으면 쓰지 않는다(읽기를 그대로 돌려보내면 아무것도 바뀌지 않는다). */
async function configureIn(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  path: string,
  config: TypeConfig,
  matchIds: boolean,
): Promise<Done> {
  const schema = await readSchema(tx, dataSourceId)
  const property = schema.properties.find((p) => p.id === propertyId)
  if (property === undefined) return notFound('data source', dataSourceId)
  if (isOptionTypeConfig(config)) {
    return config.options === undefined ? null : applyOptionsIn(tx, ctx, dataSourceId, property, config.options, path, matchIds)
  }
  switch (config.type) {
    case 'formula': {
      if (config.expression === undefined) return null
      const names = new Map(schema.properties.map((p) => [p.id, p.name]))
      const shown = displayFormula(readFormulaConfig(property.config)?.expression ?? '', (id) => names.get(id) ?? null)
      if (config.expression.trim() === shown.trim()) return null
      const r = await updateFormulaExpressionIn(tx, ctx, dataSourceId, propertyId, { expression: config.expression })
      return r.ok ? null : schemaRefusal(r, path, dataSourceId)
    }
    case 'relation': {
      // 대상 · 양방향은 바꾸지 않는다(앱도 못 한다) — 지금과 같으면 그대로, 다르면 400
      const current = readRelationConfig(property.config)
      const dual = current?.synced_property_id !== undefined
      const sameTarget = config.dataSourceId === undefined || config.dataSourceId === current?.target_data_source_id
      const sameMode =
        config.dual === undefined ||
        (config.dual === null ? !dual : dual && (config.dual.syncedId === undefined || config.dual.syncedId === current?.synced_property_id))
      if (sameTarget && sameMode) return null
      return invalid(`${path}.relation: changing a relation's data source or two-way setting is not supported by this app. Delete the property and create a new one.`)
    }
    case 'rollup': {
      const current = readRollupConfig(property.config)
      const resolved = await resolveRollupIn(tx, ctx, dataSourceId, path, config, current)
      if (!resolved.ok) return resolved.reply
      const r = await updateRollupPropertyIn(tx, ctx, dataSourceId, propertyId, {
        relationPropertyId: resolved.value.relationPropertyId,
        targetPropertyId: resolved.value.targetPropertyId,
        function: resolved.value.fn,
      })
      return r.ok ? null : schemaRefusal(r, path, dataSourceId)
    }
    case 'unique_id': {
      if (config.prefix === undefined || (config.prefix ?? null) === (property.prefix ?? null)) return null
      const r = await updatePropertyIn(tx, ctx, dataSourceId, propertyId, { prefix: config.prefix })
      return r.ok ? null : schemaRefusal(r, path, dataSourceId)
    }
    default:
      return null
  }
}

/** 새 relation 의 양방향 짝 이름 — 주지 않으면 이 데이터베이스의 이름(앱의 "열 더하기" 와 같다), 그것도 비면 속성 이름. */
async function inverseNameIn(tx: Tx, dataSourceId: string, fallback: string): Promise<string> {
  const row = await tx.queryOne<{ properties: { title?: unknown } | null }>(
    `SELECT b.properties FROM data_source ds JOIN block b ON b.id = ds.owner_database_id WHERE ds.id = $1`,
    [dataSourceId],
  )
  const title = plainTitleOf(row.properties).trim()
  return title !== '' ? title : fallback
}

async function createStepIn(tx: Tx, ctx: SessionContext, dataSourceId: string, step: Extract<SchemaStep, { kind: 'create' }>): Promise<Done> {
  const { config, path } = step
  let propertyId: string
  let describe = false
  if (config.type === 'relation') {
    const target = config.dataSourceId!
    const self = target === dataSourceId
    // 단방향 · 말하지 않음 → 짝 없이(같은 표면 앱의 규칙대로 자기 자신이 짝) · 양방향 → 짝 이름(같은 표에서 이름이 없으면 자기 자신이 짝)
    const twoWay =
      config.dual === undefined || config.dual === null || (self && config.dual.syncedName === undefined)
        ? undefined
        : { name: config.dual.syncedName ?? (await inverseNameIn(tx, dataSourceId, step.name)) }
    const r = await addRelationPropertyIn(tx, ctx, dataSourceId, { name: step.name, targetDataSourceId: target, ...(twoWay === undefined ? {} : { twoWay }) })
    if (!r.ok) return schemaRefusal(r, path, dataSourceId)
    propertyId = r.value.propertyId
    describe = true
  } else if (config.type === 'rollup') {
    const resolved = await resolveRollupIn(tx, ctx, dataSourceId, path, config, null)
    if (!resolved.ok) return resolved.reply
    const r = await addRollupPropertyIn(tx, ctx, dataSourceId, {
      name: step.name,
      relationPropertyId: resolved.value.relationPropertyId,
      targetPropertyId: resolved.value.targetPropertyId,
      function: resolved.value.fn,
    })
    if (!r.ok) return schemaRefusal(r, path, dataSourceId)
    propertyId = r.value.propertyId
    describe = true
  } else if (config.type === 'formula') {
    const r = await addFormulaPropertyIn(tx, ctx, dataSourceId, { name: step.name, expression: config.expression })
    if (!r.ok) return schemaRefusal(r, path, dataSourceId)
    propertyId = r.value.propertyId
    describe = true
  } else {
    const input: AddPropertyInput = {
      name: step.name,
      type: config.type as AddPropertyInput['type'],
      ...(typeof step.description === 'string' && step.description !== '' ? { description: step.description } : {}),
      ...(config.type === 'unique_id' && config.prefix !== undefined ? { prefix: config.prefix } : {}),
    }
    const r = await addPropertyIn(tx, ctx, dataSourceId, input)
    if (!r.ok) return schemaRefusal(r, path, dataSourceId)
    const name = normalizePropertyName(step.name)
    const made = r.value.properties.find((p) => p.name === name)
    if (made === undefined) return schemaRefusal({ ok: false, reason: 'invalid_name' }, path, dataSourceId)
    propertyId = made.id
    if (isOptionTypeConfig(config) && config.options !== undefined) {
      // 만들 때는 이름으로만 잡는다(다른 표의 스키마를 그대로 보내도 된다) — 상태는 기본 셋을 남길 목록에 맞춘다
      const done = await applyOptionsIn(tx, ctx, dataSourceId, made, config.options, path, false)
      if (done !== null) return done
    }
  }
  if (describe && typeof step.description === 'string' && step.description !== '') {
    const r = await updatePropertyIn(tx, ctx, dataSourceId, propertyId, { description: step.description })
    if (!r.ok) return schemaRefusal(r, path, dataSourceId)
  }
  return null
}

async function editStepIn(tx: Tx, ctx: SessionContext, dataSourceId: string, step: Extract<SchemaStep, { kind: 'edit' }>): Promise<Done> {
  const id = step.property.id
  if (step.name !== undefined || step.description !== undefined) {
    const r = await updatePropertyIn(tx, ctx, dataSourceId, id, {
      ...(step.name === undefined ? {} : { name: step.name }),
      ...(step.description === undefined ? {} : { description: step.description === '' ? null : step.description }),
    })
    if (!r.ok) return schemaRefusal(r, step.path, dataSourceId)
  }
  if (step.convertTo !== undefined) {
    // 노션처럼 묻지 않고 바꾼다 — 새 타입에 맞지 않는 값은 비운다(앱의 확인을 대신 준다)
    const r = await convertPropertyIn(tx, ctx, dataSourceId, id, { type: step.convertTo, confirmLoss: true })
    if (!r.ok) return schemaRefusal(r, step.path, dataSourceId)
  }
  return step.config === undefined ? null : configureIn(tx, ctx, dataSourceId, id, step.path, step.config, step.convertTo === undefined)
}

/** 스키마의 줄들을 이 소스에 — 계획(순수) → 명령들. 같은 트랜잭션이다(부르는 쪽의 명령 트랜잭션). */
async function applySchemaIn(tx: Tx, ctx: SessionContext, dataSourceId: string, entries: readonly SchemaEntry[], mode: 'create' | 'update'): Promise<Done> {
  if (entries.length === 0) return null
  const schema = await readSchema(tx, dataSourceId)
  const plan = planSchema(entries, schema.properties, mode)
  if (!plan.ok) return invalid(plan.message)
  for (const step of plan.value) {
    let done: Done
    if (step.kind === 'delete') {
      const r = await deletePropertyIn(tx, ctx, dataSourceId, step.property.id)
      done = r.ok ? null : schemaRefusal(r, step.path, dataSourceId)
    } else if (step.kind === 'edit') {
      done = await editStepIn(tx, ctx, dataSourceId, step)
    } else {
      done = await createStepIn(tx, ctx, dataSourceId, step)
    }
    if (done !== null) return done
  }
  return null
}

// ── 데이터베이스 ──────────────────────────────────────────────────────

const CREATE_DATABASE_KEYS = ['parent', 'title', 'description', 'icon', 'cover', 'is_inline', 'initial_data_source']
const UPDATE_DATABASE_KEYS = ['title', 'description', 'icon', 'cover', 'is_inline', 'in_trash', 'archived', 'is_locked', 'parent']

/** `POST /v1/databases` — 페이지 본문 안의 데이터베이스(인라인)와 그 첫 데이터 소스의 속성들. */
export const createApiDatabase: V1Handler = async ({ ctx, body, request }) => {
  if (!isObject(body)) return bodyInvalid(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = unexpectedKey(body, CREATE_DATABASE_KEYS)
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const parent = body.parent
  if (!isObject(parent)) return bodyInvalid(`body.parent should be an object, instead was ${shownValue(parent)}.`)
  const kind = parent.type ?? ['page_id', 'workspace', 'database_id', 'block_id'].find((k) => k in parent)
  if (kind === 'workspace') return invalid('Creating a database at the top of the workspace is not supported. Use parent.page_id.')
  if (kind !== 'page_id') return bodyInvalid(`body.parent.type should be "page_id", instead was ${shownValue(kind)}.`)
  const parentId = parseApiId(parent.page_id)
  if (parentId === null) return bodyInvalid(`body.parent.page_id should be a valid uuid, instead was ${shownValue(parent.page_id)}.`)

  const title = body.title === undefined ? { ok: true as const, value: '' } : plainOf(body.title, 'body.title')
  if (!title.ok) return title.reply
  const issue = descriptionIssue(body.description) ?? coverIssue(body.cover) ?? booleanIssue(body.is_inline, 'is_inline')
  if (issue !== null) return issue
  // 페이지 밑의 데이터베이스는 본문 안의 것뿐이다(앱에 "페이지 밑의 전체 페이지 데이터베이스" 가 없다 — 정본 ⑨)
  if (body.is_inline === false) return bodyInvalid('body.is_inline — only inline databases can be created under a page in this app. Send true or leave it out.')
  const icon = body.icon === undefined ? undefined : parseIcon(body.icon)
  if (icon !== undefined && !icon.ok) return icon.reply

  let entries: SchemaEntry[] = []
  const initial = body.initial_data_source
  if (initial !== undefined) {
    if (!isObject(initial)) return bodyInvalid(`body.initial_data_source should be an object, instead was ${shownValue(initial)}.`)
    const initialExtra = Object.keys(initial).find((k) => k !== 'properties')
    if (initialExtra !== undefined) {
      return bodyInvalid(`body.initial_data_source.${initialExtra} should be not present, instead was ${shownValue(initial[initialExtra])}.`)
    }
    if (initial.properties !== undefined) {
      const parsed = parseSchemaProperties(initial.properties, 'body.initial_data_source.properties')
      if (!parsed.ok) return bodyInvalid(parsed.message)
      entries = parsed.value
    }
  }

  let databaseId = ''
  const made = await inCommand(async (tx) => {
    const caps = await effectiveCaps(tx, ctx, parentId)
    if (!can(caps, 'view')) return notFound('page', parentId)
    if (!can(caps, 'create_child')) return restricted()
    // 본문 안에 놓는다 — 잠긴 페이지의 본문은 고치지 않는다(API-3 과 같다)
    if (await isLocked(tx, parentId)) return invalid(LOCKED_MESSAGE)
    const created = await createInlineDatabaseIn(tx, ctx, { parentPageId: parentId, name: title.value })
    if (!created.ok) return databaseRefusal(created.reason, parentId, 'page')
    databaseId = created.value.id
    if (icon !== undefined && icon.value !== null) {
      const set = await setDatabaseIconIn(tx, ctx, databaseId, icon.value)
      if (!set.ok) return databaseRefusal(set.reason, databaseId, 'database')
    }
    return applySchemaIn(tx, ctx, created.value.dataSourceId, entries, 'create')
  })
  if (!made.ok) return made.reply
  return databaseReply(ctx, databaseId, apiLinks(ctx, request))
}

/** `PATCH /v1/databases/{database_id}` — 이름 · 아이콘 · 잠금 · 휴지통(옛 이름 `archived` 도). */
export const updateApiDatabase: V1Handler = async ({ ctx, params, body, request }) => {
  const id = parseApiId(params.database_id)
  if (id === null) return invalid(invalidPathIdMessage('database_id', params.database_id))
  const input = body === undefined ? {} : body
  if (!isObject(input)) return bodyInvalid(`body should be an object, instead was ${shownValue(input)}.`)
  const extra = unexpectedKey(input, UPDATE_DATABASE_KEYS)
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  if (input.parent !== undefined) return invalid('Moving a database is not supported by this API. Move it in the app.')
  const title = input.title === undefined ? undefined : plainOf(input.title, 'body.title')
  if (title !== undefined && !title.ok) return title.reply
  const issue =
    descriptionIssue(input.description) ??
    coverIssue(input.cover) ??
    booleanIssue(input.is_inline, 'is_inline') ??
    booleanIssue(input.in_trash, 'in_trash') ??
    booleanIssue(input.archived, 'archived') ??
    booleanIssue(input.is_locked, 'is_locked')
  if (issue !== null) return issue
  if (input.in_trash !== undefined && input.archived !== undefined && input.in_trash !== input.archived) {
    return bodyInvalid('body.in_trash and body.archived should be the same when both are given.')
  }
  const inTrash = (input.in_trash ?? input.archived) as boolean | undefined
  const locked = input.is_locked as boolean | undefined
  const icon = input.icon === undefined ? undefined : parseIcon(input.icon)
  if (icon !== undefined && !icon.ok) return icon.reply

  const head = await withReadTransaction((tx) => openDatabaseIn(tx, ctx, id))
  if (head === null) return mistakenIdReply(ctx, 'database', id)
  if (input.is_inline !== undefined && input.is_inline !== head.is_inline) {
    return bodyInvalid('body.is_inline — switching a database between inline and full page is not supported by this app.')
  }
  const trashed = head.lifecycle === 'trashed'
  const edits = title !== undefined || icon !== undefined || locked !== undefined

  if (trashed) {
    if (inTrash === false) {
      const restored = await trashCommand(id, () => restorePage(ctx, asBlockId(id)))
      if (!restored.ok) return restored.reply
    } else if (edits) {
      return invalid(DATABASE_TRASHED_MESSAGE)
    }
  }

  if (edits) {
    const wrote = await inCommand(async (tx) => {
      const caps = await effectiveCaps(tx, ctx, id)
      if (!can(caps, 'view')) return notFound('database', id)
      if (!can(caps, 'edit_structure')) return restricted()
      // 풀고 → 고치고 → 잠근다(한 트랜잭션)
      if (locked === false) {
        const r = await setDatabaseLockIn(tx, ctx, id, false)
        if (!r.ok) return databaseRefusal(r.reason, id, 'database')
      }
      if (title !== undefined) {
        const r = await renameDatabaseIn(tx, ctx, id, title.value)
        if (!r.ok) return databaseRefusal(r.reason, id, 'database')
      }
      if (icon !== undefined) {
        const r = await setDatabaseIconIn(tx, ctx, id, icon.value)
        if (!r.ok) return databaseRefusal(r.reason, id, 'database')
      }
      if (locked === true) {
        const r = await setDatabaseLockIn(tx, ctx, id, true)
        if (!r.ok) return databaseRefusal(r.reason, id, 'database')
      }
      return null
    })
    if (!wrote.ok) return wrote.reply
  }

  if (inTrash === true && !trashed) {
    const moved = await trashCommand(id, () => trashPage(ctx, asBlockId(id)))
    if (!moved.ok) return moved.reply
  }
  return databaseReply(ctx, id, apiLinks(ctx, request))
}

// ── 데이터 소스 ───────────────────────────────────────────────────────

const ICON_ON_SOURCE_MESSAGE =
  "body.icon — a data source shows its database's icon. Set it with PATCH /v1/databases/{database_id}."

/** `POST /v1/data_sources` — 데이터베이스에 소스를 더하고(표 뷰 하나와 함께 — 앱과 같다) 그 속성들을 만든다. */
export const createApiDataSource: V1Handler = async ({ ctx, body, request }) => {
  if (!isObject(body)) return bodyInvalid(`body should be an object, instead was ${shownValue(body)}.`)
  const extra = unexpectedKey(body, ['parent', 'title', 'properties', 'icon'])
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  const parent = body.parent
  if (!isObject(parent)) return bodyInvalid(`body.parent should be an object, instead was ${shownValue(parent)}.`)
  const kind = parent.type ?? ('database_id' in parent ? 'database_id' : undefined)
  if (kind !== 'database_id') return bodyInvalid(`body.parent.type should be "database_id", instead was ${shownValue(kind)}.`)
  const databaseId = parseApiId(parent.database_id)
  if (databaseId === null) return bodyInvalid(`body.parent.database_id should be a valid uuid, instead was ${shownValue(parent.database_id)}.`)
  if (body.icon !== undefined && body.icon !== null) return bodyInvalid(ICON_ON_SOURCE_MESSAGE)
  const title = body.title === undefined ? undefined : plainOf(body.title, 'body.title')
  if (title !== undefined && !title.ok) return title.reply
  if (body.properties === undefined) return bodyInvalid('body.properties should be defined, instead was `undefined`.')
  const parsed = parseSchemaProperties(body.properties, 'body.properties')
  if (!parsed.ok) return bodyInvalid(parsed.message)

  let dataSourceId = ''
  let missing = false
  const made = await inCommand(async (tx) => {
    const name = title === undefined || title.value.trim() === '' ? undefined : title.value
    const added = await addDataSourceIn(tx, ctx, databaseId, name === undefined ? {} : { name })
    if (!added.ok) {
      missing = added.reason === 'not_found'
      return databaseRefusal(added.reason, databaseId, 'database')
    }
    dataSourceId = added.value.dataSource.id
    return applySchemaIn(tx, ctx, dataSourceId, parsed.value, 'create')
  })
  // 데이터 소스 id 를 부모로 줬으면 바른 주소를 말한다(읽기와 같은 404 — 트랜잭션 밖에서 묻는다)
  if (missing) return mistakenIdReply(ctx, 'database', databaseId)
  if (!made.ok) return made.reply
  return dataSourceReply(ctx, dataSourceId, apiLinks(ctx, request))
}

/** `PATCH /v1/data_sources/{data_source_id}` — 이름 · 속성 스키마 · 휴지통. */
export const updateApiDataSource: V1Handler = async ({ ctx, params, body, request }) => {
  const id = parseApiId(params.data_source_id)
  if (id === null) return invalid(invalidPathIdMessage('data_source_id', params.data_source_id))
  const input = body === undefined ? {} : body
  if (!isObject(input)) return bodyInvalid(`body should be an object, instead was ${shownValue(input)}.`)
  const extra = unexpectedKey(input, ['title', 'properties', 'in_trash', 'icon', 'parent'])
  if (extra !== null) return extra
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked

  if (input.parent !== undefined) return invalid('Moving a data source to another database is not supported by this API.')
  if (input.icon !== undefined) return bodyInvalid(ICON_ON_SOURCE_MESSAGE)
  const inTrashIssue = booleanIssue(input.in_trash, 'in_trash')
  if (inTrashIssue !== null) return inTrashIssue
  const inTrash = input.in_trash as boolean | undefined
  const title = input.title === undefined ? undefined : plainOf(input.title, 'body.title')
  if (title !== undefined && !title.ok) return title.reply
  let entries: SchemaEntry[] = []
  if (input.properties !== undefined && input.properties !== null) {
    const parsed = parseSchemaProperties(input.properties, 'body.properties')
    if (!parsed.ok) return bodyInvalid(parsed.message)
    entries = parsed.value
  }

  const head = await withReadTransaction((tx) => openSourceIn(tx, ctx, id, true))
  if (head === null) return mistakenIdReply(ctx, 'data source', id)
  const trashed = head.source.lifecycle === 'trashed'
  const edits = title !== undefined || entries.length > 0

  if (trashed) {
    if (inTrash === false) {
      const restored = await restoreDataSource(ctx, id)
      if (!restored.ok) return restored.reason === 'not_found' ? notFound('data source', id) : databaseRefusal(restored.reason, id, 'database')
    } else if (edits) {
      return invalid(SOURCE_TRASHED_MESSAGE)
    }
  }

  if (edits) {
    const wrote = await inCommand(async (tx) => {
      // 구조의 문 — 열 수는 있지만("만들기만") 볼 수 없으면 403(이미 열었다)
      const gate = await lockSchema(tx, ctx, id)
      if (isSchemaFailure(gate) && !gate.ok) return gate.reason === 'not_found' ? restricted() : schemaRefusal(gate, 'body', id)
      if (title !== undefined) {
        // 소스가 하나뿐이면 그 이름은 데이터베이스의 이름이다(읽기가 그것을 보여 준다)
        const live = await readDataSources(tx, head.database.id)
        const only = live.length === 1 && live[0].id === id
        const r = only ? await renameDatabaseIn(tx, ctx, head.database.id, title.value) : await renameDataSourceIn(tx, ctx, id, title.value)
        if (!r.ok) return databaseRefusal(r.reason, head.database.id, 'database')
      }
      return applySchemaIn(tx, ctx, id, entries, 'update')
    })
    if (!wrote.ok) return wrote.reply
  }

  if (inTrash === true && !trashed) {
    const moved = await trashDataSource(ctx, id)
    if (!moved.ok) return moved.reason === 'not_found' ? notFound('data source', id) : databaseRefusal(moved.reason, id, 'database')
  }
  return dataSourceReply(ctx, id, apiLinks(ctx, request), true)
}
