/**
 * 컬럼 추가 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties`
 *
 * 정본: 00-canonical-data-model.md §3.5 `property` · 03-database-core.md F-03-02
 *
 * 주소가 **data_source** 다. 데이터베이스가 아니다 — 컬럼을 소유하는 것은
 * data_source 이고(판결 C-5: 소유와 부착은 다른 축), 링크드 DB 의 뷰는 남의
 * data_source 를 보여준다. 데이터베이스 주소로 받으면 "어느 data_source 의
 * 컬럼인가"를 서버가 추측해야 한다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addProperty } from '@/lib/database/property'
import type { MvpPropertyType } from '@/lib/database/property-types'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; type?: unknown; expectedVersion?: unknown }

  // 타입이 틀린 값은 그대로 넘긴다 — 무엇이 MVP 타입인지는 라이브러리가 판정한다
  // (`title` 은 `title_immutable`, 모르는 값은 `unsupported_type`). 여기서 거르면
  // 판정이 두 곳이 된다.
  const added = await addProperty(session.ctx, dataSourceId, {
    name: typeof body.name === 'string' ? body.name : '',
    ...(body.type !== undefined ? { type: body.type as MvpPropertyType } : {}),
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!added.ok) return failureResponse(propertyFailureStatus(added.reason), added)

  // 새 컬럼은 **맨 뒤**다(`addProperty` 가 마지막 키 뒤에 붙이고, 스키마는 그
  // 순서로 읽힌다). data_source 를 잠근 채 붙였으므로 사이에 끼어든 것이 없다.
  const props = added.value.properties
  return Response.json(
    { ok: true, schema: added.value, property: props[props.length - 1] },
    { status: 201 },
  )
}
