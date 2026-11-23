/**
 * 내 API 토큰의 웹훅 — GET(목록) · POST(만들기) `/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫. 판정 · 쓰기는 `lib/api/webhooks.ts`. **로그인 세션(쿠키)** 으로만 — 토큰이 웹훅을
 * 만들지 못한다(`/v1` 에 이 길이 없다 · 명령도 다시 거부한다).
 *
 *   GET                         → { ok, webhooks: ApiWebhookSummary[] }
 *   POST { url, eventTypes }    → 201 { ok, webhook } — 만든 뒤 받는 주소로 확인 토큰을 한 번 보냈다(결과는 `webhook.verification`)
 */

import { createApiWebhook, listApiWebhooks } from '@/lib/api/webhooks'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiWebhookFailure, noStore } from './http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await listApiWebhooks(session.ctx, tokenId)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, webhooks: result.value }, { headers: noStore })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { url?: unknown; eventTypes?: unknown }
  const result = await createApiWebhook(session.ctx, tokenId, { url: body.url, eventTypes: body.eventTypes })
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, webhook: result.value }, { status: 201, headers: noStore })
}
