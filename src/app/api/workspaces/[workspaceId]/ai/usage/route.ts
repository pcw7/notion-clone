/**
 * GET /api/workspaces/[workspaceId]/ai/usage — AI 사용량 개요 (AI-7 · F-10-25)
 *
 * `{ usage: AiUsageOverview }` — 이번 기간의 한도 · 이번 UTC 달의 합 · 지난 30일(기능마다) · 사람마다 · 기능마다 · 모델마다. 소유자 · 멤버
 * 관리자는 워크스페이스 전체(`scope: 'workspace'`), 다른 멤버는 자기 것만(`scope: 'self'`) · 게스트는 404.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫. 셈은 `lib/ai/analytics.ts`(원장만 읽는다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiUsageOverviewFor } from '@/lib/ai/analytics'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/usage'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const usage = await aiUsageOverviewFor(session.ctx)
  return usage === null ? Response.json({ ok: false, error: 'not_found' }, { status: 404 }) : Response.json({ ok: true, usage })
}
