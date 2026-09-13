/**
 * 익스포트 스냅샷 읽기 — F-09-14 (3조각)
 *
 * 정본: 09-api-integrations.md F-09-14 엣지 케이스 — 권한 없음 · 동시편집 · 대용량
 *       02-page-workspace.md F-02-22 — *"잡 시작 시점의 스냅샷 기준으로 진행"*
 *
 * DB 에서 읽어 `ExportSnapshot`(plan.ts)을 만든다. 파일 이름 · Markdown · ZIP 은 모른다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 한 스냅샷으로 읽는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 권한 · 페이지 트리 · 본문 · 표 · 파일 메타를 **한 트랜잭션**(`withReadTransaction` —
 * REPEATABLE READ)에서 읽는다. 문장마다 시점이 다르면 읽는 사이 옮겨진 페이지가 두 번 나오거나
 * (조립이 던진다) 빠진다. 첨부의 **바이트**는 스냅샷 밖에서 흘려보낼 때 읽는다 — 파일은 id 로
 * 불변이다(내용을 바꾸면 새 파일이다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 볼 수 없는 것은 DB 밖으로 나오지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 내용 질의가 `perm_scope_id = ANY(readableScopes)` 로 거른다 — 사이드바 · 검색과 같은 규칙이다
 * (§3.3-32). 읽은 뒤 조립 단계에서 거르지 않는다. 그러면 볼 수 없는 제목 · 본문이 한 번은 메모리에
 * 올라오고, 거르기를 빠뜨리는 순간 ZIP 에 들어간다.
 *
 * 볼 수 없는 하위 페이지는 **자리**(id · 부모 · 순서 — 제목 없이)만 따로 읽어 부모 본문에 참조로
 * 둔다. 편집기가 이미 그 참조를 보여주므로(`readScope` 는 권한을 거르지 않는다) 새로 알려주는 것이
 * 없고, 조립이 그 참조를 빼며 `omitted_pages` 로 센다 — 백업에서 무엇이 빠졌는지 사용자가 안다.
 * 워크스페이스 전체에서 "볼 수 없는 페이지 N개"를 세지는 **않는다** — 남의 비공개 페이지 수를
 * 알려주는 일이다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 트리의 부모는 가장 가까운 "읽은" 조상이다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `page-tree.ts`(사이드바)와 같은 규칙이다. 볼 수 없는 페이지 B 밑에 따로 공유받은 C 가 있으면 C 는
 * B 를 건너뛰어 그 위 페이지의 자식이 된다 — 사이드바가 C 를 보여주는 자리와 같다. 버리면 볼 수
 * 있는 페이지가 백업에서 빠진다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { readImageSource } from '../block/image.ts'
import { plainTitleOf, readTitle } from '../block/page.ts'
import { PAGE_TYPE } from '../block/types.ts'
import { DEFAULT_PROPERTY_TYPE, isMvpPropertyType, isOptionColor, type SelectOption } from '../database/property-types.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { rowsToDoc, type BodyRow, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { isUuid } from '../ids.ts'
import { readableScopes } from '../permissions/effective.ts'
import type { CsvColumn } from './csv.ts'
import type { ExportFile, ExportNode, ExportSnapshot } from './plan.ts'

/**
 * 한 번에 읽는 블록 상한. 넘으면 읽기를 멈추고 `too_large` 다 — 전부 메모리에 올린 뒤에 ZIP 크기로
 * 거절하면 이미 늦다. 동기 다운로드(HANDOFF §2 계획)가 감당할 규모의 선이고, 잡 큐가 오면 올린다.
 */
export const MAX_EXPORT_BLOCKS = 200_000

export type ExportScopeInput = { readonly kind: 'page'; readonly rootId: string } | { readonly kind: 'workspace' }

export type SnapshotFailure =
  /** 없거나 볼 수 없는 페이지 — 둘을 구분하지 않는다(§3.3-31). */
  | 'not_found'
  | 'too_large'

export type SnapshotResult =
  | { readonly ok: true; readonly value: ExportSnapshot }
  | { readonly ok: false; readonly reason: SnapshotFailure }

