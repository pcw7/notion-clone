/**
 * 데이터베이스의 뷰 — GET/POST `/api/workspaces/[workspaceId]/databases/[databaseId]/views` (보드 4a조각)
 *
 * 정본: 00-canonical-data-model.md §3.6 · 04-database-views.md F-04-01 (뷰 컨테이너)
 *
 * W8 은 뷰를 **고르기만** 했다(뷰 타입이 table 하나라 두 번째 뷰를 만들 이유가 약했다). 보드가 들어오며
 * 만들 이유가 생겼다. 보드는 그룹이 필수라 `groupBy` 를 함께 받고, 없으면 서버가 고른다(F-04-03 의 규칙 —
 * `view.ts` `resolveGroupBy`). 고를 것이 없으면 `group_required` 다 — 화면이 select 프로퍼티를 먼저 만든다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createView, listViews, type MvpViewType, type ViewFailure } from '@/lib/database/view'
import type { GroupBy } from '@/lib/database/group'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/views'>

/** `views/[viewId]` 라우트와 같은 매핑. */
function statusOf(reason: ViewFailure): number {
  switch (reason) {
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'last_view':
      return 409
    default:
      return 400
  }
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const views = await listViews(session.ctx, databaseId)
  if (!views.ok) return Response.json({ error: views.reason }, { status: statusOf(views.reason) })
  return Response.json({ ok: true, views: views.value })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown; type?: unknown; groupBy?: unknown }

  const created = await createView(session.ctx, databaseId, {
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.type === 'string' ? { type: body.type as MvpViewType } : {}),
    ...(typeof body.groupBy === 'object' && body.groupBy !== null ? { groupBy: body.groupBy as GroupBy } : {}),
  })
  if (!created.ok) {
    return Response.json(
      { error: created.reason, ...(created.issues ? { issues: created.issues } : {}) },
      { status: statusOf(created.reason) },
    )
  }
  return Response.json({ ok: true, view: created.value }, { status: 201 })
}
