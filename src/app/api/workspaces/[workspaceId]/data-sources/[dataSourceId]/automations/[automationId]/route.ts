/**
 * /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations/[automationId] — DB automation 하나 (자동화 5b-1 · F-08-09)
 *
 *   PATCH  — `{ name?, triggers?, actions?, enabled? }` 준 것만 고친다. 켜면 꺼진 까닭이 지워진다. 실행 주체(만든 사람)는 바뀌지 않는다.
 *   DELETE — 지운다(트리거 · 액션 · 실행 기록이 함께).
 *
 * 권한은 목록과 같다(`../route.ts`).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { dbAutomationFailureStatus, deleteDbAutomation, updateDbAutomation } from '@/lib/automation/db-automation'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations/[automationId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, automationId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as Record<string, unknown>) : {}
  const updated = await updateDbAutomation(session.ctx, dataSourceId, automationId, {
    name: body.name,
    triggers: body.triggers,
    actions: body.actions,
    enabled: body.enabled,
  })
  if (!updated.ok) {
    const { ok: _ok, ...rest } = updated
    void _ok
    return Response.json({ ...rest, error: updated.reason }, { status: dbAutomationFailureStatus(updated.reason) })
  }
  return Response.json({ ok: true, automation: updated.value })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, automationId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const removed = await deleteDbAutomation(session.ctx, dataSourceId, automationId)
  if (!removed.ok) return Response.json({ error: removed.reason }, { status: dbAutomationFailureStatus(removed.reason) })
  return Response.json({ ok: true })
}
