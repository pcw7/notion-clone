/**
 * DB 행 · 셀 쓰기 — W8-a (F-03-16)
 *
 * 정본: 00-canonical-data-model.md §3.5 (`page` · `page_property_value`,
 *       불변식 R1~R4 · C1~C3) · 판결 C-3 (DB 행은 block 의 행) · X-4 (셀은 CRDT 밖)
 *       · X-6 (셀 쓰기는 `block.version` 을 올리는 3번째 쓰기자)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 행을 만드는 것은 블록을 만드는 것이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 판결 C-3: **DB 행은 `block` 테이블의 행이다.** `row_page` 같은 별도 엔티티를
 * 만들지 않는다(CLAUDE.md 절대 제약 3). 그래서 행 생성은
 * `block`(type='page', parent_type='data_source') + `page` 두 INSERT 이고,
 * 마이그레이션 0013 의 R3 트리거가 그 쌍이 어긋나는 것을 막는다.
 *
 * 순서는 `block.order_key` 이고 삭제는 `block.lifecycle` 이다 — `page` 표에
 * `order_idx`·`deleted_at` 이 **없는** 이유(R4).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제목의 정본은 EAV 이고, `block.properties.title` 은 투영이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 행의 제목은 `title` 타입 프로퍼티의 **셀 값**이다. 그런데 블록 제목을 읽는
 * 코드가 이미 여럿이다 — breadcrumb(`listAncestors`) · 최근 방문 · 검색 색인
 * (`search_document.title_text`) · 페이지 화면. 그것들은 전부
 * `block.properties.title` 을 본다.
 *
 * 그래서 **셀을 쓸 때 `block.properties.title` 로 투영한다.** 방향은 한쪽뿐이다:
 *
 *   page_property_value(title 프로퍼티)  ──투영──▶  block.properties.title
 *
 * 반대 방향은 없다. 그래서 `renamePage()` 를 DB 행에 부르면 투영이 어긋나므로
 * 그 함수가 DB 행을 **거부한다**(`page.ts` 의 가드).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 사이드카는 같은 트랜잭션, 같은 문장에서 쓴다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본: *"정렬/필터/인덱싱용 사이드카. value 에서 파생, **같은 트랜잭션에서
 * 동시 갱신**."* 파생 규칙은 `property-types.ts` 의 `deriveSidecars()` 하나뿐이고
 * 이 파일은 그것을 부른다 — 규칙을 두 벌로 만들면 "정렬은 맞는데 필터는 틀린"
 * 구간이 생긴다.
 *
 * `properties_cache` 와 `search_tsv` 는 **쓰지 않는다.** 마이그레이션 0014 의
 * 트리거가 쓴다(불변식 R2). 여기서 쓰면 정본이 둘이 된다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import { titleFromPlainText } from '../block/page.ts'
import { toPlainText, type ValidationIssue } from '../contracts/rich-text.ts'
import {
  deriveSidecars,
  emptyValue,
  isMvpPropertyType,
  validateCellValue,
  type CellValue,
  type MvpPropertyType,
} from './property-types.ts'

/** 한 번에 읽는 행 수. 뷰의 "더 보기"는 W8-b 다. */
export const DEFAULT_ROW_LIMIT = 50
export const MAX_ROW_LIMIT = 200

export type RowCell = {
  readonly propertyId: string
  readonly value: CellValue
}

export type RowSummary = {
  readonly id: string
  /** `title` 프로퍼티 셀의 평문. 없으면 빈 문자열(화면이 "제목 없음"을 고른다). */
  readonly title: string
  readonly orderKey: string
  /** `properties_cache` 를 그대로 준다 — 트리거가 유지하는 읽기 모델이다. */
  readonly properties: Readonly<Record<string, unknown>>
  readonly createdAt: Date
  readonly lastEditedAt: Date
  /** `block.version` [X-6]. 낙관적 잠금에 쓴다. */
  readonly version: string
}

