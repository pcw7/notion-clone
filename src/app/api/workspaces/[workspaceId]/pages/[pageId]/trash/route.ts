/**
 * POST   /api/workspaces/[workspaceId]/pages/[pageId]/trash — 휴지통으로 (live → trashed)
 * DELETE /api/workspaces/[workspaceId]/pages/[pageId]/trash — 복원 (trashed → live)
 * PUT    /api/workspaces/[workspaceId]/pages/[pageId]/trash — 영구 삭제 (trashed → purged)
 *
 * 세 동작이 같은 자원(`.../trash` = "이 페이지의 휴지통 상태")의 전이라서 한
 * 파일에 둔다. 메서드 배정은 이렇게 읽는다:
 *   POST   = 휴지통에 넣는다
 *   DELETE = 휴지통에서 뺀다(복원)
 *   PUT    = 휴지통 상태를 다음 단계(purged)로 확정한다
 *
 * ⚠ `DELETE` 가 "영구 삭제"가 **아니다.** 되돌릴 수 없는 쪽을 흔한 메서드에
 * 두면 실수로 부르기 쉽다 — F-02-11 이 2단계 보존을 둔 이유가 바로 그거다.
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { purgePage, restorePage, trashPage, TrashError } from '@/lib/block/trash'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/trash'>

async function resolve(ctx: Ctx) {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return { ok: false as const, response: session.response }

  try {
    return { ok: true as const, session: session.ctx, pageId: asBlockId(raw) }
  } catch {
    return { ok: false as const, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  }
}

function errorResponse(e: unknown): Response {
  if (!(e instanceof TrashError)) throw e
  // not_a_trash_root 는 409 다 — 요청이 잘못된 게 아니라 **지금 상태에서**
  // 할 수 없는 일이고, 화면은 `trashRootId` 로 대안을 제시할 수 있다.
  const status = e.code === 'not_found' ? 404 : 409
  return Response.json(
    { error: e.code, message: e.message, trashRootId: e.trashRootId },
    { status },
  )
}

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  try {
    const result = await trashPage(r.session, r.pageId)
    return Response.json({
      ok: true,
      pageId: result.pageId,
      trashedDescendants: result.trashedDescendants,
      purgeAfter: result.purgeAfter.toISOString(),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  try {
    const result = await restorePage(r.session, r.pageId)
    return Response.json({
      ok: true,
      pageId: result.pageId,
      restoredDescendants: result.restoredDescendants,
      reparented: result.reparented,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(ctx)
  if (!r.ok) return r.response
  try {
    const result = await purgePage(r.session, r.pageId)
    return Response.json({
      ok: true,
      pageId: result.pageId,
      purgedDescendants: result.purgedDescendants,
    })
  } catch (e) {
    return errorResponse(e)
  }
}
