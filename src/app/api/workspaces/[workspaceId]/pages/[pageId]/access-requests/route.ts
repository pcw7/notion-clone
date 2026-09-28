/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/access-requests — 볼 수 없는 페이지의 접근을 요청한다 (7e-1 · F-06-15)
 *
 * 몸체 없음. 이 워크스페이스의 사람이, 볼 수 없는 살아 있는 페이지에. 이미 열린 요청이 있으면 새로 만들지 않는다(`sent: false`
 * — 화면은 둘 다 "보냈습니다"). 이미 볼 수 있으면 409 `has_access`, 요청할 수 있는 페이지가 아니면 404.
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { requestPageAccess } from '@/lib/permissions/access-request'
import { accessRequestResponse } from '@/lib/permissions/access-request-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/access-requests'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const result = await requestPageAccess(session.ctx, pageId)
  if (!result.ok) return accessRequestResponse(result)
  return Response.json({ ok: true, sent: result.value.sent })
}
