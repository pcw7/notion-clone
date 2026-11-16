/**
 * 공개 API 의 페이지 객체 · property item — 읽기 (API-2 · F-09-01 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 공개 API 투영 규칙(`lifecycle` → `in_trash` · 부모의 모양) · [보강 API-1] ③ ⑤
 *       09-api-integrations.md F-09-17(property item — 제목 · 글 · relation · 사람은 쪽으로 나눈 목록 · 나머지는 하나)
 *
 * 무엇을 보는가는 앱과 같다:
 *   · 페이지 — 살아 있거나 휴지통에 있는(`in_trash`) `type='page'` 블록 · 템플릿 행은 없다(불변식 R1) · 그 사람이 볼 수 있어야 한다
 *     (`effectiveCaps` 의 `view` — 앱의 `getPage` · `readRowPage` 와 같은 판정). 볼 수 없으면 없는 것과 같다(404)
 *   · relation — **볼 수 있는 행만**(대상 표의 행 범위 `rowsAccessForDataSource` + `restrictedRowsSql` — 표 화면과 같은 술어). 대상 표를 열 수
 *     없으면 비어 있다(앱은 개수만 보인다 — 노션처럼 id 를 흘리지 않는다)
 *   · rollup — 표 화면과 같은 `computeRollupsIn`(볼 수 없는 연결은 뺀다) · 수식 — 같은 행의 칸으로(`evaluateRowFormulas`)
 *   · 아이콘 · 커버 — 올린 파일 · 내장 커버는 노션의 모양으로 줄 주소가 없어 null 이다(서명 URL 이 없다 — `file/storage.ts`)
 *   · `public_url` — 이 페이지 자신이 게시돼 열려 있고 그 사람이 게시를 관리할 수 있을 때만(앱의 공유 패널이 토큰을 그 사람에게만 보인다)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { readTitle } from '../block/page.ts'
import { pageIconOfFormat, type PageIcon } from '../block/page-icon.ts'
import { pageCoverOfFormat, type PageCover } from '../block/page-cover.ts'
import type { RichTextRun } from '../contracts/rich-text.ts'
import { ParamBag } from '../database/filter.ts'
import { compileLiveFormulas, evaluateRowFormulas } from '../database/formula-schema.ts'
import { readOptionsOf } from '../database/options.ts'
import { emptyValue, hasOptionRegistry, readRelationConfig, validateCellValue, type CellValue, type SelectOption } from '../database/property-types.ts'
import { computeRollupsIn } from '../database/rollup.ts'
import { restrictedRowsSql, rowsAccessForDataSource } from '../database/row-access.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { readPublishState } from '../publish/public-link.ts'
import {
  apiPropertyId,
  findPropertyById,
  pageTitleToApi,
  propertyValueToApi,
  userRef,
  type ApiProperty,
  type RowValues,
} from './property-values.ts'
import { toApiRichText, type ApiLinks } from './rich-text.ts'
import { encodeCursor } from './v1-protocol.ts'

/** 페이지 객체의 relation 이 싣는 앞쪽 수 — 넘으면 `has_more`(노션의 25 · F-09-17). */
export const PAGE_RELATION_LIMIT = 25

/** 읽은 페이지 — 볼 수 있는 것만 여기까지 온다. */
export type LoadedPage = {
  readonly id: string
  readonly trashed: boolean
  /** 투영 규칙의 부모(노션의 모양). */
  readonly parent: Readonly<Record<string, unknown>>
  readonly title: RichTextRun[]
  readonly icon: PageIcon | null
  readonly cover: PageCover | null
  readonly createdAt: Date
  readonly createdBy: string | null
  readonly lastEditedAt: Date
  readonly lastEditedBy: string | null
  /** 데이터베이스 행이면 그 소스 · 칸. 아니면 null. */
  readonly row: {
    readonly dataSourceId: string
    readonly databaseId: string
    readonly uniqueSeq: number | null
    readonly uniqueIdPrefix: string | null
    readonly cells: Readonly<Record<string, unknown>>
  } | null
}

