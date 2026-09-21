/**
 * teamspace 하나 — GET(멤버) `/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]` (7c-1조각 · F-06-04)
 *
 * 멤버만 읽는다 — 멤버가 아니면 없는 teamspace 와 같은 404 다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listTeamspaceMembers } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const members = await listTeamspaceMembers(session.ctx, teamspaceId)
  if (!members.ok) return teamspaceFailureResponse(members)
  return Response.json({ members: members.value })
}
