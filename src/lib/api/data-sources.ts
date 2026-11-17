/**
 * 공개 API 의 데이터베이스 · 데이터 소스 · 질의 — `GET /v1/databases/{id}` · `GET /v1/data_sources/{id}` · `POST /v1/data_sources/{id}/query`
 * (API-4 · F-09-01 · F-09-04 · F-09-16 · F-09-17)
 *
 * 정본: 00-canonical-data-model.md §3.1 공개 API 투영 규칙 · [보강 API-1] ③ ④ ⑤ ⑧ · §3.5 data source(DS1~DS3 · 규칙 A4)
 *
 * 권한은 앱의 문 그대로다 — 권한 SQL 을 여기서 쓰지 않는다:
 *   · 데이터베이스 · 데이터 소스를 여는 문은 표를 여는 문(`effectiveCaps` + `canOpenDatabase` — 볼 수 있거나 "만들기만")이고, 데이터 소스는
 *     **그 소스를 소유한 데이터베이스**의 능력으로 묻는다(규칙 A4 — 소스에는 ACL 이 없다 · 붙인 소스로 권한이 오르지 않는다). 못 열면 404
 *   · 데이터베이스의 `data_sources` 는 살아 있는 것 중 부르는 사람이 열 수 있는 것만(붙인 소스는 원본을 볼 수 있을 때만 — `readDataSources`)
 *   · 질의는 앱의 행 질의(`queryRows`)를 지난다 — 권한 술어(`rowsAccessIn` · `restrictedRowsSql`)가 필터보다 먼저 · keyset 커서 · 10,000 상한
 *     (`MAX_QUERY_PAGINATION`). 볼 수 없는 행은 소리 없이 빠진다(개수도 새지 않는다 — F-09-16). 노션의 DSL 은 `query-dsl.ts` 가 앱의 필터
 *     트리로 옮긴다
 *   · 내보내기 정책(`allow_export`)을 끄면 소유자만(페이지 · 블록과 같은 게이트 — 내용을 돌려준다)
 *
 * id 가 다른 종류면 — 데이터 소스 주소에 데이터베이스 id(노션 `2025-09-03` 의 가장 흔한 실수)는 404 `object_not_found` 에 "그 데이터베이스의
 * `data_sources[].id` 를 쓰라" 를 붙인다(그 데이터베이스를 열 수 있을 때만 — 아니면 그냥 404). 반대도 같다. 페이지 · 블록 id 는 그냥 404.
 *
 * 데이터 소스가 하나뿐인 데이터베이스는 그 소스의 이름이 데이터베이스의 제목이다(앱의 화면과 같다 — `data-source.ts` 머리말 "이름").
 * 구조 고치기(데이터베이스 · 데이터 소스 만들기 · 고치기)는 이 조각에 없다 — 400 `validation_error` 로 "앱에서 고친다" 를 말한다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf, readTitle } from '../block/page.ts'
import { readPageCover } from '../block/page-cover.ts'
import { readPageIcon } from '../block/page-icon.ts'
import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { readDataSources } from '../database/data-source.ts'
import { readSchema } from '../database/property.ts'
import { isStatusGroupKind, type StatusGroupKind } from '../database/property-types.ts'
import { MAX_QUERY_PAGINATION, queryRows } from '../database/query.ts'
import { canOpenDatabase, rowsAccessForDataSource } from '../database/row-access.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { apiParentOf, coverToApi, iconToApi, publicUrlOf, readApiOptions, readApiProperties, readApiRowPages } from './page-object.ts'
import { apiLinks, bodyInvalid, invalid, isObject, notFound, policyBlock, unexpectedKey } from './pages.ts'
import { findProperty, userRef } from './property-values.ts'
import { decodeQueryCursor, encodeQueryCursor, queryFingerprint, translateFilter, translateSorts } from './query-dsl.ts'
import { toApiRichText, type ApiLinks } from './rich-text.ts'
import { schemaToApi, type SchemaRef } from './schema-object.ts'
import { v1Fail, v1Ok, type V1Handler, type V1Reply } from './v1.ts'
import { API_MAX_PAGE_SIZE, invalidPathIdMessage, parseApiId, shownValue } from './v1-protocol.ts'

/** 구조 고치기는 이 조각에 없다(머리말). */
export const SCHEMA_WRITE_MESSAGE =
  'Creating or updating databases and data sources is not supported by this API. Change the database structure in the app.'