export type RowFailure =
  | 'not_found'
  | 'forbidden'
  | 'schema_conflict'
  | 'unknown_property'
  /** 읽기 전용 프로퍼티는 셀을 쓸 수 없다(F-03-16 엣지 케이스). */
  | 'readonly_property'
  | 'invalid_value'
  | 'version_conflict'

export type RowResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: RowFailure
      readonly issues?: readonly ValidationIssue[]
      readonly currentVersion?: string
    }

// ── 스키마 · 권한 ─────────────────────────────────────────────────────

type PropertyMeta = { id: string; type: string; writable: string; order_idx: string }

type DataSourceGate = {
  dataSourceId: string
  containerId: string
  schemaVersion: string
  properties: Map<string, PropertyMeta>
  titlePropertyId: string | null
}

/**
 * data_source 를 열고 권한과 스키마를 함께 읽는다.
 *
 * 셀 쓰기는 **`edit_content`** 를 묻는다. 스키마 변경(`edit_structure`)과 다른
 * capability 이고, 정본 §3.3 의 database 매트릭스가 그 둘을 갈라 놓은 이유가
 * "값은 고치지만 컬럼은 못 고치는 사람"이다(`property.ts` 머리말 참조).
 */
async function openDataSource(
  tx: Tx,
  ctx: SessionContext,
  dataSourceId: string,
  need: 'view' | 'edit_content' | 'create_child',
): Promise<DataSourceGate | RowResult<never>> {
  const ds = await tx.queryMaybe<{ id: string; container_id: string; schema_version: string }>(
    `SELECT ds.id, ds.owner_database_id AS container_id, ds.schema_version
       FROM data_source ds
       JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'`,
    [dataSourceId, ctx.workspaceId],
  )
  if (ds === null) return { ok: false, reason: 'not_found' } as const

  const caps = await effectiveCaps(tx, ctx, ds.container_id)
  if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
  if (need !== 'view' && !can(caps, need)) return { ok: false, reason: 'forbidden' } as const

  const rows = await tx.query<PropertyMeta>(
    `SELECT id, type, writable, order_idx FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL`,
    [dataSourceId],
  )
  return {
    dataSourceId,
    containerId: ds.container_id,
    schemaVersion: ds.schema_version,
    properties: new Map(rows.map((r) => [r.id, r])),
    titlePropertyId: rows.find((r) => r.type === 'title')?.id ?? null,
  }
}

function isFailure<T>(v: T | RowResult<never>): v is RowResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

// ── 셀 쓰기 ───────────────────────────────────────────────────────────

type PreparedCell = {
  readonly propertyId: string
  readonly value: CellValue
  readonly sidecars: ReturnType<typeof deriveSidecars>
}

/**
 * 셀들을 검증하고 사이드카를 파생한다. **쓰기 전에 전부 검사한다.**
 *
 * 하나씩 검사하며 쓰면 세 번째 셀이 틀렸을 때 앞의 둘이 이미 들어가 있다 —
 * 트랜잭션이 되돌리지만, 그 경로를 두면 "부분 적용"이 언제 가능한지를 따져야
 * 한다. 전부 통과한 뒤에만 쓴다.
 */
function prepareCells(
  gate: DataSourceGate,
  cells: readonly RowCell[],
): PreparedCell[] | RowResult<never> {
  const prepared: PreparedCell[] = []
  const issues: ValidationIssue[] = []

  for (const cell of cells) {
    const meta = gate.properties.get(cell.propertyId)
    if (meta === undefined) return { ok: false, reason: 'unknown_property' } as const

    // F-03-16: *"읽기 전용 프로퍼티 편집 시도 → 편집 모드 진입 차단."* 화면이
    // 막는 것과 별개로 서버가 막는다 — 화면만 막으면 API 로 우회된다.
    if (meta.writable === 'readonly') return { ok: false, reason: 'readonly_property' } as const

    // 불변식 C1: 자동 메타 4종과 unique_id 는 이 표에 행을 만들지 않는다.
    //            block/page 에서 투영하므로 쓰려는 것 자체가 잘못이다.
    // 불변식 C2: relation 은 relation_edge 가 정본이다.
    if (!isMvpPropertyType(meta.type)) return { ok: false, reason: 'unknown_property' } as const

    const type = meta.type as MvpPropertyType
    const found = validateCellValue(type, cell.value, `cells.${cell.propertyId}`)
    if (found.length > 0) {
      issues.push(...found)
      continue
    }
    prepared.push({
      propertyId: cell.propertyId,
      value: cell.value,
      sidecars: deriveSidecars(cell.value),
    })
  }

  if (issues.length > 0) return { ok: false, reason: 'invalid_value', issues } as const
  return prepared
}

