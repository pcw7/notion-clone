/**
 * 갤러리 카드의 미리보기 — 행 페이지 본문의 첫 이미지 (DB 심화 2f-2조각 · F-04-05)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 갤러리 ④ · 04-database-views.md F-04-05 *"`page_content`: 페이지 본문의 첫 이미지
 *       블록을 썸네일로 사용 [추정]"*
 *
 * 행마다 본문의 **최상위** 블록 중 처음 오는 이미지 하나(토글 · 컬럼 안은 보지 않는다 — §7). 순서는 `block.order_key`(Y.Doc 에서 파생 —
 * X-1 · 투영이 늦으면 한 박자 늦는다). 질의 하나로 행 전부를 묻는다(`DISTINCT ON` · `ix_block_children_live`).
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
import { imageDisplayUrl, readImageSource } from '../block/image.ts'

/** 행 id → 카드에 넣을 이미지 주소. 이미지가 없는 행은 빠진다. */
export type CardCovers = Readonly<Record<string, string>>

export async function readCardCovers(ctx: SessionContext, rowIds: readonly string[]): Promise<CardCovers> {
  if (rowIds.length === 0) return {}
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return {}
    const rows = await tx.query<{ row_id: string; properties: unknown }>(
      // 부모(행 페이지)도 살아 있어야 한다 — 행을 휴지통에 보내도 본문 블록은 `live` 로 남는다(검사가 잡았다).
      `SELECT DISTINCT ON (b.parent_id) b.parent_id AS row_id, b.properties
         FROM live_block b
         JOIN live_block rp ON rp.id = b.parent_id
        WHERE b.parent_type = 'block' AND b.parent_id = ANY($1::uuid[])
          AND b.workspace_id = $2 AND b.type = 'image'
          AND b.perm_scope_id = ANY($3::uuid[])
        ORDER BY b.parent_id, b.order_key, b.id`,
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
