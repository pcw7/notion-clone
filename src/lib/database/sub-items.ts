/**
 * 하위 항목(sub-item) — DB 심화 2b-1조각 (F-03-18 의 서버 명령)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 하위 항목 · 마이그레이션 0051 · 03-database-core.md F-03-18
 *
 * ──────────────────────────────────────────────────────────────────────
 * relation 짝 하나로 표현한다 — 계층을 행에 복사하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 켜면 같은 표를 가리키는 양방향 relation 짝이 생긴다 — "상위 항목"(`limit: 'one'` · `sub_items: 'parent'`)과 "하위 항목"
 * (`sub_items: 'children'`). 연결은 relation 의 길(`relation.ts` `linkRows`) 그대로다 — 다른 것은 셋뿐이다:
 *
 *   순환을 거부한다     자기 자신 · 자기 자손을 부모로 둘 수 없다(`wouldCreateCycle` — 커밋 때 DB 가 다시 본다 · SI3)
 *   부모는 하나다       하위 항목 칸에 행을 더하면 그 행은 **옮겨 온다** — 있던 부모와의 엣지를 같은 명령이 뺀다(SI2)
 *   role 은 DB 가 매긴다  자식 → 부모 엣지에만 `sub_item`(마이그레이션 0051 의 트리거) — 이 파일은 role 을 쓰지 않는다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 끄면 일반 relation 으로 남는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 03 의 권고(*"일반 relation 으로 강등, 엣지 보존"*)를 따른다 — 표시를 떼고 엣지의 role 을 다시 매기게 한다. 연결은 그대로
 * 남아 지운 것이 없다. 다시 켜면 **새** 짝이 생긴다(있는 relation 을 하위 항목으로 쓰는 길은 아직 없다 — 옮기기 전에 부모
 * 여럿 · 순환을 검사해야 한다 · 정본 미룬 것).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import {
  bumpSchema,
  checkPropertySlots,
  insertPropertyIn,
  isSchemaFailure,
  lockSchema,
  newPropertyId,
  readSchema,
  type PropertyResult,
  type SchemaSnapshot,
} from './property.ts'

/** 켤 때 생기는 두 속성의 이름. 이름은 바꿀 수 있다 — 짝을 알아보는 것은 이름이 아니라 `config.sub_items` 다. */
export const SUB_ITEM_NAMES = { parent: '상위 항목', children: '하위 항목' } as const

export type SubItemPair = {
  /** "상위 항목" — 자식 → 부모. 하나만 연결된다. */
  readonly parentPropertyId: string
  /** "하위 항목" — 부모 → 자식(거울상). */
  readonly childrenPropertyId: string
}

/** 이 표의 살아 있는 하위 항목 짝. 꺼져 있으면 null. */
export async function readSubItemPair(tx: Tx, dataSourceId: string): Promise<SubItemPair | null> {
  const rows = await tx.query<{ id: string; side: string }>(
    `SELECT id, config->>'sub_items' AS side FROM property
      WHERE data_source_id = $1 AND type = 'relation' AND deleted_at IS NULL AND config ? 'sub_items'`,
    [dataSourceId],
  )
  const parent = rows.find((r) => r.side === 'parent')?.id
  const children = rows.find((r) => r.side === 'children')?.id
  return parent !== undefined && children !== undefined ? { parentPropertyId: parent, childrenPropertyId: children } : null
}

export type EnableSubItemsOutcome = { readonly schema: SchemaSnapshot } & SubItemPair

/**
 * 하위 항목을 켠다. 이미 켜져 있으면 **그대로 성공**이다(토글을 두 번 눌러도 짝은 하나 · SI1).
 *
 * 권한은 스키마를 고치는 것이다(`lockSchema` — `edit_structure` · 잠긴 데이터베이스는 `locked`).
 */
