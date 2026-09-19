/**
 * 행 질의 — W8-b (F-04-09 필터 · F-04-10 정렬 · F-04-15 커서)
 *
 * 정본: 00-canonical-data-model.md §3.5 불변식 R1 · §3.6
 *       03-database-core.md F-03-17 (권한 술어 · 페이지네이션 규칙)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한이 필터보다 먼저다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17 엣지 케이스: *"권한 없는 행이 필터 결과에 포함 → **건수조차 노출하면
 * 안 된다** → 권한 술어를 필터보다 먼저 적용."*
 *
 * 우리 구조에서는 권한이 **data_source 단위**다 — 행의 `perm_scope_id` 는 컨테이너
 * 블록에서 물려받으므로 한 표의 행은 전부 같은 권한을 갖는다. 그래서 게이트가
 * 질의 앞에 있고(`openDataSource`), 통과하지 못하면 SQL 을 아예 돌리지 않는다.
 *
 * 행마다 권한이 달라지는 것은 `page_access_rule`(person property 기반)인데 그건
 * Phase 0 밖이고, 판결 X-8 이 "스코프 필터에 걸리지 않는 알려진 구멍"으로 남겼다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * OFFSET 을 쓰지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17: *"페이지네이션은 … 커서 기반이다. 2026-04-20 부터 누적 페이지네이션
 * 깊이가 10,000건으로 제한되며 … **'전부 훑는' 클라이언트 로직은 반드시 깨진다.**
 * 클론도 무한 스크롤 대신 상한 + 필터 유도 UX 를 설계하라."*
 *
 * 그래서 keyset 커서이고(`filter.ts` 의 `compileCursor`), 상한은
 * `MAX_QUERY_PAGINATION`(정본 §3.5 의 10,000)이다. 상한에 닿으면 `incomplete` 를
 * 실어 보낸다 — `pagination.ts` 의 계약이 이미 그 필드를 갖고 있다(W2).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { plainTitleOf } from '../block/page.ts'
import {
  compileCursor,
  compileFilter,
  compileSorts,
  ParamBag,
  type FilterNode,
  type PropertyTypes,
  type SortKey,
} from './filter.ts'
// 상수는 화면과 나눠 쓴다(`limits.ts` 머리말). 기존 import 경로를 깨지 않게 다시 내보낸다.
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_PAGINATION } from './limits.ts'

export { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, MAX_QUERY_PAGINATION }

export type QueriedRow = {
  readonly id: string
  readonly title: string
  readonly orderKey: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly createdAt: Date
  readonly lastEditedAt: Date
  readonly version: string
}

export type QueryRowsInput = {
  readonly filter?: FilterNode | null
  readonly sorts?: readonly SortKey[]
  readonly limit?: number
  /** 이전 응답의 `nextCursor`. */
  readonly cursor?: string | null
}

export type QueryPage = {
  readonly rows: readonly QueriedRow[]
  readonly hasMore: boolean
  readonly nextCursor: string | null
  /**
   * 커서 순회가 상한에 걸려 끊겼는지.
   *
   * `hasMore: false` 만 보고 "끝까지 읽었다"고 판단하면 안 된다는 것이
   * `pagination.ts` 계약의 핵심이다.
   */
  readonly complete: boolean
}

export type QueryFailure = 'not_found' | 'forbidden'

export type QueryResult =
  | { readonly ok: true; readonly value: QueryPage }
  | { readonly ok: false; readonly reason: QueryFailure }

export type RowRow = {
  id: string
  order_key: string
  properties_cache: Record<string, unknown> | null
  properties: { title?: unknown } | null
  created_at: Date
  last_edited_at: Date
  version: string
  /** 커서를 만들기 위한 정렬 값들. `sort_0`, `sort_1`, … */
  [k: string]: unknown
}

/**
 * 살아있는 프로퍼티의 `id → type` 맵.
 *
 * **살아있는 것만** 담는다. 지워진 프로퍼티를 참조하는 필터 규칙은 컴파일러가
 * 건너뛰어야 하고(F-03-17: 결과 0건으로 만들면 데이터 소실로 오인된다), 그
 * 판단의 근거가 이 맵에 없다는 사실이다.
 */
