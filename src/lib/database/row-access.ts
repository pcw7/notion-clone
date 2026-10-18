/**
 * 행을 읽는 문 — "만들기만" 인 사람은 자기가 열 수 있는 행만 (게시 · 공유 6f-2b-1 · F-06-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 행 단위 접근 규칙 ⑥ · 06-permissions-sharing.md F-06-10
 *       *"Can create: 새 row 생성만 가능. 기존 row 는 개별 부여 전까지 보이지 않음"* · *"롤업 · 집계 쿼리에도 같은 필터를 적용해야 누출이 없다"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 두 갈래 — 데이터베이스를 볼 수 있는 사람 · "만들기만" — 술어는 같다
 * ──────────────────────────────────────────────────────────────────────
 *
 * "만들기만"(`create_child` 는 있고 `view` 는 없다 — `create` 레벨)인 사람은 표를 열지만 **자기가 열 수 있는 행만** 본다. 그 술어가
 * `restrictedRowsSql` 이다: 그 행의 스코프를 볼 수 있다(행에 따로 준 부여 — `readableScopes`) 또는 그 행에 그 사람을 여는 규칙이 있다
 * (만든 사람 규칙 — `accessRuleEntries` 와 같은 조건). 둘 다 판정(`effectiveCaps`)과 같은 답을 SQL 로 낸다 — 행마다 판정하지 않는다
 * (06 *"10만 row DB — 규칙 평가를 쿼리 필터로 밀어넣어야 함"*).
 *
 * **데이터베이스를 볼 수 있는 사람(`view`)에게도 같은 술어를 건다**(10l-3 · 정본 ⑥). 행은 데이터베이스에서 상속하므로 끊기지 않은 행은
 * 데이터베이스의 스코프를 가리켜 그대로 지난다 — 빠지는 것은 **행을 끊고 그 사람을 뺀 행**뿐이다. 전에는 볼 수 있는 사람의 행 질의에
 * 술어가 없어, 그 행의 화면 · 셀 쓰기는 막혀도 표 · 보드 · 개수에 제목 · 칸이 그대로 섰다(누출 · HANDOFF §7). 스코프 목록은 요청마다
 * 한 번이고 싸다(10l-2 — 1ms 안팎). `OR` 는 앞에서부터 짧게 평가하므로 규칙의 EXISTS 는 스코프로 지나지 못한 행(끊긴 행)에만 돈다.
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

/**
 * 이 사람이 이 데이터베이스의 행을 어떻게 읽는가 — 볼 수 있다(`all` — 끊겨 빠진 행만 빠진다) · "만들기만"(`restricted` — 자기가 열 수 있는
 * 것만). 술어(`restrictedRowsSql`)는 같다 — 갈래는 화면의 말("내가 열 수 있는 행만")과 템플릿 목록 같은 문이 쓴다.
 */
export type RowsAccess = { readonly kind: 'all' | 'restricted'; readonly userId: string; readonly scopes: readonly string[] }

/** 표를 열 수 있는가 — 볼 수 있거나 "만들기만"(행을 더할 수 있다). 행의 범위는 `rowsAccessIn` 이 정한다. */
export function canOpenDatabase(caps: CapSet): boolean {
  return can(caps, 'view') || can(caps, 'create_child')
}

/** 데이터베이스의 능력으로 행의 범위를 정한다. 열 수 없으면 null(부르는 쪽이 not_found). */
export async function rowsAccessIn(tx: Tx, ctx: SessionContext, caps: CapSet): Promise<RowsAccess | null> {
  const kind = can(caps, 'view') ? 'all' : can(caps, 'create_child') ? 'restricted' : null
  if (kind === null) return null
  return { kind, userId: ctx.userId, scopes: await readableScopes(tx, ctx) }
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
 * 이 사람이 볼 수 있는 행의 술어 — 바깥 질의에 `page p` · `block b`(그 행)가 있다고 전제한다. 볼 수 있는 사람 · "만들기만" 모두 같다
 * (머리말 — 볼 수 있는 사람에게는 끊겨 빠진 행만 걸러진다). 이름은 처음 쓰던 곳("만들기만")에서 왔다.
 *
 * 규칙의 조건은 `accessRuleEntries`(판정)와 같다 — 만든 사람 규칙이 이 data source 에 있고 그 행을 이 사람이 만들었다, 또는 사람 규칙이
 * 있고 그 원천 속성(살아 있는 것)의 이 행 칸에 이 사람이 들었다(6g-3a — 칸의 포함은 필터와 같은 jsonb 포함 연산). 템플릿은 바깥 질의가
 * 이미 뺀다(R1).
 */
export function restrictedRowsSql(access: RowsAccess, params: ParamBag): string | null {
  const scopes = params.bind(access.scopes)
  const user = params.bind(access.userId)
  return `(b.perm_scope_id = ANY(${scopes}::uuid[]) OR ${ruleOpensRowSql(user)})`
}

/**
 * **규칙이 이 사람에게 그 행을 여는가** — 바깥 질의에 `page p` · `block b`(그 행)가 있다고 전제한다. `user` 는 사람 id 의 자리표(`$1` 등).
 * 행 범위(`restrictedRowsSql`)와 인박스의 배달 시점 권한(6h — 정본 §3.8 [보강] 담당 알림 ④)이 함께 쓴다 — 판정(`accessRuleEntries`)과
 * 같은 조건이 한 곳에만 있어야 둘이 어긋나지 않는다. 템플릿은 바깥 질의가 뺀다(R1). 규칙의 레벨은 모두 보기를 품는다.
 */
export function ruleOpensRowSql(user: string): string {
  return `((b.created_by = ${user}::uuid
            AND EXISTS (SELECT 1 FROM page_access_rule ar
                         WHERE ar.data_source_id = p.data_source_id AND ar.source_kind = 'created_by'))
           OR EXISTS (SELECT 1 FROM page_access_rule ar
                        JOIN property apr ON apr.id = ar.source_property_id AND apr.deleted_at IS NULL
                        JOIN page_property_value av ON av.page_id = p.id AND av.property_id = ar.source_property_id
                       WHERE ar.data_source_id = p.data_source_id AND ar.source_kind = 'person_property'
                         AND av.value -> 'people' @> jsonb_build_array(jsonb_build_object('id', ${user}::text))))`
}
