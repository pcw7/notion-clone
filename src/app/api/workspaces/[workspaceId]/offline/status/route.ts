/**
 * POST /api/workspaces/[workspaceId]/offline/status — 내려받은 페이지들의 지금 판 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④)
 *
 *   몸   `{ pageIds: string[] }` — `MAX_STATUS_PAGES` 개까지
 *   200  `{ pages: { [pageId]: { seq } | 'gone' } }` — `gone` 은 볼 수 없다 · 없다 · 휴지통 · 내보내기 정책이 막았다(가르지 않는다)
 *   400  `invalid_body` · `too_many`
 *   404  `not_found` — 워크스페이스에 들어올 수 없다(게이트 · 기기는 그 워크스페이스의 사본을 모두 `gone` 으로 본다)
 *
 * 판정은 `offlinePageStatus`. 응답은 그 사람의 것이라 어디에도 남기지 않는다(`private, no-store` — OF-2 의 라우트와 같다).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { offlinePageStatus } from '@/lib/offline/offline-status'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/offline/status'>

const PRIVATE = { 'cache-control': 'private, no-store' }

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const pageIds = (parsed.body as { pageIds?: unknown } | null)?.pageIds
  if (!Array.isArray(pageIds) || !pageIds.every((id): id is string => typeof id === 'string')) {
    return Response.json({ error: 'invalid_body' }, { status: 400, headers: PRIVATE })
  }
  const status = await offlinePageStatus(session.ctx, pageIds)
  if (!status.ok) return Response.json({ error: status.reason }, { status: 400, headers: PRIVATE })
  return Response.json({ pages: status.pages }, { headers: PRIVATE })
}
