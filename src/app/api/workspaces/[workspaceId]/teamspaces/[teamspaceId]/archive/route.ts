/**
 * 보관 — POST `…/teamspaces/[teamspaceId]/archive` (7c-6조각 · F-06-04)
 *
 * teamspace 는 지워지지 않고 보관된다. 보관하면 **owner 까지** 그 페이지들을 못 보고, 되살리면 정확히 돌아온다
 * (`archiveTeamspace` 머리말). owner 만 — 아니면 403, 멤버가 아니거나 이미 보관됐으면 404.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { archiveTeamspace } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/archive'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const done = await archiveTeamspace(session.ctx, teamspaceId)
  if (!done.ok) return teamspaceFailureResponse(done)
  return Response.json({ ok: true })
}
