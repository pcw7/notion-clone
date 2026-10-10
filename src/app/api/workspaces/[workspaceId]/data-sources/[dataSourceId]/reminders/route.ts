/**
 * 보이는 행들의 날짜 리마인더 — GET `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/reminders?rows=a,b,c`
 * (히스토리 · 활동 4c-3 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ⑨ ⓑ — 리마인더는 행의 읽기에 싣지 않고 화면이 보이는 행들의 것을 따로 읽는다.
 *
 * 그 표를 볼 수 있으면 누구나(리마인더는 날짜 값의 일부다 — 알림은 건 사람에게만 간다). 그 표의 살아 있는 행 것만 · 한 번에 200행.
 * 답 `{ reminders: { [rowId]: { [propertyId]: reminderJson } } }`.
 *
 *   not_found  404  표가 없거나 볼 수 없다
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listDateReminders, reminderJson } from '@/lib/database/reminder'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/reminders'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const rows = (new URL(request.url).searchParams.get('rows') ?? '').split(',').filter((id) => id.length > 0)
  const listed = await listDateReminders(session.ctx, dataSourceId, rows)
  if (!listed.ok) return Response.json({ error: 'not_found' }, { status: 404 })

  const reminders: Record<string, Record<string, ReturnType<typeof reminderJson>>> = {}
  for (const [rowId, byProperty] of listed.value) {
    reminders[rowId] = Object.fromEntries([...byProperty].map(([propertyId, r]) => [propertyId, reminderJson(r)]))
  }
  return Response.json({ ok: true, reminders })
}
