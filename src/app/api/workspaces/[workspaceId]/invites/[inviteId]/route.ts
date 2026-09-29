/**
 * DELETE /api/workspaces/[workspaceId]/invites/[inviteId] — 대기 중인 초대를 취소한다 (7g-3 · F-14-10)
 *
 * 멤버 초대와 게스트의 대기 초대(7g-1) 모두. owner · membership_admin 만(`canInvite`) — 아니면 403. 그런 대기 중인 초대가
 * 없으면(없는 id · 다른 워크스페이스 · 이미 받아들였거나 취소했다) 404. 보낸 링크는 곧바로 무효가 된다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { revokeInvite } from '@/lib/workspace/invite'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/invites/[inviteId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, inviteId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const result = await revokeInvite(session.ctx, inviteId)
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: result.reason === 'forbidden' ? 403 : 404 })
  }
  return Response.json({ ok: true, email: result.value.email })
}
