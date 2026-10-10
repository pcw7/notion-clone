/**
 * 날짜 칸의 리마인더 — PUT(걸기 · 바꾸기) · DELETE(풀기) `/api/workspaces/[workspaceId]/rows/[rowId]/reminders/[propertyId]`
 * (히스토리 · 활동 4c-1 · F-11-10)
 *
 * 정본: 00-canonical-data-model.md §3.8 [보강] 리마인더 ① ~ ⑥
 *
 * PUT 본문 `{ leadMinutes, timeZone }` — 리드는 값의 모양(날짜만 · 시각)에 맞는 목록에서(`leadsFor`), 타임존은 브라우저의 IANA 이름.
 * 답은 리마인더(`reminderJson`). 받는 사람은 건 사람이다.
 *
 *   not_found          404  행 · 속성이 없거나 볼 수 없다
 *   forbidden          403  볼 수만 있다(`edit_content` 가 없다)
 *   locked             409  행 페이지가 잠겼다
 *   no_date            409  그 칸에 날짜가 없다 — 날짜를 먼저 넣는다
 *   not_date           400  날짜 속성이 아니다
 *   invalid_lead       400  이 값에 없는 리드다
 *   invalid_time_zone  400  모르는 타임존이다
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { clearDateReminder, reminderJson, setDateReminder, type ReminderFailure } from '@/lib/database/reminder'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/reminders/[propertyId]'>

const STATUS: Readonly<Record<ReminderFailure, number>> = {
  not_found: 404,
  forbidden: 403,
  locked: 409,
  no_date: 409,
  not_date: 400,
  invalid_lead: 400,
  invalid_time_zone: 400,
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { leadMinutes?: unknown; timeZone?: unknown }

  const set = await setDateReminder(session.ctx, rowId, decodeURIComponent(propertyId), {
    leadMinutes: body.leadMinutes,
    timeZone: body.timeZone,
  })
  if (!set.ok) return Response.json({ error: set.reason }, { status: STATUS[set.reason] })
  return Response.json({ ok: true, reminder: reminderJson(set.value) })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(rowId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const cleared = await clearDateReminder(session.ctx, rowId, decodeURIComponent(propertyId))
  if (!cleared.ok) return Response.json({ error: cleared.reason }, { status: STATUS[cleared.reason] })
  return Response.json({ ok: true })
}