type PageDbRow = {
  id: string
  lifecycle: string
  parent_type: string
  parent_id: string
  parent_block_type: string | null
  properties: { title?: unknown } | null
  format: Record<string, unknown> | null
  created_at: Date
  created_by: string | null
  last_edited_at: Date
  last_edited_by: string | null
  data_source_id: string | null
  database_id: string | null
  is_template: boolean | null
  unique_seq: string | null
  unique_id_prefix: string | null
  properties_cache: Record<string, unknown> | null
}

/** 투영 규칙의 부모 — 페이지 밑 · 일반 블록 밑(토글 · 열) · 데이터 소스(데이터베이스 id 를 함께) · 최상위(워크스페이스 · teamspace). */
function parentOf(row: PageDbRow): Record<string, unknown> {
  if (row.parent_type === 'data_source') {
    return { type: 'data_source_id', data_source_id: row.parent_id, database_id: row.database_id }
  }
  if (row.parent_type === 'block') {
    return row.parent_block_type === 'page' ? { type: 'page_id', page_id: row.parent_id } : { type: 'block_id', block_id: row.parent_id }
  }
  return { type: 'workspace', workspace: true }
}

/** 페이지 하나 — 볼 수 있는 것만(아니면 null). 휴지통의 페이지도 준다(`in_trash`) · 영구 삭제한 것과 템플릿 행은 없다. */
export async function loadPageIn(tx: Tx, ctx: SessionContext, pageId: string): Promise<LoadedPage | null> {
  const row = await tx.queryMaybe<PageDbRow>(
    `SELECT b.id, b.lifecycle::text AS lifecycle, b.parent_type::text AS parent_type, b.parent_id, pb.type::text AS parent_block_type,
            b.properties, b.format, b.created_at, b.created_by, b.last_edited_at, b.last_edited_by,
            p.data_source_id, ds.owner_database_id AS database_id, p.is_template, p.unique_seq, ds.unique_id_prefix, p.properties_cache
       FROM block b
       LEFT JOIN page p ON p.id = b.id
       LEFT JOIN data_source ds ON ds.id = p.data_source_id
       LEFT JOIN block pb ON b.parent_type = 'block' AND pb.id = b.parent_id
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'page' AND b.lifecycle IN ('live', 'trashed')`,
    [pageId, ctx.workspaceId],
  )
  if (row === null || row.is_template === true) return null
  if (!can(await effectiveCaps(tx, ctx, pageId), 'view')) return null
  return {
    id: row.id,
    trashed: row.lifecycle === 'trashed',
    parent: parentOf(row),
    title: readTitle(row.properties),
    icon: pageIconOfFormat(row.format),
    cover: pageCoverOfFormat(row.format),
    createdAt: row.created_at,
    createdBy: row.created_by,
    lastEditedAt: row.last_edited_at,
    lastEditedBy: row.last_edited_by,
    row:
      row.parent_type === 'data_source' && row.data_source_id !== null && row.database_id !== null
        ? {
            dataSourceId: row.data_source_id,
            databaseId: row.database_id,
            uniqueSeq: row.unique_seq === null ? null : Number(row.unique_seq),
            uniqueIdPrefix: row.unique_id_prefix,
            cells: row.properties_cache ?? {},
          }
        : null,
  }
}

/** 한 소스의 살아 있는 속성 — 스키마 순서. */
export async function readApiProperties(tx: Tx, dataSourceId: string): Promise<ApiProperty[]> {
  return tx.query<ApiProperty>(
    `SELECT id, name, type::text AS type, config FROM property
      WHERE data_source_id = $1 AND deleted_at IS NULL
      ORDER BY order_idx, id`,
    [dataSourceId],
  )
}

