/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/activity?cursor= — 페이지의 활동 (히스토리 · 활동 4d-3 · F-11-04)
 *
 * Updates 패널이 읽는다. 최신순 30개씩 · `nextCursor` 가 있으면 그것으로 다음을 읽는다(`notification/page-activity.ts`).
 *
 * 볼 수 있는 사람만 — 볼 수 없거나 없는 페이지면 404(정본 §3.8 [보강] Updates 패널 ①). 깨진 커서는 400.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listPageActivity } from '@/lib/notification/page-activity'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/activity'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const listed = await listPageActivity(session.ctx, pageId, { cursor: new URL(request.url).searchParams.get('cursor') })
  if (!listed.ok) return Response.json({ error: listed.reason }, { status: listed.reason === 'not_found' ? 404 : 400 })
  return Response.json({
    ok: true,
    items: listed.items.map((item) => ({ ...item, at: item.at.toISOString() })),
    nextCursor: listed.nextCursor,
  })
}