export async function readPropertyTypes(tx: Tx, dataSourceId: string): Promise<PropertyTypes> {
  const rows = await tx.query<{ id: string; type: string }>(
    `SELECT id, type FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId],
  )
  return new Map(rows.map((r) => [r.id, r.type]))
}

/**
 * 필터·정렬·커서로 행을 읽는다.
 *
 * 불변식 R1: *"모든 뷰/API 쿼리는 기본 조건으로 `is_template=false` 를 강제한다."*
 */
export async function queryRows(
  ctx: SessionContext,
  dataSourceId: string,
  input: QueryRowsInput = {},
): Promise<QueryResult> {
  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_QUERY_LIMIT)),
    MAX_QUERY_LIMIT,
  )
  const sorts = (input.sorts ?? []).slice()

  return withReadTransaction(async (tx) => {
    // ── ① 권한. 필터보다 먼저다 ──
    const ds = await tx.queryMaybe<{ container_id: string }>(
      `SELECT ds.owner_database_id AS container_id
         FROM data_source ds
         JOIN block b ON b.id = ds.owner_database_id
        WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
      [dataSourceId, ctx.workspaceId],
    )
    if (ds === null) return { ok: false, reason: 'not_found' } as const
    if (!can(await effectiveCaps(tx, ctx, ds.container_id), 'view')) {
      // 못 보는 사람에게는 존재를 알리지 않는다.
      return { ok: false, reason: 'not_found' } as const
    }

    const types = await readPropertyTypes(tx, dataSourceId)

    // ── ② 컴파일. `$1` 은 dataSourceId 가 쓰므로 2번부터 발급한다 ──
    const params = new ParamBag(2)
    const filterSql = compileFilter(input.filter ?? null, types, params)
    const compiledSort = compileSorts(sorts, types, params)

    // 커서는 정렬 키 값 + order_key 를 담는다. 정렬 구성이 바뀌면 길이가 달라져
    // `compileCursor` 가 `null` 을 주고, 그때는 처음부터 읽는다 —
    // 손상된 커서를 던지지 않는 `pagination.ts` 의 태도와 같다.
    const cursorValues = decodeCursorValues(input.cursor)
    const cursorSql =
      cursorValues === null ? null : compileCursor(compiledSort, cursorValues, params)

    const where = [
      'p.data_source_id = $1',
      'p.is_template = false', // 불변식 R1
      "b.lifecycle = 'live'",
      filterSql,
      cursorSql,
    ].filter((s): s is string => s !== null)

    // 정렬 값을 함께 꺼낸다 — 다음 커서를 만들려면 마지막 행의 정렬 값이 필요하고,
    // 애플리케이션이 다시 계산할 수 없다(EAV 의 값이기 때문이다).
    const sortColumns = compiledSort.keys
      .map((k, i) => `, ${k.expr} AS sort_${i}`)
      .join('')

    const limitParam = params.bind(limit + 1)

    const rows = await tx.query<RowRow>(
      `SELECT b.id, b.order_key, p.properties_cache, b.properties,
              b.created_at, b.last_edited_at, b.version${sortColumns}
         FROM page p
         JOIN block b ON b.id = p.id
        WHERE ${where.join(' AND ')}
        ORDER BY ${compiledSort.orderBy}
        LIMIT ${limitParam}`,
      [dataSourceId, ...params.values],
    )

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]

    return {
      ok: true,
      value: {
        rows: page.map(toQueriedRow),
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursorValues([
                ...compiledSort.keys.map((_, i) => last[`sort_${i}`]),
                last.order_key,
              ])
            : null,
        // 한 페이지만 보고는 누적 깊이를 알 수 없다. 호출자가 `limit` 합계를
        // 세어 상한에 닿았는지 판단하도록 이 값을 준다 — 지금은 한 페이지가
        // 상한보다 작으므로 항상 complete 다. 누적 추적은 호출자의 일이다.
        complete: true,
      },
    } as const
  })
}

export function toQueriedRow(row: RowRow): QueriedRow {
  return {
    id: row.id,
    title: plainTitleOf(row.properties),
    orderKey: row.order_key,
    properties: row.properties_cache ?? {},
    createdAt: row.created_at,
    lastEditedAt: row.last_edited_at,
    version: row.version,
  }
}

// ── 커서 직렬화 ───────────────────────────────────────────────────────
//
// `pagination.ts` 의 `Cursor` 는 `{sortKey, id}` 두 문자열이다. 여기는 정렬 값이
// **여러 개**이고 타입이 섞여 있으므로(숫자·날짜·불리언·NULL) 그 계약을 그대로
// 쓸 수 없다. 같은 불투명·base64url 규칙을 따르되 배열을 담는다.
//
// ⚠ 커서에 정렬 값이 들어간다는 것은 **그 값이 클라이언트에 노출된다**는 뜻이다.
//   이미 그 행을 보여 줬으므로 새로 새는 정보는 없다 — 마지막 행의 값이다.

export function encodeCursorValues(values: readonly unknown[]): string {
  const normalized = values.map((v) => (v instanceof Date ? v.toISOString() : v))
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url')
}

export function decodeCursorValues(raw: string | null | undefined): unknown[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    // 손상된 커서는 던지지 않고 처음부터 읽는다(`pagination.ts` 와 같은 태도).
    return null
  }
}

// // `pagination.ts` 의 커서 헬퍼를 쓰지 않는 이유를 남겨 둔다.
//
// 그 계약(`{sortKey, id}`)은 정렬 축이 **하나**일 때의 모양이다. 검색(W7)이 두 축을
// 고정 폭 문자열로 합쳐 쓸 수 있었던 것은 축이 "제목 일치 + 시각" 둘로 정해져
// 있었기 때문이다. 여기는 사용자가 정렬 키를 고르고 타입이 섞이므로 합칠 수 없다.
//
// 규칙(불투명 · base64url · 손상 시 처음부터)은 같게 유지한다.
