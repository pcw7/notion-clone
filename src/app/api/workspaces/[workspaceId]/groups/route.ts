/**
 * 그룹 — GET(목록) · POST(만들기) `/api/workspaces/[workspaceId]/groups` (7a조각 · F-06-03)
 *
 * 목록은 게스트가 아닌 멤버 전원이 읽고(공유 패널이 그룹 이름을 알아야 한다), 만들기는 owner · membership_admin
 * 만 한다(`workspace/group.ts` 머리말).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createGroup, listGroups } from '@/lib/workspace/group'
import { userGroupFailureResponse } from '@/lib/workspace/group-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/groups'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const listed = await listGroups(session.ctx)
  if (!listed.ok) return userGroupFailureResponse(listed)
  return Response.json({ groups: listed.value })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown }

  const created = await createGroup(session.ctx, body.name)
  if (!created.ok) return userGroupFailureResponse(created)
  return Response.json({ group: { ...created.value, memberCount: 0 } }, { status: 201 })
}
