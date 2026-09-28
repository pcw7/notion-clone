/**
 * DELETE /api/workspaces/[workspaceId]/guests/[userId] — 게스트를 워크스페이스에서 뺀다 (7d-3 · F-06-09)
 *
 * 받은 부여를 모두 거둔다(`removeGuest` 머리말 — 다시 초대받아도 옛 페이지가 돌아오지 않는다). owner · membership_admin 만.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { removeGuest } from '@/lib/workspace/guest'
import { guestManageResponse } from '@/lib/workspace/guest-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/guests/[userId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, userId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(userId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const removed = await removeGuest(session.ctx, userId)
  if (!removed.ok) return guestManageResponse(removed)
  return Response.json({ ok: true, pages: removed.value.pages })
}
