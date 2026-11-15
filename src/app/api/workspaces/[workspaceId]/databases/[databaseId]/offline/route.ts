/**
 * GET /api/workspaces/[workspaceId]/databases/[databaseId]/offline — 오프라인으로 볼 데이터베이스 하나를 받는다 (OF-4 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑤)
 *
 *   200  `{ databaseId, name, icon, viewName, columns, rows, truncated, savedVersion }` — 첫 뷰의 보이는 열 · 처음 50행(칸은 보이는 글자)
 *   403  `policy_disabled` — 워크스페이스 정책이 멤버의 내보내기를 막았다(소유자만 — 내보내기 · 페이지 내려받기와 같은 게이트)
 *   404  `not_found` — 없거나 볼 수 없거나 휴지통의 데이터베이스(가르지 않는다)
 *
 * 판정은 `readOfflineDatabase`. 응답은 그 사람의 것이라 어디에도 남기지 않는다(`private, no-store` — OF-2 의 라우트와 같다). 상대 날짜 필터는
 * 보는 사람의 오늘로 편다(데이터베이스 화면과 같은 쿠키).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { readOfflineDatabase } from '@/lib/offline/offline-database'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/offline'>

const PRIVATE = { 'cache-control': 'private, no-store' }

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const read = await readOfflineDatabase(session.ctx, databaseId, { today: await readViewerToday() })
  if (!read.ok) {
    return Response.json({ error: read.reason }, { status: read.reason === 'policy_disabled' ? 403 : 404, headers: PRIVATE })
  }
  return Response.json(read.value, { headers: PRIVATE })
}
