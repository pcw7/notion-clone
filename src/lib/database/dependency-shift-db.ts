/**
 * 종속 관계 날짜 이동 — 읽기 (40번 트랙 TL-5 · 정본 §3.5 [보강 TL-5] ①②④)
 *
 * 계획(`dependency-shift.ts`)에 넣을 것을 한 트랜잭션 안에서 읽는다: 데이터베이스의 이동 방식 · 바뀐 행에서 닿는 간선 ·
 * 닿는 행들의 그 날짜 속성 값. 쓰기 · 권한은 `row.ts` 가 한다(셀 쓰는 길은 하나다).
 */

import type { Tx } from '../db/tx.ts'
import { readDependencyPair } from './dependencies.ts'
import { isShiftMode, MAX_SHIFTED_ROWS, type DependencyShiftMode, type ShiftEdge } from './dependency-shift.ts'
import type { DateValue } from './property-types.ts'

/** 데이터베이스의 이동 방식 — NULL 은 `never`. */
export async function readShiftMode(tx: Tx, databaseId: string): Promise<DependencyShiftMode> {
  const row = await tx.queryMaybe<{ mode: string | null }>(`SELECT dependency_shift_mode AS mode FROM database WHERE id = $1`, [databaseId])
  return row !== null && isShiftMode(row.mode) ? row.mode : 'never'
}

/** 간선 상한 — 행 상한보다 넉넉히 두되 한도가 있다(넘으면 너무 크다). */
const MAX_EDGES = MAX_SHIFTED_ROWS * 5

export type ShiftContext = {
  readonly mode: DependencyShiftMode
  readonly edges: readonly ShiftEdge[]
  readonly values: ReadonlyMap<string, DateValue | null>
}

/**
 * 이 행이 막는 행들을 따라 닿는 간선과 값. 종속 관계가 꺼져 있거나 방식이 `never` 면 null.
 * `tooLarge` 는 간선이 상한을 넘었다는 뜻이다.
 */
export async function loadShiftContext(
  tx: Tx,
  input: { readonly dataSourceId: string; readonly databaseId: string; readonly rowId: string; readonly propertyId: string },
): Promise<ShiftContext | 'tooLarge' | null> {
  const mode = await readShiftMode(tx, input.databaseId)
  if (mode === 'never') return null
  if ((await readDependencyPair(tx, input.dataSourceId)) === null) return null

  // 간선은 막힌 행(from) → 막는 행(to). 바뀐 행을 막는 행으로 두고 막힌 쪽으로 걷는다. UNION 이 순환을 끊는다.
  const edges = await tx.query<{ blocker: string; blocked: string }>(
    `WITH RECURSIVE reach(blocker, blocked) AS (
       SELECT e.to_page_id, e.from_page_id FROM relation_edge e WHERE e.role = 'dependency' AND e.to_page_id = $1
       UNION
       SELECT e.to_page_id, e.from_page_id FROM relation_edge e JOIN reach r ON e.to_page_id = r.blocked WHERE e.role = 'dependency'
     )
     SELECT blocker, blocked FROM reach LIMIT ${MAX_EDGES + 1}`,
    [input.rowId],
  )
  if (edges.length > MAX_EDGES) return 'tooLarge'

  const ids = [...new Set(edges.map((e) => e.blocked))]
  const values = new Map<string, DateValue | null>()
  if (ids.length > 0) {
    const rows = await tx.query<{ page_id: string; date: DateValue | null }>(
      `SELECT v.page_id, v.value -> 'date' AS date
         FROM page_property_value v JOIN block b ON b.id = v.page_id
        WHERE v.property_id = $2 AND v.page_id = ANY($1::uuid[]) AND b.lifecycle = 'live'`,
      [ids, input.propertyId],
    )
    for (const r of rows) values.set(r.page_id, r.date !== null && typeof r.date.start === 'string' ? r.date : null)
  }
  return { mode, edges, values }
}
