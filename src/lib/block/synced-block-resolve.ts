/**
 * 동기화 블록 사본의 해석 · 접근 요청 — 사본이 가리키는 원본 X 가 어느 페이지에 있고 이 사람이 볼 수 있는가 (SB-2 · F-01-11 · 정본 [보강 SB-0] ⑦ ⑨ · SY6 · SY7)
 *
 *   ok         X 의 행이 살아 있는 원본이고 그 페이지 A 가 살아 있고 `can(capsA,'view')` — `pageId` 를 준다(사본이 A 의 문서에 붙는다)
 *   no_access  볼 수 없다 — 휴지통이든 아니든. **id · 제목 · 상태를 싣지 않는다**
 *   trashed    볼 수 있는데 A 가 휴지통이다
 *   missing    행이 없거나(지웠다 · 영구 삭제 · 아직 투영 전) 원본이 아니다 · A 가 영구 삭제됐다
 *
 * 해석은 길 안내일 뿐이고 문은 협업 서버다 — 그 사이 권한이 바뀌면 연결이 닫힌다(5c). 권한은 `SessionContext` 와 능력 비트(`can`)로만 묻는다
 * (레벨을 견주지 않는다 · 게스트도 같다). 질의는 `ctx.workspaceId` 에 묶인다 — 다른 워크스페이스의 원본은 없는 것이다(SY6).
 *
 * 접근 요청은 X 로 보낸다 — 서버가 A 를 찾아 A 의 `page_access` 요청을 연다. 화면은 A 의 id · 제목을 모른다.
 *
 * 사본 수(SB-4 · ⑬ · ⑪ⓒ)도 여기다 — 원본을 지우거나 잘라낼 때 화면이 묻는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { requestAccess, type AccessRequestResult } from '../permissions/access-request.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps, readableScopes } from '../permissions/effective.ts'
import { plainTitleOf } from './page.ts'
import { SYNCED_BLOCK_TYPE, SYNCED_FROM_KEY } from './synced-block.ts'

export type SyncedResolution =
  | { readonly state: 'ok'; readonly pageId: string }
  | { readonly state: 'no_access' }
  | { readonly state: 'trashed' }
  | { readonly state: 'missing' }

/** X 가 든 페이지 — 살아 있는 원본의 행일 때만. 조상 중 가장 깊은 페이지(정본 ④). */
async function originalPageOf(tx: Tx, ctx: SessionContext, blockId: string): Promise<{ id: string; lifecycle: string } | null> {
  if (!isUuid(blockId)) return null
  const row = await tx.queryMaybe<{ page_id: string | null; lifecycle: string | null }>(
    `SELECT p.id AS page_id, p.lifecycle::text AS lifecycle
       FROM block b
       LEFT JOIN LATERAL (
         SELECT a.id, a.lifecycle FROM unnest(b.ancestor_path) WITH ORDINALITY AS t(id, depth)
           JOIN block a ON a.id = t.id AND a.type = 'page'
          ORDER BY t.depth DESC LIMIT 1
       ) p ON true
      WHERE b.id = $1 AND b.workspace_id = $2 AND b.type = $3 AND NOT (b.properties ? $4)`,
    [blockId.toLowerCase(), ctx.workspaceId, SYNCED_BLOCK_TYPE, SYNCED_FROM_KEY],
  )
  return row === null || row.page_id === null || row.lifecycle === null ? null : { id: row.page_id, lifecycle: row.lifecycle }
}

/** 해석(⑨) — 머리말의 넷. */
export async function resolveSyncedBlock(ctx: SessionContext, blockId: string): Promise<SyncedResolution> {
  return withReadTransaction(async (tx) => {
    const page = await originalPageOf(tx, ctx, blockId)
    if (page === null) return { state: 'missing' }
    if (!can(await effectiveCaps(tx, ctx, page.id), 'view')) return { state: 'no_access' }
    if (page.lifecycle === 'trashed') return { state: 'trashed' }
    if (page.lifecycle !== 'live') return { state: 'missing' }
    return { state: 'ok', pageId: page.id }
  })
}

/** 원본 X 가 보이는 곳 — 페이지마다 한 줄(그 안의 첫 블록 · 원본이 있으면 원본). */
export type SyncedPlace = {
  readonly pageId: string
  readonly title: string
  /** 그 페이지에서 X 를 보이는 블록 — 원본이면 X, 사본이면 그 사본. */
  readonly blockId: string
  readonly original: boolean
}

/** 한 번에 돌려주는 페이지 수 — 줄 하나 · 목록 하나에 그린다. */
export const SYNCED_PLACES_LIMIT = 50

/**
 * "다른 N개 페이지에서 편집 중"(SB-3 · 정본 ㉑ [SB-3 고침]) — X 의 페이지(원본)와 X 를 가리키는 사본의 페이지들 중 **살아 있고 이 사람이 볼 수 있는
 * 것만**(`perm_scope_id = ANY(readableScopes)` — 볼 수 없는 페이지는 수에도 들지 않는다 · 백링크와 같은 판결). 원본 먼저, 그다음 최근에 고친
 * 페이지 차례. 사본은 역인덱스(`ix_block_synced_copies` — 부분 식 인덱스라 술어를 글자 그대로 쓴다)로 찾는다. 사본의 페이지는 그 행의
 * `ancestor_path` 에서 가장 깊은 `page` 다(정본 ④).
 */
