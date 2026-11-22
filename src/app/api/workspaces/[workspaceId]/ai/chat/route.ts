/**
 * POST /api/workspaces/[workspaceId]/ai/chat — AI 채팅의 한 턴 (AI-6 · F-10-17 · F-10-22)
 *
 * 본문 `{ sessionId?, message, scope? }` → 게이트(호출 전에 예약 · 기능 `chat`) → 문맥(서버가 짓는다) → 공급자 → SSE(`session` · `delta` ·
 * `done` · `error`). 형식 · 상태는 `lib/ai/chat-http.ts` 의 머리말이 정본이다. 연결을 닫으면(멈추기) 답은 `stopped`(셈에 든다).
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑪
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiChatResponse } from '@/lib/ai/chat-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/chat'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  return aiChatResponse(session.ctx, parsed.body, request.signal)
}