async function writeCells(tx: Tx, rowId: string, cells: readonly PreparedCell[]): Promise<void> {
  for (const cell of cells) {
    await tx.query(
      `INSERT INTO page_property_value (
         page_id, property_id, value,
         num_value, text_value, date_start, date_end, bool_value,
         filled_by, updated_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 'user', now())
       ON CONFLICT (page_id, property_id) DO UPDATE SET
         value      = EXCLUDED.value,
         num_value  = EXCLUDED.num_value,
         text_value = EXCLUDED.text_value,
         date_start = EXCLUDED.date_start,
         date_end   = EXCLUDED.date_end,
         bool_value = EXCLUDED.bool_value,
         filled_by  = EXCLUDED.filled_by,
         updated_at = now()`,
      [
        rowId,
        cell.propertyId,
        JSON.stringify(cell.value),
        cell.sidecars.num,
        cell.sidecars.text,
        cell.sidecars.dateStart,
        cell.sidecars.dateEnd,
        cell.sidecars.bool,
      ],
    )
  }
}

/**
 * `title` 셀을 `block.properties.title` 로 투영한다.
 *
 * 머리말의 한쪽 방향 규칙. 이 투영이 없으면 행 페이지를 열었을 때 제목이
 * 비어 있고, breadcrumb·최근 방문·검색 색인이 전부 빈 제목을 본다.
 */
async function projectTitle(
  tx: Tx,
  rowId: string,
  cells: readonly PreparedCell[],
  titlePropertyId: string | null,
): Promise<void> {
  if (titlePropertyId === null) return
  const titleCell = cells.find((c) => c.propertyId === titlePropertyId)
  if (titleCell === undefined) return

  const plain = titleCell.value.type === 'title' ? toPlainText(titleCell.value.title) : ''
  await tx.query(
    `UPDATE block SET properties = jsonb_set(properties, '{title}', $2::jsonb, true) WHERE id = $1`,
    [rowId, JSON.stringify(titleFromPlainText(plain))],
  )
}

/**
 * `block.version` 을 올린다 — X-6 의 쓰기자 ②(셀/relation/derived 쓰기).
 *
 * `search_document.version` 의 소스이고, 그 값이 오르지 않으면 색인이 이 행을
 * "안 바뀐 것"으로 본다.
 */
async function bumpRow(tx: Tx, ctx: SessionContext, rowId: string): Promise<string> {
  const row = await tx.queryOne<{ version: string }>(
    `UPDATE block SET version = version + 1, last_edited_by = $2, last_edited_at = now()
      WHERE id = $1 RETURNING version`,
    [rowId, ctx.userId],
  )
  return row.version
}

// ── 행 생성 ───────────────────────────────────────────────────────────

export type CreateRowInput = {
  readonly cells?: readonly RowCell[]
  /** 주면 낙관적 잠금이 된다 — 낡은 스키마로 쓰는 것을 막는다. */
  readonly expectedSchemaVersion?: string
}

