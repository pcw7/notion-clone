/**
 * POST /api/workspaces/[workspaceId]/guests/[userId]/promote — 게스트를 멤버로 올린다 (7d-3 · F-06-09)
 *
 * 받은 부여는 그대로 · 워크스페이스 전체 접근이 얹힌다 · 기본 teamspace 에 들어간다(`promoteGuest` 머리말). owner ·
 * membership_admin 만.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { promoteGuest } from '@/lib/workspace/guest'
import { guestManageResponse } from '@/lib/workspace/guest-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/guests/[userId]/promote'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, userId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(userId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const promoted = await promoteGuest(session.ctx, userId)
  if (!promoted.ok) return guestManageResponse(promoted)
  return Response.json({ ok: true, teamspaces: promoted.value.teamspaces })
}
