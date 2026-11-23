/**
 * 테스트 보내기 — POST `/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/test` (API-8 · F-09-09)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ⑫ — `test` 이벤트 하나를 아웃박스에 넣는다(노션에 없다). 워커가 보통의 이벤트처럼
 * 서명해 보낸다 — 결과는 배달 기록에 선다. 켜진 구독만(409 `invalid_state`) · 기다리는 테스트는 다섯까지. 로그인 세션(쿠키)으로만.
 *
 *   POST → 202 { ok, eventId }
 */

import { sendApiWebhookTest } from '@/lib/api/webhooks'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiWebhookFailure, noStore } from '../../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]/webhooks/[webhookId]/test'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId, webhookId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await sendApiWebhookTest(session.ctx, tokenId, webhookId)
  if (!result.ok) return apiWebhookFailure(result)
  return Response.json({ ok: true, eventId: result.value.eventId }, { status: 202, headers: noStore })
}
