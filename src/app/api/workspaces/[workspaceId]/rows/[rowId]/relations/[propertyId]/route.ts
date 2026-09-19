/**
 * 한 칸의 연결 — GET/POST `/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]` (relation 5a조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 불변식 C2 · E1 / 03-database-core.md F-03-10
 *
 *   GET  ?cursor=&limit=          볼 수 있고 살아 있는 연결(제목과 함께) · 전체 개수 · 볼 수 없는 개수
 *   POST { add?: [], remove?: [] } 연결을 더하고 뺀다
 *
 * ★ 셀 PATCH(`rows/[rowId]`)로는 relation 을 쓸 수 없다 — 값이 셀이 아니라 엣지다(C2). **"이 목록으로 바꿔라"도 받지
 * 않는다**: 값이 집합이라 통째로 덮으면 동시에 더한 남의 연결이 사라진다(`relation.ts` 머리말).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { linkRows, readRelation, type RelationFailure } from '@/lib/database/relation'
import { failureResponse, rowJson } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]'>

/** `rowFailureStatus` 와 같은 매핑 — 못 보면 404, 볼 수는 있는데 못 고치면 403. */
function statusOf(reason: RelationFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'unknown_property':
    case 'readonly_property':
    case 'invalid_value':
      return 400
  }
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const params = new URL(request.url).searchParams
  const rawLimit = Number(params.get('limit'))
  const page = await readRelation(session.ctx, rowId, propertyId, {
    cursor: params.get('cursor'),
    ...(Number.isFinite(rawLimit) && rawLimit > 0 ? { limit: rawLimit } : {}),
  })
  if (!page.ok) return failureResponse(statusOf(page.reason), page)
  return Response.json({ ok: true, ...page.value })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { add?: unknown; remove?: unknown }

  // 모양 검사는 라이브러리가 한다(`invalid_value` + 어느 필드인지).
  const linked = await linkRows(session.ctx, rowId, propertyId, {
    ...(body.add !== undefined ? { add: body.add as string[] } : {}),
    ...(body.remove !== undefined ? { remove: body.remove as string[] } : {}),
  })
  if (!linked.ok) return failureResponse(statusOf(linked.reason), linked)
  return Response.json({ ok: true, row: rowJson(linked.value) })
}
