/**
 * 레이아웃 되돌리기 — POST `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/layout/undo` (항목 레이아웃 3e-1 · F-16-12)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 레이아웃의 직전 버전 · 16 F-16-12 *"직전 버전 1개 · 실행 취소 1스텝"*
 *
 * 본문 `{ version }` — 지금 보고 있는 버전. 직전 버전의 스냅샷을 새 적용으로 쓴다(version 이 오른다) · 기록을 지운다. 되돌릴 것이 없으면
 * 409 `no_undo` · 그 뒤에 다른 적용이 있었으면 409 `layout_conflict`. 권한은 적용과 같다(`edit_structure` · 잠기면 409).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { undoRecordLayout } from '@/lib/database/layout'
import { failureResponse, layoutFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/layout/undo'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { version?: unknown }
  if (typeof body.version !== 'string' || !/^\d{1,19}$/.test(body.version)) {
    return Response.json({ error: 'invalid_layout' }, { status: 400 })
  }

  const undone = await undoRecordLayout(session.ctx, dataSourceId, { expectedVersion: body.version })
  if (!undone.ok) return failureResponse(layoutFailureStatus(undone.reason), undone)
  return Response.json({ ok: true, layout: undone.value.layout, changed: undone.value.changed })
}
