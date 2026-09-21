/**
 * 그룹에서 빼기 — DELETE `/api/workspaces/[workspaceId]/groups/[groupId]/members/[userId]` (7a조각 · F-06-03)
 *
 * 행은 남긴다(`removed_at` — M1). 그룹에 없는 사람이면 아무것도 바꾸지 않고 200 이다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { removeGroupMember } from '@/lib/workspace/group'
import { userGroupFailureResponse } from '@/lib/workspace/group-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/groups/[groupId]/members/[userId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, groupId, userId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(groupId)) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!isUuid(userId)) return Response.json({ error: 'invalid_member' }, { status: 400 })

  const removed = await removeGroupMember(session.ctx, groupId, userId)
  if (!removed.ok) return userGroupFailureResponse(removed)
  return Response.json({ ok: true })
}
