/**
 * GET /api/workspaces/[workspaceId]/synced-blocks/[blockId]/places — 원본 X 가 보이는 페이지들 (SB-3 · F-01-11 · 정본 [보강 SB-0] ㉑ [SB-3 고침])
 *
 * `{ places: [{ pageId, title, blockId, original }] }` — X 의 페이지(원본)와 X 를 가리키는 사본의 페이지 중 살아 있고 이 사람이 볼 수 있는 것만
 * (`listSyncedPlaces`). 볼 수 없는 페이지는 수에도 들지 않는다. 화면은 이 페이지를 빼고 "다른 N개 페이지에서 편집 중" 을 그린다. 저장하지 않는다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listSyncedPlaces } from '@/lib/block/synced-block-resolve'

export async function GET(_request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/synced-blocks/[blockId]/places'>): Promise<Response> {
  const { workspaceId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const places = await listSyncedPlaces(session.ctx, blockId)
  // 권한이 바뀌면 답도 바뀐다 — 담아 두지 않는다
  return Response.json({ places }, { headers: { 'cache-control': 'no-store' } })
}
