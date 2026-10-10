/**
 * /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations — DB automation (자동화 5b-1 · F-08-09)
 *
 *   GET  — 그 표의 automation(트리거 · 액션 · 켜짐 · 꺼진 까닭 · 만든 사람).
 *   POST — `{ name, triggers: [{ type: 'page_added' } | { type: 'property_edited', propertyId, condition? }], actions: [...] }` 로 만든다.
 *          만든 사람이 실행 주체다. 틀리면 400 `invalid_trigger` · `invalid_action`(+ `problem` · `index`) · `invalid_name` · `too_many`.
 *
 * 그 데이터베이스의 전체 권한만 — 볼 수 없으면 404, 볼 수 있지만 전체 권한이 없으면 403(`automation/db-automation.ts`).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createDbAutomation, dbAutomationFailureStatus, listDbAutomations, type DbAutomationResult } from '@/lib/automation/db-automation'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations'>

function failure(result: Exclude<DbAutomationResult<unknown>, { ok: true }>): Response {
  const { ok: _ok, ...body } = result
  void _ok
  return Response.json({ ...body, error: result.reason }, { status: dbAutomationFailureStatus(result.reason) })
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const listed = await listDbAutomations(session.ctx, dataSourceId)
  if (!listed.ok) return failure(listed)
  return Response.json({ ok: true, automations: listed.value })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as Record<string, unknown>) : {}
  const made = await createDbAutomation(session.ctx, dataSourceId, { name: body.name, triggers: body.triggers, actions: body.actions })
  if (!made.ok) return failure(made)
  return Response.json({ ok: true, automation: made.value }, { status: 201 })
}
