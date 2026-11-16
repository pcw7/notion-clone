/**
 * 내 API 토큰 하나 — DELETE(폐기) `/api/workspaces/[workspaceId]/api-tokens/[tokenId]` (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ① — 폐기는 곧바로 듣는다(게이트가 매 요청 읽는다). 로그인 세션(쿠키)으로만.
 *
 *   DELETE → { ok } · 내 (살아 있는) 토큰이 아니면 404 `not_found`
 */

import { revokeApiToken } from '@/lib/api/api-token'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiTokenFailure } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens/[tokenId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, tokenId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await revokeApiToken(session.ctx, tokenId)
  if (!result.ok) return apiTokenFailure(result.reason)
  return Response.json({ ok: true })
}
