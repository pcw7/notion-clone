/**
 * /api/workspaces/[workspaceId]/emoji — 커스텀 이모지 (인접 제품 7c-1 · F-13-16)
 *
 *   GET  — 살아 있는 이모지 `{ emoji: [{ id, name, fileId, createdBy, createdAt, canManage }] }`(이름 순) · 워크스페이스의 누구나
 *   POST — `{ name, fileId }` — 이미지는 먼저 올린 파일(`POST /files`). 201 `{ emoji }` · 게스트 · 소유자만 설정이면 403 `forbidden` ·
 *          400 `invalid_name` | `invalid_file` | `too_large` · 409 `duplicate_name` | `too_many`
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강] 커스텀 이모지. 판정은 `emoji/custom-emoji.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createCustomEmoji, emojiFailureStatus, listCustomEmoji } from '@/lib/emoji/custom-emoji'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/emoji'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return Response.json({ ok: true, emoji: await listCustomEmoji(session.ctx) })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown; fileId?: unknown }
  const result = await createCustomEmoji(session.ctx, { name: body.name, fileId: body.fileId })
  return result.ok
    ? Response.json({ ok: true, emoji: result.value }, { status: 201 })
    : Response.json({ ok: false, error: result.reason }, { status: emojiFailureStatus(result.reason) })
}
