/**
 * 속성 타입 바꾸기 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/convert` (2c-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] 프로퍼티 타입 바꾸기 / 03-database-core.md F-03-14
 *
 * 본문: `{ type, confirmLoss?, expectedVersion? }`. 값이 사라지는 칸이 있으면 `409 lossy_conversion` 과 그 개수(`lost`)를 준다 —
 * 화면은 "N개 칸의 값이 사라집니다"를 묻고 `confirmLoss: true` 를 실어 다시 보낸다. 바꿀 수 없는 쌍은 `400 unsupported_type`, 제목은
 * `400 title_immutable`, 칸이 상한을 넘으면 `409 too_large`.
 *
 * `PATCH …/properties/{id}` 가 타입을 받지 않는 이유는 그 라우트 머리말 그대로다 — 이름을 고치려다 데이터를 잃는 길을 만들지 않는다.
 * 타입 바꾸기는 이 주소 하나다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { convertProperty } from '@/lib/database/property-convert'
import { convertFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/properties/[propertyId]/convert'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { type?: unknown; confirmLoss?: unknown; expectedVersion?: unknown }

  const result = await convertProperty(session.ctx, dataSourceId, propertyId, {
    type: body.type,
    confirmLoss: body.confirmLoss === true,
    ...(typeof body.expectedVersion === 'string' ? { expectedVersion: body.expectedVersion } : {}),
  })
  if (!result.ok) {
    return Response.json(
      { error: result.reason, ...(result.lost !== undefined ? { lost: result.lost } : {}), ...(result.currentVersion !== undefined ? { currentVersion: result.currentVersion } : {}) },
      { status: convertFailureStatus(result.reason) },
    )
  }
  return Response.json({ ok: true, ...result.value })
}
