/**
 * 캘린더의 행 — GET `/api/workspaces/[workspaceId]/views/[viewId]/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&q=` (DB 심화 2g-1 · F-04-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 · 04-database-views.md F-04-06
 *
 * 보이는 기간(62일 이하)에 걸친 행 전부(상한까지)와 날짜 없는 행의 수. 필터 · 정렬은 `rows` 라우트처럼 뷰에 저장된 것을 쓰고, 뷰 검색어
 * `q` 만 요청에서 받는다(2e — 임시 조건). 행의 날짜를 바꾸는 것은 셀 쓰기(`PATCH /rows/[rowId]`)다 — 여기는 읽기만이다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { queryCalendar, type CalendarFailure } from '@/lib/database/calendar-query'
import { rowJson } from '@/lib/database/http'
import { normalizeSearch } from '@/lib/database/search'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/calendar'>

const STATUS: Readonly<Record<CalendarFailure, number>> = {
  not_found: 404,
  not_calendar: 400,
  no_date_property: 409,
  invalid_value: 400,
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const params = new URL(request.url).searchParams
  const result = await queryCalendar(session.ctx, viewId, {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    search: normalizeSearch(params.get('q')),
  })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({
    ok: true,
    datePropertyId: result.value.datePropertyId,
    rows: result.value.rows.map(rowJson),
    undated: result.value.undated,
    truncated: result.value.truncated,
  })
}
