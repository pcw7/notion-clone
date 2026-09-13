/**
 * 뷰 — W8-b (F-04-01 Table · F-04-12 표시 프로퍼티 · F-04-09/10 저장된 필터·정렬)
 *
 * 정본: 00-canonical-data-model.md §3.6 (`view` · `view_property`,
 *       불변식 VW1~VW3 · V1 · V2) · 판결 C-6
 *       03-database-core.md F-03-17 (뷰는 1급 API 리소스다)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 뷰는 공유 상태다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-03-17 엣지 케이스: *"동시편집 중 다른 사용자가 필터를 바꿈 → **뷰 설정은 공유
 * 상태다.** 내 화면의 행 집합이 갑자기 변한다."*
 *
 * 그래서 필터를 고치는 권한은 셀을 고치는 권한과 다르다. `edit_structure` 를
 * 묻는다 — 정본 §3.3 의 database 매트릭스에서 `edit_content` **레벨**은
 * `edit_structure` 를 주지 않으므로, "값은 고치지만 **모두가 보는 표의 모양**은
 * 못 고치는 사람"이 데이터로 표현된다. 스키마 변경과 같은 무게다.
 *
 * 개인 뷰(`owner_user_id`)는 그 구분이 필요 없지만 MVP 에 없다 — 컬럼만 있다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * `view_property` 는 뷰가 아는 컬럼마다 **행이 있다**
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본의 `visible boolean NOT NULL DEFAULT false` 가 그 모델을 가리킨다 — 행이
 * 있고 기본은 꺼짐이므로, 보여 줄 컬럼은 **명시적으로** `true` 인 행을 갖는다.
 *
 * 그래서 두 곳에서 행을 만든다:
 *   · `createView` — 그 시점의 살아있는 프로퍼티 전부
 *   · `addProperty` — 그 data_source 의 **모든 뷰**에 한 행씩
 *
 * 두 번째가 팬아웃이지만 뷰 수는 한 줌이고, 이렇게 하면 "컬럼을 추가했는데 표에
 * 안 보인다"가 없어진다. 대안(행이 없으면 보이는 것으로 치기)은 순서 키가 두
 * 공간으로 갈라져서(`view_property.order_idx` vs `property.order_idx`) 컬럼 정렬이
 * 설명 불가능해진다.
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { withTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { orderKeyBetween } from '../block/order-key.ts'
import {
  MAX_SORT_KEYS,
  validateFilter,
  validateSorts,
  type FilterNode,
  type SortKey,
} from './filter.ts'
import { readPropertyTypes } from './query.ts'
import {
  isMvpPropertyType,
  isOptionColor,
  type MvpPropertyType,
  type SelectOption,
} from './property-types.ts'
import type { ValidationIssue } from '../contracts/rich-text.ts'

/** MVP 가 만드는 뷰 타입. 정본의 `type` 은 10종이지만 Table 하나로 제품이 성립한다. */
export const MVP_VIEW_TYPES = ['table'] as const
export type MvpViewType = (typeof MVP_VIEW_TYPES)[number]

export const DEFAULT_VIEW_NAME = '표'
export const MAX_VIEW_NAME_LENGTH = 200
/** 정본의 `load_limit` CHECK 과 같은 범위. */
export const MIN_LOAD_LIMIT = 1
export const MAX_LOAD_LIMIT = 200

export type ViewColumn = {
  readonly propertyId: string
  readonly name: string
  readonly type: MvpPropertyType
  readonly visible: boolean
  readonly orderKey: string
  readonly width: number | null
  readonly wrap: boolean
  /**
   * select 컬럼의 옵션 목록(`order_idx` 순). 다른 타입은 빈 배열이다.
   *
   * 셀은 **옵션 id** 만 들고 있어서(`property-types.ts` 머리말) 이것 없이는 화면이
   * 이름을 그릴 수 없다. 컬럼에 싣는 이유는 `GET /rows` 가 컬럼과 행을 한 왕복에
   * 주는 것과 같다 — 옵션을 따로 읽으면 표를 열 때마다 왕복이 하나 더 는다.
   */
  readonly options: readonly SelectOption[]
}

