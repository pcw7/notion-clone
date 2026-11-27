/**
 * POST /api/workspaces/[workspaceId]/synced-blocks/[blockId]/access-requests — 사본에서 원본 페이지에 접근을 요청한다 (SB-2 · 정본 [보강 SB-0] ⑦ · F-06-15)
 *
 * 요청은 원본 X 로 보내고 서버가 X 의 페이지 A 를 찾아 `page_access` 요청을 연다(`requestSyncedOriginalAccess`). 답에 A 를 싣지 않는다 —
 * `{ ok: true, sent }` · 이미 볼 수 있으면 409 `has_access` · X 가 살아 있는 원본이 아니거나 요청할 수 없는 페이지면 404(둘을 가르지 않는다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { requestSyncedOriginalAccess } from '@/lib/block/synced-block-resolve'
import { accessRequestResponse } from '@/lib/permissions/access-request-http'

export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/synced-blocks/[blockId]/access-requests'>,
): Promise<Response> {
  const { workspaceId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await requestSyncedOriginalAccess(session.ctx, blockId)
  if (!result.ok) return accessRequestResponse(result)
  return Response.json({ ok: true, sent: result.value.sent })
}
