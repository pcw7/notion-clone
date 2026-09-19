/**
 * select 옵션 추가 — POST
 * `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/options`
 *
 * 정본: 00-canonical-data-model.md §3.5 `select_option` · 03-database-core.md F-03-04
 *
 * 셀 팝오버의 *"`XXX` 생성"* 이 부른다. 같은 이름(대소문자 무시)이 이미 있으면
 * 새로 만들지 않고 그 옵션을 돌려준다(`addSelectOption` 머리말 — 동시 생성의 수렴).
 * 그래서 상태 코드가 둘이다: 만들었으면 201, 있던 것을 줬으면 200. 화면은 어느
 * 쪽이든 받은 `option.id` 를 셀에 넣으면 된다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addSelectOption } from '@/lib/database/property'
import type { OptionColor, StatusGroupKind } from '@/lib/database/property-types'
import { failureResponse, propertyFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/options'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; color?: unknown; group?: unknown }

  const added = await addSelectOption(session.ctx, dataSourceId, propertyId, {
    name: typeof body.name === 'string' ? body.name : '',
    // 색 검사는 라이브러리가 한다(`invalid_color`).
    ...(body.color !== undefined ? { color: body.color as OptionColor } : {}),
    // status 옵션의 범주. 값 검사는 라이브러리가 한다(`invalid_group`).
    ...(body.group !== undefined ? { group: body.group as StatusGroupKind } : {}),
  })
  if (!added.ok) return failureResponse(propertyFailureStatus(added.reason), added)
  return Response.json(
    { ok: true, option: added.value.option, created: added.value.created, schemaVersion: added.value.schemaVersion },
    { status: added.value.created ? 201 : 200 },
  )
}
