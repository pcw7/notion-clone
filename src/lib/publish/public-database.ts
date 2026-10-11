/**
 * 공개 표 · 공개 행의 속성 — 게시된 데이터베이스를 읽기 전용으로 (게시 · 공유 6a-2c-1 · F-06-08 · F-13-08)
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [정정] 웹 게시 ⑫ · [보강] 공개 화면 ⑩
 *       마스터 §5.3 *"공개 렌더러는 앱 렌더러와 분리된 읽기 전용 SSR. 내부 조회 함수 재사용 금지"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 자기 질의 · 순수 부품만 함께 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 앱의 행 질의(`queryRows`)는 `SessionContext` 로 권한을 묻는다 — 공개 방문자는 그것이 없다. 이 파일은 판정(`resolvePublicPageIn`)을
 * 지난 뒤 자기 질의로 읽는다. 필터 · 정렬의 SQL 은 순수 컴파일러(`compileFilter` · `compileSorts`)를 앱과 함께 쓴다 — 같은 뷰가 앱과
 * 공개 화면에서 같은 행을 같은 순서로 보인다.
 *
 * **무엇을 보이나** — 그 데이터베이스가 소유한 data source 의 첫 뷰(탭 순서)의 **공유** 필터 · 정렬(개인 것은 방문자에게 없다) ·
 * 보이는 열. 행은 공개 경로가 여는 것만(정본 ③ — `live` · 템플릿 아님 · 막는 모더레이션 없음 · 상속이 끊기지 않음). 처음
 * `PUBLIC_TABLE_MAX_ROWS` 줄까지(넘으면 `truncated`). 하위 항목은 펴지 않고 평평하게 둔다.
 *
 * **열은 값이 행에 있는 타입만** — 제목 · 글 · 숫자 · 선택 · 상태 · 체크박스 · 날짜 · 고유 ID. 관계형(대상이 공개인지를 따로 물어야
 * 한다) · 롤업 · 수식(읽을 때 계산 — 보는 사람의 권한이 든다) · 버튼(누를 수 없다)은 그리지 않는다. 수식으로 거르는 뷰는 그 캐시가
 * 낡을 수 있다(공개 경로는 캐시를 채우지 않는다 — 앱에서 누군가 그 표를 열면 채워진다).
 */

import { readTitle } from '../block/page.ts'
import { pageIconOfFormat, type PageIcon } from '../block/page-icon.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import { compileFilter, compileSorts, formulaTypeKey, NO_VIEWER, ParamBag, type FilterNode, type SortKey } from '../database/filter.ts'
import type { Tx } from '../db/tx.ts'
import type { PublicTarget } from './public-access.ts'

/** 공개 화면이 그리는 열의 타입 — 값이 행(`properties_cache`)에 있는 것. */
export const PUBLIC_CELL_TYPES = ['title', 'rich_text', 'number', 'select', 'status', 'checkbox', 'date', 'unique_id'] as const
export type PublicCellType = (typeof PUBLIC_CELL_TYPES)[number]

/** 공개 표의 줄 상한 — 넘으면 `truncated`(공개 화면은 페이지를 넘기지 않는다 · v1). */
export const PUBLIC_TABLE_MAX_ROWS = 100

export type PublicOption = { readonly id: string; readonly name: string; readonly color: string }

export type PublicColumn = {
  readonly id: string
  readonly name: string
  readonly type: PublicCellType
  /** 선택 · 상태의 옵션(순서대로). 다른 타입은 빈 배열. */
  readonly options: readonly PublicOption[]
  /** 고유 ID 의 접두사(그 data source 의 것). */
  readonly prefix: string | null
}

export type PublicRow = {
  readonly id: string
  readonly title: readonly RichTextRun[]
  readonly icon: PageIcon | null
  /** 셀 값 — 속성 id → 값(`properties_cache` 그대로 · 보이는 공개 열의 것만). */
  readonly cells: Readonly<Record<string, unknown>>
  readonly uniqueSeq: number | null
}

export type PublicTable = {
  readonly viewName: string
  readonly columns: readonly PublicColumn[]
  readonly rows: readonly PublicRow[]
  /** 줄 상한에 걸려 더 있다. */
  readonly truncated: boolean
}

