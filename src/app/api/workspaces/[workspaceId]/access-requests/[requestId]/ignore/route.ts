/**
 * POST /api/workspaces/[workspaceId]/access-requests/[requestId]/ignore — 접근 요청을 무시한다 (7e-1 · F-06-15)
 *
 * 몸체 없음. 그 페이지를 공유할 수 있는 사람만. 요청한 사람에게 알리지 않는다 — 하루 동안 그 사람의 화면은 "보냈습니다" 그대로다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { ignoreAccessRequest } from '@/lib/permissions/access-request'
import { accessRequestResponse } from '@/lib/permissions/access-request-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/access-requests/[requestId]/ignore'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, requestId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(requestId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const result = await ignoreAccessRequest(session.ctx, requestId)
  if (!result.ok) return accessRequestResponse(result)
  return Response.json({ ok: true })
}
