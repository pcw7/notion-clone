/**
 * 갤러리 카드의 미리보기 — 행 페이지 본문의 첫 이미지 · 행 페이지의 커버 (DB 심화 2f-2조각 · 34번 트랙 PC-5 · F-04-05 · F-02-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 갤러리 ④ · 04-database-views.md F-04-05 *"`page_content`: 페이지 본문의 첫 이미지
 *       블록을 썸네일로 사용 [추정]"*
 *
 * 행마다 본문을 **깊이 우선 차례**로 걸어 처음 오는 이미지 하나(Y-1 — 토글 · 컬럼 · 콜아웃 · 목록 안도 · 하위 페이지 · 데이터베이스 안으로는
 * 내려가지 않는다 · 깊이 열까지). 차례는 조상들의 `block.order_key` 를 이은 길(`chr(1)` 로 잇는다 — 어떤 키 글자보다 작아 "부모 다음 그
 * 자식들, 그다음 형제" 가 바이트 차례로 선다 · Y.Doc 에서 파생 — X-1 · 투영이 늦으면 한 박자 늦는다). 질의 하나로 행 전부를 묻는다
 * (재귀 + `DISTINCT ON` · `ix_block_children_live`).
 *
 * 값은 **화면에 넣을 주소**다 — 우리 파일이면 `imageContentPath`(세션으로 인증 · 서명 URL 을 저장하지 않는다 FS2), 외부면 그 URL
 * (받을 때 http/https 로 거른 값 · `image.ts`). 빈 이미지 블록은 건너뛰지 않고 "미리보기 없음"이다 — 비어 있는 첫 이미지 뒤의 것을 찾지
 * 않는다(본문을 쓰는 사람이 그 자리를 비워 둔 것이다).
 *
 * 권한: 부르는 쪽은 이미 그 행들을 볼 수 있다고 확인했다(행 질의의 게이트). 그래도 여기서 한 번 더 **읽을 수 있는 스코프**의 블록만
 * 본다 — 행의 본문은 행과 같은 스코프를 물려받지만, 이 함수가 아무 id 묶음이나 받아도 새지 않게.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { imageContentPath, imageDisplayUrl, readImageSource } from '../block/image.ts'
import { coverBackground, readPageCover } from '../block/page-cover.ts'
import { GALLERY_COVER_MAX_DEPTH, type GalleryLayout } from './gallery.ts'

/** 본문을 걷는 깊이의 상한(Y-1) — 그보다 깊은 이미지는 보지 않는다(편집기의 중첩도 그만큼 깊지 않다). */
const MAX_COVER_DEPTH = GALLERY_COVER_MAX_DEPTH

/**
 * 카드의 미리보기 하나 — 이미지 주소(글) 또는 내장 커버의 배경(PC-5 — 단색 · 그라디언트는 그림이 아니다). 글을 그대로 둔 것은 2f-2 부터의
 * 응답 모양(행 id → 주소)을 지키려서다.
 */
export type CardCover = string | { readonly background: string }

/** 행 id → 카드에 넣을 미리보기. 없는 행은 빠진다. */
export type CardCovers = Readonly<Record<string, CardCover>>

/** 레이아웃의 미리보기(`gallery.cover`)대로 읽는다 — 본문의 첫 이미지 · 행 페이지의 커버 · 없음. */
export async function readGalleryCovers(ctx: SessionContext, cover: GalleryLayout['cover'], rowIds: readonly string[]): Promise<CardCovers> {
  if (cover === 'page_content') return readCardCovers(ctx, rowIds)
  if (cover === 'page_cover') return readPageCoverCards(ctx, rowIds)
  return {}
}

/**
 * 행 페이지의 커버(PC-5 · 정본 §3.4 [보강 PC-5]) — 올린 이미지는 워크스페이스의 파일 경로 · 주소는 그 주소 · 내장 커버는 배경. 커버가 없는
 * 행은 빠진다. 위치(PC-3)는 싣지 않는다 — 카드는 가운데로 잘라 채운다(카드의 맞춤 설정이 정한다). 읽을 수 있는 스코프의 행만(본문의 첫
 * 이미지와 같은 까닭).
 */
export async function readPageCoverCards(ctx: SessionContext, rowIds: readonly string[]): Promise<CardCovers> {
  if (rowIds.length === 0) return {}
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return {}
    const rows = await tx.query<{ id: string; cover: unknown }>(
      `SELECT id, format -> 'page_cover' AS cover FROM live_block
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND type = 'page' AND perm_scope_id = ANY($3::uuid[])
          AND format ? 'page_cover'`,
      [rowIds, ctx.workspaceId, scopes],
    )
    const out: Record<string, CardCover> = {}
    for (const r of rows) {
      const cover = readPageCover(r.cover)
      if (cover === null) continue
      out[r.id] =
        cover.type === 'gallery' ? { background: coverBackground(cover) } : cover.type === 'external' ? cover.url : imageContentPath(ctx.workspaceId, cover.file_id)
    }
    return out
  })
}

export async function readCardCovers(ctx: SessionContext, rowIds: readonly string[]): Promise<Readonly<Record<string, string>>> {
  if (rowIds.length === 0) return {}
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return {}
    const rows = await tx.query<{ row_id: string; properties: unknown }>(
      // 부모(행 페이지)도 살아 있어야 한다 — 행을 휴지통에 보내도 본문 블록은 `live` 로 남는다(검사가 잡았다).
      // 하위 페이지 · 데이터베이스 블록에서 멈춘다 — 그 아래는 그 페이지의 본문이다(Y-1).
      `WITH RECURSIVE walk AS (
         SELECT b.id, b.parent_id AS row_id, b.type, b.properties, (b.order_key COLLATE "C")::text AS path, 1 AS depth
           FROM live_block b
           JOIN live_block rp ON rp.id = b.parent_id
          WHERE b.parent_type = 'block' AND b.parent_id = ANY($1::uuid[])
            AND b.workspace_id = $2 AND b.perm_scope_id = ANY($3::uuid[])
         UNION ALL
         SELECT c.id, w.row_id, c.type, c.properties, w.path || chr(1) || c.order_key, w.depth + 1
           FROM walk w
           JOIN live_block c ON c.parent_type = 'block' AND c.parent_id = w.id
          WHERE w.type NOT IN ('page', 'database') AND w.depth < ${MAX_COVER_DEPTH}
            AND c.perm_scope_id = ANY($3::uuid[])
       )
       SELECT DISTINCT ON (row_id) row_id, properties
         FROM walk
        WHERE type = 'image'
        ORDER BY row_id, path COLLATE "C", id`,
      [rowIds, ctx.workspaceId, scopes],
    )
    const out: Record<string, string> = {}
    for (const r of rows) {
      const url = imageDisplayUrl(ctx.workspaceId, readImageSource(r.properties))
      if (url !== null) out[r.row_id] = url
    }
    return out
  })
}
