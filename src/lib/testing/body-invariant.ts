/**
 * 4b 의 불변식 — **본문 행은 그 페이지 Y.Doc 의 투영이다** (판결 X-1)
 *
 * 명령이 끝난 뒤 한 페이지의 본문을 두 곳에서 읽어 같은 문서인지 본다.
 *
 *   - 행: `loadPageBody` — 편집기가 읽는 경로. ProseMirror 왕복의 정규형으로 맞춘다(Y.Doc 층이 더하는 차이만 본다)
 *   - Y.Doc: 로그를 읽어 `readBodyYDoc`
 *
 * ⚠ Y.Doc 이 **이미 옮겨져 있어야** 검사가 뜻이 있다. 옮기지 않은 페이지를 읽으면 그 자리에서 행으로 옮기므로 늘 같다.
 *   그래서 스냅샷이 있는지 먼저 단언한다 — 명령이 본문 세션을 거쳤다는 증거이기도 하다.
 */

import assert from 'node:assert/strict'

import type { SessionContext } from '../auth/session-context.ts'
import { loadPageBody } from '../block/save-page-body.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { readBodyYDoc } from '../collab/ydoc.ts'
import { query } from '../db/pool.ts'
import type { EditorDoc } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import type { BlockId } from '../ids.ts'

/** 이 페이지의 본문 행과 Y.Doc 이 같은 문서로 읽힌다. 읽은 문서를 돌려준다. */
export async function assertBodyMatchesYDoc(ctx: SessionContext, pageId: string, label = pageId): Promise<EditorDoc> {
  const snapshots = await query<{ page_id: string }>(`SELECT page_id FROM doc_snapshot WHERE page_id = $1`, [pageId])
  assert.equal(snapshots.length, 1, `${label}: 본문이 Y.Doc 으로 옮겨지지 않았다 — 명령이 본문 세션을 거치지 않았다`)

  const rows = await loadPageBody(ctx, pageId as BlockId)
  assert.ok(rows !== null, `${label}: 본문을 읽지 못했다`)
  const state = await loadDocState(ctx, pageId)
  assert.ok(state.ok, `${label}: Y.Doc 을 읽지 못했다`)

  const fromRows = pmToDoc(docToPm(rows.doc))
  const fromYDoc = readBodyYDoc(state.value.ydoc, pageId).doc
  assert.deepEqual(fromYDoc, fromRows, `${label}: 행과 Y.Doc 이 다른 본문이다`)
  return fromYDoc
}
