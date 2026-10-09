/**
 * 수식 값의 캐시를 채운다 — 거르거나 정렬하기 직전에 (DB 심화 2j-2조각 · F-03-13)
 *
 * 정본: 00-canonical-data-model.md §3.5 `derived_value` · 불변식 D1 · [보강] `derived_value`
 *       03-database-core.md F-03-13 *"팬아웃 폭발 → 즉시 계산하지 말고 stale 마킹 후 조회되는 페이지만 계산(lazy)"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 무효화는 DB 가, 채우기는 여기가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 칸 · 속성 · 옵션이 바뀌면 트리거가 `stale` 로 둔다(0062). 여기는 **거르기 직전에** 그 표의 낡은 · 없는 행을 계산해 채운다. 읽기 트랜잭션은
 * READ ONLY 라 채우기는 그 앞의 쓰기 트랜잭션이다. 계산은 화면이 쓰는 그 함수다(`compileLiveFormulas` · `evaluateRowFormulas`) —
 * 화면에 보이는 값과 거르는 값이 같다. 사이드카는 칸과 같은 함수(`formulaCell` → `deriveSidecars`)로 만든다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 계산하는 동안 바뀌면 — 잠근다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행을 읽고 계산해 쓰는 사이에 칸이 바뀌면, 그 쓰기의 트리거가 `stale` 로 둔 것을 옛 값(`stale = false`)으로 덮어 **무효화를 잃는다.**
 * 그래서 표를 `FOR SHARE`(스키마 명령의 `FOR UPDATE` 와 겨룬다 — 식을 고치는 동안 옛 식으로 채우지 않는다)로, 행을
 * `FOR SHARE SKIP LOCKED`(칸 쓰기는 행의 읽기 모델을 고치며 그 행을 잡는다)로 잡는다. 지금 쓰이는 행은 건너뛴다 — 기다리지 않고 교착도
 * 없다. 그 행은 쓰기가 끝나면 다시 `stale` 이고 다음 거르기가 채운다(이번 한 번은 옛 값으로 걸러질 수 있다 — 막 고치는 행이다).
 *
 * `now()` · `today()` 를 읽는 수식(다른 수식을 거쳐서라도)은 캐시가 시간이 지나면 틀린다 — 그것으로 거르면 표 전부를 다시 계산한다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, withTransaction, type Tx } from '../db/tx.ts'
import { usesClock, type FormulaValue } from '../formula/formula.ts'
import { propertyIdsIn, type FilterNode, type SortKey } from './filter.ts'
import { compileLiveFormulas, evaluateRowFormulas, type FormulaSourceProperty, type LiveFormula } from './formula-schema.ts'
import { formulaCell } from './formula-plan.ts'
import { readOptionsOf } from './options.ts'
import { isUuid } from '../ids.ts'
import { deriveSidecars, isOptionType } from './property-types.ts'

/** 한 번에 쓰는 줄 수 — 파라미터 하나(jsonb)에 싣는다. */
const UPSERT_CHUNK = 1000

/** 지금을 읽는 수식 — 스스로 읽거나, 그런 수식을 읽는다. */
function clockFormulas(formulas: readonly LiveFormula[]): Set<string> {
  const byId = new Map(formulas.map((f) => [f.id, f]))
  const memo = new Map<string, boolean>()
  const visit = (id: string, seen: Set<string>): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const f = byId.get(id)
    if (f === undefined || !f.ok || seen.has(id)) return false
    seen.add(id)
    const result = usesClock(f.compiled.ast) || f.compiled.dependsOn.some((d) => visit(d, seen))
    memo.set(id, result)
    return result
  }
  return new Set(formulas.filter((f) => visit(f.id, new Set())).map((f) => f.id))
}

/**
 * 이 표의 수식 캐시를 채운다 — `propertyIds` 중 수식이 있을 때만(필터 · 정렬이 읽는 속성을 넘긴다). 권한은 보지 않는다 — 캐시는 이미 있는
 * 칸에서 나오고 밖으로 나가지 않는다(거르는 질의가 권한을 본다). 이 워크스페이스의 살아 있는 표만.
 */
export async function refreshDerivedValues(
  ctx: SessionContext,
  dataSourceId: string,
  propertyIds: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  if (propertyIds.length === 0 || !isUuid(dataSourceId)) return
  await withTransaction(async (tx) => {
    // 수식이 없으면 잠그지 않고 끝난다(거르는 질의마다 부르므로 가볍게)
    const wanted = await tx.query<{ id: string }>(
      `SELECT id FROM property WHERE data_source_id = $1 AND id = ANY($2::text[]) AND type = 'formula' AND deleted_at IS NULL`,
      [dataSourceId, [...propertyIds]],
    )
    if (wanted.length === 0) return

    // ① 표 — 스키마가 바뀌지 않게
    const ds = await tx.queryMaybe<{ id: string }>(
      `SELECT ds.id FROM data_source ds JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND ds.lifecycle = 'live' AND b.lifecycle = 'live'
        FOR SHARE OF ds`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null) return

    const properties = await tx.query<FormulaSourceProperty>(
      `SELECT id, name, type::text AS type, config FROM property
        WHERE data_source_id = $1 AND deleted_at IS NULL
        ORDER BY order_idx, id`,
      [dataSourceId],
    )
    const formulas = compileLiveFormulas(properties)
    const clock = clockFormulas(formulas)
    const everyRow = wanted.some((w) => clock.has(w.id))

    // ② 낡은 · 없는 행 — 지금 쓰이는 행은 건너뛴다(머리말)
    const rows = await tx.query<{ id: string; properties_cache: Record<string, unknown> | null }>(
      `SELECT p.id, p.properties_cache
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1 AND p.is_template = false AND b.lifecycle = 'live'
          AND ($3 OR EXISTS (
                SELECT 1 FROM unnest($2::text[]) AS f(id)
                 WHERE NOT EXISTS (SELECT 1 FROM derived_value dv WHERE dv.page_id = p.id AND dv.property_id = f.id AND NOT dv.stale)))
        ORDER BY p.id
        FOR SHARE OF p SKIP LOCKED`,
      [dataSourceId, formulas.map((f) => f.id), everyRow],
    )
    if (rows.length === 0) return

    await writeValues(tx, formulas, properties, rows, now)
  })
}

