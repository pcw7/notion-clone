/**
 * POST /api/workspaces/[workspaceId]/ai/complete — AI 응답 하나 (AI-1 · F-10-09 · F-10-12)
 *
 * 본문 `{ feature, prompt | messages, pageId? }` → 게이트(호출 전에 예약) → 공급자 → SSE(`event: delta|done|error`). 거부는 JSON —
 * 429 `ai_limit_reached` · 403 `ai_disabled` · 503 `ai_unavailable` …. 형식 · 상태는 `lib/ai/complete-http.ts` 의 머리말이 정본이다.
 * 연결을 닫으면(멈추기) 공급자 연결도 닫히고 그 응답은 `stopped`(셈에 든다).
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ①~④
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiCompleteResponse } from '@/lib/ai/complete-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/complete'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  return aiCompleteResponse(session.ctx, parsed.body, request.signal)
}
