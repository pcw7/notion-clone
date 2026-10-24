/**
 * relation 프로퍼티의 "하나만" 제한 바꾸기 — PATCH `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations/[propertyId]` (10n-42)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-42] 제한 바꾸기 / 03-database-core.md F-03-10
 *
 * 본문: `{ limit: 'one' | 'none', expectedVersion? }`. 켜도 이미 여럿이 이어진 칸은 그대로다(F-03-10 *"기존 값 유지 + 신규 입력만 제한"*).
 * 모르는 값 · 하위 항목 · 종속 관계의 짝이면 `invalid_config`(400) · relation 이 아니거나 없으면 `not_found`(404) · 구조를 못 고치면 403.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { setRelationLimit } from '@/lib/database/relation'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations/[propertyId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { limit?: unknown; expectedVersion?: unknown }

  const updated = await setRelationLimit(session.ctx, dataSourceId, propertyId, {
    limit: body.limit,
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!updated.ok) return failureResponse(propertyFailureStatus(updated.reason), updated)
  return Response.json({ ok: true, schema: updated.value })
}
