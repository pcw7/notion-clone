/**
 * POST /api/workspaces/[workspaceId]/access-requests/[requestId]/approve — 접근 요청을 허락한다 (7e-1 · F-06-15)
 *
 * `{ "level": "view" | "comment" | "edit" | "full_access" }`. 그 페이지를 공유할 수 있는 사람만. 부여는 공유 설정과 같은 길을
 * 거친다(`grantAccessIn` — 게스트에게 전체 권한은 400 `guest_level`). 이미 처리된 요청은 409 `decided`.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { approveAccessRequest } from '@/lib/permissions/access-request'
import { accessRequestResponse } from '@/lib/permissions/access-request-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/access-requests/[requestId]/approve'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, requestId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(requestId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { level?: unknown }

  const result = await approveAccessRequest(session.ctx, requestId, body.level)
  if (!result.ok) return accessRequestResponse(result)
  return Response.json({ ok: true, granted: result.value.granted })
}