/**
 * 행을 만든다. **맨 뒤**에 붙는다.
 *
 * `create_child` 를 묻는다. 정본 §3.3 의 database 매트릭스에 `create` 레벨이
 * 따로 있는 이유가 이것이다 — 폼 제출처럼 "내용은 못 보면서 행만 추가"하는
 * 경우가 있다(규칙 A2 가 경계하는 그 지점).
 *
 * ⚠ 지금은 그 레벨을 데이터베이스 노드에 **직접 부여할 수 없다**(HANDOFF §7 —
 *   `resolveCaps` 가 대상 종류를 'page' 로 고정한다). 상속받은 `edit`·
 *   `full_access` 에는 `create_child` 가 들어 있으므로 정상 동작한다.
 */
export async function createRow(
  ctx: SessionContext,
  dataSourceId: string,
  input: CreateRowInput = {},
): Promise<RowResult<RowSummary>> {
  return withTransaction(async (tx) => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'create_child')
    if (isFailure(gate)) return gate

    if (
      input.expectedSchemaVersion !== undefined &&
      input.expectedSchemaVersion !== gate.schemaVersion
    ) {
      return { ok: false, reason: 'schema_conflict', currentVersion: gate.schemaVersion } as const
    }

    const prepared = prepareCells(gate, input.cells ?? [])
    if (isFailure(prepared)) return prepared

    const rowId = randomUUID()
    const container = await tx.queryOne<{ ancestor_path: string[]; perm_scope_id: string }>(
      `SELECT ancestor_path, perm_scope_id FROM block WHERE id = $1`,
      [gate.containerId],
    )

    // 형제 중 마지막 키. data_source 직속 형제만 본다(`parent_id = dataSourceId`).
    const last = await tx.queryMaybe<{ order_key: string }>(
      `SELECT order_key FROM block WHERE parent_id = $1 ORDER BY order_key DESC LIMIT 1`,
      [dataSourceId],
    )

    await tx.query(
      `INSERT INTO block (
         id, workspace_id, type, parent_type, parent_id, order_key,
         ancestor_path, perm_scope_id, properties, format,
         created_by, created_at, last_edited_by, last_edited_at
       ) VALUES (
         $1, $2, 'page', 'data_source', $3, $4,
         $5, $6, '{}'::jsonb, '{}'::jsonb,
         $7, now(), $7, now()
       )`,
      [
        rowId,
        ctx.workspaceId,
        dataSourceId,
        orderKeyBetween(last?.order_key ?? null, null),
        // 컨테이너의 경로에 컨테이너 자신을 이어 붙인다 [X-7]. data_source 는
        // 블록이 아니므로 경로에 들어가지 않는다 — 경로는 block id 배열이다.
        [...container.ancestor_path, gate.containerId],
        container.perm_scope_id,
        ctx.userId,
      ],
    )
    // R3 트리거가 이 쌍을 검사한다(type · parent_type · data_source_id 일치).
    await tx.query(`INSERT INTO page (id, data_source_id) VALUES ($1, $2)`, [rowId, dataSourceId])

    if (prepared.length > 0) {
      await writeCells(tx, rowId, prepared)
      await projectTitle(tx, rowId, prepared, gate.titlePropertyId)
    }

    const summary = await readRow(tx, rowId)
    if (summary === null) return { ok: false, reason: 'not_found' } as const
    return { ok: true, value: summary } as const
  })
}

// ── 셀 수정 ───────────────────────────────────────────────────────────

export type UpdateCellsInput = {
  readonly cells: readonly RowCell[]
  readonly expectedSchemaVersion?: string
  /**
   * 클라이언트가 읽었을 때의 `block.version`.
   *
   * 주면 낙관적 잠금이 된다. 생략하면 LWW 다 — F-03-16 이 *"여러 사용자가 동일
   * 셀 동시 편집 → 셀 단위 잠금 없이 LWW"* 라고 한 기본값이다.
   */
  readonly expectedVersion?: string
}

