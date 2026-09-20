/**
 * rollup — rollup 5c-1조각 (F-03-11 의 프로퍼티 만들기와 읽을 때 계산)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 · 03-database-core.md F-03-11 · 마스터 문서 §5.2-5 · §7-6
 *
 * ──────────────────────────────────────────────────────────────────────
 * 값은 어디에도 저장하지 않는다 — 읽을 때 계산한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 마스터 §5.2-5: *"rollup 은 v1 에서 on-read 계산(1,000행까지 충분)."* `page_property_value` 에도(불변식 C1)
 * `properties_cache` 에도 rollup 은 없다. 캐시에 못 넣는 이유는 relation 의 제목과 같다 — **결과가 보는 사람마다 다르다.**
 * 그래서 화면은 행을 받은 뒤 이 파일의 `computeRollups` 를 **행 묶음에 대해 한 번** 부른다(칸마다 부르지 않는다 —
 * `loadRelationLabels` 와 같은 모양). 질의 수는 행 · 칸 수와 무관하게 일정하다.
 *
 * 귀결(정본 D1): rollup 은 거를 수도 정렬할 수도 없다 — 필터 · 정렬은 `derived_value` 의 사이드카로만 컴파일되는데 v1 에는
 * 그 표가 없다. 뷰의 컬럼에 서는 것은 5c-2 가 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한 · 휴지통은 집계 **안**에서 거른다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 볼 수 없는 연결 행과 휴지통의 행은 집계에서 **뺀다**(F-03-11 엣지 케이스 표 · 마스터 §7-6 ⑧). 값을 가린 채 집계에 넣으면
 * `min` · `max` · `show_original` 이 원본을 역산하게 해 준다. 빼고 나면 결과는 **묻는 사람이 어차피 읽을 수 있는 값만의
 * 함수**다. 볼 수 없어서 뺀 개수는 `hidden` 으로 준다("N개 항목 접근 불가") — relation 칸이 이미 보여 주는 개수다.
 * 읽을 수 있는지는 제목 맵과 같은 축으로 묻는다(`readableScopes` — 행은 표의 스코프를 물려받는다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 설정이 끊겨도 rollup 은 남는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * relation 프로퍼티나 대상 프로퍼티가 지워져도(soft delete) rollup 을 함께 지우지 않는다 — 읽을 때 "끊겼다"고 답한다
 * (`relation_missing` · `target_missing`). 복원하면 되살아난다. 함께 지우면 복원이 rollup 을 되살리지 못한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 1,000개를 넘는 칸은 계산하지 않는다 — 틀린 숫자는 빈칸보다 나쁘다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 한 칸의 살아 있는 연결이 `MAX_ROLLUP_LINKS` 를 넘으면 `too_many` 다. 앞 1,000개만 더한 합을 주면 화면은 그것을 합이라고
 * 그린다. 이 답이 실제로 나오기 시작하면 `derived_value` 캐시를 들일 때다(정본).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { isUuid } from '../ids.ts'
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
import { canViewDataSource } from './relation.ts'
import { readCell } from './cell-format.ts'
import { isOptionType, readRelationConfig, type CellValue } from './property-types.ts'
import {
  aggregate,
  effectiveRollupFunction,
  isRollupFunction,
  isRollupTargetType,
  readRollupConfig,
  rollupFunctionsFor,
  MAX_ROLLUP_ROWS,
  type RollupCell,
  type RollupColumnInfo,
  type RollupFunction,
  type RollupPage,
} from './rollup-functions.ts'

// 모양은 DB 를 모르는 모듈에 있다 — 화면이 값으로도 타입으로도 읽는다(§3.3-163 의 경계).
export {
  readRollupConfig,
  EMPTY_ROLLUP_PAGE,
  MAX_ROLLUP_ROWS,
  type RollupCell,
  type RollupColumnInfo,
  type RollupConfig,
  type RollupFunction,
  type RollupPage,
  type RollupResult,
} from './rollup-functions.ts'

/** 한 칸이 집계하는 연결의 상한(머리말). 마스터 §5.2-5 의 "1,000행까지". */
export const MAX_ROLLUP_LINKS = 1000

// ── 프로퍼티 만들기 ───────────────────────────────────────────────────

