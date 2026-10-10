/**
 * 행을 읽는 문 — "만들기만" 인 사람은 자기가 열 수 있는 행만 (게시 · 공유 6f-2b-1 · F-06-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 행 단위 접근 규칙 ⑥ · 06-permissions-sharing.md F-06-10
 *       *"Can create: 새 row 생성만 가능. 기존 row 는 개별 부여 전까지 보이지 않음"* · *"롤업 · 집계 쿼리에도 같은 필터를 적용해야 누출이 없다"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 두 갈래 — 데이터베이스를 볼 수 있으면 모든 행, "만들기만" 이면 술어
 * ──────────────────────────────────────────────────────────────────────
 *
 * 데이터베이스를 볼 수 있는 사람(`view`)은 지금까지처럼 모든 행을 본다 — 행은 데이터베이스에서 상속한다(`query.ts` 머리말). "만들기만"
 * (`create_child` 는 있고 `view` 는 없다 — `create` 레벨)인 사람은 표를 열지만 **자기가 열 수 있는 행만** 본다. 그 술어가
 * `restrictedRowsSql` 이다: 그 행의 스코프를 볼 수 있다(행에 따로 준 부여 — `readableScopes`) 또는 그 행에 그 사람을 여는 규칙이 있다
 * (만든 사람 규칙 — `accessRuleEntries` 와 같은 조건). 둘 다 판정(`effectiveCaps`)과 같은 답을 SQL 로 낸다 — 행마다 판정하지 않는다
 * (06 *"10만 row DB — 규칙 평가를 쿼리 필터로 밀어넣어야 함"*).
 *
 * **권한이 필터보다 먼저다**(F-03-17) — 이 술어는 행 질의 · 보드 · 캘린더 · 열 집계의 WHERE 에 같은 자리로 들어간다. 하나라도 빠지면
 * 건수 · 집계로 남의 행이 샌다.
 *
 * 둘 다 아니면(볼 수도 만들 수도 없다) 문은 없다 — 부르는 쪽이 not_found 를 준다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { can, type CapSet } from '../permissions/levels.ts'
import type { ParamBag } from './filter.ts'

/** 이 사람이 이 데이터베이스의 행을 어떻게 읽는가 — 모두 · 자기가 열 수 있는 것만. */
export type RowsAccess =
  | { readonly kind: 'all' }
  | { readonly kind: 'restricted'; readonly userId: string; readonly scopes: readonly string[] }

/** 표를 열 수 있는가 — 볼 수 있거나 "만들기만"(행을 더할 수 있다). 행의 범위는 `rowsAccessIn` 이 정한다. */
export function canOpenDatabase(caps: CapSet): boolean {
  return can(caps, 'view') || can(caps, 'create_child')
}

/** 데이터베이스의 능력으로 행의 범위를 정한다. 열 수 없으면 null(부르는 쪽이 not_found). */
export async function rowsAccessIn(tx: Tx, ctx: SessionContext, caps: CapSet): Promise<RowsAccess | null> {
  if (can(caps, 'view')) return { kind: 'all' }
  if (!can(caps, 'create_child')) return null
  return { kind: 'restricted', userId: ctx.userId, scopes: await readableScopes(tx, ctx) }
}

/**
 * data source 의 행을 어떻게 읽는가 — 행은 그 data source 를 **소유한** 데이터베이스에서 상속하므로 그 데이터베이스의 능력으로 정한다
 * (붙인 소스의 뷰도 행은 원본의 것이다 · 2l-2). 이 워크스페이스의 살아 있는 것이 아니거나 열 수 없으면 null.
 */
export async function rowsAccessForDataSource(tx: Tx, ctx: SessionContext, dataSourceId: string): Promise<RowsAccess | null> {
  const ds = await tx.queryMaybe<{ owner: string }>(
    `SELECT ds.owner_database_id AS owner
       FROM data_source ds
       JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
    [dataSourceId, ctx.workspaceId],
  )
  if (ds === null) return null
  return rowsAccessIn(tx, ctx, await effectiveCaps(tx, ctx, ds.owner))
}

/**
 * "만들기만" 인 사람이 볼 수 있는 행의 술어 — 바깥 질의에 `page p` · `block b`(그 행)가 있다고 전제한다. 모두 보면 null.
 *
 * 규칙의 조건은 `accessRuleEntries`(판정)와 같다 — 만든 사람 규칙이 이 data source 에 있고 그 행을 이 사람이 만들었다. 템플릿은 바깥
 * 질의가 이미 뺀다(R1).
 */
export function restrictedRowsSql(access: RowsAccess, params: ParamBag): string | null {
  if (access.kind === 'all') return null
  const scopes = params.bind(access.scopes)
  const user = params.bind(access.userId)
  return `(b.perm_scope_id = ANY(${scopes}::uuid[])
           OR (b.created_by = ${user}::uuid
               AND EXISTS (SELECT 1 FROM page_access_rule ar
                            WHERE ar.data_source_id = p.data_source_id AND ar.source_kind = 'created_by')))`
}
