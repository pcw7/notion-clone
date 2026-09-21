/**
 * 그룹 하나 — GET(멤버) · PATCH(이름) · DELETE `/api/workspaces/[workspaceId]/groups/[groupId]` (7a조각 · F-06-03)
 *
 * 지우기는 그 그룹이 받은 부여까지 지운다 — 응답의 `nodes` 가 부여를 거둔 페이지 · 데이터베이스의 수다. 지우면 관리할
 * 사람이 남지 않는 페이지가 생기면 409 `would_orphan` 이고 `nodes` 가 그런 페이지의 수다(`workspace/group.ts`).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteGroup, listGroupMembers, renameGroup } from '@/lib/workspace/group'
import { userGroupFailureResponse } from '@/lib/workspace/group-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/groups/[groupId]'>

const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, groupId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(groupId)) return notFound()

  const listed = await listGroupMembers(session.ctx, groupId)
  if (!listed.ok) return userGroupFailureResponse(listed)
  return Response.json({ members: listed.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, groupId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(groupId)) return notFound()

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown }

  const renamed = await renameGroup(session.ctx, groupId, body.name)
  if (!renamed.ok) return userGroupFailureResponse(renamed)
  return Response.json({ ok: true })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, groupId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(groupId)) return notFound()

  const deleted = await deleteGroup(session.ctx, groupId)
  if (!deleted.ok) return userGroupFailureResponse(deleted)
  return Response.json({ ok: true, nodes: deleted.value.nodes })
}