/** 행마다 수식 전부를 계산해 캐시에 쓴다(`stale = false`). */
async function writeValues(
  tx: Tx,
  formulas: readonly LiveFormula[],
  properties: readonly FormulaSourceProperty[],
  rows: readonly { id: string; properties_cache: Record<string, unknown> | null }[],
  now: Date,
): Promise<void> {
  const options = await readOptionsOf(tx, properties.filter((p) => isOptionType(p.type)).map((p) => p.id))
  const optionNames = new Map<string, string>()
  for (const list of options.values()) for (const o of list) optionNames.set(o.id, o.name)
  const typeOf = new Map(properties.map((p) => [p.id, p.type]))

  const records: Record<string, unknown>[] = []
  for (const row of rows) {
    const values = evaluateRowFormulas(formulas, (id) => typeOf.get(id) ?? null, row.properties_cache ?? {}, (id) => optionNames.get(id) ?? null, { now })
    for (const f of formulas) records.push(recordOf(row.id, f.id, values[f.id] ?? null))
  }
  for (let at = 0; at < records.length; at += UPSERT_CHUNK) {
    await tx.query(
      `INSERT INTO derived_value (page_id, property_id, value, num_value, text_value, date_start, date_end, bool_value, stale, computed_at)
       SELECT x.page_id, x.property_id, x.value, x.num_value, x.text_value, x.date_start, x.date_end, x.bool_value, false, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(page_id uuid, property_id text, value jsonb, num_value numeric, text_value text,
                                                  date_start timestamptz, date_end timestamptz, bool_value boolean)
       ON CONFLICT (page_id, property_id) DO UPDATE
         SET value = EXCLUDED.value, num_value = EXCLUDED.num_value, text_value = EXCLUDED.text_value,
             date_start = EXCLUDED.date_start, date_end = EXCLUDED.date_end, bool_value = EXCLUDED.bool_value,
             stale = false, computed_at = now()`,
      [JSON.stringify(records.slice(at, at + UPSERT_CHUNK))],
    )
  }
}

/** 수식 값 한 칸 → 캐시 한 줄. 사이드카는 칸과 같은 함수로(정본 [보강] `derived_value` ①). */
function recordOf(pageId: string, propertyId: string, value: FormulaValue): Record<string, unknown> {
  const cell = formulaCell(value)
  const sidecars = cell === null ? null : deriveSidecars(cell)
  return {
    page_id: pageId,
    property_id: propertyId,
    value,
    num_value: sidecars?.num ?? null,
    text_value: sidecars?.text ?? null,
    date_start: sidecars?.dateStart?.toISOString() ?? null,
    // 수식이 낸 범위가 거꾸로면(끝이 시작보다 앞) 끝을 버린다 — 칸의 CHECK(`ck_ppv_date_range`)과 같은 뜻
    date_end:
      sidecars?.dateEnd && sidecars.dateStart && sidecars.dateEnd >= sidecars.dateStart ? sidecars.dateEnd.toISOString() : null,
    bool_value: sidecars?.bool ?? null,
  }
}

/**
 * 뷰 하나를 읽기 전에 — 이 사람이 실제로 쓰는 필터 · 정렬(개인 것이 있으면 그것 · 2h-1)이 읽는 수식을 채운다. 보드 · 캘린더처럼 뷰를 읽기
 * 트랜잭션 안에서 여는 길이 부른다. 없는 뷰면 아무것도 하지 않는다(권한 · 존재는 그 뒤의 읽기가 답한다).
 */
export async function refreshDerivedForView(ctx: SessionContext, viewId: string): Promise<void> {
  if (!isUuid(viewId)) return
  const shape = await withReadTransaction((tx) =>
    tx.queryMaybe<{ data_source_id: string; filter: FilterNode | null; sorts: SortKey[] | null }>(
      `SELECT v.data_source_id, coalesce(o.filter, v.filter) AS filter, coalesce(o.sorts, v.sorts) AS sorts
         FROM view v
         LEFT JOIN view_user_override o ON o.view_id = v.id AND o.user_id = $2
        WHERE v.id = $1`,
      [viewId, ctx.userId],
    ),
  )
  if (shape === null) return
  await refreshDerivedValues(ctx, shape.data_source_id, propertyIdsIn(shape.filter, Array.isArray(shape.sorts) ? shape.sorts : []))
}
