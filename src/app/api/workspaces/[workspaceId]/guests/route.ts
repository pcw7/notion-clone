/**
 * GET /api/workspaces/[workspaceId]/guests — 게스트 목록 (7d-3 · F-06-09)
 *
 * owner · membership_admin 만(`canManageGuests`) — 아니면 403. 게스트마다 이름 · 이메일 · 받은 페이지 수.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listGuests } from '@/lib/workspace/guest'
import { guestManageResponse } from '@/lib/workspace/guest-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/guests'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const listed = await listGuests(session.ctx)
  if (!listed.ok) return guestManageResponse(listed)
  return Response.json({ guests: listed.value })
}
