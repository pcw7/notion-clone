/**
 * 열 집계 — 필터를 지난 행 전부의 통계를 한 질의로 (DB 심화 2d-1조각 · F-04-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 열 집계 · 04-database-views.md F-04-16
 *
 * 열마다 통계 한 줄(`ColumnStats`)을 내고 함수의 값은 `calculations.ts` 가 만든다. 질의는 열 수와 무관하게 **하나**다 — 필터를 지난 행을
 * CTE 로 한 번 고르고 열마다 그 행들의 칸을 한 번 모은다. 사이드카를 본다(값 있는 칸 = 사이드카 중 하나라도 있음 · 고유 값 = 사이드카의
 * 고유 값 — 선택은 옵션 id 라 이름을 바꿔도 같다).
 *
 * 권한은 표 단위다 — 표를 볼 수 있으면 그 행 전부를 볼 수 있다(행 단위 권한이 없다 · HANDOFF §7). 그래서 못 보는 행이 집계에 섞이는
 * 길이 없다(04 *"볼 수 없는 행은 집계 이전에 제외"*). 행 단위 권한이 생기면 이 CTE 가 그것을 거른다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { calculationResult, calculationsFor, type Calculation, type CalculationResult, type ColumnStats } from './calculations.ts'
import { compileFilter, ParamBag, type FilterNode } from './filter.ts'
import { isMvpPropertyType } from './property-types.ts'
import { readPropertyTypes } from './query.ts'

/** 계산을 단 열 — 컬럼의 `calculation` 과 타입. */
export type CalculatedColumn = { readonly propertyId: string; readonly type: string; readonly calculation?: Calculation | null }

export type Calculations = Readonly<Record<string, CalculationResult>>

/**
 * 이 표 · 이 필터로 열들의 집계를 계산한다. 계산이 없거나 타입에 맞지 않는 열(타입을 바꾼 뒤)은 빠진다 — 저장값은 남는다.
 * 못 보는 표면 빈 결과다(존재를 알리지 않는다).
 */
export async function computeCalculations(
  ctx: SessionContext,
  dataSourceId: string,
  filter: FilterNode | null,
  columns: readonly CalculatedColumn[],
): Promise<Calculations> {
  const wanted = columns.filter(
    (c): c is CalculatedColumn & { calculation: Calculation } =>
      c.calculation !== null && c.calculation !== undefined && isMvpPropertyType(c.type) && calculationsFor(c.type).includes(c.calculation),
  )
  if (wanted.length === 0) return {}
  return withReadTransaction(async (tx) => {
    const ds = await tx.queryMaybe<{ container_id: string }>(
      `SELECT ds.owner_database_id AS container_id
         FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null || !can(await effectiveCaps(tx, ctx, ds.container_id), 'view')) return {}
    const stats = await readStats(tx, dataSourceId, filter, wanted.map((c) => c.propertyId))
    const out: Record<string, CalculationResult> = {}
    for (const column of wanted) {
      const s = stats.get(column.propertyId)
      if (s !== undefined) out[column.propertyId] = calculationResult(column.calculation, s)
    }
    return out
  })
}

type StatsRow = {
  filled: number
  distinct: number
  sum: number | null
  avg: number | null
  median: number | null
  min: number | null
  max: number | null
  dmin: string | null
  dmax: string | null
  checked: number
}

/** 열마다 통계 한 줄 — 질의 하나. 지워진 프로퍼티를 가리키는 필터 규칙은 컴파일러가 건너뛴다(표의 행 질의와 같은 규칙). */
async function readStats(tx: Tx, dataSourceId: string, filter: FilterNode | null, propertyIds: readonly string[]): Promise<Map<string, ColumnStats>> {
  const types = await readPropertyTypes(tx, dataSourceId)
  const params = new ParamBag(2)
  const filterSql = compileFilter(filter, types, params)
  const columns = propertyIds.map((id, i) => {
    const p = params.bind(id)
    return `(SELECT json_build_object(
               'filled', count(*) FILTER (WHERE v.num_value IS NOT NULL OR v.text_value IS NOT NULL OR v.date_start IS NOT NULL OR v.bool_value),
               'distinct', count(DISTINCT coalesce(v.num_value::text, v.text_value, v.date_start::text)),
               'sum', sum(v.num_value), 'avg', avg(v.num_value),
               'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY v.num_value),
               'min', min(v.num_value), 'max', max(v.num_value),
               'dmin', min(v.date_start), 'dmax', max(coalesce(v.date_end, v.date_start)),
               'checked', count(*) FILTER (WHERE v.bool_value))
             FROM r JOIN page_property_value v ON v.page_id = r.id AND v.property_id = ${p}) AS c${i}`
  })
  const row = await tx.queryOne<Record<string, unknown>>(
    `WITH r AS (
       SELECT p.id FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.is_template = false AND b.lifecycle = 'live'${filterSql === null ? '' : ` AND ${filterSql}`}
     )
     SELECT (SELECT count(*) FROM r)::int AS total, ${columns.join(', ')}`,
    [dataSourceId, ...params.values],
  )
  const total = Number(row.total)
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  const out = new Map<string, ColumnStats>()
  for (const [i, id] of propertyIds.entries()) {
    const s = row[`c${i}`] as StatsRow
    out.set(id, {
      total,
      filled: Number(s.filled),
      distinct: Number(s.distinct),
      sum: num(s.sum),
      avg: num(s.avg),
      median: num(s.median),
      min: num(s.min),
      max: num(s.max),
      dateMin: s.dmin === null ? null : new Date(s.dmin).toISOString(),
      dateMax: s.dmax === null ? null : new Date(s.dmax).toISOString(),
      checked: Number(s.checked),
    })
  }
  return out
}