/** 공개 행의 속성 묶음 — 스키마 순서 · 행 레이아웃이 숨긴 것 빼고 · 제목 빼고(제목은 머리다). */
export type PublicRowProperties = {
  readonly columns: readonly PublicColumn[]
  readonly cells: Readonly<Record<string, unknown>>
  readonly uniqueSeq: number | null
}

const PUBLIC_SET: ReadonlySet<string> = new Set(PUBLIC_CELL_TYPES)
const isPublicType = (type: string): type is PublicCellType => PUBLIC_SET.has(type)

type ColumnRow = { property_id: string; name: string; type: string; unique_id_prefix: string | null }

/**
 * 루트가 데이터베이스이고 그 데이터베이스를 여는 공개 화면의 표. 아니면 null. 부르는 쪽이 같은 트랜잭션에서 판정(`resolvePublicPageIn`)을
 * 지났다 — 이 함수는 판정을 다시 하지 않고 **행마다의 공개 조건**만 건다.
 */
export async function readPublicTableIn(tx: Tx, target: PublicTarget): Promise<PublicTable | null> {
  if (target.pageId !== target.rootId) return null
  const root = await tx.queryMaybe<{ type: string }>(`SELECT type FROM block WHERE id = $1`, [target.rootId])
  if (root?.type !== 'database') return null

  // 소유한 data source 의 첫 뷰 — 붙인 소스(linked)는 다른 데이터베이스의 행이다(그 데이터베이스는 게시되지 않았다)
  const view = await tx.queryMaybe<{ id: string; name: string | null; data_source_id: string; filter: unknown; sorts: unknown }>(
    `SELECT v.id, v.name, v.data_source_id, v.filter, v.sorts
       FROM view v
       JOIN data_source ds ON ds.id = v.data_source_id
      WHERE v.database_id = $1 AND v.owner_kind = 'database_view' AND ds.owner_database_id = $1 AND ds.lifecycle = 'live'
      ORDER BY v.order_idx, v.id
      LIMIT 1`,
    [target.rootId],
  )
  if (view === null) return { viewName: '', columns: [], rows: [], truncated: false }

  const columns = await publicColumns(
    tx,
    await tx.query<ColumnRow>(
      `SELECT vp.property_id, p.name, p.type::text AS type, ds.unique_id_prefix
         FROM view_property vp
         JOIN property p ON p.id = vp.property_id
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE vp.view_id = $1 AND vp.visible AND p.deleted_at IS NULL
        ORDER BY vp.order_idx, vp.property_id`,
      [view.id],
    ),
  )

  const types = await propertyTypes(tx, view.data_source_id)
  // `$1` 은 data source — 2번부터 발급한다
  const params = new ParamBag(2)
  // 공개 화면은 보는 사람이 없다 — "나"(6g-2c)는 아무도 아니다(포함은 0행 · 포함하지 않음은 모든 행)
  const filterSql = compileFilter((view.filter as FilterNode | null) ?? null, types, params, NO_VIEWER)
  const sorted = compileSorts(Array.isArray(view.sorts) ? (view.sorts as SortKey[]) : [], types, params)
  const limit = params.bind(PUBLIC_TABLE_MAX_ROWS + 1)
  const rows = await tx.query<{
    id: string
    properties: Record<string, unknown> | null
    format: Record<string, unknown> | null
    properties_cache: Record<string, unknown> | null
    unique_seq: string | null
  }>(
    `SELECT b.id, b.properties, b.format, p.properties_cache, p.unique_seq
       FROM page p
       JOIN block b ON b.id = p.id
      WHERE p.data_source_id = $1 AND ${OPENABLE_ROW}${filterSql === null ? '' : ` AND ${filterSql}`}
      ORDER BY ${sorted.orderBy}
      LIMIT ${limit}`,
    [view.data_source_id, ...params.values],
  )

  const shown = rows.slice(0, PUBLIC_TABLE_MAX_ROWS)
  return {
    viewName: view.name ?? '',
    columns,
    rows: shown.map((row) => ({
      id: row.id,
      title: readTitle(row.properties),
      icon: pageIconOfFormat(row.format),
      cells: pick(row.properties_cache, columns),
      uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq),
    })),
    truncated: rows.length > PUBLIC_TABLE_MAX_ROWS,
  }
}

