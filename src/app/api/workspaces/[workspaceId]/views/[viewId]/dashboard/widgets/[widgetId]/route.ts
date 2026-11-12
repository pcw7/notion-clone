/**
 * 대시보드의 위젯 지우기 — DELETE `/api/workspaces/[workspaceId]/views/[viewId]/dashboard/widgets/[widgetId]` (DB-1 · F-04-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③ — 위젯을 지우면 배치에서 빼고 그 줄을 당긴다 · 빈 줄은 없앤다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { removeDashboardWidget } from '@/lib/database/dashboard'
import { dashboardFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/dashboard/widgets/[widgetId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId, widgetId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId) || !isUuid(widgetId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const removed = await removeDashboardWidget(session.ctx, viewId, widgetId)
  if (!removed.ok) return failureResponse(dashboardFailureStatus(removed.reason), removed)
  return Response.json({ ok: true, dashboard: removed.value })
}
