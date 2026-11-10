/**
 * 페이지의 걸린 제안 목록 — 메타 표 `suggestion` 의 `open` 행 (SG-2 · F-05-12)
 *
 * 정본: 00-canonical-data-model.md 제안 편집 (U-2) · [보강 SG-1] ④ ⑤
 *
 * SG-3 의 "제안" 목록 · 카드가 읽는다. 문은 페이지 화면과 같다 — 살아 있는 페이지 · `view`. 아니면 없는 페이지와 같은 답(`not_found`).
 * 사람 이름은 편집 이력과 같은 규칙이다 — 멤버 목록을 받을 수 없는 역할(게스트)에게는 "멤버"(`block/edit-info.ts`).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { editorLabel, editorNames } from '../block/edit-info.ts'
import { withReadTransaction } from '../db/tx.ts'
import type { SuggestionKind } from '../editor/suggestion-original.ts'
import { isUuid } from '../ids.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { canListMembers } from '../workspace/list.ts'

export type OpenSuggestion = {
  readonly id: string
  readonly kind: SuggestionKind
  readonly authorId: string
  readonly authorName: string
  readonly preview: string | null
  readonly createdAt: Date
}

export type ListSuggestionsResult =
  | { readonly ok: true; readonly suggestions: readonly OpenSuggestion[] }
  | { readonly ok: false; readonly reason: 'not_found' }

/** 이 페이지의 걸린(`open`) 제안 — 처음 본 차례. */
export async function listOpenSuggestions(ctx: SessionContext, pageId: string): Promise<ListSuggestionsResult> {
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }
  const rows = await withReadTransaction(async (tx) => {
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (page === null || !can(await effectiveCaps(tx, ctx, pageId), 'view')) return null
    return tx.query<{ id: string; kind: SuggestionKind; author_id: string; preview: string | null; created_at: Date }>(
      `SELECT id, kind, author_id, preview, created_at FROM suggestion
        WHERE page_id = $1 AND state = 'open'
        ORDER BY created_at, id`,
      [pageId],
    )
  })
  if (rows === null) return { ok: false, reason: 'not_found' }
  const names = await editorNames(ctx, rows.map((r) => r.author_id))
  const canSeeNames = canListMembers(ctx.role)
  return {
    ok: true,
    suggestions: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      authorId: r.author_id,
      authorName: editorLabel(r.author_id, names, canSeeNames),
      preview: r.preview,
      createdAt: r.created_at,
    })),
  }
}
