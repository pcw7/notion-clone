/**
 * GET /api/workspaces/[workspaceId]/synced-blocks/[blockId]/copies — 원본의 사본 수 (SB-4 · F-01-11 · 정본 [보강 SB-0] ⑬ · ⑪ⓒ [SB-4 고침])
 *
 * `{ copies, elsewhere }` — 살아 있는 페이지의 사본 수(볼 수 없는 페이지도 센다 · 수만) · `elsewhere` 는 원본의 페이지 밖의 것. 원본을
 * 지울 때의 확인 · 잘라낼 때의 알림이 묻는다. X 가 살아 있는 원본이 아니거나 그 페이지를 볼 수 없으면 404(둘을 가르지 않는다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { countSyncedCopies } from '@/lib/block/synced-block-resolve'

export async function GET(_request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/synced-blocks/[blockId]/copies'>): Promise<Response> {
  const { workspaceId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const count = await countSyncedCopies(session.ctx, blockId)
  if (count === null) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  return Response.json(count, { headers: { 'cache-control': 'no-store' } })
}
