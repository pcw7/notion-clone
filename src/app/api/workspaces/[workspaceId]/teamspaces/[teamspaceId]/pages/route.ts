/**
 * teamspace 의 최상위 페이지 — GET `/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/pages` (7c-1조각 · F-06-04)
 *
 * 볼 수 있는 것만 온다(`listTeamspacePages` — 스코프로 거른다). teamspace 를 볼 수 없으면 빈 목록이다 — 없는 teamspace 와
 * 같은 답이다. 만들기는 `POST pages` 의 `teamspaceId`.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listTeamspacePages } from '@/lib/block/page'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/pages'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ pages: [] })

  const pages = await listTeamspacePages(session.ctx, teamspaceId)
  return Response.json({ pages: pages.map((p) => ({ id: p.id, title: p.plainTitle })) })
}
