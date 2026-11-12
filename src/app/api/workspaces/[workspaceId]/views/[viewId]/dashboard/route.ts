/**
 * 대시보드의 배치 — GET/PATCH `/api/workspaces/[workspaceId]/views/[viewId]/dashboard` (DB-1 · F-04-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 DB-1] ③
 *
 * GET → `{ ok, dashboard: { id, layout, updatedAt, widgets } }` — 원본을 볼 수 없는 위젯은 이름 · 타입 · 소스 없이 `accessible: false`.
 * PATCH `{ layout, updatedAt }` — 읽은 판의 `updatedAt` 을 함께 보낸다. 그 사이 바뀌었으면 409 `conflict`(다시 읽는다).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { readDashboard, updateDashboardLayout } from '@/lib/database/dashboard'
import { dashboardFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/dashboard'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const got = await readDashboard(session.ctx, viewId)
  if (!got.ok) return failureResponse(dashboardFailureStatus(got.reason), got)
  return Response.json({ ok: true, dashboard: got.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { layout?: unknown; updatedAt?: unknown }

  const updated = await updateDashboardLayout(session.ctx, viewId, { layout: body.layout, updatedAt: body.updatedAt })
  if (!updated.ok) return failureResponse(dashboardFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, dashboard: updated.value })
}
