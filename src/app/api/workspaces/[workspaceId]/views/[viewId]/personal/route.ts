/**
 * 나에게만 적용하는 필터 · 정렬 — `/api/workspaces/[workspaceId]/views/[viewId]/personal` (DB 심화 2h-1 · F-04-17)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` · [보강] 개인 필터 · 정렬 · 04-database-views.md F-04-17
 *
 *   PATCH  { filter?, sorts? }  나의 필터 · 정렬을 건다(공유 것을 대체 · `filter: null` 은 "필터 없음") — 볼 수 있으면 된다
 *   DELETE                      나의 것을 버린다(공유 것으로)
 *   POST                        나의 것을 **모두에게** 저장한다(Save for everyone) — `edit_structure`
 *
 * 공유 필터 · 정렬을 바꾸는 것은 `PATCH /views/[viewId]` 다(편집자 · 그쪽은 자기 개인 것의 그 쪽을 지운다).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { publishPersonalView, resetPersonalView, setPersonalView, type ViewResult, type ViewDetail } from '@/lib/database/view'
import type { FilterNode, SortKey } from '@/lib/database/filter'
import { viewFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/personal'>

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

function respond(result: ViewResult<ViewDetail>): Response {
  if (!result.ok) {
    return Response.json(
      { error: result.reason, ...(result.issues ? { issues: result.issues } : {}) },
      { status: viewFailureStatus(result.reason) },
    )
  }
  return Response.json({ ok: true, view: result.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { filter?: unknown; sorts?: unknown }
  // ★ `filter: null`(필터 없음)과 "안 보냄"을 가른다 — `'filter' in body`.
  return respond(
    await setPersonalView(session.ctx, viewId, {
      ...('filter' in body ? { filter: body.filter as FilterNode | null } : {}),
      ...('sorts' in body ? { sorts: body.sorts as SortKey[] } : {}),
    }),
  )
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()
  return respond(await resetPersonalView(session.ctx, viewId))
}

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return notFound()
  return respond(await publishPersonalView(session.ctx, viewId))
}