/** 옵션을 쓰는 속성의 옵션. */
export async function readApiOptions(tx: Tx, properties: readonly ApiProperty[]): Promise<Map<string, SelectOption[]>> {
  return readOptionsOf(tx, properties.filter((p) => hasOptionRegistry(p.type)).map((p) => p.id))
}

/**
 * 이 칸의 **볼 수 있는** 연결 — 연결한 차례 · `offset` 부터 `limit` 개와 더 있는가. 대상 표를 열 수 없으면 비어 있다. 행 범위의 술어는 표
 * 화면과 같다(`restrictedRowsSql`).
 */
export async function visibleRelationIn(
  tx: Tx,
  ctx: SessionContext,
  rowId: string,
  property: ApiProperty,
  offset: number,
  limit: number,
): Promise<{ readonly ids: string[]; readonly hasMore: boolean }> {
  const config = readRelationConfig(property.config)
  if (config === null) return { ids: [], hasMore: false }
  const access = await rowsAccessForDataSource(tx, ctx, config.target_data_source_id)
  if (access === null) return { ids: [], hasMore: false }
  const params = new ParamBag(6)
  const visible = restrictedRowsSql(access, params) ?? 'FALSE'
  const rows = await tx.query<{ id: string }>(
    `SELECT p.id
       FROM relation_edge e
       JOIN page p ON p.id = e.to_page_id
       JOIN block b ON b.id = p.id
      WHERE e.property_id = $1 AND e.from_page_id = $2
        AND b.workspace_id = $3 AND b.lifecycle = 'live' AND p.is_template = false
        AND ${visible}
      ORDER BY e.order_idx COLLATE "C", p.id
      OFFSET $4 LIMIT $5`,
    [property.id, rowId, ctx.workspaceId, offset, limit + 1, ...params.values],
  )
  return { ids: rows.slice(0, limit).map((r) => r.id), hasMore: rows.length > limit }
}

/** 한 행의 값의 재료 — 이 사람의 권한으로(머리말). */
async function rowValuesIn(
  tx: Tx,
  ctx: SessionContext,
  page: LoadedPage,
  row: NonNullable<LoadedPage['row']>,
  properties: readonly ApiProperty[],
  now: Date,
): Promise<RowValues> {
  const options = await readApiOptions(tx, properties)
  const relations = new Map<string, { ids: string[]; hasMore: boolean }>()
  for (const p of properties) {
    if (p.type === 'relation') relations.set(p.id, await visibleRelationIn(tx, ctx, page.id, p, 0, PAGE_RELATION_LIMIT))
  }
  let rollups: RowValues['rollups'] = null
  if (properties.some((p) => p.type === 'rollup')) {
    const computed = await computeRollupsIn(tx, ctx, row.dataSourceId, [page.id])
    if (computed.ok) rollups = { columns: computed.value.columns, cells: computed.value.values[page.id] ?? {} }
  }
  let formulas: RowValues['formulas'] = {}
  if (properties.some((p) => p.type === 'formula')) {
    const typeOf = new Map(properties.map((p) => [p.id, p.type]))
    const optionNames = new Map<string, string>()
    for (const list of options.values()) for (const o of list) optionNames.set(o.id, o.name)
    formulas = evaluateRowFormulas(compileLiveFormulas(properties), (id) => typeOf.get(id) ?? null, row.cells, (id) => optionNames.get(id) ?? null, { now })
  }
  return {
    cells: row.cells,
    options,
    relations,
    rollups,
    formulas,
    // 고유 ID 의 접두사는 표의 것 · 번호는 행의 것(불변식 C1)
    uniqueId: { prefix: row.uniqueIdPrefix, number: row.uniqueSeq },
    createdTime: page.createdAt,
    createdBy: page.createdBy,
    lastEditedTime: page.lastEditedAt,
    lastEditedBy: page.lastEditedBy,
    now,
  }
}

