/**
 * 확인 토큰 다시 보내기 — POST `/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/resend` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ — 확인을 기다릴 때만 · 10초에 한 번(429 `too_soon`). 로그인 세션(쿠키)으로만.
 *
 *   POST → { ok, webhook } — 결과는 `webhook.verification`(상태 코드 · 짧은 까닭)
 */

import { resendApiWebhookVerification } from '@/lib/api/webhooks'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiWebhookFailure, noStore } from '../../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/resend'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await resendApiWebhookVerification(session.ctx, tokenId, webhookId)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, webhook: result.value }, { headers: noStore })
}
