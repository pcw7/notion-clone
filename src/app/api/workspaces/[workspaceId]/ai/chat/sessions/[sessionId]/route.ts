/**
 * /api/workspaces/[workspaceId]/ai/chat/sessions/[sessionId] — 내 AI 대화 하나 (AI-6 · F-10-17)
 *
 *   GET    — `{ ok, session: { id, title, scope, updatedAt, messages: [{ id, role, content, status, sources: [{…, viewable}] }] } }`
 *   PATCH  — `{ title }` 이름 바꾸기(1~60자 · 아니면 400 `invalid_title`)
 *   DELETE — 지운다(대화와 메시지 — 원장은 남는다) · `{ ok: true }`
 *
 * 그 사람의 대화가 아니면(남의 것 · 없다) 모두 404 — 있는지 새지 않는다. 판정 · 질의는 `lib/ai/chat-store.ts`.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteChatSession, getChatSession, renameChatSession } from '@/lib/ai/chat-store'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/chat/sessions/[sessionId]'>

const notFound = () => Response.json({ ok: false, error: 'not_found' }, { status: 404 })

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, sessionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const found = await getChatSession(session.ctx, sessionId)
  return found === null ? notFound() : Response.json({ ok: true, session: found })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, sessionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const title = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { title?: unknown }).title : undefined
  const result = await renameChatSession(session.ctx, sessionId, title)
  if (result.ok) return Response.json({ ok: true, session: result.value })
  return result.reason === 'not_found' ? notFound() : Response.json({ ok: false, error: result.reason }, { status: 400 })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, sessionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return (await deleteChatSession(session.ctx, sessionId)) ? Response.json({ ok: true }) : notFound()
}