export const unsupportedSchemaWrite: V1Handler = async () => v1Fail(400, 'validation_error', SCHEMA_WRITE_MESSAGE)

// ── 읽기 ──────────────────────────────────────────────────────────────

type DatabaseRow = {
  id: string
  lifecycle: string
  parent_type: string
  parent_id: string
  parent_block_type: string | null
  properties: { title?: unknown } | null
  created_at: Date
  created_by: string | null
  last_edited_at: Date
  last_edited_by: string | null
  icon: unknown
  cover: unknown
  is_inline: boolean
}

const DATABASE_SELECT = `SELECT b.id, b.lifecycle::text AS lifecycle, b.parent_type::text AS parent_type, b.parent_id, pb.type::text AS parent_block_type,
            b.properties, b.created_at, b.created_by, b.last_edited_at, b.last_edited_by, d.icon, d.cover, d.is_inline
       FROM block b
       JOIN database d ON d.id = b.id
       LEFT JOIN block pb ON b.parent_type = 'block' AND pb.id = b.parent_id`

/** 데이터베이스 하나 — 표를 열 수 있어야 한다(볼 수 있거나 "만들기만"). 휴지통의 것도 준다(`in_trash`). */
async function openDatabaseIn(tx: Tx, ctx: SessionContext, databaseId: string, live = false): Promise<DatabaseRow | null> {
  const row = await tx.queryMaybe<DatabaseRow>(
    `${DATABASE_SELECT}
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'database' AND b.lifecycle ${live ? "= 'live'" : "IN ('live', 'trashed')"}`,
    [databaseId, ctx.workspaceId],
  )
  if (row === null) return null
  return canOpenDatabase(await effectiveCaps(tx, ctx, databaseId)) ? row : null
}

type SourceRow = {
  id: string
  name: string
  owner: string
  created_at: Date
  updated_at: Date
  unique_id_prefix: string | null
}

/**
 * 데이터 소스 하나 — 소스와 주인 데이터베이스가 살아 있고(행 질의의 문과 같다) 주인을 열 수 있어야 한다. 주인 데이터베이스와 함께.
 */
async function openSourceIn(tx: Tx, ctx: SessionContext, dataSourceId: string): Promise<{ source: SourceRow; database: DatabaseRow } | null> {
  const source = await tx.queryMaybe<SourceRow>(
    `SELECT ds.id, ds.name, ds.owner_database_id AS owner, ds.created_at, ds.updated_at, ds.unique_id_prefix
       FROM data_source ds
       JOIN block b ON b.id = ds.owner_database_id
      WHERE ds.id = $1 AND b.workspace_id = $2 AND b.lifecycle = 'live' AND ds.lifecycle = 'live'`,
    [dataSourceId, ctx.workspaceId],
  )
  if (source === null) return null
  const database = await openDatabaseIn(tx, ctx, source.owner, true)
  return database === null ? null : { source, database }
}

/** id 가 다른 종류일 때의 404 — 열 수 있는 데이터베이스 · 데이터 소스면 바른 주소를 말한다(머리말). */
async function mistakenIdReply(ctx: SessionContext, kind: 'database' | 'data source', id: string): Promise<V1Reply> {
  const other = await withReadTransaction(async (tx) =>
    kind === 'data source' ? (await openDatabaseIn(tx, ctx, id, true)) !== null : (await openSourceIn(tx, ctx, id)) !== null,
  )
  if (!other) return notFound(kind, id)
  return v1Fail(
    404,
    'object_not_found',
    kind === 'data source'
      ? `Could not find data source with ID: ${id}. This is a database ID — retrieve the database (GET /v1/databases/${id}) and use one of its data_sources[].id.`
      : `Could not find database with ID: ${id}. This is a data source ID — use /v1/data_sources/${id} instead.`,
  )
}

