/**
 * 지운 속성의 조건을 뺀 알림을 봤다 — POST `/api/workspaces/[workspaceId]/views/[viewId]/notices` (DB 실시간 동기화 RT-3 · F-05-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] ③ · 마이그레이션 0154
 *
 *   POST { ids: [알림 id …] }  → { ok, seen }   화면이 띄운 알림 — 다시 띄우지 않는다. 이 뷰의 · 나에게 온 것만 적는다
 *
 * 알림 목록은 서버 화면이 읽어 준다(`listViewNotices`). 뷰를 볼 수 없으면 404.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { ackViewNotices } from '@/lib/database/view'
import { viewFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/views/[viewId]/notices'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(viewId)) return Response.json({ error: 'not_found' }, { status: 404 })
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const raw = (parsed.body ?? {}) as { ids?: unknown }
  if (!Array.isArray(raw.ids) || !raw.ids.every((id) => typeof id === 'string')) {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }
  const result = await ackViewNotices(session.ctx, viewId, raw.ids as string[])
  if (!result.ok) return Response.json({ error: result.reason }, { status: viewFailureStatus(result.reason) })
  return Response.json({ ok: true, seen: result.value.seen })
}