/**
 * 공개로 연 페이지가 데이터베이스의 행이면 그 속성 묶음. 아니면 null. 판정은 부르는 쪽이 지났다(템플릿 · 휴지통의 행은 판정이 이미
 * 닫는다 — `chainOpens`).
 */
export async function readPublicRowPropertiesIn(tx: Tx, target: PublicTarget): Promise<PublicRowProperties | null> {
  const row = await tx.queryMaybe<{ data_source_id: string; properties_cache: Record<string, unknown> | null; unique_seq: string | null }>(
    `SELECT data_source_id, properties_cache, unique_seq FROM page WHERE id = $1`,
    [target.pageId],
  )
  if (row === null) return null
  // 행 레이아웃이 숨긴 속성(8f-2) — 앱의 행 화면과 같다
  const columns = await publicColumns(
    tx,
    await tx.query<ColumnRow>(
      `SELECT p.id AS property_id, p.name, p.type::text AS type, ds.unique_id_prefix
         FROM property p
         JOIN data_source ds ON ds.id = p.data_source_id
        WHERE p.data_source_id = $1 AND p.deleted_at IS NULL AND p.type::text <> 'title'
          AND NOT EXISTS (SELECT 1 FROM layout_module m JOIN layout_tab t ON t.id = m.tab_id AND t.kind = 'content'
                           WHERE m.data_source_id = p.data_source_id AND m.kind = 'property' AND m.property_id = p.id AND m.visible = false)
        ORDER BY p.order_idx, p.id`,
      [row.data_source_id],
    ),
  )
  return { columns, cells: pick(row.properties_cache, columns), uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq) }
}

/**
 * 공개 경로가 여는 행 — 정본 [정정] 웹 게시 ③ 의 사슬 조건을 행 하나에 건 것(데이터베이스 루트의 조건은 판정이 이미 봤다). `chainOpens` 와
 * 같은 답이어야 한다 — 표에 선 행을 누르면 열려야 하고, 열리지 않는 행이 표에 서면 안 된다.
 */
const OPENABLE_ROW = `p.is_template = false
        AND b.lifecycle = 'live'
        AND b.moderation_state NOT IN ('restricted', 'taken_down')
        AND NOT EXISTS (SELECT 1 FROM block_acl_meta m WHERE m.node_id = b.id AND m.inherits_from_parent = false)`

/** 공개 타입의 열만 · 선택 · 상태의 옵션을 붙여. */
async function publicColumns(tx: Tx, rows: readonly ColumnRow[]): Promise<PublicColumn[]> {
  const kept = rows.filter((r) => isPublicType(r.type))
  const optionIds = kept.filter((r) => r.type === 'select' || r.type === 'status').map((r) => r.property_id)
  const options =
    optionIds.length === 0
      ? []
      : await tx.query<{ property_id: string; id: string; name: string; color: string }>(
          `SELECT property_id, id, name, color::text AS color FROM select_option WHERE property_id = ANY($1::text[]) ORDER BY property_id, order_idx, id`,
          [optionIds],
        )
  return kept.map((r) => ({
    id: r.property_id,
    name: r.name,
    type: r.type as PublicCellType,
    options: options.filter((o) => o.property_id === r.property_id).map((o) => ({ id: o.id, name: o.name, color: o.color })),
    prefix: r.type === 'unique_id' ? r.unique_id_prefix : null,
  }))
}

/** 필터 · 정렬 컴파일러의 입력 — 속성 id → 타입(수식은 결과 타입과 함께 · 앱의 `readPropertyTypes` 와 같은 모양). */
async function propertyTypes(tx: Tx, dataSourceId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await tx.query<{ id: string; type: string; result_type: string | null }>(
    `SELECT id, type::text AS type, config ->> 'result_type' AS result_type FROM property WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId],
  )
  return new Map(rows.map((r) => [r.id, r.type === 'formula' ? formulaTypeKey(r.result_type ?? '') : r.type]))
}

/** 보이는 공개 열의 값만 — 캐시의 다른 칸(숨긴 열 · 그리지 않는 타입)은 싣지 않는다. */
function pick(cache: Record<string, unknown> | null, columns: readonly PublicColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    const value = cache?.[column.id]
    if (value !== undefined) out[column.id] = value
  }
  return out
}
