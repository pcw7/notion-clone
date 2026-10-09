/**
 * 이 속성을 읽는 수식 · 롤업 — 지우거나 유형을 바꾸기 전에 알린다 (DB 심화 2j-1조각 · F-03-13)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 수식 1단계 · [보강] rollup v1
 *       03-database-core.md F-03-14 *"변환된 프로퍼티를 참조하던 formula/rollup → 에러 상태로 전환하고 사용자에게 알림"* ·
 *       F-03-02 *"다른 프로퍼티가 참조 중인 프로퍼티 삭제 → 참조하는 formula/rollup 은 에러 상태로 전환"*
 *
 * 지우기 · 유형 바꾸기는 막지 않는다 — 지우기는 되살릴 수 있고(수식 · 롤업이 돌아온다), 유형은 되돌릴 수 있다. 다만 **누르기 전에** 무엇이
 * 깨지는지 말한다. 조용히 깨지면 "수식이 왜 오류지?"를 거꾸로 찾아야 한다.
 *
 *   수식   `property_dependency` 에서 이 속성을 읽는 살아 있는 수식(같은 표 — 1단계의 수식은 relation 을 타지 않는다)
 *   롤업   이 속성이 그 롤업의 relation 이거나(롤업은 같은 표에 산다) 대상이다(롤업은 **다른 표**에 산다 — `ix_property_rollup_target`)
 *
 * **바로 읽는 것만**이다 — 그것을 다시 읽는 수식은 오류가 아니라 빈 값을 받는다(수식 1단계 ⑥). 다른 표의 롤업은 **그 표를 볼 수 있을
 * 때만** 이름을 준다 — 볼 수 없으면 개수만(`hidden`). 지우려는 사람이 다른 표의 속성 이름을 알게 되면 안 된다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { plainTitleOf } from '../block/page.ts'
import { canViewDataSource } from './relation.ts'

export type PropertyDependent = {
  readonly id: string
  readonly name: string
  readonly type: 'formula' | 'rollup'
  /** 다른 표의 것이면 그 표(데이터베이스)의 이름. 이 표의 것이면 null. */
  readonly tableName: string | null
}

export type PropertyDependents = {
  readonly dependents: readonly PropertyDependent[]
  /** 볼 수 없는 표의 롤업 수 — 이름은 주지 않는다. */
  readonly hidden: number
}

export type DependentsResult = { readonly ok: true; readonly value: PropertyDependents } | { readonly ok: false; readonly reason: 'not_found' }

export async function listPropertyDependents(ctx: SessionContext, dataSourceId: string, propertyId: string): Promise<DependentsResult> {
  return withReadTransaction(async (tx) => {
    // 표를 볼 수 있고 그 표의 살아 있는 속성이어야 한다 — 아니면 없는 것과 같은 답
    if (!(await canViewDataSource(tx, ctx, dataSourceId))) return { ok: false, reason: 'not_found' } as const
    const own = await tx.queryMaybe<{ one: number }>(
      `SELECT 1 AS one FROM property WHERE id = $1 AND data_source_id = $2 AND deleted_at IS NULL`,
      [propertyId, dataSourceId],
    )
    if (own === null) return { ok: false, reason: 'not_found' } as const

    const rows = await tx.query<{ id: string; name: string; type: 'formula' | 'rollup'; data_source_id: string; order_idx: string }>(
      `SELECT p.id, p.name, 'formula' AS type, p.data_source_id, p.order_idx
         FROM property_dependency pd
         JOIN property p ON p.id = pd.dependent_property_id
        WHERE pd.source_property_id = $1 AND p.type = 'formula' AND p.deleted_at IS NULL
       UNION
       SELECT p.id, p.name, 'rollup' AS type, p.data_source_id, p.order_idx
         FROM property p
         -- 휴지통의 표 · 다른 워크스페이스의 롤업은 깨질 것이 없다 — 세지도 않는다("볼 수 없는 롤업"으로 읽히면 안 된다)
         JOIN data_source ds ON ds.id = p.data_source_id AND ds.lifecycle = 'live'
         JOIN block b ON b.id = ds.owner_database_id AND b.lifecycle = 'live' AND b.workspace_id = $3
        WHERE p.type = 'rollup' AND p.deleted_at IS NULL
          AND (
            (p.data_source_id = $2 AND p.config ->> 'relation_property_id' = $1)
            OR p.config ->> 'target_property_id' = $1
          )`,
      [propertyId, dataSourceId, ctx.workspaceId],
    )

    // 다른 표의 것 — 볼 수 있는 표만 이름을 준다. 표마다 한 번 묻는다.
    const others = [...new Set(rows.map((r) => r.data_source_id).filter((id) => id !== dataSourceId))]
    const tables = new Map<string, string | null>()
    for (const id of others) {
      if (!(await canViewDataSource(tx, ctx, id))) {
        tables.set(id, null)
        continue
      }
      const db = await tx.queryOne<{ properties: { title?: unknown } | null }>(
        `SELECT b.properties FROM data_source ds JOIN block b ON b.id = ds.owner_database_id WHERE ds.id = $1`,
        [id],
      )
      tables.set(id, plainTitleOf(db.properties))
    }

    const dependents: PropertyDependent[] = []
    let hidden = 0
    for (const r of rows) {
      if (r.data_source_id === dataSourceId) {
        dependents.push({ id: r.id, name: r.name, type: r.type, tableName: null })
        continue
      }
      const table = tables.get(r.data_source_id)
      if (table === null || table === undefined) hidden += 1
      else dependents.push({ id: r.id, name: r.name, type: r.type, tableName: table })
    }
    // 이 표의 것이 먼저 · 표 안에서는 속성 순서 · 다른 표는 이름순
    const orderOf = new Map(rows.map((r) => [r.id, r.order_idx]))
    dependents.sort((a, b) =>
      (a.tableName ?? '') !== (b.tableName ?? '')
        ? (a.tableName ?? '').localeCompare(b.tableName ?? '', 'ko')
        : (orderOf.get(a.id) ?? '') < (orderOf.get(b.id) ?? '')
          ? -1
          : 1,
    )
    return { ok: true, value: { dependents, hidden } } as const
  })
}
