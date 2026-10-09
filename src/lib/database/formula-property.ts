/**
 * 수식 속성 — 만들기 · 식 고치기 · 읽을 때 계산 (DB 심화 2i-2조각 · F-03-12)
 *
 * 정본: 00-canonical-data-model.md §3.5 `property_dependency` · [보강] 수식 1단계 · 03-database-core.md F-03-12
 *
 * ──────────────────────────────────────────────────────────────────────
 * 저장하는 것: 식 · 결과 타입 · 의존 간선
 * ──────────────────────────────────────────────────────────────────────
 *
 * `property.config = { expression, result_type }`(0060 의 CHECK) — 식은 원문 그대로에 속성 자리만 `⟦id⟧`. 수식이 읽는 속성마다
 * `property_dependency` 한 줄. 만들 때 · 고칠 때 **표의 수식 그래프 전체**로 순환과 깊이(15)를 본다(`checkFormulaGraph`) — 그래프는
 * 간선 표에서 읽는다(저장된 의존이 정본이다 · 지금 읽히지 않는 수식도 간선은 있다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 저장하지 않는다 — 읽을 때 계산한다(rollup v1 과 같다)
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1단계의 수식은 **같은 행의 칸**만 읽으므로 행을 읽은 뒤 그 행들로 한 번에 계산한다(`computeFormulaValues` — 질의 둘: 속성 · 옵션).
 * 식은 읽을 때 지금 스키마로 다시 읽는다 — 읽던 속성이 지워졌거나 타입이 바뀌어 읽히지 않으면 그 컬럼은 **이유를 든 채 빈 값**이다(03
 * *"참조하던 프로퍼티 삭제 → 수식이 에러 상태. 셀에 에러 표시, 값 없음"*). 저장값은 남아 속성을 복원하면 돌아온다. 값이 없으니 거르거나
 * 정렬할 수 없다(정본 D1 — `derived_value` 가 들어올 때 · §7).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { compileFormula, type FormulaValue } from '../formula/formula.ts'
import {
  bumpSchema,
  insertPropertyIn,
  isSchemaFailure,
  lockSchema,
  normalizePropertyName,
  readSchema,
  type PropertyResult,
  type SchemaSnapshot,
} from './property.ts'
import { readOptionsOf } from './options.ts'
import { isOptionType } from './property-types.ts'
import { formulaGraphProblem } from './formula-graph.ts'
import {
  compileLiveFormulas,
  evaluateRowFormulas,
  formulaSchemaOf,
  MAX_FORMULA_DEPTH,
  type FormulaSourceProperty,
} from './formula-schema.ts'

const fail = (reason: 'invalid_name' | 'invalid_formula' | 'formula_cycle' | 'formula_too_deep' | 'not_found' | 'unsupported_type'): PropertyResult<never> => ({ ok: false, reason })

/** 표의 살아 있는 속성(수식이 볼 수 있는 후보 · 수식 자신 포함). */
async function readLiveProperties(tx: Tx, dataSourceId: string): Promise<FormulaSourceProperty[]> {
  return tx.query<FormulaSourceProperty>(
    `SELECT id, name, type::text AS type, config FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL
      ORDER BY order_idx, id`,
    [dataSourceId],
  )
}

async function writeDependencies(tx: Tx, propertyId: string, sources: readonly string[]): Promise<void> {
  await tx.query(`DELETE FROM property_dependency WHERE dependent_property_id = $1`, [propertyId])
  if (sources.length === 0) return
  await tx.query(
    `INSERT INTO property_dependency (dependent_property_id, source_property_id)
     SELECT $1, s FROM unnest($2::text[]) AS s`,
    [propertyId, sources],
  )
}

export type AddFormulaInput = {
  readonly name: unknown
  /** 사람이 쓴 식 — `prop("이름")` 으로 속성을 읽는다. */
  readonly expression: unknown
  readonly expectedVersion?: string
}

/** 수식 속성을 만든다 — 식을 읽고(틀리면 위치와 함께 거부) · 깊이를 보고 · 의존 간선을 쓴다. */
export async function addFormulaProperty(
  ctx: SessionContext,
  dataSourceId: string,
  input: AddFormulaInput,
): Promise<PropertyResult<{ readonly schema: SchemaSnapshot; readonly propertyId: string }>> {
  const name = normalizePropertyName(input.name)
  if (name === null) return fail('invalid_name')
  if (typeof input.expression !== 'string') return fail('invalid_formula')
  const expression = input.expression

  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const compiled = compileFormula(expression, formulaSchemaOf(await readLiveProperties(tx, dataSourceId)))
    if (!compiled.ok) return { ok: false, reason: 'invalid_formula', formulaError: compiled.error } as const

    // 새 수식은 아직 아무도 읽지 않는다 — 순환은 생길 수 없고 깊이만 본다
    const bad = await formulaGraphProblem(tx, dataSourceId, { id: '\u0000new', dependsOn: compiled.value.dependsOn })
    if (bad !== null) return fail(bad)

    const propertyId = await insertPropertyIn(tx, dataSourceId, {
      name,
      type: 'formula',
      description: null,
      config: { expression: compiled.value.stored, result_type: compiled.value.resultType },
    })
    if (isSchemaFailure(propertyId)) return propertyId
    await writeDependencies(tx, propertyId, compiled.value.dependsOn)

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: { schema: await readSchema(tx, dataSourceId), propertyId } } as const
  })
}

