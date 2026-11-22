/**
 * GET /api/workspaces/[workspaceId]/ai/usage/log — AI 활동 기록 (AI-7 · F-10-25)
 *
 * 쿼리 `cursor?` · `member?`(사람 id) · `feature?`(ask · edit · translate · block · chat) → `{ entries, nextCursor }`(최근 것부터 50 ·
 * 키셋 커서). 페이지는 보는 사람이 지금 볼 수 있을 때만 제목(아니면 `{kind:'hidden'}`). 다른 멤버는 자기 것만 — 남을 거르면 403 · 게스트는
 * 404 · 모양이 틀리면 400 `invalid_input`.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫. 판정 · 질의는 `lib/ai/analytics.ts`.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiUsageLogFor } from '@/lib/ai/analytics'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/usage/log'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const q = new URL(request.url).searchParams
  const result = await aiUsageLogFor(session.ctx, { cursor: q.get('cursor'), member: q.get('member'), feature: q.get('feature') })
  if (result.ok) return Response.json({ ok: true, ...result.value })
  const status = result.reason === 'forbidden' ? 403 : result.reason === 'not_found' ? 404 : 400
  return Response.json({ ok: false, error: result.reason }, { status })
}
