/**
 * 멤버 한 사람 — 멤버 관리 10o-1 (F-06-02)
 *
 *   PATCH  `/api/workspaces/[workspaceId]/members/[userId]`  `{ role }`  역할 바꾸기  →  `{ ok, from, to, teamspaces }`
 *   DELETE `/api/workspaces/[workspaceId]/members/[userId]`              내보내기     →  `{ ok, role }`
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기. owner · membership_admin 만 — 관리 역할(owner ·
 * membership_admin)을 주거나 가진 사람은 owner 만 건드린다. 게스트는 게스트의 길(`/guests/[userId]`)이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { changeMemberRole, removeMember } from '@/lib/workspace/member'
import { memberManageResponse } from '@/lib/workspace/member-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/members/[userId]'>

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, userId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(userId)) return notFound()

  const body = (await request.json().catch(() => null)) as { role?: unknown } | null
  const changed = await changeMemberRole(session.ctx, userId, body?.role)
  if (!changed.ok) return memberManageResponse(changed)
  return Response.json({ ok: true, ...changed.value })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, userId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(userId)) return notFound()

  const removed = await removeMember(session.ctx, userId)
  if (!removed.ok) return memberManageResponse(removed)
  return Response.json({ ok: true, role: removed.value.role })
}
