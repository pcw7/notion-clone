/**
 * rollup 프로퍼티 만들기 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollups` (rollup 5c-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] rollup v1 / 03-database-core.md F-03-11
 *
 * `properties` 라우트와 따로 둔다 — rollup 의 config 는 다른 프로퍼티 둘(이 표의 relation · 그 대상 표의 프로퍼티)을
 * 가리키고, 그 둘이 맞물리는지를 만들 때 검사한다. 본문: `{ name, relationPropertyId, targetPropertyId, function }`.
 *
 * relation 이 이 표의 것이 아니거나, 대상 표를 볼 수 없거나, 대상이 셀 타입이 아니면 전부 같은 답이다(`invalid_target` ·
 * 400) — 못 보는 표의 스키마를 id 를 찍어 보며 알아낼 수 없다. 함수가 대상 타입에 맞지 않으면 `invalid_config`.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addRollupProperty } from '@/lib/database/rollup'
import { DEFAULT_ROLLUP_FUNCTION, isRollupFunction } from '@/lib/database/rollup-functions'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/rollups'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as {
    name?: unknown
    relationPropertyId?: unknown
    targetPropertyId?: unknown
    function?: unknown
    expectedVersion?: unknown
  }
  // 함수를 안 보냈으면 기본 함수다(F-03-11: 기본 계산은 `show_original`). 보냈는데 모르는 값이면 거부한다 —
  // 오타를 조용히 기본값으로 바꾸면 "합을 골랐는데 목록이 나온다".
  if (body.function !== undefined && !isRollupFunction(body.function)) {
    return Response.json({ error: 'invalid_config' }, { status: 400 })
  }

  const added = await addRollupProperty(session.ctx, dataSourceId, {
    name: typeof body.name === 'string' ? body.name : '',
    // 모양이 틀린 id 는 그대로 넘긴다 — 판정(`invalid_target`)은 라이브러리가 한다.
    relationPropertyId: typeof body.relationPropertyId === 'string' ? body.relationPropertyId : '',
    targetPropertyId: typeof body.targetPropertyId === 'string' ? body.targetPropertyId : '',
    function: body.function ?? DEFAULT_ROLLUP_FUNCTION,
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!added.ok) return failureResponse(propertyFailureStatus(added.reason), added)

  const { schema, propertyId } = added.value
  return Response.json({ ok: true, schema, property: schema.properties.find((p) => p.id === propertyId) }, { status: 201 })
}