export async function updateCells(
  ctx: SessionContext,
  rowId: string,
  input: UpdateCellsInput,
): Promise<RowResult<RowSummary>> {
  return withTransaction(async (tx) => {
    // 행을 잠근다. 같은 행의 셀을 동시에 쓰면 `properties_cache` 재생성이
    // 겹치는데, 잠금이 있으면 순서가 정해져 마지막 재생성이 전부를 본다.
    const row = await tx.queryMaybe<{ data_source_id: string; version: string }>(
      `SELECT p.data_source_id, b.version
         FROM page p
         JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
        FOR UPDATE OF b`,
      [rowId, ctx.workspaceId],
    )
    if (row === null) return { ok: false, reason: 'not_found' } as const

    const gate = await openDataSource(tx, ctx, row.data_source_id, 'edit_content')
    if (isFailure(gate)) return gate

    if (
      input.expectedSchemaVersion !== undefined &&
      input.expectedSchemaVersion !== gate.schemaVersion
    ) {
      return { ok: false, reason: 'schema_conflict', currentVersion: gate.schemaVersion } as const
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
      return { ok: false, reason: 'version_conflict', currentVersion: row.version } as const
    }

    const prepared = prepareCells(gate, input.cells)
    if (isFailure(prepared)) return prepared

    if (prepared.length > 0) {
      await writeCells(tx, rowId, prepared)
      await projectTitle(tx, rowId, prepared, gate.titlePropertyId)
      await bumpRow(tx, ctx, rowId)
    }

    const summary = await readRow(tx, rowId)
    if (summary === null) return { ok: false, reason: 'not_found' } as const
    return { ok: true, value: summary } as const
  })
}

/**
 * 셀을 비운다.
 *
 * **행을 지우지 않는다.** 빈 값으로 덮어쓴다 — 타입별로 "비어 있다"의 모양이
 * 다르므로(`emptyValue`) 행을 지우는 것과 다르다. 특히 `checkbox` 는 빈 값이
 * `false` 라서 행을 지우면 `equals false` 필터에서 빠진다.
 */
export async function clearCell(
  ctx: SessionContext,
  rowId: string,
  propertyId: string,
): Promise<RowResult<RowSummary>> {
  return withReadTransaction(async (tx) => {
    const meta = await tx.queryMaybe<{ type: string }>(
      `SELECT pr.type
         FROM page p
         JOIN block b ON b.id = p.id
         JOIN property pr ON pr.data_source_id = p.data_source_id AND pr.id = $2
        WHERE p.id = $1 AND b.workspace_id = $3 AND pr.deleted_at IS NULL`,
      [rowId, propertyId, ctx.workspaceId],
    )
    if (meta === null) return { ok: false, reason: 'not_found' } as const
    if (!isMvpPropertyType(meta.type)) return { ok: false, reason: 'unknown_property' } as const
    return { type: meta.type }
  }).then((pre) =>
    isFailure(pre)
      ? pre
      : updateCells(ctx, rowId, {
          cells: [{ propertyId, value: emptyValue(pre.type as MvpPropertyType) }],
        }),
  )
}

// ── 조회 ──────────────────────────────────────────────────────────────

type RowRow = {
  id: string
  order_key: string
  properties_cache: Record<string, unknown> | null
  properties: { title?: unknown } | null
  created_at: Date
  last_edited_at: Date
  version: string
}

function toRowSummary(row: RowRow): RowSummary {
  const raw = row.properties?.title
  return {
    id: row.id,
    // 투영된 제목을 읽는다. 정본은 EAV 이지만 평문 제목이 필요한 곳은 많고
    // 그때마다 셀을 조인할 이유가 없다(투영의 목적이 그것이다).
    title: Array.isArray(raw)
      ? raw
          .map((r) =>
            typeof r === 'object' && r !== null
              ? String((r as { plain_text?: unknown }).plain_text ?? '')
              : '',
          )
          .join('')
      : '',
    orderKey: row.order_key,
    properties: row.properties_cache ?? {},
    createdAt: row.created_at,
    lastEditedAt: row.last_edited_at,
    version: row.version,
  }
}