export async function enableSubItems(
  ctx: SessionContext,
  dataSourceId: string,
  input: { readonly expectedVersion?: string } = {},
): Promise<PropertyResult<EnableSubItemsOutcome>> {
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const existing = await readSubItemPair(tx, dataSourceId)
    if (existing !== null) return { ok: true, value: { schema: await readSchema(tx, dataSourceId), ...existing } } as const

    // 이름은 비어 있는 것을 고른다 — 껐다 다시 켜면 옛 짝이 일반 relation 으로 같은 이름을 갖고 있다("상위 항목 2").
    // 두 이름을 쓰기 전에 함께 묻는다 — 첫 속성을 넣은 뒤에 둘째 이름이 겹친다는 것을 알면 안 된다(`checkPropertySlots` 머리말).
    const taken = new Set(
      (await tx.query<{ name: string }>(`SELECT name FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`, [dataSourceId])).map(
        (r) => r.name,
      ),
    )
    const parentName = freeName(SUB_ITEM_NAMES.parent, taken)
    const childrenName = freeName(SUB_ITEM_NAMES.children, taken)
    const slot = await checkPropertySlots(tx, dataSourceId, [parentName, childrenName])
    if (slot !== null) return slot

    const parentPropertyId = newPropertyId()
    const childrenPropertyId = newPropertyId()
    const parent = await insertPropertyIn(tx, dataSourceId, {
      id: parentPropertyId,
      name: parentName,
      type: 'relation',
      description: null,
      config: { target_data_source_id: dataSourceId, synced_property_id: childrenPropertyId, limit: 'one', sub_items: 'parent' },
    })
    if (isSchemaFailure(parent)) return parent
    const children = await insertPropertyIn(tx, dataSourceId, {
      id: childrenPropertyId,
      name: childrenName,
      type: 'relation',
      description: null,
      config: { target_data_source_id: dataSourceId, synced_property_id: parentPropertyId, sub_items: 'children' },
    })
    if (isSchemaFailure(children)) return children

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: { schema: await readSchema(tx, dataSourceId), parentPropertyId, childrenPropertyId } } as const
  })
}

/** `base` · `base 2` · `base 3` … 중 아직 없는 첫 이름. */
function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/**
 * 하위 항목을 끈다 — 짝은 **일반 relation 으로 남는다**(머리말). 꺼져 있으면 그대로 성공이다.
 *
 * 엣지의 role 은 DB 가 매기므로(0051) 표시를 뗀 뒤 그 엣지를 한 번 고쳐 다시 매기게 한다 — 직접 `NULL` 을 쓰지 않는 이유는
 * 트리거가 어차피 덮기 때문이고, 규칙이 한 곳(트리거)에만 있게 하려는 것이다.
 */
export async function disableSubItems(
  ctx: SessionContext,
  dataSourceId: string,
  input: { readonly expectedVersion?: string } = {},
): Promise<PropertyResult<SchemaSnapshot>> {
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const pair = await readSubItemPair(tx, dataSourceId)
    if (pair === null) return { ok: true, value: await readSchema(tx, dataSourceId) } as const

    const ids = [pair.parentPropertyId, pair.childrenPropertyId]
    await tx.query(
      `UPDATE property SET config = config - 'sub_items', updated_at = now() WHERE id = ANY($1::text[]) AND data_source_id = $2`,
      [ids, dataSourceId],
    )
    await tx.query(`UPDATE relation_edge SET role = role WHERE property_id = $1 AND role IS NOT NULL`, [pair.parentPropertyId])

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

/**
 * `child` 의 부모를 `parent` 로 두면 순환이 생기는가 — 같은 행이거나, `parent` 의 조상 사슬에 `child` 가 있다.
 *
 * 부모가 하나라(SI2) 위로 걷는 길은 한 줄이다. DB 의 지연 제약 트리거가 같은 것을 커밋 때 다시 본다 — 이 함수는 **이유를
 * 말하려고** 먼저 묻는다(트리거의 실패는 500 이 된다).
 */
export async function wouldCreateCycle(tx: Tx, parentPropertyId: string, child: string, parent: string): Promise<boolean> {
  if (child === parent) return true
  const hit = await tx.queryMaybe<{ one: number }>(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT $2::uuid, 0
       UNION ALL
       SELECT e.to_page_id, up.depth + 1
         FROM relation_edge e JOIN up ON e.from_page_id = up.id
        WHERE e.property_id = $1 AND up.depth < 100000
     )
     SELECT 1 AS one FROM up WHERE id = $3 LIMIT 1`,
    [parentPropertyId, parent, child],
  )
  return hit !== null
}
