/**
 * GET /api/workspaces/[workspaceId]/synced-blocks/[blockId] — 동기화 블록 사본의 해석 (SB-2 · F-01-11 · 정본 [보강 SB-0] ⑨)
 *
 * `{ state: 'ok', pageId }` · `{ state: 'no_access' }` · `{ state: 'trashed' }` · `{ state: 'missing' }` — 늘 200 이다(사본의 자리를 고르는 길
 * 안내). `no_access` 는 원본 페이지의 id · 제목을 싣지 않는다. 문은 협업 서버다(`resolveSyncedBlock` 머리말). 저장하지 않는다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { resolveSyncedBlock } from '@/lib/block/synced-block-resolve'

export async function GET(_request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/synced-blocks/[blockId]'>): Promise<Response> {
  const { workspaceId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const resolved = await resolveSyncedBlock(session.ctx, blockId)
  // 권한이 바뀌면 답도 바뀐다 — 담아 두지 않는다
  return Response.json(resolved, { headers: { 'cache-control': 'no-store' } })
}
