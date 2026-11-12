/**
 * 지도의 핀 — GET `/api/workspaces/[workspaceId]/views/[viewId]/map?q=` (MP-2 · F-04-19)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 MP-1] ⑥
 *
 * `{ pins: [{ rowId, title, name, address, lat, lng }], truncated, mapBy }` — 필터 · 정렬은 뷰에 저장된 것을 쓰고 요청에서는 뷰 검색어 `q`
 * (임시 조건)만 받는다. 문은 뷰를 읽는 것과 같다 — 볼 수 없으면 404 · 지도 뷰가 아니면 400.
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { queryMapPins, type MapFailure } from '@/lib/database/map-query'
import { normalizeSearch } from '@/lib/database/search'
import { readViewerToday } from '@/lib/settings/time-zone-cookie'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/map'>

const STATUS: Readonly<Record<MapFailure, number>> = { not_found: 404, not_map: 400 }

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const search = normalizeSearch(new URL(request.url).searchParams.get('q'))
  const result = await queryMapPins(session.ctx, viewId, { search, today: await readViewerToday() })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, ...result.value })
}
