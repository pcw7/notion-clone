/**
 * 내 API 토큰 — GET(목록) · POST(만들기) `/api/workspaces/[workspaceId]/api-tokens` (API-1 · F-09-02)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 API-1] ①. 판정 · 쓰기는 `lib/api/api-token.ts`. 이 라우트는 **로그인 세션(쿠키)** 으로만
 * 부른다 — 토큰이 토큰을 만들지 못한다(`/v1` 에는 이 길이 없다 · 명령도 다시 거부한다). 거부 코드의 상태는 `http.ts`.
 *
 *   GET                              → { ok, tokens: ApiTokenSummary[] }
 *   POST { name, expiresInDays? }    → 201 { ok, token, summary } — `token` 은 이 한 번만 평문이다
 */

import { createApiToken, listApiTokens } from '@/lib/api/api-token'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { apiTokenFailure } from './http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/api-tokens'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await listApiTokens(session.ctx)
  if (!result.ok) return apiTokenFailure(result.reason)
  return Response.json({ ok: true, tokens: result.value }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown; expiresInDays?: unknown }
  const result = await createApiToken(session.ctx, { name: body.name, expiresInDays: body.expiresInDays })
  if (!result.ok) return apiTokenFailure(result.reason)
  // 값은 이 응답에만 — 캐시에 남기지 않는다
  return Response.json(
    { ok: true, token: result.value.token, summary: result.value.summary },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  )
}
