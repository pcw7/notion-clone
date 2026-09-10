/**
 * GET /api/workspaces/[workspaceId]/trash — 휴지통 목록 (F-11-05)
 *
 * **삭제 루트만** 나온다. 자손 수천 개가 목록에 쏟아지면 안 된다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listTrash } from '@/lib/block/trash'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/trash'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const entries = await listTrash(session.ctx)
  return Response.json({
    ok: true,
    entries: entries.map((e) => ({
      id: e.id,
      title: e.title,
      trashedAt: e.trashedAt.toISOString(),
      purgeAfter: e.purgeAfter?.toISOString() ?? null,
      descendantCount: e.descendantCount,
    })),
  })
}
