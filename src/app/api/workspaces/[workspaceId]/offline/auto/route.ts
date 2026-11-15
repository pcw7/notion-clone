/**
 * GET /api/workspaces/[workspaceId]/offline/auto — 자동 내려받기의 원천 (OF-5 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑥)
 *
 *   200  `{ favorites: string[], recent: string[] }` — 이 사람의 즐겨찾기 · 최근 10개(볼 수 있는 페이지 id · 화면의 차례). 내보내기 정책이
 *        막으면 둘 다 빈 목록
 *   403  `plan_required` — 요금제가 자동 내려받기를 허락하지 않는다(Free)
 *   404  `not_found` — 워크스페이스에 들어올 수 없다(게이트)
 *
 * 판정은 `offlineAutoSources`. 응답은 그 사람의 것이라 어디에도 남기지 않는다(`private, no-store` — OF-2 · OF-3 의 라우트와 같다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { offlineAutoSources } from '@/lib/offline/offline-auto-sources'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/offline/auto'>

const PRIVATE = { 'cache-control': 'private, no-store' }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const sources = await offlineAutoSources(session.ctx)
  if (!sources.ok) return Response.json({ error: sources.reason }, { status: 403, headers: PRIVATE })
  return Response.json(sources.value, { headers: PRIVATE })
}