export type AddRollupInput = {
  readonly name: string
  /** **이 표의** relation 프로퍼티. */
  readonly relationPropertyId: string
  /** 그 relation 의 **대상 표의** 프로퍼티. 셀 타입이어야 한다. */
  readonly targetPropertyId: string
  readonly function: RollupFunction
  readonly expectedVersion?: string
}

export type AddRollupOutcome = {
  readonly schema: SchemaSnapshot
  readonly propertyId: string
}

const propertyFail = (reason: 'invalid_name' | 'invalid_target' | 'invalid_config'): PropertyResult<never> => ({
  ok: false,
  reason,
})

/**
 * rollup 프로퍼티를 만든다.
 *
 *   이 표의 `edit_structure`            (`lockSchema`)
 *   relation 은 **이 표의** 살아 있는 relation 프로퍼티
 *   대상 표를 **볼 수 있어야** 한다     못 보는 표의 스키마를 id 를 찍어 보며 알아낼 수 없다 — 없는 것과 같은 답(`invalid_target`)
 *   대상은 그 표의 살아 있는 **셀 타입** 프로퍼티   relation · rollup 은 안 된다(참조 체인이 깊이 1 에 머문다 · 정본)
 *   함수는 그 타입이 고를 수 있는 것    아니면 `invalid_config`
 *
 * 대상 표는 잠그지 않는다 — 그쪽 스키마에 쓰는 것이 없다. 만든 직후 대상 프로퍼티가 지워지는 경합은 읽기가 `target_missing`
 * 으로 답한다(지워지는 것은 언제든 일어나는 일이고, 그래서 읽기가 견딘다).
 */