/** 아이콘 — 이모지 · 외부 주소 · 커스텀 이모지(이름과 함께). 올린 파일은 줄 주소가 없어 null(머리말). */
async function iconToApi(tx: Tx, ctx: SessionContext, icon: PageIcon | null): Promise<unknown> {
  if (icon === null) return null
  switch (icon.type) {
    case 'emoji':
      return { type: 'emoji', emoji: icon.emoji }
    case 'external':
      return { type: 'external', external: { url: icon.url } }
    case 'custom_emoji': {
      const emoji = await tx.queryMaybe<{ name: string }>(
        `SELECT name FROM custom_emoji WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [icon.custom_emoji.id, ctx.workspaceId],
      )
      return { type: 'custom_emoji', custom_emoji: { id: icon.custom_emoji.id, name: emoji?.name ?? null } }
    }
    case 'file':
      return null
  }
}

/** 커버 — 외부 주소만 노션의 모양이 있다. 내장 커버(그라디언트 · 단색)와 올린 파일은 null(머리말). */
function coverToApi(cover: PageCover | null): unknown {
  return cover?.type === 'external' ? { type: 'external', external: { url: cover.url } } : null
}

/** 노션의 페이지 객체(`public_url` 은 부르는 쪽이 채운다). */
export async function pageObjectIn(tx: Tx, ctx: SessionContext, page: LoadedPage, links: ApiLinks, now: Date): Promise<Record<string, unknown>> {
  let properties: Record<string, unknown>
  if (page.row === null) {
    properties = pageTitleToApi(page.title, links)
  } else {
    const schema = await readApiProperties(tx, page.row.dataSourceId)
    const values = await rowValuesIn(tx, ctx, page, page.row, schema, now)
    properties = Object.fromEntries(schema.map((p) => [p.name, propertyValueToApi(p, values, links)]))
  }
  return {
    object: 'page',
    id: page.id,
    created_time: page.createdAt.toISOString(),
    last_edited_time: page.lastEditedAt.toISOString(),
    created_by: page.createdBy === null ? null : userRef(page.createdBy),
    last_edited_by: page.lastEditedBy === null ? null : userRef(page.lastEditedBy),
    cover: coverToApi(page.cover),
    icon: await iconToApi(tx, ctx, page.icon),
    parent: page.parent,
    in_trash: page.trashed,
    properties,
    url: links.pageUrl(page.id),
    public_url: null,
  }
}

/** 게시 주소 — 이 페이지 자신의 게시가 켜져 열려 있고(정책 · 운영자 조치 · 만료) 토큰을 받을 수 있는 사람(관리자)에게만. */
async function publicUrlOf(ctx: SessionContext, pageId: string, links: ApiLinks, now: Date): Promise<string | null> {
  const state = await readPublishState(ctx, pageId)
  if (!state.ok) return null
  const s = state.value
  const open = s.published && s.policyAllows && s.moderation === null && (s.expiresAt === null || Date.parse(s.expiresAt) > now.getTime())
  return open && s.token !== null ? `${links.origin}/p/${s.token}` : null
}

/** `GET /v1/pages/{id}` 의 몸체 — 볼 수 없으면 null. */
export async function readApiPage(ctx: SessionContext, pageId: string, links: ApiLinks): Promise<Record<string, unknown> | null> {
  const now = new Date()
  const read = await withReadTransaction(async (tx) => {
    const page = await loadPageIn(tx, ctx, pageId)
    return page === null ? null : { trashed: page.trashed, json: await pageObjectIn(tx, ctx, page, links, now) }
  })
  if (read === null) return null
  return read.trashed ? read.json : { ...read.json, public_url: await publicUrlOf(ctx, pageId, links, now) }
}

// ── property item ─────────────────────────────────────────────────────

export type PropertyItemWindow = { readonly offset: number; readonly pageSize: number }

export type PropertyItemRead =
  | { readonly ok: true; readonly json: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'page_not_found' | 'property_not_found' }

/** 쪽으로 나눈 목록(노션의 모양) — `items` 는 이 쪽의 값들. */
function itemList(
  id: string,
  type: string,
  items: readonly unknown[],
  window: PropertyItemWindow,
  hasMore: boolean,
  nextUrl: (cursor: string) => string,
): Record<string, unknown> {
  const next = hasMore ? encodeCursor(window.offset + window.pageSize) : null
  return {
    object: 'list',
    results: items.map((value) => ({ object: 'property_item', id, type, [type]: value })),
    next_cursor: next,
    has_more: hasMore,
    type: 'property_item',
    property_item: { id, next_url: next === null ? null : nextUrl(next), type, [type]: {} },
  }
}

/** 배열을 쪽으로 자른다. */
function pageOf<T>(all: readonly T[], window: PropertyItemWindow): { items: T[]; hasMore: boolean } {
  return { items: all.slice(window.offset, window.offset + window.pageSize), hasMore: all.length > window.offset + window.pageSize }
}

/** 저장된 칸을 그 타입으로 — 모양이 아니면 빈 값. */
function cellOf(type: 'title' | 'rich_text' | 'people', raw: unknown): CellValue {
  return (validateCellValue(type, raw).length === 0 ? raw : emptyValue(type)) as CellValue
}

/**
 * `GET /v1/pages/{id}/properties/{property_id}` 의 몸체. 제목 · 글 · relation · 사람은 목록(글 조각 · 연결 · 사람 하나가 항목 하나), 나머지는
 * 항목 하나(rollup 도 하나다 — 노션은 연결로 나누지만 우리는 계산한 값 하나를 준다).
 */
export async function readPropertyItem(
  ctx: SessionContext,
  pageId: string,
  propertyId: string,
  window: PropertyItemWindow,
  links: ApiLinks,
  nextUrl: (cursor: string) => string,
): Promise<PropertyItemRead> {
  const now = new Date()
  return withReadTransaction(async (tx): Promise<PropertyItemRead> => {
    const page = await loadPageIn(tx, ctx, pageId)
    if (page === null) return { ok: false, reason: 'page_not_found' }

    if (page.row === null) {
      if (propertyId !== 'title') return { ok: false, reason: 'property_not_found' }
      const { items, hasMore } = pageOf(toApiRichText(page.title, links), window)
      return { ok: true, json: itemList('title', 'title', items, window, hasMore, nextUrl) }
    }

    const schema = await readApiProperties(tx, page.row.dataSourceId)
    const property = findPropertyById(schema, propertyId)
    if (property === null) return { ok: false, reason: 'property_not_found' }
    const id = apiPropertyId(property)

    if (property.type === 'title' || property.type === 'rich_text') {
      const cell = cellOf(property.type, page.row.cells[property.id])
      const runs = cell.type === 'title' ? cell.title : cell.type === 'rich_text' ? cell.rich_text : []
      const { items, hasMore } = pageOf(toApiRichText(runs, links), window)
      return { ok: true, json: itemList(id, property.type, items, window, hasMore, nextUrl) }
    }
    if (property.type === 'people') {
      const cell = cellOf('people', page.row.cells[property.id])
      const { items, hasMore } = pageOf(cell.type === 'people' ? cell.people.map((p) => userRef(p.id)) : [], window)
      return { ok: true, json: itemList(id, 'people', items, window, hasMore, nextUrl) }
    }
    if (property.type === 'relation') {
      const linked = await visibleRelationIn(tx, ctx, page.id, property, window.offset, window.pageSize)
      return { ok: true, json: itemList(id, 'relation', linked.ids.map((to) => ({ id: to })), window, linked.hasMore, nextUrl) }
    }

    const values = await rowValuesIn(tx, ctx, page, page.row, [property, ...schema.filter((p) => p.id !== property.id)], now)
    const value = propertyValueToApi(property, values, links)
    return { ok: true, json: { object: 'property_item', id, type: property.type, [property.type]: value[property.type] } }
  })
}
