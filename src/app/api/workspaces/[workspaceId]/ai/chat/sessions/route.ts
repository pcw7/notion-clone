/**
 * GET /api/workspaces/[workspaceId]/ai/chat/sessions — 내 AI 대화 목록 (AI-6 · F-10-17)
 *
 * `{ ok, sessions: [{ id, title, scope, updatedAt }] }` — 그 사람의 것만 · 최근 것부터 50. AI 를 쓸 수 없는 사람(게스트)은 403.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪. 판정 · 질의는 `lib/ai/chat-store.ts`.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listChatSessions } from '@/lib/ai/chat-store'
import { canUseAi } from '@/lib/ai/usage'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/chat/sessions'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!canUseAi(session.ctx)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  return Response.json({ ok: true, sessions: await listChatSessions(session.ctx) })
}
