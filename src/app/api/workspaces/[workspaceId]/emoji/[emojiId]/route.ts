/**
 * /api/workspaces/[workspaceId]/emoji/[emojiId] — 커스텀 이모지 하나 (인접 제품 7c-1 · F-13-16)
 *
 *   PATCH  — `{ name }` — 이름을 바꾼다(쓰인 곳은 id 로 가리키므로 따라간다). 올린 사람이나 소유자(403) · 400 `invalid_name` ·
 *            409 `duplicate_name` · 없거나 지웠으면 404
 *   DELETE — 지운다(표시만 남는다 — 쓰인 곳은 "지운 이모지" 로 그린다 · 파일 참조를 내린다). 올린 사람이나 소유자
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지 ②③. 판정은 `emoji/custom-emoji.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteCustomEmoji, emojiFailureStatus, renameCustomEmoji } from '@/lib/emoji/custom-emoji'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/emoji/[emojiId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, emojiId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const name = (parsed.body as { name?: unknown } | null)?.name
  const result = await renameCustomEmoji(session.ctx, emojiId, name)
  return result.ok
    ? Response.json({ ok: true, emoji: result.value })
    : Response.json({ ok: false, error: result.reason }, { status: emojiFailureStatus(result.reason) })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, emojiId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await deleteCustomEmoji(session.ctx, emojiId)
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ ok: false, error: result.reason }, { status: emojiFailureStatus(result.reason) })
}
