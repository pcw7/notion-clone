/**
 * 검색 전체 재색인 — 운영 명령의 몸 (10p-4 · F-07-06 · HANDOFF §7 "검색 전체 재색인 경로")
 *
 * 색인 텍스트(`search_document.title_text` · `body_text` · `lang`)는 저장 · 이름 바꾸기가 같은 트랜잭션에서 쓴다. 그 밖의 길로 생긴 행 —
 * 마이그레이션 0012 의 백필(메타만 넣고 텍스트는 NULL) · 색인 규칙(`blockText`)이 바뀐 뒤의 옛 행 — 은 그 페이지가 다시 저장될 때까지
 * 검색되지 않거나 옛 텍스트로 걸린다. 이 모듈이 행에서 다시 쓴다(`reindexPageFromRows` — 저장 경로와 같은 범위 · 순서 규칙).
 *
 * 페이지마다 트랜잭션 하나 — 큰 워크스페이스에서 긴 트랜잭션을 만들지 않는다. 한 페이지가 실패해도 나머지는 간다(실패한 id 를 돌려준다).
 */

import { query } from '../db/pool.ts'
import { withTransaction } from '../db/tx.ts'
import { reindexPageFromRows } from '../block/save-page-body.ts'

export type ReindexResult = {
  /** 다시 쓴 페이지 수. */
  readonly indexed: number
  /** 그사이 사라진 페이지(없음) 수. */
  readonly missing: number
  /** 실패한 페이지 id — 다시 돌리면 된다. */
  readonly failed: readonly string[]
}

/** 이 페이지들을 다시 색인한다. */
export async function reindexPages(pageIds: readonly string[]): Promise<ReindexResult> {
  let indexed = 0
  let missing = 0
  const failed: string[] = []
  for (const id of pageIds) {
    try {
      const done = await withTransaction((tx) => reindexPageFromRows(tx, id))
      if (done) indexed += 1
      else missing += 1
    } catch {
      failed.push(id)
    }
  }
  return { indexed, missing, failed }
}

/** 한 번에 읽는 페이지 id 수. */
export const REINDEX_BATCH = 200

/**
 * 색인 행이 있는 모든 페이지를 다시 색인한다(워크스페이스를 주면 그 워크스페이스만). id 차례로 나눠 읽는다 — 도는 사이 생긴 페이지는 저장 경로가
 * 이미 색인한다. `onProgress` 는 나눔마다 지금까지의 수를 받는다.
 */
export async function reindexAllPages(
  options: { readonly workspaceId?: string; readonly onProgress?: (done: number) => void } = {},
): Promise<ReindexResult> {
  let after = '00000000-0000-0000-0000-000000000000'
  let indexed = 0
  let missing = 0
  const failed: string[] = []
  for (;;) {
    const rows = await query<{ doc_id: string }>(
      `SELECT doc_id FROM search_document
        WHERE type = 'page' AND doc_id > $1::uuid AND ($2::uuid IS NULL OR workspace_id = $2::uuid)
        ORDER BY doc_id LIMIT $3`,
      [after, options.workspaceId ?? null, REINDEX_BATCH],
    )
    if (rows.length === 0) break
    const part = await reindexPages(rows.map((r) => r.doc_id))
    indexed += part.indexed
    missing += part.missing
    failed.push(...part.failed)
    after = rows[rows.length - 1]!.doc_id
    options.onProgress?.(indexed + missing + failed.length)
    if (rows.length < REINDEX_BATCH) break
  }
  return { indexed, missing, failed }
}
