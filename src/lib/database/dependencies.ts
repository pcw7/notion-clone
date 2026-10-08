/**
 * 종속 관계(dependency) — DB 심화 2b-3조각 (F-03-18 의 Blocking · Blocked by)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 종속 관계 · 마이그레이션 0052 · 03-database-core.md F-03-18
 *
 * 하위 항목(`sub-items.ts`)과 같은 모양이다 — 같은 표의 양방향 relation 짝("선행 작업" · "후행 작업")과 `config.dependencies` 표시,
 * DB 가 매기는 `role='dependency'`(선행 작업 엣지 — 막히는 행 → 막는 행). 다른 것:
 *
 *   개수 제한이 없다     막는 행이 여럿일 수 있다(하위 항목의 "부모는 하나"가 없다 — 옮겨 오기도 없다)
 *   순환 검사가 그래프다  위로 걷는 길이 여럿이라 방문한 행을 모으며 걷는다(`wouldCreateDependencyCycle` · DB 는 UNION)
 *   날짜를 옮기지 않는다  03 의 클론 대안 — `dependency_shift_mode` 는 `never` 뿐이다(정본 ④)
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
import { freeName } from './sub-items.ts'

/** 켤 때 생기는 두 속성의 이름. 짝을 알아보는 것은 이름이 아니라 `config.dependencies` 다. */
export const DEPENDENCY_NAMES = { blockedBy: '선행 작업', blocking: '후행 작업' } as const

export type DependencyPair = {
  /** "선행 작업" — 이 행을 막는 행들(막히는 행 → 막는 행). */
  readonly blockedByPropertyId: string
  /** "후행 작업" — 이 행이 막는 행들(거울상). */
  readonly blockingPropertyId: string
}

export async function readDependencyPair(tx: Tx, dataSourceId: string): Promise<DependencyPair | null> {
  const rows = await tx.query<{ id: string; side: string }>(
    `SELECT id, config->>'dependencies' AS side FROM property
      WHERE data_source_id = $1 AND type = 'relation' AND deleted_at IS NULL AND config ? 'dependencies'`,
    [dataSourceId],
  )
  const blockedBy = rows.find((r) => r.side === 'blocked_by')?.id
  const blocking = rows.find((r) => r.side === 'blocking')?.id
  return blockedBy !== undefined && blocking !== undefined ? { blockedByPropertyId: blockedBy, blockingPropertyId: blocking } : null
}

/** 종속 관계를 켠다. 이미 켜져 있으면 그대로 성공이다(DP1). 권한은 스키마를 고치는 것이다. */
export async function enableDependencies(
  ctx: SessionContext,
  dataSourceId: string,
  input: { readonly expectedVersion?: string } = {},
): Promise<PropertyResult<{ readonly schema: SchemaSnapshot } & DependencyPair>> {
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const existing = await readDependencyPair(tx, dataSourceId)
    if (existing !== null) return { ok: true, value: { schema: await readSchema(tx, dataSourceId), ...existing } } as const

    const taken = new Set(
      (await tx.query<{ name: string }>(`SELECT name FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`, [dataSourceId])).map(
        (r) => r.name,
      ),
    )
    const blockedByName = freeName(DEPENDENCY_NAMES.blockedBy, taken)
    const blockingName = freeName(DEPENDENCY_NAMES.blocking, taken)
    const slot = await checkPropertySlots(tx, dataSourceId, [blockedByName, blockingName])
    if (slot !== null) return slot

    const blockedByPropertyId = newPropertyId()
    const blockingPropertyId = newPropertyId()
    const blockedBy = await insertPropertyIn(tx, dataSourceId, {
      id: blockedByPropertyId,
      name: blockedByName,
      type: 'relation',
      description: null,
      config: { target_data_source_id: dataSourceId, synced_property_id: blockingPropertyId, dependencies: 'blocked_by' },
    })
    if (isSchemaFailure(blockedBy)) return blockedBy
    const blocking = await insertPropertyIn(tx, dataSourceId, {
      id: blockingPropertyId,
      name: blockingName,
      type: 'relation',
      description: null,
      config: { target_data_source_id: dataSourceId, synced_property_id: blockedByPropertyId, dependencies: 'blocking' },
    })
    if (isSchemaFailure(blocking)) return blocking

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: { schema: await readSchema(tx, dataSourceId), blockedByPropertyId, blockingPropertyId } } as const
  })
}

/** 종속 관계를 끈다 — 짝은 일반 relation 으로 남는다(연결은 그대로 · role 은 트리거가 다시 매겨 지운다). */
export async function disableDependencies(
  ctx: SessionContext,
  dataSourceId: string,
  input: { readonly expectedVersion?: string } = {},
): Promise<PropertyResult<SchemaSnapshot>> {
  return withCommandTransaction(async (tx) => {
    const own = await lockSchema(tx, ctx, dataSourceId, input.expectedVersion)
    if (isSchemaFailure(own)) return own

    const pair = await readDependencyPair(tx, dataSourceId)
    if (pair === null) return { ok: true, value: await readSchema(tx, dataSourceId) } as const

    await tx.query(
      `UPDATE property SET config = config - 'dependencies', updated_at = now() WHERE id = ANY($1::text[]) AND data_source_id = $2`,
      [[pair.blockedByPropertyId, pair.blockingPropertyId], dataSourceId],
    )
    await tx.query(`UPDATE relation_edge SET role = role WHERE property_id = $1 AND role IS NOT NULL`, [pair.blockedByPropertyId])

    await bumpSchema(tx, dataSourceId)
    return { ok: true, value: await readSchema(tx, dataSourceId) } as const
  })
}

/**
 * `blocker` 가 `blocked` 를 막게 하면 순환이 생기는가 — 같은 행이거나, `blocker` 를 막는 사슬(위로)에 `blocked` 가 있다.
 *
 * 막는 행이 여럿이라 길이 여럿이다 — UNION 이 방문한 행을 한 번만 걷는다. DB 의 지연 제약 트리거가 커밋 때 다시 본다 — 이 함수는
 * 이유를 말하려고 먼저 묻는다.
 */
export async function wouldCreateDependencyCycle(
  tx: Tx,
  blockedByPropertyId: string,
  blocked: string,
  blocker: string,
): Promise<boolean> {
  if (blocked === blocker) return true
  const hit = await tx.queryMaybe<{ one: number }>(
    `WITH RECURSIVE up(id) AS (
       SELECT $2::uuid
       UNION
       SELECT e.to_page_id FROM relation_edge e JOIN up ON e.from_page_id = up.id WHERE e.property_id = $1
     )
     SELECT 1 AS one FROM up WHERE id = $3 LIMIT 1`,
    [blockedByPropertyId, blocker, blocked],
  )
  return hit !== null
}
