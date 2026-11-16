/**
 * 공개 API 의 블록 — 본문 읽기 · 블록 객체 · 새 페이지의 본문 쓰기 (API-3 · F-09-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ③ ⑤ · 공개 API 투영 규칙 · 판결 X-1(본문의 정본은 Y.Doc)
 *
 *   · 읽기는 **Y.Doc 의 원문**이다(`readBodyState` → `readBodyYDoc` — 내보내기 · 게시와 같은 읽기). 수락 전 제안 글은 빠지고 지우자는 글은
 *     그냥 글이다 — 제안 마크는 문서 밖이다. 행은 참여자 편집의 투영 창만큼 낡을 수 있어 본문을 행으로 읽지 않는다. 아직 Y.Doc 으로 옮기지
 *     않은 페이지만 행에서 짓는다(`rowsToDoc` — 옮기기와 같은 규칙)
 *   · 블록의 시각 · 사람은 투영된 행에서 — 아직 투영되지 않은 블록은 그 페이지의 것으로 대신한다
 *   · 부모는 투영 규칙 — 페이지 본문의 맨 위는 `page_id`, 그 밖은 `block_id`. 페이지 자신을 블록으로 읽으면 페이지의 부모(API-2 와 같다)
 *   · `in_trash` — 본문 블록은 그 페이지의 것(휴지통의 페이지 본문은 모두 휴지통이다)
 *   · 하위 페이지 · 인라인 데이터베이스의 제목은 그 사람이 볼 수 있을 때만(`effectiveCaps` — 앱의 참조와 같은 규칙)
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext } from '../auth/session-context.ts'
import { ownerPageOf, openPageBody } from '../block/body-write.ts'
import { plainTitleOf } from '../block/page.ts'
import { readBodyScope } from '../block/save-page-body.ts'
import { readImageSource } from '../block/image.ts'
import { readBodyState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import type { Tx } from '../db/tx.ts'
import { rowsToDoc, type EditorBlock, type EditorDoc } from '../editor/document.ts'
import { docToPm } from '../editor/pm-adapter.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { apiBlockObject, blockContentToApi, columnWidthsOf, type RefInfo, type UploadRef } from './block-json.ts'
import { loadPageIn, type LoadedPage } from './page-object.ts'
import type { ApiLinks } from './rich-text.ts'

// ── 찾기 ──────────────────────────────────────────────────────────────

/** 인라인 · 전체 페이지 데이터베이스 — 블록으로 읽으면 `child_database`. */
export type LoadedDatabase = {
  readonly id: string
  readonly trashed: boolean
  readonly parent: Readonly<Record<string, unknown>>
  readonly title: string
  readonly createdAt: Date
  readonly createdBy: string | null
  readonly lastEditedAt: Date
  readonly lastEditedBy: string | null
}

/** id 가 가리키는 것 — 페이지(행 포함) · 데이터베이스 · 어느 페이지 본문의 블록. 볼 수 없거나 없으면 null(있는지 새지 않는다). */
export type Located =
  | { readonly kind: 'page'; readonly page: LoadedPage }
  | { readonly kind: 'database'; readonly database: LoadedDatabase }
  | { readonly kind: 'body'; readonly owner: LoadedPage }

type ParentRow = { parent_type: string; parent_id: string; parent_block_type: string | null }

/** 투영 규칙의 부모(API-2 `page-object.ts` 와 같다). 데이터베이스는 데이터 소스 밑에 서지 않는다. */
function parentShape(row: ParentRow): Record<string, unknown> {
  if (row.parent_type === 'block') {
    return row.parent_block_type === 'page' ? { type: 'page_id', page_id: row.parent_id } : { type: 'block_id', block_id: row.parent_id }
  }
  return { type: 'workspace', workspace: true }
}

async function loadDatabaseIn(tx: Tx, ctx: SessionContext, id: string): Promise<LoadedDatabase | null> {
  const row = await tx.queryMaybe<
    ParentRow & { id: string; lifecycle: string; properties: { title?: unknown } | null; created_at: Date; created_by: string | null; last_edited_at: Date; last_edited_by: string | null }
  >(
    `SELECT b.id, b.lifecycle::text AS lifecycle, b.parent_type::text AS parent_type, b.parent_id, pb.type::text AS parent_block_type,
            b.properties, b.created_at, b.created_by, b.last_edited_at, b.last_edited_by
       FROM block b
       LEFT JOIN block pb ON b.parent_type = 'block' AND pb.id = b.parent_id
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = 'database' AND b.lifecycle IN ('live', 'trashed')`,
    [id, ctx.workspaceId],
  )
  if (row === null || !can(await effectiveCaps(tx, ctx, id), 'view')) return null
  return {
    id: row.id,
    trashed: row.lifecycle === 'trashed',
    parent: parentShape(row),
    title: plainTitleOf(row.properties),
    createdAt: row.created_at,
    createdBy: row.created_by,
    lastEditedAt: row.last_edited_at,
    lastEditedBy: row.last_edited_by,
  }
}

