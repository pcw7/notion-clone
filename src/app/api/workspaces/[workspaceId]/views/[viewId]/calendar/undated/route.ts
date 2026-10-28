/**
 * 캘린더의 날짜 없는 행 — GET `/api/workspaces/[workspaceId]/views/[viewId]/calendar/undated?q=&cursor=` (캘린더의 나머지 C-2 · F-04-06)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 캘린더 ⑥
 *
 * 머리의 "날짜 없음 N개" 가 여는 목록 — 그 수와 같은 조건의 행을 표의 차례로 50개씩(`queryUndatedRows`). 읽기만이다.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { queryUndatedRows, type UndatedResult } from '@/lib/database/calendar-query'
import { rowJson } from '@/lib/database/http'
import { normalizeSearch } from '@/lib/database/search'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/calendar/undated'>

const STATUS: Readonly<Record<Extract<UndatedResult, { ok: false }>['reason'], number>> = {
  not_found: 404,
  not_calendar: 400,
  no_date_property: 409,
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const params = new URL(request.url).searchParams
  const result = await queryUndatedRows(session.ctx, viewId, {
    search: normalizeSearch(params.get('q')),
    cursor: params.get('cursor'),
    // 보는 사람의 오늘(R-1 · 상대 날짜 필터) — 달력 · 수와 같은 날
    today: await readViewerToday(),
  })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({
    ok: true,
    rows: result.value.rows.map(rowJson),
    hasMore: result.value.hasMore,
    nextCursor: result.value.nextCursor,
  })
}