export async function addRollupProperty(
  ctx: SessionContext,
  dataSourceId: string,
  input: AddRollupInput,
): Promise<PropertyResult<AddRollupOutcome>> {
  const name = normalizePropertyName(input.name)
  if (name === null) return propertyFail('invalid_name')
  if (!isRollupFunction(input.function)) return propertyFail('invalid_config')
  if (typeof input.relationPropertyId !== 'string' || typeof input.targetPropertyId !== 'string') {
    return propertyFail('invalid_target')
  }

  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const relation = await tx.queryMaybe<{ config: unknown }>(
      `SELECT config FROM property
        WHERE id = $1 AND data_source_id = $2 AND type = 'relation' AND deleted_at IS NULL`,
      [input.relationPropertyId, dataSourceId],
    )
    const relationConfig = relation === null ? null : readRelationConfig(relation.config)
    if (relationConfig === null) return propertyFail('invalid_target')

    const targetDataSourceId = relationConfig.target_data_source_id
    if (targetDataSourceId !== dataSourceId && !(await canViewDataSource(tx, ctx, targetDataSourceId))) {
      return propertyFail('invalid_target')
    }

    const target = await tx.queryMaybe<{ type: string }>(
      `SELECT type FROM property WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [input.targetPropertyId, targetDataSourceId],
    )
    if (target === null || !isRollupTargetType(target.type)) return propertyFail('invalid_target')
    if (!rollupFunctionsFor(target.type).includes(input.function)) return propertyFail('invalid_config')

    const propertyId = await insertPropertyIn(tx, dataSourceId, {
      name,
      type: 'rollup',
      description: null,
      config: {
        relation_property_id: input.relationPropertyId,
        target_property_id: input.targetPropertyId,
        function: input.function,
      },
    })
    if (isSchemaFailure(propertyId)) return propertyId

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: { schema: await readSchema(tx, dataSourceId), propertyId } } as const
  })
}

// ── 읽을 때 계산 ──────────────────────────────────────────────────────

export type RollupReadResult =
  | { readonly ok: true; readonly value: RollupPage }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_value' }

type EdgeRow = { from_page_id: string; property_id: string; to_page_id: string; readable: boolean }

/**
 * 이 행들의 rollup 칸을 계산한다 — 머리말의 규칙 전부가 여기 모인다.
 *
 * 질의는 행 · 칸 수와 무관하게 일정하다: 스키마(rollup · relation · 대상) → 행 확인 → **엣지 한 번** → **대상 값 한 번**.
 * 같은 relation 을 타는 rollup 이 여럿이어도 엣지는 한 번 읽는다.
 */
export async function computeRollups(
  ctx: SessionContext,
  dataSourceId: string,
  rowIds: readonly string[],
  /** 검사가 상한을 낮춰 본다(1,001행을 만들지 않으려고). 라우트는 넘기지 않는다. */
  limits: { readonly maxLinks?: number } = {},
): Promise<RollupReadResult> {
  const maxLinks = limits.maxLinks ?? MAX_ROLLUP_LINKS
  if (!isUuid(dataSourceId)) return { ok: false, reason: 'not_found' }
  if (!Array.isArray(rowIds) || rowIds.some((id) => typeof id !== 'string' || !isUuid(id))) {
    return { ok: false, reason: 'invalid_value' }
  }
  const wanted = [...new Set(rowIds)]
  if (wanted.length > MAX_ROLLUP_ROWS) return { ok: false, reason: 'invalid_value' }

  return withReadTransaction(async (tx) => {
    if (!(await canViewDataSource(tx, ctx, dataSourceId))) return { ok: false, reason: 'not_found' } as const

    // ── 스키마: rollup → relation → 대상 ──
    const rollups = await tx.query<{ id: string; config: unknown }>(
      `SELECT id, config FROM property
        WHERE data_source_id = $1 AND type = 'rollup' AND deleted_at IS NULL`,
      [dataSourceId],
    )
    if (rollups.length === 0) return { ok: true, value: { columns: {}, values: {} } } as const

    const configs = new Map(rollups.map((r) => [r.id, readRollupConfig(r.config)] as const))
    const relationIds = [...new Set([...configs.values()].flatMap((c) => (c === null ? [] : [c.relation_property_id])))]
    const targetIds = [...new Set([...configs.values()].flatMap((c) => (c === null ? [] : [c.target_property_id])))]

    // relation 은 **이 표의 것**이어야 한다 — 다른 표의 relation 을 가리키는 config 는 끊긴 것으로 읽는다.
    const relations = await tx.query<{ id: string; config: unknown }>(
      `SELECT id, config FROM property
        WHERE id = ANY($1::text[]) AND data_source_id = $2 AND type = 'relation' AND deleted_at IS NULL`,
      [relationIds, dataSourceId],
    )
    const targetTableOf = new Map<string, string>()
    for (const r of relations) {
      const config = readRelationConfig(r.config)
      if (config !== null) targetTableOf.set(r.id, config.target_data_source_id)
    }

    const targets = await tx.query<{ id: string; data_source_id: string; type: string }>(
      `SELECT id, data_source_id, type FROM property WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
      [targetIds],
    )
    const targetOf = new Map(targets.map((t) => [t.id, t] as const))

    // 옵션 이름은 그 표의 내용이다 — 볼 수 있는 표의 것만 읽는다.
    const visibleTables = new Set<string>([dataSourceId])
    for (const table of new Set(targetTableOf.values())) {
      if (table !== dataSourceId && (await canViewDataSource(tx, ctx, table))) visibleTables.add(table)
    }

    type Live = Omit<Extract<RollupColumnInfo, { state: 'ok' }>, 'state' | 'targetOptions'> & {
      readonly id: string
      readonly table: string
    }
    const columns: Record<string, RollupColumnInfo> = {}
    const live: Live[] = []
    for (const [propertyId, config] of configs) {
      const table = config === null ? undefined : targetTableOf.get(config.relation_property_id)
      if (config === null || table === undefined) {
        columns[propertyId] = { state: 'relation_missing' }
        continue
      }
      const target = targetOf.get(config.target_property_id)
      // 대상은 **그 relation 의 대상 표의** 프로퍼티여야 한다.
      if (target === undefined || target.data_source_id !== table || !isRollupTargetType(target.type)) {
        columns[propertyId] = { state: 'target_missing' }
        continue
      }
      live.push({
        id: propertyId,
        table,
        function: effectiveRollupFunction(config.function, target.type),
        relationPropertyId: config.relation_property_id,
        targetPropertyId: config.target_property_id,
        targetType: target.type,
      })
    }

    const optionsOf = await readOptionsOf(tx, [
      ...new Set(live.filter((c) => isOptionType(c.targetType) && visibleTables.has(c.table)).map((c) => c.targetPropertyId)),
    ])
    for (const c of live) {
      columns[c.id] = {
        state: 'ok',
        function: c.function,
        relationPropertyId: c.relationPropertyId,
        targetPropertyId: c.targetPropertyId,
        targetType: c.targetType,
        targetOptions: optionsOf.get(c.targetPropertyId) ?? [],
      }
    }

    if (live.length === 0 || wanted.length === 0) return { ok: true, value: { columns, values: {} } } as const

    // ── 행: 이 표의 · 살아 있는 · 템플릿이 아닌 것만 ──
    const rows = await tx.query<{ id: string }>(
      `SELECT p.id FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = ANY($1::uuid[]) AND p.data_source_id = $2 AND b.workspace_id = $3
          AND b.lifecycle = 'live' AND p.is_template = false`,
      [wanted, dataSourceId, ctx.workspaceId],
    )

    // ── 엣지 한 번. 휴지통 · 템플릿은 여기서 빠지고, 읽을 수 있는지는 표시만 해 둔다(hidden 을 세야 한다) ──
    const scopes = await readableScopes(tx, ctx)
    const edges = await tx.query<EdgeRow>(
      `SELECT from_page_id, property_id, to_page_id, readable
         FROM (SELECT e.from_page_id, e.property_id, e.to_page_id,
                      (b.perm_scope_id = ANY($4::uuid[])) AS readable,
                      row_number() OVER (PARTITION BY e.from_page_id, e.property_id
                                             ORDER BY e.order_idx COLLATE "C", e.to_page_id) AS rn
                 FROM relation_edge e
                 JOIN page p ON p.id = e.to_page_id
                 JOIN block b ON b.id = p.id
                WHERE e.property_id = ANY($1::text[]) AND e.from_page_id = ANY($2::uuid[])
                  AND b.workspace_id = $3 AND b.lifecycle = 'live' AND p.is_template = false) t
        WHERE rn <= $5
        ORDER BY from_page_id, property_id, rn`,
      // 상한보다 하나 더 읽는다 — "넘었다"를 알려면 넘은 하나가 필요하다.
      [[...new Set(live.map((c) => c.relationPropertyId))], rows.map((r) => r.id), ctx.workspaceId, scopes, maxLinks + 1],
    )
    const edgesOf = new Map<string, EdgeRow[]>()
    for (const e of edges) {
      const key = `${e.from_page_id}:${e.property_id}`
      const list = edgesOf.get(key)
      if (list === undefined) edgesOf.set(key, [e])
      else list.push(e)
    }

    // ── 대상 값 한 번. **읽을 수 있는 행의 것만** 읽는다 — 읽지 않은 값은 샐 수 없다 ──
    const readableTargets = [...new Set(edges.filter((e) => e.readable).map((e) => e.to_page_id))]
    const cells = await tx.query<{ page_id: string; property_id: string; value: unknown }>(
      `SELECT page_id, property_id, value FROM page_property_value
        WHERE page_id = ANY($1::uuid[]) AND property_id = ANY($2::text[])`,
      [readableTargets, [...new Set(live.map((c) => c.targetPropertyId))]],
    )
    const cellOf = new Map(cells.map((c) => [`${c.page_id}:${c.property_id}`, c.value] as const))

    const values: Record<string, Record<string, RollupCell>> = {}
    for (const row of rows) {
      const out: Record<string, RollupCell> = {}
      for (const column of live) {
        const linked = edgesOf.get(`${row.id}:${column.relationPropertyId}`) ?? []
        if (linked.length > maxLinks) {
          out[column.id] = { state: 'too_many' }
          continue
        }
        const readable = linked.filter((e) => e.readable)
        // 칸이 없는 행은 그 타입의 빈 값이다(`readCell`) — count 는 세고 count_values 는 세지 않는다.
        const inputs: CellValue[] = readable.map((e) =>
          readCell(column.targetType, cellOf.get(`${e.to_page_id}:${column.targetPropertyId}`)),
        )
        out[column.id] = { state: 'ok', result: aggregate(column.function, inputs), hidden: linked.length - readable.length }
      }
      values[row.id] = out
    }
    return { ok: true, value: { columns, values } } as const
  })
}
