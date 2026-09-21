/**
 * teamspace — GET(내가 멤버인 것) · POST(만들기) `/api/workspaces/[workspaceId]/teamspaces` (7c-1조각 · F-06-04)
 *
 * 만든 사람이 owner 가 된다. 둘러보기(내가 멤버가 아닌 open · closed teamspace)는 아직 없다(§7).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createTeamspace, listMyTeamspaces } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return Response.json({ teamspaces: await listMyTeamspaces(session.ctx) })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; visibility?: unknown }

  const created = await createTeamspace(session.ctx, { name: body.name, visibility: body.visibility })
  if (!created.ok) return teamspaceFailureResponse(created)
  return Response.json({ teamspace: created.value }, { status: 201 })
}
