/**
 * 소유자로 들어가기 — POST `…/teamspaces/[teamspaceId]/claim` (7c-10조각 · F-06-04)
 *
 * 워크스페이스 owner 가 스스로 그 teamspace 의 owner 가 된다 — 고아 teamspace 를 되살리는 길이다. 비공개 · 보관된 것에도
 * 들어간다. 멤버 목록에 이름이 서므로 몰래 여는 문이 아니다(`claimTeamspaceOwnership`). 워크스페이스 owner 가 아니면 404 —
 * 이 경로가 있다는 것도 알려 주지 않는다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { isUuid } from '@/lib/ids'
import { claimTeamspaceOwnership } from '@/lib/workspace/teamspace'
import { teamspaceFailureResponse } from '@/lib/workspace/teamspace-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/teamspaces/[teamspaceId]/claim'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, teamspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(teamspaceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const done = await claimTeamspaceOwnership(session.ctx, teamspaceId)
  if (!done.ok) return teamspaceFailureResponse(done)
  return Response.json({ ok: true })
}