export type ViewDetail = {
  readonly id: string
  readonly databaseId: string
  readonly dataSourceId: string
  readonly name: string
  readonly type: string
  readonly orderKey: string
  readonly filter: FilterNode | null
  readonly sorts: readonly SortKey[]
  readonly loadLimit: number
  /** 스키마 순서가 아니라 **뷰 순서**다. 숨긴 컬럼도 들어 있다(화면이 거른다). */
  readonly columns: readonly ViewColumn[]
}

export type ViewSummary = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly orderKey: string
}

export type ViewFailure =
  | 'not_found'
  | 'forbidden'
  | 'invalid_name'
  | 'unsupported_type'
  | 'invalid_filter'
  | 'invalid_sorts'
  | 'last_view'
  /** 제목 컬럼은 숨길 수 없다(F-04-12). */
  | 'title_required'

export type ViewResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly reason: ViewFailure
      readonly issues?: readonly ValidationIssue[]
    }

const fail = (reason: ViewFailure, issues?: readonly ValidationIssue[]): ViewResult<never> =>
  issues === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, issues } as const)

function isFailure<T>(v: T | ViewResult<never>): v is ViewResult<never> {
  return typeof v === 'object' && v !== null && 'ok' in v
}

// ── 게이트 ────────────────────────────────────────────────────────────

type DatabaseGate = { databaseId: string; dataSourceId: string }

/**
 * 데이터베이스를 열고 권한을 본다.
 *
 * ACL 은 **컨테이너 블록**에 걸린다(`database.id` = `block.id`, X-2). `data_source`
 * 에는 ACL 이 없다 — 같은 표의 행은 전부 같은 권한이라는 전제가 거기서 온다.
 */
