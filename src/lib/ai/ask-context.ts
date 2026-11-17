/**
 * 묻기의 문맥 — 그 페이지의 제목 · 원문을 서버가 읽는다 (AI-2 · F-10-01 · DB)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑥ *"그 페이지의 원문 — 제안 마크 밖 · 그 사람이 볼 수 있는 것만"*
 *
 * 편집기가 보낸 페이지 글을 믿지 않는다 — 공개 API · 내보내기와 같은 원문 읽기(`readBodyIn` → `readBodyYDoc` — 넣자는 제안 글은 빠지고
 * 지우자는 글은 그냥 글이다)를 `view` 를 물은 뒤에 한다. 살아 있는 페이지만 · 볼 수 없거나 없으면 null(404 — 있는지 새지 않는다).
 */

import { readBodyIn } from '../api/block-body.ts'
import type { SessionContext } from '../auth/session-context.ts'
import { plainTitleOf } from '../block/page.ts'
import { withReadTransaction } from '../db/tx.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import type { AskPage } from './ask-prompt.ts'

export async function readAskPage(ctx: SessionContext, pageId: string): Promise<AskPage | null> {
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ properties: { title?: unknown } | null }>(
      `SELECT properties FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (row === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return null
    return { title: plainTitleOf(row.properties), doc: await readBodyIn(tx, ctx, pageId) }
  })
}
