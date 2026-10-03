/**
 * 데이터베이스의 data source — GET/POST `/api/workspaces/[workspaceId]/databases/[databaseId]/data-sources` (잔여 묶음 8e-1 · F-04-23)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 다중 data source · 04-database-views.md F-04-23
 *
 * GET 은 붙은 data source 들(부착 순서) · POST 는 하나를 더한다 — 표 뷰 하나가 함께 생기고, 응답이 그 뷰 id 를 준다(화면이 그 탭을 연다).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addDataSource, listDataSources } from '@/lib/database/data-source'
import { dataSourceFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/data-sources'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const sources = await listDataSources(session.ctx, databaseId)
  if (!sources.ok) return failureResponse(dataSourceFailureStatus(sources.reason), sources)
  return Response.json({ ok: true, dataSources: sources.value })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown }

  const added = await addDataSource(session.ctx, databaseId, 'name' in body ? { name: body.name } : {})
  if (!added.ok) return failureResponse(dataSourceFailureStatus(added.reason), added)
  return Response.json({ ok: true, dataSource: added.value.dataSource, viewId: added.value.viewId }, { status: 201 })
}
