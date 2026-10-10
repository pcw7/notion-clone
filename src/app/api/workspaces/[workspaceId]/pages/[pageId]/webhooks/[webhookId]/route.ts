/**
 * /api/workspaces/[workspaceId]/pages/[pageId]/webhooks/[webhookId] — 웹훅 하나 (히스토리 · 활동 4e-1 · F-11-19)
 *
 *   PATCH  — `{ "paused": true | false }` 로 멈추거나 다시 켠다(실패로 멈춘 것도 다시 켠다 — 정본 ⑦).
 *   DELETE — 지운다.
 *
 * 권한은 목록과 같다(`../route.ts`).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { removePageWebhook, setPageWebhookPaused, webhookFailureStatus } from '@/lib/notification/page-webhook'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/webhooks/[webhookId]'>

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const paused = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { paused?: unknown }).paused : undefined
  if (typeof paused !== 'boolean') return Response.json({ error: 'invalid_body' }, { status: 400 })
  const updated = await setPageWebhookPaused(session.ctx, pageId, webhookId, paused)
  if (!updated.ok) return Response.json({ error: updated.reason }, { status: webhookFailureStatus(updated.reason) })
  return Response.json({ ok: true, webhook: updated.value })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const removed = await removePageWebhook(session.ctx, pageId, webhookId)
  if (!removed.ok) return Response.json({ error: removed.reason }, { status: webhookFailureStatus(removed.reason) })
  return Response.json({ ok: true })
}
