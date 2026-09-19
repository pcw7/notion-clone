/**
 * 보드의 그룹 — GET/POST `/api/workspaces/[workspaceId]/views/[viewId]/groups` (보드 4a조각)
 *
 * 정본: 00-canonical-data-model.md §3.6 · 04-database-views.md F-04-11 · F-04-03
 *
 *   GET                       그룹 전부(카운트 · 숨김) + 보이는 그룹의 첫 페이지 행
 *   GET ?group=<key>&cursor=  한 그룹의 다음 페이지 — 그룹별 독립 커서(F-04-15)
 *   POST { action: 'move', rowId, groupKey, beforeRowId? }
 *                             카드 이동. 셀 값 + 열 안 자리를 **한 트랜잭션**으로(마스터 문서 §5.2 4번)
 *
 * `rows` 라우트처럼 필터 · 정렬 · 그룹은 요청에서 받지 않는다 — 뷰에 저장된 것을 쓴다. 그룹을 바꾸는 것은
 * `PATCH /views/[viewId]` 의 `groupBy` 이고 그쪽은 `edit_structure` 를 묻는다. 이동은 `edit_content` 다
 * (F-04-03: 카드 드래그 = 데이터 편집).
 *
 * `group` 이 있으면 `''` 도 유효한 키다("No X" 그룹) — `searchParams.get` 이 빈 문자열을 그대로 준다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { moveRow, queryGroupRows, queryGroups } from '@/lib/database/group'
import { failureResponse, groupFailureStatus, rowJson } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/groups'>

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })
const invalid = () => Response.json({ error: 'invalid_value' }, { status: 400 })

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()

  const params = new URL(request.url).searchParams
  const group = params.get('group')

  if (group !== null) {
    const rawLimit = Number(params.get('limit'))
    const page = await queryGroupRows(session.ctx, viewId, group, {
      cursor: params.get('cursor'),
      ...(Number.isFinite(rawLimit) && rawLimit > 0 ? { limit: rawLimit } : {}),
    })
    if (!page.ok) return failureResponse(groupFailureStatus(page.reason), page)
    return Response.json({
      ok: true,
      rows: page.value.rows.map(rowJson),
      hasMore: page.value.hasMore,
      nextCursor: page.value.nextCursor,
    })
  }

  const groups = await queryGroups(session.ctx, viewId)
  if (!groups.ok) return failureResponse(groupFailureStatus(groups.reason), groups)
  const { value } = groups
  return Response.json({
    ok: true,
    propertyId: value.propertyId,
    propertyType: value.propertyType,
    manualOrder: value.manualOrder,
    groups: value.groups.map((g) => ({ ...g, rows: g.rows.map(rowJson) })),
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as {
    action?: unknown
    rowId?: unknown
    groupKey?: unknown
    beforeRowId?: unknown
  }
  if (body.action !== 'move') return invalid()
  if (typeof body.rowId !== 'string' || !isUuid(body.rowId)) return invalid()
  if (typeof body.groupKey !== 'string') return invalid()
  if (body.beforeRowId !== undefined && body.beforeRowId !== null) {
    if (typeof body.beforeRowId !== 'string' || !isUuid(body.beforeRowId)) return invalid()
  }

  const moved = await moveRow(session.ctx, viewId, {
    rowId: body.rowId,
    groupKey: body.groupKey,
    beforeRowId: (body.beforeRowId as string | null | undefined) ?? null,
  })
  if (!moved.ok) return failureResponse(groupFailureStatus(moved.reason), moved)
  return Response.json({
    ok: true,
    row: rowJson(moved.value.row),
    groupKey: moved.value.groupKey,
    positioned: moved.value.positioned,
  })
}
