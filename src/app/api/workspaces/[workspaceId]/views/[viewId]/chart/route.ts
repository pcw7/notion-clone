/**
 * 차트의 데이터 — GET `/api/workspaces/[workspaceId]/views/[viewId]/chart?q=` (38번 트랙 CH-1 · F-04-08)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강 CH-1] ④
 *
 * 그룹마다 `{ key, option, statusGroup, count, hidden, value }` 와 축의 설정. 행은 읽지 않는다. 그룹 · 필터 · 정렬은 뷰에 저장된 것을
 * 쓰고 요청에서는 뷰 검색어 `q`(임시 조건)만 받는다. 문은 뷰를 읽는 것과 같다 — 볼 수 없으면 404 · 그룹이 없으면 `not_grouped`.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { queryGroupSummary } from '@/lib/database/group'
import { failureResponse, groupFailureStatus } from '@/lib/database/http'
import { normalizeSearch } from '@/lib/database/search'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/chart'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const search = normalizeSearch(new URL(request.url).searchParams.get('q'))
  const page = await queryGroupSummary(session.ctx, viewId, { search, today: await readViewerToday() })
  if (!page.ok) return failureResponse(groupFailureStatus(page.reason), page)
  return Response.json({ ok: true, ...page.value })
}