type BlockRow = {
  id: string
  type: string
  parent_type: string
  parent_id: string
  order_key: string
  ancestor_path: string[]
  properties: Record<string, unknown> | null
  format: Record<string, unknown> | null
}

type PlaceholderRow = Pick<BlockRow, 'id' | 'parent_id' | 'order_key' | 'ancestor_path'>

const byOrder = (a: { order_key: string; id: string }, b: { order_key: string; id: string }): number =>
  a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** 경로를 뒤에서부터 훑어 집합에 든 첫 조상. */
function nearestIn(path: readonly string[], set: ReadonlySet<string>): string | null {
  for (let i = path.length - 1; i >= 0; i -= 1) if (set.has(path[i])) return path[i]
  return null
}

export async function readExportSnapshot(
  ctx: SessionContext,
  scope: ExportScopeInput,
  options: { readonly maxBlocks?: number } = {},
): Promise<SnapshotResult> {
  const maxBlocks = options.maxBlocks ?? MAX_EXPORT_BLOCKS

  return withReadTransaction(async (tx) => {
    // 첫 문장이 스냅샷을 정한다. 익스포트 시각도 그 시점이다.
    const { now } = await tx.queryOne<{ now: Date }>(`SELECT now() AS now`)
    const scopes = await readableScopes(tx, ctx)
    const readable = new Set(scopes)

    let rootId: string | null = null
    if (scope.kind === 'page') {
      if (!isUuid(scope.rootId)) return { ok: false, reason: 'not_found' } as const
      const root = await tx.queryMaybe<{ id: string; perm_scope_id: string }>(
        `SELECT id, perm_scope_id FROM live_block
          WHERE id = $1 AND workspace_id = $2 AND type IN ('page', 'database')`,
        [scope.rootId, ctx.workspaceId],
      )
      if (root === null || !readable.has(root.perm_scope_id)) return { ok: false, reason: 'not_found' } as const
      rootId = root.id
    }

    // 범위 조건. 페이지 범위는 그 노드와 자손이다 — `@>` 라야 ancestor_path 의 GIN 인덱스를 탄다.
    const subtree = rootId === null ? '' : `AND (b.id = $4 OR b.ancestor_path @> ARRAY[$4]::uuid[])`
    const rangeParams = rootId === null ? [] : [rootId]

    // ── ① 읽을 수 있는 블록 전부 — 페이지 · 표 · 본문 ──
    const blocks = await tx.query<BlockRow>(
      `SELECT b.id, b.type, b.parent_type, b.parent_id, b.order_key, b.ancestor_path, b.properties, b.format
         FROM live_block b
        WHERE b.workspace_id = $1 AND b.perm_scope_id = ANY($2::uuid[]) ${subtree}
        LIMIT $3`,
      [ctx.workspaceId, scopes, maxBlocks + 1, ...rangeParams],
    )
    if (blocks.length > maxBlocks) return { ok: false, reason: 'too_large' } as const

    // ── ② 볼 수 없는 하위 페이지의 자리 — 제목 · 본문 없이 ──
    const placeholders = await tx.query<PlaceholderRow>(
      `SELECT b.id, b.parent_id, b.order_key, b.ancestor_path
         FROM live_block b
        WHERE b.workspace_id = $1 AND b.type = 'page' AND b.parent_type = 'block'
          AND NOT (b.perm_scope_id = ANY($2::uuid[])) ${subtree}
        LIMIT $3`,
      [ctx.workspaceId, scopes, maxBlocks + 1, ...rangeParams],
    )
    if (placeholders.length > maxBlocks) return { ok: false, reason: 'too_large' } as const

    // ── ③ DB 행의 셀. 템플릿 행은 내보내지 않는다(불변식 R1) ──
    const rowIds = blocks.filter((b) => b.type === PAGE_TYPE && b.parent_type === 'data_source').map((b) => b.id)
    const pageRows = rowIds.length === 0
      ? []
      : await tx.query<{ id: string; is_template: boolean; properties_cache: Record<string, unknown> | null }>(
          `SELECT id, is_template, properties_cache FROM page WHERE id = ANY($1::uuid[])`,
          [rowIds],
        )
    const templates = new Set(pageRows.filter((r) => r.is_template).map((r) => r.id))
    const cellsOf = new Map(pageRows.map((r) => [r.id, r.properties_cache ?? {}]))

    // ── ④ 노드와 트리 ──
    const nodeRows = blocks.filter(
      (b) => (b.type === PAGE_TYPE && !templates.has(b.id)) || b.type === 'database',
    )
    const nodeIds = new Set(nodeRows.map((b) => b.id))
    const typeOf = new Map(nodeRows.map((b) => [b.id, b.type]))

    const roots: BlockRow[] = []
    const childrenOf = new Map<string, BlockRow[]>()
    const rowsOf = new Map<string, BlockRow[]>()
    for (const node of nodeRows) {
      const parent = node.id === rootId ? null : nearestIn(node.ancestor_path, nodeIds)
      if (parent === null) {
        roots.push(node)
      } else if (typeOf.get(parent) === 'database') {
        // 표 밑에 놓일 수 있는 것은 행뿐이다. 템플릿 행의 하위 페이지처럼 자리가 없는 것은 두지 않는다
        // — MVP 에는 템플릿 행을 만드는 경로가 없다.
        if (node.parent_type === 'data_source') push(rowsOf, parent, node)
      } else {
        push(childrenOf, parent, node)
      }
    }

    // ── ⑤ 본문. 블록은 가장 가까운 페이지 조상의 문서에 속한다 ──
    const pageIds = new Set([
      ...blocks.filter((b) => b.type === PAGE_TYPE).map((b) => b.id),
      ...placeholders.map((p) => p.id),
    ])
    const bodyRows = new Map<string, BodyRow[]>()
    for (const block of blocks) {
      // 행 · 최상위 노드 · 표는 어느 본문에도 들어가지 않는다.
      if (block.parent_type !== 'block' || block.type === 'database') continue
      const owner = nearestIn(block.ancestor_path, pageIds)
      if (owner !== null) push(bodyRows, owner, block)
    }
    for (const placeholder of placeholders) {
      const owner = nearestIn(placeholder.ancestor_path, pageIds)
      if (owner !== null) push(bodyRows, owner, { ...placeholder, type: PAGE_TYPE, properties: null, format: null })
    }

    const nodes = new Map<string, ExportNode>()
    for (const node of nodeRows) {
      if (node.type !== PAGE_TYPE) continue
      const doc = rowsToDoc(node.id, bodyRows.get(node.id) ?? [])
      nodes.set(node.id, {
        kind: 'page',
        id: node.id,
        title: readTitle(node.properties),
        doc,
        childIds: inDocumentOrder(childrenOf.get(node.id) ?? [], doc),
        ...(cellsOf.has(node.id) ? { cells: cellsOf.get(node.id) } : {}),
      })
    }

    const databaseIds = nodeRows.filter((b) => b.type === 'database').map((b) => b.id)
    const tables = await readTables(tx, databaseIds)
    for (const database of nodeRows.filter((b) => b.type === 'database')) {
      const table = tables.get(database.id)
      const rows = (rowsOf.get(database.id) ?? []).filter((row) => row.parent_id === table?.dataSourceId).sort(byOrder)
      nodes.set(database.id, {
        kind: 'database',
        id: database.id,
        name: plainTitleOf(database.properties),
        columns: table?.columns ?? [],
        rowIds: rows.map((row) => row.id),
      })
    }

    return {
      ok: true,
      value: {
        scope: rootId === null ? { kind: 'workspace' } : { kind: 'page', rootId },
        exportedAt: now,
        rootIds: roots.sort(byOrder).map((root) => root.id),
        nodes,
        files: await readFiles(tx, ctx, blocks),
        excluded: {},
      },
    } as const
  })
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * 자식의 순서 — 본문에 참조가 있는 것은 **본문에 보이는 순서**(토글 안까지), 참조가 없는 것
 * (볼 수 없는 페이지 밑에서 올라온 것)은 그 뒤에 `order_key` 순.
 */
function inDocumentOrder(children: readonly BlockRow[], doc: EditorDoc): string[] {
  const position = new Map<string, number>()
  const walk = (blocks: readonly EditorBlock[]): void => {
    for (const block of blocks) {
      if (block.type === PAGE_TYPE && !position.has(block.id)) position.set(block.id, position.size)
      walk(block.children ?? [])
    }
  }
  walk(doc.blocks)

  return [...children]
    .sort((a, b) => {
      const pa = position.get(a.id)
      const pb = position.get(b.id)
      if (pa !== undefined && pb !== undefined) return pa - pb
      if (pa !== undefined) return -1
      if (pb !== undefined) return 1
      return byOrder(a, b)
    })
    .map((child) => child.id)
}

type Table = { readonly dataSourceId: string; readonly columns: CsvColumn[] }

/** 표마다 **소유한** data_source 하나(`getDatabase` 와 같은 규칙)의 살아 있는 프로퍼티 · 옵션. */
async function readTables(tx: Tx, databaseIds: readonly string[]): Promise<Map<string, Table>> {
  if (databaseIds.length === 0) return new Map()

  const sources = await tx.query<{ id: string; owner_database_id: string }>(
    `SELECT DISTINCT ON (owner_database_id) id, owner_database_id
       FROM data_source
      WHERE owner_database_id = ANY($1::uuid[])
      ORDER BY owner_database_id, created_at, id`,
    [databaseIds],
  )
  const sourceIds = sources.map((s) => s.id)
  const properties = await tx.query<{ id: string; data_source_id: string; name: string; type: string }>(
    `SELECT id, data_source_id, name, type::text AS type
       FROM property
      WHERE data_source_id = ANY($1::uuid[]) AND deleted_at IS NULL
      ORDER BY data_source_id, order_idx, id`,
    [sourceIds],
  )
  const selectIds = properties.filter((p) => p.type === 'select').map((p) => p.id)
  const options = selectIds.length === 0
    ? []
    : await tx.query<{ property_id: string; id: string; name: string; color: string }>(
        `SELECT property_id, id, name, color::text AS color
           FROM select_option
          WHERE property_id = ANY($1::text[])
          ORDER BY property_id, order_idx, id`,
        [selectIds],
      )

  const optionsOf = new Map<string, SelectOption[]>()
  for (const option of options) {
    push(optionsOf, option.property_id, {
      id: option.id,
      name: option.name,
      color: isOptionColor(option.color) ? option.color : 'default',
    })
  }

  const tables = new Map<string, Table>()
  for (const source of sources) {
    tables.set(source.owner_database_id, {
      dataSourceId: source.id,
      columns: properties
        .filter((p) => p.data_source_id === source.id)
        .map((p) => ({
          propertyId: p.id,
          name: p.name,
          // 스키마 ENUM 은 24종이다. 읽기는 관대하게 — `property.ts` 의 `toSummary` 와 같은 규칙.
          type: isMvpPropertyType(p.type) ? p.type : DEFAULT_PROPERTY_TYPE,
          ...(p.type === 'select' ? { options: optionsOf.get(p.id) ?? [] } : {}),
        })),
    })
  }
  return tables
}

/** 본문이 가리키는 우리 파일 중 **이 워크스페이스** 것의 메타. 다른 워크스페이스의 id 는 없는 것과 같다. */
async function readFiles(tx: Tx, ctx: SessionContext, blocks: readonly BlockRow[]): Promise<Map<string, ExportFile>> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const source = readImageSource(block.properties)
    if (source?.kind === 'file') ids.add(source.fileId)
  }
  if (ids.size === 0) return new Map()

  const rows = await tx.query<{ id: string; mime: string; original_name: string | null; size_bytes: string | number }>(
    `SELECT id, mime, original_name, size_bytes FROM file WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [ctx.workspaceId, [...ids]],
  )
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, mime: row.mime, originalName: row.original_name, sizeBytes: Number(row.size_bytes) },
    ]),
  )
}
