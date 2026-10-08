/**
 * 뷰 — GET/PATCH/DELETE `/api/workspaces/[workspaceId]/views/[viewId]`
 *
 * 정본: 00-canonical-data-model.md §3.6 · 03-database-core.md F-03-17
 *   *"Views API 정식 출시 … **즉 뷰도 이제 1급 API 리소스다.** 클론 설계 시 뷰를
 *   '프론트엔드 로컬 상태'로 두면 안 된다."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 거부 코드를 한 곳에서 매핑한다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `not_found` 는 **못 보는 경우도 포함한다**(`view.ts` 가 그렇게 돌려준다).
 * 403 과 404 를 가르는 기준은 "볼 수는 있는가" 하나다 — 403 을 주는 순간 그
 * 데이터베이스가 존재한다는 사실이 새기 때문이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteView, getView, updateView, type MvpViewType } from '@/lib/database/view'
import type { GalleryLayout } from '@/lib/database/gallery'
import { viewFailureStatus } from '@/lib/database/http'
import type { FilterNode, SortKey } from '@/lib/database/filter'
import type { GroupBy } from '@/lib/database/group'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]'>


export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const got = await getView(session.ctx, viewId)
  if (!got.ok) return Response.json({ error: got.reason }, { status: viewFailureStatus(got.reason) })
  return Response.json({ ok: true, view: got.value })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown
    type?: unknown
    filter?: unknown
    sorts?: unknown
    loadLimit?: unknown
    groupBy?: unknown
    defaultTemplateId?: unknown
    gallery?: unknown
  }

  // ★ `filter` · `groupBy` 는 `null` 과 "안 보냄"을 구분해야 한다 — 전자는 "없애라",
  //   후자는 "그대로 둬라" 다. `'filter' in body` 로 가른다.
  const updated = await updateView(session.ctx, viewId, {
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.type === 'string' ? { type: body.type as MvpViewType } : {}),
    ...('filter' in body ? { filter: body.filter as FilterNode | null } : {}),
    ...('sorts' in body ? { sorts: body.sorts as SortKey[] } : {}),
    ...(typeof body.loadLimit === 'number' ? { loadLimit: body.loadLimit } : {}),
    ...('groupBy' in body ? { groupBy: body.groupBy as GroupBy | null } : {}),
    // 기본 템플릿도 `null`(빈 페이지로 돌려라)과 "안 보냄"을 구분한다(F-08-03).
    ...('defaultTemplateId' in body ? { defaultTemplateId: body.defaultTemplateId as string | null } : {}),
    // 갤러리 레이아웃(2f-2) — 바꿀 키만. 모양은 명령이 본다(`validateGalleryPatch`).
    ...('gallery' in body ? { gallery: body.gallery as Partial<GalleryLayout> } : {}),
  })

  if (!updated.ok) {
    return Response.json(
      { error: updated.reason, ...(updated.issues ? { issues: updated.issues } : {}) },
      { status: viewFailureStatus(updated.reason) },
    )
  }
  return Response.json({ ok: true, view: updated.value })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const removed = await deleteView(session.ctx, viewId)
  if (!removed.ok) {
    return Response.json({ error: removed.reason }, { status: viewFailureStatus(removed.reason) })
  }
  return Response.json({ ok: true })
}
