/**
 * /api/workspaces/[workspaceId]/pages/[pageId]/webhooks — 페이지 웹훅 (히스토리 · 활동 4e-1 · F-11-19)
 *
 *   GET  — 그 페이지의 웹훅(힌트 · 건 사람 · 멈춤). URL 원문은 주지 않는다. `disabled` 는 소유자가 워크스페이스의 웹훅을 껐는가(10n-70).
 *   POST — `{ "url": "https://…" }` 로 건다. 모양이 틀리면 400 `invalid_url`(+ `problem`), 5개를 넘으면 400 `too_many`, 워크스페이스가
 *          웹훅을 껐으면 400 `webhooks_disabled`.
 *
 * 그 페이지의 전체 권한만 — 볼 수 없으면 404, 볼 수 있지만 전체 권한이 없으면 403, 데이터베이스 행이면 400 `row_page`
 * (정본 §3.8 [보강] 페이지 웹훅 ④ · `notification/page-webhook.ts`).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { query } from '@/lib/db/pool'
import { addPageWebhook, listPageWebhooks, webhookFailureStatus, type WebhookResult } from '@/lib/notification/page-webhook'
import { webhooksAllowedIn } from '@/lib/notification/webhook-switch'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/webhooks'>

function failure(result: Exclude<WebhookResult<unknown>, { ok: true }>): Response {
  return Response.json(
    { error: result.reason, ...(result.problem === undefined ? {} : { problem: result.problem }) },
    { status: webhookFailureStatus(result.reason) },
  )
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const listed = await listPageWebhooks(session.ctx, pageId)
  if (!listed.ok) return failure(listed)
  return Response.json({ ok: true, webhooks: listed.value, disabled: !(await webhooksAllowedIn({ query }, session.ctx.workspaceId)) })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const url = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { url?: unknown }).url : undefined
  const added = await addPageWebhook(session.ctx, pageId, url)
  if (!added.ok) return failure(added)
  return Response.json({ ok: true, webhook: added.value }, { status: 201 })
}