export async function listSyncedPlaces(ctx: SessionContext, originalId: string): Promise<SyncedPlace[]> {
  if (!isUuid(originalId)) return []
  const id = originalId.toLowerCase()
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    const rows = await tx.query<{ block_id: string; original: boolean; page_id: string; properties: { title?: unknown } | null }>(
      `SELECT block_id, original, page_id, properties FROM (
         SELECT DISTINCT ON (p.id) s.id AS block_id, s.original, p.id AS page_id, p.properties, p.last_edited_at
           FROM (
             SELECT b.id, true AS original, b.ancestor_path FROM block b
              WHERE b.id = $2::uuid AND b.workspace_id = $1 AND b.type = 'synced_block' AND NOT (b.properties ? 'synced_from')
             UNION ALL
             SELECT b.id, false, b.ancestor_path FROM block b
              WHERE b.workspace_id = $1 AND b.type = 'synced_block' AND b.properties ? 'synced_from' AND (b.properties ->> 'synced_from') = $3
           ) s
           JOIN LATERAL (
             SELECT a.id, a.properties, a.lifecycle, a.perm_scope_id, a.last_edited_at
               FROM unnest(s.ancestor_path) WITH ORDINALITY AS t(id, depth)
               JOIN block a ON a.id = t.id AND a.type = 'page'
              ORDER BY t.depth DESC LIMIT 1
           ) p ON true
          WHERE p.lifecycle = 'live' AND p.perm_scope_id = ANY($4::uuid[])
          ORDER BY p.id, s.original DESC, s.id
       ) d
       ORDER BY d.original DESC, d.last_edited_at DESC, d.page_id
       LIMIT ${SYNCED_PLACES_LIMIT}`,
      [ctx.workspaceId, id, id, scopes],
    )
    return rows.map((r) => ({ pageId: r.page_id, title: plainTitleOf(r.properties), blockId: r.block_id, original: r.original }))
  })
}

/**
 * X 를 가리키는 사본이 든 **살아 있는** 페이지와 그 안의 사본 수 — 권한을 보지 않는다(호출자가 본다). id 순. 역인덱스
 * (`ix_block_synced_copies` — 술어를 글자 그대로)로 찾고, 사본의 페이지는 그 행의 `ancestor_path` 에서 가장 깊은 `page` 다(정본 ④). 휴지통의
 * 페이지 · 아직 투영되지 않은 사본은 없다(⑫ⓑ · ⑬ — 받아들인다).
 */
export async function syncedCopyPagesIn(tx: Tx, workspaceId: string, originalId: string): Promise<{ readonly pageId: string; readonly copies: number }[]> {
  const rows = await tx.query<{ page_id: string; n: string }>(
    `SELECT p.id AS page_id, count(*) AS n
       FROM block b
       JOIN LATERAL (
         SELECT a.id, a.lifecycle FROM unnest(b.ancestor_path) WITH ORDINALITY AS t(id, depth)
           JOIN block a ON a.id = t.id AND a.type = 'page'
          ORDER BY t.depth DESC LIMIT 1
       ) p ON true
      WHERE b.workspace_id = $1 AND b.type = 'synced_block' AND b.properties ? 'synced_from' AND (b.properties ->> 'synced_from') = $2
        AND p.lifecycle = 'live'
      GROUP BY p.id
      ORDER BY p.id`,
    [workspaceId, originalId.toLowerCase()],
  )
  return rows.map((r) => ({ pageId: r.page_id, copies: Number(r.n) }))
}

/** 원본 X 의 사본 수(⑬ 지우기 확인 · ⑪ⓒ 잘라내기 알림 · SB-4) — `elsewhere` 는 X 의 페이지 밖의 것. */
export type SyncedCopyCount = { readonly copies: number; readonly elsewhere: number }

/**
 * 사본 수 — X 가 살아 있는 원본이고 그 페이지를 볼 수 있을 때만(아니면 null — 없는 것과 같은 답). 볼 수 없는 페이지의 사본도 센다 — 수만
 * 싣고 이름 · id 는 싣지 않는다(정본 ⑬). 살아 있는 페이지의 것만.
 */
export async function countSyncedCopies(ctx: SessionContext, originalId: string): Promise<SyncedCopyCount | null> {
  return withReadTransaction(async (tx) => {
    const page = await originalPageOf(tx, ctx, originalId)
    if (page === null || !can(await effectiveCaps(tx, ctx, page.id), 'view')) return null
    const pages = await syncedCopyPagesIn(tx, ctx.workspaceId, originalId)
    const copies = pages.reduce((sum, p) => sum + p.copies, 0)
    return { copies, elsewhere: copies - (pages.find((p) => p.pageId === page.id)?.copies ?? 0) }
  })
}

/**
 * 사본에서 보내는 접근 요청 — X 의 페이지 A 에 `page_access` 를 연다. 결과에 A 를 싣지 않는다. X 가 살아 있는 원본이 아니면 `not_found`
 * (요청할 수 없는 페이지와 같은 답이다).
 */
export async function requestSyncedOriginalAccess(ctx: SessionContext, blockId: string): Promise<AccessRequestResult> {
  const page = await withReadTransaction((tx) => originalPageOf(tx, ctx, blockId))
  if (page === null) return { ok: false, reason: 'not_found' }
  return requestAccess(ctx, page.id, 'page_access')
}
