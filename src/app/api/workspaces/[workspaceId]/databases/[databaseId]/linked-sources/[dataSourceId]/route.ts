/**
 * 붙인 소스를 뗀다 — DELETE `/api/workspaces/[workspaceId]/databases/[databaseId]/linked-sources/[dataSourceId]` (2l-1 · F-04-13)
 *
 * 부착 행이 빠지고 그 위의 뷰가 함께 사라진다 — 원본은 그대로다. 소유한 소스는 409(`owned_source` — 휴지통이 그 길이다) · 마지막 살아 있는
 * 소스도 409(`last_source`).
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { detachLinkedDataSource } from '@/lib/database/data-source'
import { dataSourceFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/linked-sources/[dataSourceId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const detached = await detachLinkedDataSource(session.ctx, databaseId, dataSourceId)
  if (!detached.ok) return failureResponse(dataSourceFailureStatus(detached.reason), detached)
  return Response.json({ ok: true })
}
