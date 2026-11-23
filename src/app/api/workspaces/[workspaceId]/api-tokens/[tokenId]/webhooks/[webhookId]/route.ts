/**
 * 웹훅 하나 — GET(구독 · 배달 기록) · PATCH(멈추기 · 다시 켜기) · DELETE(지우기)
 * `/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫. 로그인 세션(쿠키)으로만.
 *
 *   GET                    → { ok, webhook, deliveries } — 기록은 최근 것부터 20줄(응답 본문은 없다 · 상태 코드 · 짧은 까닭)
 *   PATCH { paused }       → { ok, webhook } — 멈추기는 켜진 것만 · 다시 켜기는 멈춘 것 · 실패로 꺼진 것만(아니면 409)
 *   DELETE                 → { ok } — 기다리던 이벤트 · 기록도 함께
 */

import { getApiWebhook, removeApiWebhook, setApiWebhookPaused } from '@/lib/api/webhooks'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiWebhookFailure, noStore } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await getApiWebhook(session.ctx, tokenId, webhookId)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, ...result.value }, { headers: noStore })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const paused = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { paused?: unknown }).paused : undefined
  const result = await setApiWebhookPaused(session.ctx, tokenId, webhookId, paused)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, webhook: result.value }, { headers: noStore })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await removeApiWebhook(session.ctx, tokenId, webhookId)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true }, { headers: noStore })
}
