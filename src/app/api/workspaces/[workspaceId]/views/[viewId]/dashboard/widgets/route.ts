/**
 * 대시보드에 위젯 넣기 — POST `/api/workspaces/[workspaceId]/views/[viewId]/dashboard/widgets` (DB-1 · F-04-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ②③
 *
 * `{ dataSourceId, type, name?, row? }` → 201 `{ ok, widgetId, dashboard }`. 자리가 없으면(12개 · 3줄) 409 `full`.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addDashboardWidget } from '@/lib/database/dashboard'
import type { WidgetViewType } from '@/lib/database/dashboard-layout'
import { dashboardFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/dashboard/widgets'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { dataSourceId?: unknown; type?: unknown; name?: unknown; row?: unknown }
  if (typeof body.dataSourceId !== 'string' || !isUuid(body.dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })
  if (typeof body.type !== 'string') return Response.json({ error: 'unsupported_type' }, { status: 400 })

  const added = await addDashboardWidget(session.ctx, viewId, {
    dataSourceId: body.dataSourceId,
    type: body.type as WidgetViewType,
    ...(body.name !== undefined ? { name: body.name as string } : {}),
    ...(body.row !== undefined ? { row: body.row as number } : {}),
  })
  if (!added.ok) return failureResponse(dashboardFailureStatus(added.reason), added)
  return Response.json({ ok: true, widgetId: added.value.widgetId, dashboard: added.value.dashboard }, { status: 201 })
}
