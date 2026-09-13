/**
 * 데이터베이스 이름 변경 — PATCH `/api/workspaces/[workspaceId]/databases/[databaseId]`
 *
 * 정본: 00-canonical-data-model.md §3.5 `database.title_rich`
 *
 * 페이지 제목 라우트(`pages/[pageId]`)를 쓰지 않는다. 그쪽은 `type='page'` 만 받고
 * 검색 색인을 함께 쓴다 — 데이터베이스는 이름이 두 곳(`block.properties.title` ·
 * `database.title_rich`)에 있고 `search_document` 에 행이 없다(`renameDatabase` 머리말).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { renameDatabase } from '@/lib/database/database'
import { databaseFailureStatus, failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(databaseId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { name?: unknown }

  const renamed = await renameDatabase(session.ctx, databaseId, body.name)
  if (!renamed.ok) return failureResponse(databaseFailureStatus(renamed.reason), renamed)
  return Response.json({ ok: true, database: renamed.value })
}
