/**
 * teamspace 하나 — GET(머리 · 멤버) · PATCH(설정) `…/teamspaces/[teamspaceId]` (7c-1 · 7c-2 · 7c-5조각 · F-06-04)
 *
 * 멤버만 읽는다 — 멤버가 아니면 없는 teamspace 와 같은 404 다. 머리(`teamspace` — 이름 · 내 역할 · 초대 규칙)를 멤버와
 * 함께 준다: 설정 화면은 조작 뒤에 이것 하나를 다시 읽어 **내 역할까지** 새로 받는다(스스로 owner 를 내려놓으면 버튼이
 * 바뀌어야 한다).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { getTeamspace, listTeamspaceMembers, updateTeamspace } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const teamspace = await getTeamspace(session.ctx, teamspaceId)
  if (!teamspace.ok) return teamspaceFailureResponse(teamspace)
  const members = await listTeamspaceMembers(session.ctx, teamspaceId)
  if (!members.ok) return teamspaceFailureResponse(members)
  return Response.json({ teamspace: teamspace.value, members: members.value })
}

/** 설정 — 이름 · 공개 범위 · 초대 규칙. owner 만(7c-5). 고친 뒤에는 화면이 GET 하나를 다시 읽는다. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; visibility?: unknown; whoCanInvite?: unknown }

  const updated = await updateTeamspace(session.ctx, teamspaceId, body)
  if (!updated.ok) return teamspaceFailureResponse(updated)
  return Response.json({ ok: true })
}
