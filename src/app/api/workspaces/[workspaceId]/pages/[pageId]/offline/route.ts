/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/offline — 오프라인으로 쓸 페이지 하나를 받는다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ②)
 *
 *   200  `{ pageId, title, icon, cover, seq, state }` — `state` 는 본문 상태(Y update · base64) · `seq` 는 마지막 `doc_update` 의 seq
 *   403  `policy_disabled` — 워크스페이스 정책이 멤버의 내보내기를 막았다(소유자만 — 내보내기와 같은 게이트)
 *   404  `not_found` — 없거나 볼 수 없거나 휴지통의 페이지(가르지 않는다)
 *
 * 권한은 본문 읽기와 같다(`readOfflinePage`). 응답은 그 사람의 본문이라 어디에도 남기지 않는다(`private, no-store` — 서비스 워커도 API 는
 * 캐시하지 않는다). 기기에 두는 것은 화면이 IndexedDB 에 직접 쓴다(`lib/offline/offline-store.ts`).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { readOfflinePage } from '@/lib/offline/offline-page'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/offline'>

const PRIVATE = { 'cache-control': 'private, no-store' }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const read = await readOfflinePage(session.ctx, pageId)
  if (!read.ok) {
    return Response.json({ error: read.reason }, { status: read.reason === 'policy_disabled' ? 403 : 404, headers: PRIVATE })
  }
  return Response.json(read.value, { headers: PRIVATE })
}
