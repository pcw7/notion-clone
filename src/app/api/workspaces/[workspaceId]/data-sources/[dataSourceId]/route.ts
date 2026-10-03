/**
 * data source 하나 — PATCH `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]` (잔여 묶음 8e-1 · F-04-23)
 *
 * 이름을 바꾼다(`{ name }`). 권한은 주인 데이터베이스의 `edit_structure` 이고, 잠긴 데이터베이스는 409 다(`data-source.ts`).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { renameDataSource } from '@/lib/database/data-source'
import { dataSourceFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown }

  const renamed = await renameDataSource(session.ctx, dataSourceId, body.name)
  if (!renamed.ok) return failureResponse(dataSourceFailureStatus(renamed.reason), renamed)
  return Response.json({ ok: true, dataSource: renamed.value })
}
