/**
 * 제안 수락 · 거절의 기록 — 메타 표 `suggestion` 의 state · 누가 · 언제 (SG-3 · F-05-12 · 판결 U-2 · 불변식 S9)
 *
 * 정본: 00-canonical-data-model.md [보강 SG-1] ⑤ · 제안 편집 (U-2) · 마이그레이션 0140
 *
 * 수락 · 거절의 진실은 본문이다 — 편집기가 **먼저** 한 트랜잭션으로 마크를 떼고 글을 지운다(`editor/suggestion-resolve.ts` · 커밋 주체는
 * 누른 사람). 이 명령은 **그다음에** 표를 맞춘다. 차례가 이래서 안전하다:
 *
 *   - 본문이 먼저 서버에 닿아 투영이 돌면 그 행은 `stale` 이 된다(마크가 사라졌다 · S8) — 그래서 `open` 과 `stale` 을 함께 받는다
 *   - 이 명령이 먼저 돌면 행은 `accepted` · `rejected` 다 — 투영은 그 둘을 건드리지 않는다(`project.ts`) · 마크가 사라져도 그대로
 *   - 이 명령이 실패하면(연결이 끊겼다) 본문은 이미 바뀌었고 투영이 행을 `stale` 로 둔다 — 화면이 실패를 알린다
 *   - 이미 정한 행(`accepted` · `rejected`)은 다시 쓰지 않는다 — 둘이 함께 눌렀으면 먼저 쓴 사람이 남는다(`resolved` 에 없다)
 *
 * 문은 본문을 고칠 수 있는 사람이다(`edit_content` · 잠긴 페이지는 아니다 — 협업 접속 판정과 같다). 볼 수 없으면 없는 페이지와 같은 답.
 * 마크의 author_id 는 보여 주는 메타일 뿐 — 판정은 누른 사람의 권한이다(`project.ts` 머리말).
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction } from '../db/tx.ts'
import type { ResolveAction } from '../editor/suggestion-resolve.ts'
import { isUuid } from '../ids.ts'
import { notifySuggestionsAccepted } from '../notification/fanout.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'
import { isLocked } from '../permissions/lock.ts'

/** 한 번에 정할 수 있는 제안 수 — 모두 수락 · 모두 거절의 상한. */
export const RESOLVE_LIMIT = 1000

export type ResolveSuggestionsResult =
  | { readonly ok: true; readonly resolved: readonly string[] }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' | 'invalid' }

const STATE_OF: Readonly<Record<ResolveAction, 'accepted' | 'rejected'>> = { accept: 'accepted', reject: 'rejected' }

/**
 * 이 페이지의 제안들을 수락 · 거절로 적는다 — 아직 정하지 않은 것(`open` · `stale`)만. 정한 sid 를 돌려준다(없는 sid · 이미 정한 sid ·
 * 다른 페이지의 sid 는 빠진다 — 아직 투영되지 않은 방금 친 제안도 그렇다).
 */
export async function resolveSuggestions(
  ctx: SessionContext,
  pageId: string,
  ids: unknown,
  action: unknown,
): Promise<ResolveSuggestionsResult> {
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }
  if ((action !== 'accept' && action !== 'reject') || !Array.isArray(ids) || ids.length === 0 || ids.length > RESOLVE_LIMIT) {
    return { ok: false, reason: 'invalid' }
  }
  if (!ids.every((id): id is string => typeof id === 'string')) return { ok: false, reason: 'invalid' }
  // 모양이 틀린 sid 는 표에 없다(투영이 넣지 않는다) — 거부하지 않고 뺀다
  const wanted = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))]

  return withCommandTransaction(async (tx) => {
    const page = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'`,
      [pageId, ctx.workspaceId],
    )
    if (page === null) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_content') || (await isLocked(tx, pageId))) return { ok: false, reason: 'forbidden' } as const
    if (wanted.length === 0) return { ok: true, resolved: [] } as const

    const rows = await tx.query<{ id: string; author_id: string }>(
      `UPDATE suggestion SET state = $3, resolved_by = $4, resolved_at = now()
        WHERE page_id = $1 AND id = ANY($2::uuid[]) AND state IN ('open', 'stale')
        RETURNING id, author_id`,
      [pageId, wanted, STATE_OF[action], ctx.userId],
    )
    // 수락만 제안한 사람에게 알린다(SG-4 · 거절은 알리지 않는다)
    if (action === 'accept') {
      await notifySuggestionsAccepted(tx, ctx, { pageId, suggestions: rows.map((r) => ({ id: r.id, authorId: r.author_id })) })
    }
    return { ok: true, resolved: rows.map((r) => r.id) } as const
  })
}