const databaseUrl = (ctx: SessionContext, links: ApiLinks, id: string) => `${links.origin}/w/${ctx.workspaceId}/db/${id}`

/** 데이터베이스의 소스 — 살아 있고 열 수 있는 것만. 하나뿐이면 그 이름은 데이터베이스의 제목이다(머리말). */
async function visibleSourcesIn(tx: Tx, ctx: SessionContext, row: DatabaseRow): Promise<{ id: string; name: string }[]> {
  const sources = await readDataSources(tx, row.id, ctx)
  const single = sources.length === 1
  return sources.filter((s) => s.readable).map((s) => ({ id: s.id, name: single ? plainTitleOf(row.properties) : s.name }))
}

/** 노션의 데이터베이스 객체. */
async function databaseObjectIn(tx: Tx, ctx: SessionContext, row: DatabaseRow, links: ApiLinks): Promise<Record<string, unknown>> {
  const title = readTitle(row.properties)
  return {
    object: 'database',
    id: row.id,
    created_time: row.created_at.toISOString(),
    last_edited_time: row.last_edited_at.toISOString(),
    created_by: row.created_by === null ? null : userRef(row.created_by),
    last_edited_by: row.last_edited_by === null ? null : userRef(row.last_edited_by),
    title: toApiRichText(title, links),
    description: [],
    icon: await iconToApi(tx, ctx, readPageIcon(row.icon)),
    cover: coverToApi(readPageCover(row.cover)),
    parent: apiParentOf(row.parent_type, row.parent_id, row.parent_block_type),
    is_inline: row.is_inline,
    in_trash: row.lifecycle === 'trashed',
    data_sources: await visibleSourcesIn(tx, ctx, row),
    url: databaseUrl(ctx, links, row.id),
    public_url: null,
  }
}

