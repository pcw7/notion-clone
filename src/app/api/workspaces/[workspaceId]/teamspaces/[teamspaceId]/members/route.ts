/**
 * teamspace 에 멤버 넣기 — POST `/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/members`
 * `{ principal: { type: 'user' | 'group', id }, role?: 'member' | 'owner' }` (7c-1조각 · F-06-04)
 *
 * 이미 살아 있는 멤버면 아무것도 바꾸지 않는다 — 역할은 `members/{type}/{id}` 의 PATCH 가 바꾼다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addTeamspaceMember } from '@/lib/workspace/teamspace'
import { readTeamspacePrincipal, teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/members'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { principal?: { type?: unknown; id?: unknown } | null; role?: unknown }
  const principal = readTeamspacePrincipal(body.principal?.type, body.principal?.id)
  if (principal === null) return Response.json({ error: 'invalid_member' }, { status: 400 })

  const added = await addTeamspaceMember(session.ctx, teamspaceId, principal, body.role ?? 'member')
  if (!added.ok) return teamspaceFailureResponse(added)
  return Response.json({ ok: true })
}
