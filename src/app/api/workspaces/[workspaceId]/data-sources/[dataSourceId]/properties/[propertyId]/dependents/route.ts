/**
 * 이 속성을 읽는 수식 · 롤업 — GET `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/dependents`
 * (DB 심화 2j-1조각 · F-03-13)
 *
 * 머리 메뉴가 "속성 삭제" · "유형 바꾸기"를 열 때 부른다 — 누르기 전에 무엇이 깨지는지 말하려고(`property-dependents.ts`).
 * 답: `{ dependents: [{ id, name, type, tableName }], hidden }` — 다른 표의 롤업은 그 표를 볼 수 있을 때만 이름이 있고, 아니면 `hidden` 으로 센다.
 * 표를 볼 수 없거나 속성이 없으면 404(존재를 알리지 않는다).
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listPropertyDependents } from '@/lib/database/property-dependents'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/dependents'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const listed = await listPropertyDependents(session.ctx, dataSourceId, propertyId)
  if (!listed.ok) return Response.json({ error: listed.reason }, { status: 404 })
  return Response.json({ ok: true, ...listed.value })
}
