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
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, type Tx } from '../db/tx.ts'
import { isUuid } from '../ids.ts'
import { requestAccess, type AccessRequestResult } from '../permissions/access-request.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'
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

/**
 * 사본에서 보내는 접근 요청 — X 의 페이지 A 에 `page_access` 를 연다. 결과에 A 를 싣지 않는다. X 가 살아 있는 원본이 아니면 `not_found`
 * (요청할 수 없는 페이지와 같은 답이다).
 */
export async function requestSyncedOriginalAccess(ctx: SessionContext, blockId: string): Promise<AccessRequestResult> {
  const page = await withReadTransaction((tx) => originalPageOf(tx, ctx, blockId))
  if (page === null) return { ok: false, reason: 'not_found' }
  return requestAccess(ctx, page.id, 'page_access')
}
