/**
 * teamspace 멤버 하나 — PATCH(역할 `{ role }`) · DELETE(빼기 · 나가기)
 * `/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/members/[principalType]/[principalId]` (7c-1조각 · F-06-04)
 *
 * 역할은 owner 만 바꾼다. 빼기는 owner 는 누구든, 멤버는 자기 자신만이다. 마지막 owner 는 내리거나 뺄 수 없다(409).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { removeTeamspaceMember, setTeamspaceMemberRole } from '@/lib/workspace/teamspace'
import { readTeamspacePrincipal, teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/members/[principalType]/[principalId]'>

async function open(ctx: Ctx) {
  const { workspaceId, teamspaceId, principalType, principalId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return { ok: false as const, response: session.response }
  if (!isUuid(teamspaceId)) return { ok: false as const, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  const principal = readTeamspacePrincipal(principalType, principalId)
  if (principal === null) {
    return { ok: false as const, response: Response.json({ error: 'invalid_member' }, { status: 400 }) }
  }
  return { ok: true as const, session, teamspaceId, principal }
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const opened = await open(ctx)
  if (!opened.ok) return opened.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { role?: unknown }

  const changed = await setTeamspaceMemberRole(opened.session.ctx, opened.teamspaceId, opened.principal, body.role)
  if (!changed.ok) return teamspaceFailureResponse(changed)
  return Response.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const opened = await open(ctx)
  if (!opened.ok) return opened.response
  const removed = await removeTeamspaceMember(opened.session.ctx, opened.teamspaceId, opened.principal)
  if (!removed.ok) return teamspaceFailureResponse(removed)
  return Response.json({ ok: true })
}