async function readRow(tx: Tx, rowId: string): Promise<RowSummary | null> {
  const row = await tx.queryMaybe<RowRow>(
    `SELECT b.id, b.order_key, p.properties_cache, b.properties,
            b.created_at, b.last_edited_at, b.version
       FROM page p JOIN block b ON b.id = p.id
      WHERE p.id = $1`,
    [rowId],
  )
  return row === null ? null : toRowSummary(row)
}

export type ListRowsInput = {
  readonly limit?: number
  /** 마지막으로 읽은 행의 `orderKey`. keyset 커서다. */
  readonly after?: string | null
}

/**
 * 행을 `order_key` 순으로 읽는다.
 *
 * 불변식 R1: *"모든 뷰/API 쿼리는 기본 조건으로 `is_template=false` 를 강제한다."*
 * 템플릿 행이 섞이면 사용자가 만든 적 없는 행이 표에 나타난다.
 *
 * 정렬·필터는 W8-b(뷰)의 일이다. 여기는 스키마 순서 그대로다.
 */
export async function listRows(
  ctx: SessionContext,
  dataSourceId: string,
  input: ListRowsInput = {},
): Promise<RowResult<{ rows: RowSummary[]; hasMore: boolean; nextCursor: string | null }>> {
  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_ROW_LIMIT)),
    MAX_ROW_LIMIT,
  )

  return withReadTransaction(async (tx) => {
    const gate = await openDataSource(tx, ctx, dataSourceId, 'view')
    if (isFailure(gate)) return gate

    const rows = await tx.query<RowRow>(
      `SELECT b.id, b.order_key, p.properties_cache, b.properties,
              b.created_at, b.last_edited_at, b.version
         FROM page p
         JOIN block b ON b.id = p.id
        WHERE p.data_source_id = $1
          AND p.is_template = false            -- 불변식 R1
          AND b.lifecycle = 'live'
          AND ($2::text IS NULL OR b.order_key COLLATE "C" > $2::text COLLATE "C")
        ORDER BY b.order_key COLLATE "C"
        LIMIT $3`,
      [dataSourceId, input.after ?? null, limit + 1],
    )

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(toRowSummary)
    return {
      ok: true,
      value: {
        rows: page,
        hasMore,
        nextCursor: hasMore ? (page[page.length - 1]?.orderKey ?? null) : null,
      },
    } as const
  })
}

// ── 삭제 ──────────────────────────────────────────────────────────────

/**
 * 행을 휴지통으로 보낸다.
 *
 * 행은 `type='page'` 블록이므로 `lifecycle` 축을 그대로 쓴다(X-3). 셀은
 * 건드리지 않는다 — 복원하면 값이 돌아와야 한다.
 *
 * `trash.ts` 의 `trashPage` 를 쓰지 않는 이유: 그 함수는 **페이지 트리**의
 * 삭제 루트·자손 개수를 계산하는데, DB 행에는 자손이 없고 "삭제 루트"도
 * 자기 자신뿐이다. 빌려 쓰면 그 함수가 행까지 신경 쓰게 된다.
 */
export async function trashRow(ctx: SessionContext, rowId: string): Promise<RowResult<null>> {
  return withTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ data_source_id: string }>(
      `SELECT p.data_source_id
         FROM page p JOIN block b ON b.id = p.id
        WHERE p.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
        FOR UPDATE OF b`,
      [rowId, ctx.workspaceId],
    )
    if (row === null) return { ok: false, reason: 'not_found' } as const

    const gate = await openDataSource(tx, ctx, row.data_source_id, 'edit_content')
    if (isFailure(gate)) return gate

    await tx.query(
      `UPDATE block
          SET lifecycle = 'trashed', trashed_at = now(), trashed_by = $2,
              trash_root_id = id, trash_reason = 'user',
              purge_after = now() + make_interval(days => (
                SELECT trash_days FROM workspace WHERE id = $3)),
              last_edited_by = $2, last_edited_at = now(), version = version + 1
        WHERE id = $1`,
      [rowId, ctx.userId, ctx.workspaceId],
    )
    return { ok: true, value: null } as const
  })
}