/** 스키마의 재료 — 상태 범주 · relation 의 짝과 rollup 의 대상(다른 표의 것은 그 표를 열 수 있을 때만 이름을). */
async function schemaLookupsIn(tx: Tx, ctx: SessionContext, dataSourceId: string, properties: readonly { id: string; name: string; type: string; config: unknown }[]) {
  const statusIds = properties.filter((p) => p.type === 'status').map((p) => p.id)
  const groups = new Map<string, { id: string; kind: StatusGroupKind }[]>()
  if (statusIds.length > 0) {
    const rows = await tx.query<{ id: string; property_id: string; kind: string }>(
      `SELECT id, property_id, kind::text AS kind FROM status_group WHERE property_id = ANY($1::text[])
        ORDER BY property_id, CASE kind WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END`,
      [statusIds],
    )
    for (const r of rows) {
      if (!isStatusGroupKind(r.kind)) continue
      groups.set(r.property_id, [...(groups.get(r.property_id) ?? []), { id: r.id, kind: r.kind }])
    }
  }

  const refs = new Map<string, SchemaRef>(properties.map((p) => [p.id, { name: p.name, type: p.type }]))
  const wanted = new Set<string>()
  for (const p of properties) {
    const c = p.config as { synced_property_id?: unknown; target_property_id?: unknown } | null
    if (p.type === 'relation' && typeof c?.synced_property_id === 'string' && !refs.has(c.synced_property_id)) wanted.add(c.synced_property_id)
    if (p.type === 'rollup' && typeof c?.target_property_id === 'string' && !refs.has(c.target_property_id)) wanted.add(c.target_property_id)
  }
  if (wanted.size > 0) {
    const rows = await tx.query<{ id: string; name: string; type: string; data_source_id: string }>(
      `SELECT id, name, type::text AS type, data_source_id FROM property WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
      [[...wanted]],
    )
    const open = new Map<string, boolean>()
    for (const r of rows) {
      if (r.data_source_id !== dataSourceId && !open.has(r.data_source_id)) {
        open.set(r.data_source_id, (await rowsAccessForDataSource(tx, ctx, r.data_source_id)) !== null)
      }
      refs.set(r.id, { name: r.data_source_id === dataSourceId || open.get(r.data_source_id) === true ? r.name : null, type: r.type })
    }
  }
  return { statusGroups: groups, refs }
}

/** 노션의 데이터 소스 객체. */
async function dataSourceObjectIn(
  tx: Tx,
  ctx: SessionContext,
  opened: { source: SourceRow; database: DatabaseRow },
  links: ApiLinks,
): Promise<Record<string, unknown>> {
  const { source, database } = opened
  const schema = await readSchema(tx, source.id)
  const lookups = await schemaLookupsIn(tx, ctx, source.id, schema.properties)
  const databaseTitle = readTitle(database.properties)
  const only = (await readDataSources(tx, database.id)).length === 1
  const title: RichTextRun[] = only ? databaseTitle : [textRun(source.name)]
  return {
    object: 'data_source',
    id: source.id,
    created_time: source.created_at.toISOString(),
    last_edited_time: source.updated_at.toISOString(),
    properties: schemaToApi(schema.properties, { uniqueIdPrefix: source.unique_id_prefix, ...lookups }),
    parent: { type: 'database_id', database_id: database.id },
    database_parent: apiParentOf(database.parent_type, database.parent_id, database.parent_block_type),
    title: toApiRichText(title, links),
    description: [],
    // 노션 — 앱에서 단 아이콘은 데이터베이스 · 데이터 소스 둘 다 같은 것을 돌려준다
    icon: await iconToApi(tx, ctx, readPageIcon(database.icon)),
    in_trash: false,
    is_inline: database.is_inline,
  }
}

/** `GET /v1/databases/{database_id}` */
export const retrieveDatabase: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.database_id)
  if (id === null) return invalid(invalidPathIdMessage('database_id', params.database_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)
  const read = await withReadTransaction(async (tx) => {
    const row = await openDatabaseIn(tx, ctx, id)
    return row === null ? null : { trashed: row.lifecycle === 'trashed', json: await databaseObjectIn(tx, ctx, row, links) }
  })
  if (read === null) return mistakenIdReply(ctx, 'database', id)
  return v1Ok(read.trashed ? read.json : { ...read.json, public_url: await publicUrlOf(ctx, id, links, new Date()) })
}

/** `GET /v1/data_sources/{data_source_id}` */
export const retrieveDataSource: V1Handler = async ({ ctx, params, request }) => {
  const id = parseApiId(params.data_source_id)
  if (id === null) return invalid(invalidPathIdMessage('data_source_id', params.data_source_id))
  const blocked = await policyBlock(ctx)
  if (blocked !== null) return blocked
  const links = apiLinks(ctx, request)
  const json = await withReadTransaction(async (tx) => {
    const opened = await openSourceIn(tx, ctx, id)
    return opened === null ? null : dataSourceObjectIn(tx, ctx, opened, links)
  })
  return json === null ? mistakenIdReply(ctx, 'data source', id) : v1Ok(json)
}

// ── 질의 ──────────────────────────────────────────────────────────────

const QUERY_KEYS = ['filter', 'sorts', 'start_cursor', 'page_size', 'in_trash', 'is_archived', 'result_type']

export type QueryOptions = {
  /** 한 질의가 페이지로 넘겨 줄 수 있는 행의 상한 — 노션의 10,000(`MAX_QUERY_PAGINATION`). 시험이 낮춘다. */
  readonly cap?: number
}

/** `POST /v1/data_sources/{data_source_id}/query` 를 만든다 — 상한만 고른다(시험). */
export function makeQueryDataSource(options: QueryOptions = {}): V1Handler {
  const cap = options.cap ?? MAX_QUERY_PAGINATION
  return async ({ ctx, params, body, request }) => {
    const id = parseApiId(params.data_source_id)
    if (id === null) return invalid(invalidPathIdMessage('data_source_id', params.data_source_id))
    const input = body === undefined ? {} : body
    if (!isObject(input)) return bodyInvalid(`body should be an object, instead was ${shownValue(input)}.`)
    const extra = unexpectedKey(input, QUERY_KEYS)
    if (extra !== null) return extra

    const pageSize = input.page_size ?? API_MAX_PAGE_SIZE
    if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > API_MAX_PAGE_SIZE) {
      return bodyInvalid(`body.page_size should be a number between 1 and ${API_MAX_PAGE_SIZE}, instead was ${shownValue(input.page_size)}.`)
    }
    const cursor = input.start_cursor === undefined || input.start_cursor === null ? null : decodeQueryCursor(input.start_cursor)
    if (input.start_cursor !== undefined && input.start_cursor !== null && cursor === null) {
      return bodyInvalid(`body.start_cursor should be a cursor from a previous response, instead was ${shownValue(input.start_cursor)}.`)
    }
    for (const key of ['in_trash', 'is_archived'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') return bodyInvalid(`body.${key} should be a boolean, instead was ${shownValue(input[key])}.`)
    }
    if (input.in_trash !== undefined && input.is_archived !== undefined && input.in_trash !== input.is_archived) {
      return bodyInvalid('body.in_trash and body.is_archived should be the same when both are given.')
    }
    const trashed = (input.in_trash ?? input.is_archived) === true
    const resultType = input.result_type
    if (resultType !== undefined && resultType !== 'page' && resultType !== 'data_source') {
      return bodyInvalid(`body.result_type should be "page" or "data_source", instead was ${shownValue(resultType)}.`)
    }
    const url = new URL(request.url)
    const wantedProperties = [...url.searchParams.getAll('filter_properties'), ...url.searchParams.getAll('filter_properties[]')]

    const blocked = await policyBlock(ctx)
    if (blocked !== null) return blocked

    // 스키마 — 이름 · id 를 앱의 속성으로, 옵션 이름을 id 로
    const schema = await withReadTransaction(async (tx) => {
      const opened = await openSourceIn(tx, ctx, id)
      if (opened === null) return null
      const properties = await readApiProperties(tx, id)
      return { properties, options: await readApiOptions(tx, properties) }
    })
    if (schema === null) return mistakenIdReply(ctx, 'data source', id)

    const filter = translateFilter(input.filter, schema.properties, schema.options)
    if (!filter.ok) return invalid(filter.message)
    const sorts = translateSorts(input.sorts, schema.properties)
    if (!sorts.ok) return invalid(sorts.message)
    let only: Set<string> | null = null
    if (wantedProperties.length > 0) {
      only = new Set()
      for (const key of wantedProperties) {
        const property = findProperty(schema.properties, key)
        if (property === null) return invalid(`query failed validation: filter_properties — Could not find property with name or id: ${key}`)
        only.add(property.id)
      }
    }

    const fingerprint = queryFingerprint(id, filter.value, sorts.value, trashed)
    if (cursor !== null && (cursor.fingerprint !== fingerprint || cursor.consumed >= cap)) {
      return bodyInvalid('body.start_cursor does not belong to this query. Send the same filter, sorts and in_trash as the request that returned it.')
    }

    const envelope = (results: unknown[], next: string | null, incomplete: boolean) => ({
      object: 'list',
      results,
      next_cursor: next,
      has_more: next !== null,
      type: 'page_or_data_source',
      page_or_data_source: {},
      ...(incomplete ? { request_status: { type: 'incomplete', incomplete_reason: 'query_result_limit_reached' } } : {}),
    })
    // 데이터 소스 밑의 데이터 소스(위키)는 없다 — 그 결과는 늘 비어 있다
    if (resultType === 'data_source') return v1Ok(envelope([], null, false))

    const consumed = cursor?.consumed ?? 0
    const limit = Math.min(pageSize, cap - consumed)
    const page = await queryRows(ctx, id, { filter: filter.value, sorts: sorts.value, limit, cursor: cursor?.engine ?? null, trashed })
    if (!page.ok) return notFound('data source', id)

    const given = consumed + page.value.rows.length
    const capped = page.value.hasMore && given >= cap
    const next =
      page.value.hasMore && !capped && page.value.nextCursor !== null
        ? encodeQueryCursor({ fingerprint, consumed: given, engine: page.value.nextCursor })
        : null
    const results = await readApiRowPages(ctx, id, page.value.rows.map((r) => r.id), apiLinks(ctx, request), only)
    return v1Ok(envelope(results, next, capped))
  }
}

/** `POST /v1/data_sources/{data_source_id}/query` */
export const queryDataSource: V1Handler = makeQueryDataSource()
