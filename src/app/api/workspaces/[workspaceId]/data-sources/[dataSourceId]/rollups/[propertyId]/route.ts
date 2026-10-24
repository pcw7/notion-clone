/**
 * rollup 프로퍼티 고치기 — PATCH `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollups/[propertyId]` (10n-31)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 — 고치기 / 03-database-core.md F-03-11
 *
 * 본문: `{ relationPropertyId?, targetPropertyId?, function?, expectedVersion? }` — 보낸 것만 바꾸고 나머지는 지금 값이다. 검사는 만들기와
 * 같다(`checkRollupSetting`): relation 이 이 표의 것이 아니거나 · 대상 표를 볼 수 없거나 · 대상이 셀 타입이 아니면 `invalid_target`(400) ·
 * 함수가 대상 타입에 맞지 않으면 `invalid_config`(400) · 롤업이 아니거나 없으면 `not_found`(404).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { updateRollupProperty } from '@/lib/database/rollup'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollups/[propertyId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as {
    relationPropertyId?: unknown
    targetPropertyId?: unknown
    function?: unknown
    expectedVersion?: unknown
  }

  const updated = await updateRollupProperty(session.ctx, dataSourceId, propertyId, {
    ...(body.relationPropertyId !== undefined ? { relationPropertyId: body.relationPropertyId } : {}),
    ...(body.targetPropertyId !== undefined ? { targetPropertyId: body.targetPropertyId } : {}),
    ...(body.function !== undefined ? { function: body.function } : {}),
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!updated.ok) return failureResponse(propertyFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, schema: updated.value })
}