async function openDatabase(
  tx: Tx,
  ctx: SessionContext,
  databaseId: string,
  need: 'view' | 'edit_structure',
): Promise<DatabaseGate | ViewResult<never>> {
  const row = await tx.queryMaybe<{ data_source_id: string }>(
    `SELECT ds.id AS data_source_id
       FROM database d
       JOIN block b ON b.id = d.id
       JOIN data_source ds ON ds.owner_database_id = d.id
      WHERE d.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
      ORDER BY ds.created_at
      LIMIT 1`,
    [databaseId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')

  const caps = await effectiveCaps(tx, ctx, databaseId)
  if (!can(caps, 'view')) return fail('not_found')
  if (need === 'edit_structure' && !can(caps, 'edit_structure')) return fail('forbidden')

  return { databaseId, dataSourceId: row.data_source_id }
}

/** 뷰 id 로 열고 권한을 본다. 뷰가 어느 DB 의 것인지는 뷰 행이 안다. */
async function openView(
  tx: Tx,
  ctx: SessionContext,
  viewId: string,
  need: 'view' | 'edit_structure',
): Promise<(DatabaseGate & { viewId: string }) | ViewResult<never>> {
  const row = await tx.queryMaybe<{ database_id: string }>(
    `SELECT v.database_id
       FROM view v
       JOIN block b ON b.id = v.database_id
      WHERE v.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live'
        AND v.owner_kind = 'database_view'`,
    [viewId, ctx.workspaceId],
  )
  if (row === null) return fail('not_found')

  const gate = await openDatabase(tx, ctx, row.database_id, need)
  if (isFailure(gate)) return gate
  return { ...gate, viewId }
}

function normalizeName(raw: unknown, fallback: string): string | null {
  if (raw === undefined) return fallback
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_VIEW_NAME_LENGTH) return null
  return name
}

// ── 읽기 ──────────────────────────────────────────────────────────────

type ViewRow = {
  id: string
  database_id: string
  data_source_id: string
  name: string | null
  type: string
  order_idx: string
  filter: unknown
  sorts: unknown
  load_limit: number
}

/**
 * 뷰의 컬럼 목록.
 *
 * `view_property` 와 `property` 를 조인한다. **살아있는 프로퍼티만** 나온다 —
 * soft delete 된 컬럼의 `view_property` 행은 남아 있지만(복원하면 설정이 돌아온다)
 * 화면에 그려서는 안 된다.
 *
 * 정렬은 `view_property.order_idx` 다 — 뷰마다 컬럼 순서가 다를 수 있고, 그것이
 * 스키마 순서(`property.order_idx`)와 별개라는 것이 C-6 의 요점이다.
 */
async function readColumns(tx: Tx, viewId: string): Promise<ViewColumn[]> {
  const rows = await tx.query<{
    property_id: string
    name: string
    type: string
    visible: boolean
    order_idx: string
    width: number | null
    wrap: boolean
  }>(
    `SELECT vp.property_id, p.name, p.type::text AS type,
            vp.visible, vp.order_idx, vp.width, vp.wrap
       FROM view_property vp
       JOIN property p ON p.id = vp.property_id
      WHERE vp.view_id = $1 AND p.deleted_at IS NULL
      ORDER BY vp.order_idx, vp.property_id`,
    [viewId],
  )

  const selectIds = rows.filter((r) => r.type === 'select').map((r) => r.property_id)
  const optionRows =
    selectIds.length === 0
      ? []
      : await tx.query<{ property_id: string; id: string; name: string; color: string }>(
          `SELECT property_id, id, name, color::text AS color
             FROM select_option
            WHERE property_id = ANY($1::text[])
            ORDER BY order_idx, id`,
          [selectIds],
        )
  const optionsOf = new Map<string, SelectOption[]>()
  for (const o of optionRows) {
    const list = optionsOf.get(o.property_id) ?? []
    list.push({ id: o.id, name: o.name, color: isOptionColor(o.color) ? o.color : 'default' })
    optionsOf.set(o.property_id, list)
  }

  return rows
    .filter((r) => isMvpPropertyType(r.type))
    .map((r) => ({
      propertyId: r.property_id,
      name: r.name,
      type: r.type as MvpPropertyType,
      visible: r.visible,
      orderKey: r.order_idx,
      width: r.width,
      wrap: r.wrap,
      options: optionsOf.get(r.property_id) ?? [],
    }))
}

async function readView(tx: Tx, viewId: string): Promise<ViewDetail | null> {
  const row = await tx.queryMaybe<ViewRow>(
    `SELECT v.id, v.database_id, v.data_source_id, v.name, v.type, v.order_idx,
            v.filter, v.sorts, v.load_limit
       FROM view v WHERE v.id = $1`,
    [viewId],
  )
  if (row === null) return null
  return {
    id: row.id,
    databaseId: row.database_id,
    dataSourceId: row.data_source_id,
    name: row.name ?? DEFAULT_VIEW_NAME,
    type: row.type,
    orderKey: row.order_idx,
    // 저장된 AST 를 그대로 준다. 검증은 쓰기 경로에서 이미 했고, 읽기에서
    // 다시 검증하면 상한을 낮추는 날 기존 뷰가 열리지 않는다(정본 §3.5).
    filter: (row.filter as FilterNode | null) ?? null,
    sorts: Array.isArray(row.sorts) ? (row.sorts as SortKey[]) : [],
    loadLimit: row.load_limit,
    columns: await readColumns(tx, viewId),
  }
}

export async function getView(ctx: SessionContext, viewId: string): Promise<ViewResult<ViewDetail>> {
  return withReadTransaction(async (tx) => {
    const gate = await openView(tx, ctx, viewId, 'view')
    if (isFailure(gate)) return gate
    const view = await readView(tx, viewId)
    return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
  })
}

/**
 * 이 데이터베이스의 뷰 탭.
 *
 * 불변식 VW2: *"`owner_kind='layout_tab'` 인 뷰는 DB 뷰 탭 목록에 노출되지 않는다."*
 * 그래서 `owner_kind = 'database_view'` 를 건다 — 마이그레이션 0015 의 부분 인덱스가
 * 정확히 이 질의의 모양이다.
 */
export async function listViews(
  ctx: SessionContext,
  databaseId: string,
): Promise<ViewResult<ViewSummary[]>> {
  return withReadTransaction(async (tx) => {
    const gate = await openDatabase(tx, ctx, databaseId, 'view')
    if (isFailure(gate)) return gate

    const rows = await tx.query<{ id: string; name: string | null; type: string; order_idx: string }>(
      `SELECT id, name, type, order_idx FROM view
        WHERE database_id = $1 AND owner_kind = 'database_view'
        ORDER BY order_idx, id`,
      [databaseId],
    )
    return {
      ok: true,
      value: rows.map((r) => ({
        id: r.id,
        name: r.name ?? DEFAULT_VIEW_NAME,
        type: r.type,
        orderKey: r.order_idx,
      })),
    } as const
  })
}

// ── 생성 ──────────────────────────────────────────────────────────────

export type CreateViewInput = {
  readonly name?: string
  readonly type?: MvpViewType
}

/**
 * 뷰를 만든다. 그 시점의 살아있는 프로퍼티 전부를 **보이는 컬럼**으로 시딩한다.
 *
 * 시딩하지 않으면 `visible` 기본값이 `false` 라 **컬럼이 하나도 없는 표**가 나온다.
 */
export async function createView(
  ctx: SessionContext,
  databaseId: string,
  input: CreateViewInput = {},
): Promise<ViewResult<ViewDetail>> {
  const name = normalizeName(input.name, DEFAULT_VIEW_NAME)
  if (name === null) return fail('invalid_name')

  const type = input.type ?? 'table'
  if (!MVP_VIEW_TYPES.includes(type)) return fail('unsupported_type')

  return withTransaction(async (tx) => {
    const gate = await openDatabase(tx, ctx, databaseId, 'edit_structure')
    if (isFailure(gate)) return gate

    const last = await tx.queryMaybe<{ order_idx: string }>(
      `SELECT order_idx FROM view
        WHERE database_id = $1 AND owner_kind = 'database_view'
        ORDER BY order_idx DESC LIMIT 1`,
      [databaseId],
    )

    const viewId = randomUUID()
    await tx.query(
      `INSERT INTO view (id, owner_kind, database_id, data_source_id, name, type, order_idx,
                         configuration, created_at, updated_at)
       VALUES ($1, 'database_view', $2, $3, $4, $5, $6, '{}'::jsonb, now(), now())`,
      [viewId, databaseId, gate.dataSourceId, name, type, orderKeyBetween(last?.order_idx ?? null, null)],
    )

    await seedViewProperties(tx, viewId, gate.dataSourceId)

    const view = await readView(tx, viewId)
    return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
  })
}

/**
 * 이 뷰에 그 data_source 의 살아있는 프로퍼티를 전부 넣는다(보이는 상태로).
 *
 * 컬럼 순서는 **스키마 순서를 물려받는다** — 새 뷰가 기존 표와 같은 순서로 보이는
 * 편이 예측 가능하다. 그 뒤로는 뷰마다 따로 움직인다(C-6).
 */
async function seedViewProperties(tx: Tx, viewId: string, dataSourceId: string): Promise<void> {
  await tx.query(
    `INSERT INTO view_property (view_id, property_id, visible, order_idx)
     SELECT $1, p.id, true, p.order_idx
       FROM property p
      WHERE p.data_source_id = $2 AND p.deleted_at IS NULL
     ON CONFLICT (view_id, property_id) DO NOTHING`,
    [viewId, dataSourceId],
  )
}

/**
 * 프로퍼티가 추가될 때 그 data_source 의 **모든 뷰**에 컬럼을 넣는다.
 *
 * `property.ts` 의 `addProperty` 와 `restoreProperty` 가 부른다. 이것이 없으면
 * "컬럼을 추가했는데 표에 안 보인다" 가 된다 — `visible` 기본값이 `false` 이고
 * 행이 없으면 `readColumns` 의 조인에서 빠지기 때문이다.
 *
 * 맨 뒤에 붙인다. 뷰마다 마지막 키가 다르므로 뷰별로 계산한다.
 */
export async function addPropertyToViews(
  tx: Tx,
  dataSourceId: string,
  propertyId: string,
): Promise<void> {
  const views = await tx.query<{ id: string; last: string | null }>(
    `SELECT v.id,
            (SELECT max(vp.order_idx) FROM view_property vp WHERE vp.view_id = v.id) AS last
       FROM view v WHERE v.data_source_id = $1`,
    [dataSourceId],
  )
  for (const view of views) {
    await tx.query(
      `INSERT INTO view_property (view_id, property_id, visible, order_idx)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (view_id, property_id) DO UPDATE SET visible = true`,
      [view.id, propertyId, orderKeyBetween(view.last, null)],
    )
  }
}

// ── 수정 ──────────────────────────────────────────────────────────────

export type UpdateViewInput = {
  readonly name?: string
  /** `null` 을 주면 필터를 없앤다. 생략하면 그대로 둔다. */
  readonly filter?: FilterNode | null
  readonly sorts?: readonly SortKey[]
  readonly loadLimit?: number
}

/**
 * 뷰 설정을 고친다.
 *
 * 필터·정렬은 **쓰기 경로에서 검증한다**(정본 §3.5: 읽기에 걸면 상한을 낮출 때
 * 기존 뷰가 통째로 안 열린다). 검증에 쓰는 타입 맵은 `readPropertyTypes` 가
 * 살아있는 프로퍼티만 담아 주므로, 지워진 컬럼으로 규칙을 **새로 만드는** 것은
 * 여기서 막힌다.
 */
export async function updateView(
  ctx: SessionContext,
  viewId: string,
  input: UpdateViewInput,
): Promise<ViewResult<ViewDetail>> {
  const name = input.name === undefined ? undefined : normalizeName(input.name, DEFAULT_VIEW_NAME)
  if (input.name !== undefined && name === null) return fail('invalid_name')

  if (
    input.loadLimit !== undefined &&
    (!Number.isInteger(input.loadLimit) ||
      input.loadLimit < MIN_LOAD_LIMIT ||
      input.loadLimit > MAX_LOAD_LIMIT)
  ) {
    return fail('invalid_sorts')
  }

  return withTransaction(async (tx) => {
    const gate = await openView(tx, ctx, viewId, 'edit_structure')
    if (isFailure(gate)) return gate

    const types = await readPropertyTypes(tx, gate.dataSourceId)

    if (input.filter !== undefined && input.filter !== null) {
      const issues = validateFilter(input.filter, types)
      if (issues.length > 0) return fail('invalid_filter', issues)
    }
    if (input.sorts !== undefined) {
      const issues = validateSorts(input.sorts, types)
      if (issues.length > 0) return fail('invalid_sorts', issues)
    }

    await tx.query(
      `UPDATE view
          SET name = coalesce($2, name),
              -- filter 는 null 로 **지울 수 있어야** 하므로 coalesce 로 접으면
              -- 안 된다. "안 보냈다"와 "없애라"를 구분한다.
              filter = CASE WHEN $3::boolean THEN $4::jsonb ELSE filter END,
              sorts = CASE WHEN $5::boolean THEN $6::jsonb ELSE sorts END,
              load_limit = coalesce($7, load_limit),
              updated_at = now()
        WHERE id = $1`,
      [
        viewId,
        name ?? null,
        input.filter !== undefined,
        input.filter === undefined || input.filter === null ? null : JSON.stringify(input.filter),
        input.sorts !== undefined,
        input.sorts === undefined ? null : JSON.stringify(input.sorts),
        input.loadLimit ?? null,
      ],
    )

    const view = await readView(tx, viewId)
    return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
  })
}

// ── 컬럼 ──────────────────────────────────────────────────────────────

export type SetColumnInput = {
  readonly visible?: boolean
  /** `null` 을 주면 자동 폭으로 돌린다. */
  readonly width?: number | null
  readonly wrap?: boolean
}

/**
 * 컬럼 하나의 표시 설정을 고친다.
 *
 * 불변식 V1: *"순서 변경은 반드시 **단일 행 UPDATE**. 배열이면 'A는 폭, B는 순서'가
 * 전체 LWW 로 충돌한다."* 그래서 이 함수는 한 행만 만진다 — 두 사람이 다른 컬럼을
 * 각각 고치는 것이 서로를 지우지 않는다.
 */
export async function setViewColumn(
  ctx: SessionContext,
  viewId: string,
  propertyId: string,
  input: SetColumnInput,
): Promise<ViewResult<ViewDetail>> {
  if (input.width !== undefined && input.width !== null && !(Number.isInteger(input.width) && input.width > 0)) {
    return fail('invalid_sorts')
  }

  return withTransaction(async (tx) => {
    const gate = await openView(tx, ctx, viewId, 'edit_structure')
    if (isFailure(gate)) return gate

    const existing = await tx.queryMaybe<{ type: string }>(
      `SELECT p.type::text AS type
         FROM view_property vp JOIN property p ON p.id = vp.property_id
        WHERE vp.view_id = $1 AND vp.property_id = $2 AND p.deleted_at IS NULL`,
      [viewId, propertyId],
    )
    if (existing === null) return fail('not_found')
    // F-04-12 엣지 케이스: *"title 프로퍼티 숨김 시도 → 거부(페이지 진입 경로 상실)."*
    // 행을 여는 길이 제목 칸이고, 모든 컬럼을 숨긴 표에서도 제목 열은 남아야 한다
    // (F-04-02: "모든 프로퍼티 숨김 → title 열만 남음"). 화면이 메뉴를 숨기는 것과
    // 별개로 여기서 막는다 — API 로 직접 부르면 화면의 규칙은 없다.
    if (input.visible === false && existing.type === 'title') return fail('title_required')

    await tx.query(
      `UPDATE view_property
          SET visible = coalesce($3, visible),
              width = CASE WHEN $4::boolean THEN $5 ELSE width END,
              wrap = coalesce($6, wrap)
        WHERE view_id = $1 AND property_id = $2`,
      [
        viewId,
        propertyId,
        input.visible ?? null,
        input.width !== undefined,
        input.width ?? null,
        input.wrap ?? null,
      ],
    )

    const view = await readView(tx, viewId)
    return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
  })
}

/**
 * 컬럼을 `beforeId` 앞으로 옮긴다. `null` 이면 맨 뒤로.
 *
 * `moveProperty`(스키마 순서)와 **별개 축**이다 — 뷰마다 컬럼 순서가 다를 수 있다는
 * 것이 C-6 의 요점이고, 같은 함수로 묶으면 한 뷰에서 옮긴 것이 전부에 퍼진다.
 */
export async function moveViewColumn(
  ctx: SessionContext,
  viewId: string,
  propertyId: string,
  beforeId: string | null,
): Promise<ViewResult<ViewDetail>> {
  return withTransaction(async (tx) => {
    const gate = await openView(tx, ctx, viewId, 'edit_structure')
    if (isFailure(gate)) return gate

    const columns = await readColumns(tx, viewId)
    if (!columns.some((c) => c.propertyId === propertyId)) return fail('not_found')
    if (beforeId !== null && !columns.some((c) => c.propertyId === beforeId)) return fail('not_found')

    // 자기 앞으로 옮기기는 아무 일도 아니다 — `moveProperty` 에서 같은 버그를
    // 겪었다(자신을 목록에서 빼면 `findIndex` 가 -1 이 되어 맨 앞으로 날아간다).
    if (beforeId === propertyId) {
      const view = await readView(tx, viewId)
      return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
    }

    const others = columns.filter((c) => c.propertyId !== propertyId)
    const at = beforeId === null ? others.length : others.findIndex((c) => c.propertyId === beforeId)
    const prev = at > 0 ? (others[at - 1]?.orderKey ?? null) : null
    const next = at < others.length ? (others[at]?.orderKey ?? null) : null

    await tx.query(
      `UPDATE view_property SET order_idx = $3 WHERE view_id = $1 AND property_id = $2`,
      [viewId, propertyId, orderKeyBetween(prev, next)],
    )

    const view = await readView(tx, viewId)
    return view === null ? fail('not_found') : ({ ok: true, value: view } as const)
  })
}

// ── 삭제 ──────────────────────────────────────────────────────────────

/**
 * 뷰를 지운다. `view_property` 는 CASCADE 로 함께 사라진다.
 *
 * **마지막 뷰는 지울 수 없다.** 뷰가 없는 데이터베이스는 화면에 그릴 것이 없고,
 * 그 상태를 만들면 사용자가 표를 되살릴 방법이 없다. 노션도 마지막 뷰 삭제를 막는다.
 */
export async function deleteView(ctx: SessionContext, viewId: string): Promise<ViewResult<null>> {
  return withTransaction(async (tx) => {
    const gate = await openView(tx, ctx, viewId, 'edit_structure')
    if (isFailure(gate)) return gate

    const count = await tx.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM view
        WHERE database_id = $1 AND owner_kind = 'database_view'`,
      [gate.databaseId],
    )
    if (Number(count.n) <= 1) return fail('last_view')

    await tx.query(`DELETE FROM view WHERE id = $1`, [viewId])
    return { ok: true, value: null } as const
  })
}

/** 정렬 키 상한을 화면이 읽을 수 있게 다시 내보낸다. */
export { MAX_SORT_KEYS }
