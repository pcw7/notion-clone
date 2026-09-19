/**
 * relation 프로퍼티 만들기 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations` (relation 5a조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 `relation_edge` · 불변식 E1 / 03-database-core.md F-03-10
 *
 * `properties` 라우트와 따로 둔다 — relation 은 프로퍼티 **하나**가 아니라 때로 **둘**을(그것도 다른 표에) 한 트랜잭션에서
 * 만든다. 본문: `{ name, targetDataSourceId, twoWay?: { name }, limit?: 'one' | 'none' }` — 네 가지 모양은
 * `lib/database/relation.ts` 머리말.
 *
 * 대상 표를 볼 수 없으면 없는 표와 같은 답(`invalid_target` · 400)이다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addRelationProperty } from '@/lib/database/relation'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as {
    name?: unknown
    targetDataSourceId?: unknown
    twoWay?: unknown
    limit?: unknown
    expectedVersion?: unknown
  }
  const twoWay =
    typeof body.twoWay === 'object' && body.twoWay !== null ? (body.twoWay as { name?: unknown }) : undefined

  const added = await addRelationProperty(session.ctx, dataSourceId, {
    name: typeof body.name === 'string' ? body.name : '',
    // 모양이 틀린 대상은 그대로 넘긴다 — 판정(`invalid_target`)은 라이브러리가 한다.
    targetDataSourceId: typeof body.targetDataSourceId === 'string' ? body.targetDataSourceId : '',
    ...(twoWay !== undefined ? { twoWay: { name: typeof twoWay.name === 'string' ? twoWay.name : '' } } : {}),
    ...(body.limit === 'one' ? { limit: 'one' as const } : {}),
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!added.ok) return failureResponse(propertyFailureStatus(added.reason), added)

  const { schema, propertyId, syncedPropertyId } = added.value
  return Response.json(
    { ok: true, schema, property: schema.properties.find((p) => p.id === propertyId), syncedPropertyId },
    { status: 201 },
  )
}
