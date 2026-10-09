/**
 * 다른 데이터베이스의 소스를 붙인다 — POST `/api/workspaces/[workspaceId]/databases/[databaseId]/linked-sources` (2l-1 · F-04-13)
 *
 * 정본: 00-canonical-data-model.md §3.5 `database_data_source`(부착 · DS2 `is_linked` 는 파생) · 04-database-views.md F-04-13
 *
 * 본문: `{ dataSourceId }`. 이 데이터베이스의 `edit_structure` 와 원본을 볼 수 있어야 한다 — 볼 수 없으면 404(남의 표의 소스가 있는지 알리지
 * 않는다). 표 뷰 하나가 함께 생기고 응답이 그 뷰 id 를 준다(화면이 그 탭을 연다). 이미 붙었으면 409, 제 것이면 400.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { attachLinkedDataSource } from '@/lib/database/data-source'
import { dataSourceFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/linked-sources'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { dataSourceId?: unknown }

  const attached = await attachLinkedDataSource(session.ctx, databaseId, { dataSourceId: body.dataSourceId })
  if (!attached.ok) return failureResponse(dataSourceFailureStatus(attached.reason), attached)
  return Response.json({ ok: true, dataSource: attached.value.dataSource, viewId: attached.value.viewId }, { status: 201 })
}
