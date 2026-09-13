/**
 * 컬럼 하나 — PATCH(이름 · 설명) · DELETE(soft delete)
 * `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]`
 *
 * 정본: 00-canonical-data-model.md §3.5 `property`(불변식 P1 · P2) · 03 F-03-02
 *
 * **타입은 여기서 바꾸지 않는다.** 타입 변환은 F-03-09(모든 셀을 다시 쓰는 작업 +
 * 손실 경고)이고, 이름을 고치는 요청에 `type` 을 함께 받으면 "이름만 바꾸려다
 * 데이터를 잃는" 경로가 생긴다(`updateProperty` 머리말).
 *
 * `propertyId` 는 uuid 가 아니다 — nanoid(21) text 다(C-4). 그래서 형식 가드가 없고,
 * 틀린 값은 그냥 "없는 컬럼"으로 떨어진다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteProperty, updateProperty } from '@/lib/database/property'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; description?: unknown; expectedVersion?: unknown }

  const hasName = typeof body.name === 'string'
  // `description: null` 은 "비워라"다. 키가 없으면 그대로 둔다.
  const hasDescription = typeof body.description === 'string' || body.description === null
  if (!hasName && !hasDescription) {
    return Response.json({ error: 'invalid_name' }, { status: 400 })
  }

  const updated = await updateProperty(session.ctx, dataSourceId, propertyId, {
    ...(hasName ? { name: body.name as string } : {}),
    ...(hasDescription ? { description: body.description as string | null } : {}),
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!updated.ok) return failureResponse(propertyFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, schema: updated.value })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const removed = await deleteProperty(session.ctx, dataSourceId, propertyId)
  if (!removed.ok) return failureResponse(propertyFailureStatus(removed.reason), removed)
  return Response.json({ ok: true, schema: removed.value })
}
