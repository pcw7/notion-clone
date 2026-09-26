/**
 * 복원 — POST `…/teamspaces/[teamspaceId]/restore` (7c-6조각 · F-06-04)
 *
 * 보관된 teamspace 를 그 **owner** 가 되살린다. 살아 있는 것을 되살리려 하면 404 다(보관된 것들 중에 없다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { restoreTeamspace } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/restore'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const done = await restoreTeamspace(session.ctx, teamspaceId)
  if (!done.ok) return teamspaceFailureResponse(done)
  return Response.json({ ok: true })
}
