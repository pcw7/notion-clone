/**
 * 참여 — POST `/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/join` (7c-5조각 · F-06-04)
 *
 * 둘러보기에서 스스로 들어온다. 멤버 넣기(`…/members`)와 라우트를 갈라 둔 까닭은 묻는 것이 다르기 때문이다 — 그쪽은
 * "넣는 사람이 그럴 역할인가", 이쪽은 "이 teamspace 가 나를 받는가"다(`joinTeamspace`).
 *
 *   open → 201 · closed → 403 `needs_invite` · private · 없는 것 · 둘러볼 수 없는 역할 → 404
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { joinTeamspace } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/join'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const joined = await joinTeamspace(session.ctx, teamspaceId)
  if (!joined.ok) return teamspaceFailureResponse(joined)
  return Response.json({ ok: true }, { status: 201 })
}
