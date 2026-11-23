/**
 * 웹훅 확인 — POST `/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/verify` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ — 받는 주소가 받은 확인 토큰을 붙여 넣으면 켜진다(노션). 로그인 세션(쿠키)으로만.
 *
 *   POST { verificationToken } → { ok, webhook } · 틀리면 400 `wrong_token` · 이미 확인했으면 409 `not_pending`
 */

import { verifyApiWebhook } from '@/lib/api/webhooks'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiWebhookFailure, noStore } from '../../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/verify'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const given = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { verificationToken?: unknown }).verificationToken : undefined
  const result = await verifyApiWebhook(session.ctx, tokenId, webhookId, given)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, webhook: result.value }, { headers: noStore })
}