/**
 * 수식의 식을 고친다 — 표의 수식 그래프에서 이 수식의 간선을 새 것으로 바꿔 순환 · 깊이를 본다(가운데 수식을 고치면 그것을 읽는 수식의
 * 깊이도 바뀐다). 결과 타입이 바뀌면 이 수식을 읽는 수식은 다음 읽기에서 타입이 맞지 않아 이유를 든다(§7 — 저장 때 알리기는 아직).
 */
export async function updateFormulaExpression(
  ctx: SessionContext,
  dataSourceId: string,
  propertyId: string,
  input: { readonly expression: unknown; readonly expectedVersion?: string },
): Promise<PropertyResult> {
  if (typeof input.expression !== 'string') return fail('invalid_formula')
  const expression = input.expression
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const properties = await readLiveProperties(tx, dataSourceId)
    const target = properties.find((p) => p.id === propertyId)
    if (target === undefined) return fail('not_found')
    if (target.type !== 'formula') return fail('unsupported_type')

    const compiled = compileFormula(expression, formulaSchemaOf(properties))
    if (!compiled.ok) return { ok: false, reason: 'invalid_formula', formulaError: compiled.error } as const

    const bad = await formulaGraphProblem(tx, dataSourceId, { id: propertyId, dependsOn: compiled.value.dependsOn })
    if (bad !== null) return fail(bad)

    await tx.query(
      `UPDATE property SET config = jsonb_build_object('expression', $2::text, 'result_type', $3::text), updated_at = now()
        WHERE id = $1`,
      [propertyId, compiled.value.stored, compiled.value.resultType],
    )
    await writeDependencies(tx, propertyId, compiled.value.dependsOn)
    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

// ── 읽을 때 계산 ──────────────────────────────────────────────────────

/** 행 묶음의 수식 값 — 컬럼마다 읽히는지(아니면 이유), 행마다 수식 값. */
export type FormulaPage = {
  readonly columns: Readonly<Record<string, { readonly error: string | null }>>
  readonly values: Readonly<Record<string, Readonly<Record<string, FormulaValue>>>>
}

const EMPTY_PAGE: FormulaPage = { columns: {}, values: {} }

/**
 * 이 표의 행들의 수식 값. 부르는 쪽은 이미 행을 읽었다(권한 · 휴지통을 지났다) — 여기서는 그 행의 칸만 읽는다. 표를 볼 수 없으면 빈
 * 답이다(존재를 알리지 않는다). 지금(`now()` · `today()`)은 계산하는 순간이다.
 */
export async function computeFormulaValues(
  ctx: SessionContext,
  dataSourceId: string,
  rows: readonly { readonly id: string; readonly properties: Readonly<Record<string, unknown>> }[],
  now: Date = new Date(),
): Promise<FormulaPage> {
  return withReadTransaction(async (tx) => {
    const ds = await tx.queryMaybe<{ container_id: string }>(
      `SELECT ds.owner_database_id AS container_id FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null || !can(await effectiveCaps(tx, ctx, ds.container_id), 'view')) return EMPTY_PAGE
    const properties = await readLiveProperties(tx, dataSourceId)
    if (!properties.some((p) => p.type === 'formula')) return EMPTY_PAGE

    const formulas = compileLiveFormulas(properties)
    const options = await readOptionsOf(tx, properties.filter((p) => isOptionType(p.type)).map((p) => p.id))
    const optionNames = new Map<string, string>()
    for (const list of options.values()) for (const o of list) optionNames.set(o.id, o.name)
    const typeOf = new Map(properties.map((p) => [p.id, p.type]))

    const values: Record<string, Record<string, FormulaValue>> = {}
    for (const row of rows) {
      values[row.id] = evaluateRowFormulas(formulas, (id) => typeOf.get(id) ?? null, row.properties, (id) => optionNames.get(id) ?? null, { now })
    }
    return {
      columns: Object.fromEntries(formulas.map((f) => [f.id, { error: f.ok ? null : f.error }])),
      values,
    }
  })
}

export { MAX_FORMULA_DEPTH }