/**
 * id 를 찾는다 — 행으로 무엇인지 고르고 본문 블록이면 그 본문을 가진 페이지를 본다(볼 수 있어야 한다). 본문 블록이 실제로 본문에 있는지는
 * 본문을 읽는 쪽이 본다(행은 투영이다).
 */
export async function locateIn(tx: Tx, ctx: SessionContext, id: string): Promise<Located | null> {
  const row = await tx.queryMaybe<{ type: string }>(`SELECT type::text AS type FROM block WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId])
  if (row === null) return null
  if (row.type === 'page') {
    const page = await loadPageIn(tx, ctx, id)
    return page === null ? null : { kind: 'page', page }
  }
  if (row.type === 'database') {
    const database = await loadDatabaseIn(tx, ctx, id)
    return database === null ? null : { kind: 'database', database }
  }
  const ownerId = await ownerPageOf(tx, ctx, id)
  if (ownerId === null) return null
  const owner = await loadPageIn(tx, ctx, ownerId)
  return owner === null ? null : { kind: 'body', owner }
}

// ── 본문 ──────────────────────────────────────────────────────────────

/** 페이지 본문의 원문(머리말) — 잠그지 않고 읽는다. */
export async function readBodyIn(tx: Tx, ctx: SessionContext, pageId: string): Promise<EditorDoc> {
  const state = await readBodyState(tx, pageId)
  if (state !== null) return readBodyYDoc(state.ydoc, pageId).doc
  // 아직 Y.Doc 으로 옮기지 않은 페이지 — 옮기기가 쓰는 같은 범위 · 같은 조립
  return rowsToDoc(pageId, (await readBodyScope(tx, ctx, pageId)).filter((r) => r.lifecycle === 'live'))
}

/** 블록과 그 부모(본문의 맨 위면 null). */
export type BodyEntry = { readonly block: EditorBlock; readonly parentId: string | null }

export function indexBody(doc: EditorDoc): Map<string, BodyEntry> {
  const out = new Map<string, BodyEntry>()
  const walk = (blocks: readonly EditorBlock[], parentId: string | null): void => {
    for (const block of blocks) {
      out.set(block.id, { block, parentId })
      walk(block.children ?? [], block.id)
    }
  }
  walk(doc.blocks, null)
  return out
}

/** 참조 블록의 제목 · 자식 여부 — 볼 수 없으면 빈 제목 · 자식 없음. */
async function refInfoIn(tx: Tx, ctx: SessionContext, ids: readonly string[]): Promise<Map<string, RefInfo>> {
  const out = new Map<string, RefInfo>()
  if (ids.length === 0) return out
  const rows = await tx.query<{ id: string; type: string; properties: { title?: unknown } | null; has_children: boolean }>(
    `SELECT b.id, b.type::text AS type, b.properties,
            EXISTS (SELECT 1 FROM block c WHERE c.parent_id = b.id AND c.workspace_id = b.workspace_id AND c.lifecycle = 'live') AS has_children
       FROM block b WHERE b.id = ANY($1::uuid[]) AND b.workspace_id = $2`,
    [ids, ctx.workspaceId],
  )
  for (const row of rows) {
    const visible = can(await effectiveCaps(tx, ctx, row.id), 'view')
    out.set(row.id, {
      title: visible ? plainTitleOf(row.properties) : '',
      hasChildren: visible && row.type === 'page' && row.has_children,
    })
  }
  return out
}

type MetaRow = { id: string; created_at: Date; created_by: string | null; last_edited_at: Date; last_edited_by: string | null }

/** 본문 블록들의 노션 객체 — 시각 · 사람은 행에서(없으면 그 페이지의 것). */
export async function blockObjectsIn(
  tx: Tx,
  ctx: SessionContext,
  owner: LoadedPage,
  doc: EditorDoc,
  entries: readonly BodyEntry[],
  links: ApiLinks,
): Promise<Record<string, unknown>[]> {
  if (entries.length === 0) return []
  const ids = entries.map((e) => e.block.id)
  const meta = new Map(
    (
      await tx.query<MetaRow>(
        `SELECT id, created_at, created_by, last_edited_at, last_edited_by FROM block WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
        [ids, ctx.workspaceId],
      )
    ).map((r) => [r.id, r]),
  )
  const refs = await refInfoIn(
    tx,
    ctx,
    entries.filter((e) => e.block.type === 'page' || e.block.type === 'database').map((e) => e.block.id),
  )
  const fileIds = entries.flatMap((e) => {
    const source = e.block.type === 'file' ? readImageSource(e.block.properties) : null
    return source?.kind === 'file' ? [source.fileId] : []
  })
  const fileNames = new Map(
    fileIds.length === 0
      ? []
      : (
          await tx.query<{ id: string; original_name: string | null }>(
            `SELECT id, original_name FROM file WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
            [fileIds, ctx.workspaceId],
          )
        ).map((r) => [r.id, r.original_name ?? ''] as const),
  )
  const read = { links, refs, fileNames, columnWidths: columnWidthsOf(doc) }
  return entries.map(({ block, parentId }) => {
    const row = meta.get(block.id)
    return apiBlockObject(block.id, blockContentToApi(block, read), {
      parent: parentId === null ? { type: 'page_id', page_id: owner.id } : { type: 'block_id', block_id: parentId },
      createdTime: row?.created_at ?? owner.createdAt,
      lastEditedTime: row?.last_edited_at ?? owner.lastEditedAt,
      createdBy: row === undefined ? owner.createdBy : row.created_by,
      lastEditedBy: row === undefined ? owner.lastEditedBy : row.last_edited_by,
      inTrash: owner.trashed,
    })
  })
}

/** 본문에 블록이 있는가 — 페이지를 블록으로 읽을 때의 `has_children`. */
async function hasBodyIn(tx: Tx, ctx: SessionContext, pageId: string): Promise<boolean> {
  return (await readBodyIn(tx, ctx, pageId)).blocks.length > 0
}

/** 페이지 자신을 블록으로 — `child_page {title}`(노션은 페이지 id 도 블록 id 다). */
export async function pageBlockObjectIn(tx: Tx, ctx: SessionContext, page: LoadedPage): Promise<Record<string, unknown>> {
  const title = page.title.map((r) => (typeof r?.plain_text === 'string' ? r.plain_text : '')).join('')
  return apiBlockObject(page.id, { type: 'child_page', payload: { title }, hasChildren: await hasBodyIn(tx, ctx, page.id) }, {
    parent: page.parent,
    createdTime: page.createdAt,
    lastEditedTime: page.lastEditedAt,
    createdBy: page.createdBy,
    lastEditedBy: page.lastEditedBy,
    inTrash: page.trashed,
  })
}

/** 데이터베이스를 블록으로 — `child_database {title}`. 행은 자식이 아니다(노션과 같다). */
export function databaseBlockObject(database: LoadedDatabase): Record<string, unknown> {
  return apiBlockObject(database.id, { type: 'child_database', payload: { title: database.title }, hasChildren: false }, {
    parent: database.parent,
    createdTime: database.createdAt,
    lastEditedTime: database.lastEditedAt,
    createdBy: database.createdBy,
    lastEditedBy: database.lastEditedBy,
    inTrash: database.trashed,
  })
}

// ── 쓰기 ──────────────────────────────────────────────────────────────

/**
 * 받은 블록이 가리키는 올린 파일 — 이 워크스페이스의 파일이고 그 블록이 받는 종류(이미지는 image/* · 비디오는 video/*)여야 한다. 맞지 않는
 * 첫 자리의 글을 돌려준다(없으면 null). 다른 워크스페이스의 파일 id 를 본문에 심는 길을 막는다.
 */
export async function uploadIssueIn(tx: Tx, ctx: SessionContext, uploads: readonly UploadRef[]): Promise<string | null> {
  if (uploads.length === 0) return null
  const files = new Map(
    (
      await tx.query<{ id: string; mime: string | null }>(`SELECT id, mime FROM file WHERE id = ANY($1::uuid[]) AND workspace_id = $2`, [
        uploads.map((u) => u.id),
        ctx.workspaceId,
      ])
    ).map((f) => [f.id, f.mime ?? ''] as const),
  )
  for (const upload of uploads) {
    const mime = files.get(upload.id)
    if (mime === undefined) return `${upload.path} should be a file uploaded to this workspace, instead was "${upload.id}".`
    if (upload.blockType !== 'file' && !mime.startsWith(`${upload.blockType}/`)) {
      return `${upload.path} should be an ${upload.blockType} file, instead was a file of type "${mime || 'unknown'}".`
    }
  }
  return null
}

/**
 * 방금 만든 페이지(같은 트랜잭션)의 본문을 쓴다 — 본문 세션(경로 ② · 출처 `api`). `POST /v1/pages` 의 `children`. 거부면 그 까닭(영어).
 */
export async function writeNewPageBodyIn(tx: Tx, ctx: SessionContext, pageId: string, blocks: readonly EditorBlock[]): Promise<string | null> {
  if (blocks.length === 0) return null
  // 잠금 순서 — 본문을 가진 페이지 행 → 스냅샷(`body-write.ts` ①)
  await tx.query(`SELECT id FROM block WHERE id = $1 FOR UPDATE`, [pageId])
  const body = await openPageBody(tx, ctx, pageId, 'api')
  const next = docToPm({ blocks })
  body.change((tr) => {
    tr.replaceWith(0, tr.doc.content.size, next.content)
  })
  const result = await body.finish({ origin: 'api' })
  if (result.ok) return null
  return result.reason === 'page_ref_too_deep' ? 'The page is nested too deeply for these blocks.' : `The page content could not be saved (${result.reason}).`
}

/** 새 블록 id — 서버가 만든다(노션처럼 받은 id 는 없다). */
export const newApiBlockId = (): string => randomUUID()
