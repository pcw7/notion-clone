/**
 * /api/workspaces/[workspaceId]/ai/translate — 페이지 번역 (AI-4 · F-10-03 · F-10-12)
 *
 * GET  `?pageId&language` — 미리 보기(쓸 응답 수 = 청크 수 · 남은 응답 · 부르지 않는다).
 * POST `{ pageId, language }` — 번역본을 원본의 새 하위 페이지로 만들고 청크마다 예약 → 공급자 → 끝(SSE `progress` · `wait` · `done` ·
 *      `error`). 연결을 닫으면 흐르던 청크가 멈추고(`stopped`) 거기까지로 번역본을 쓴다. 형식 · 상태는 `lib/ai/translate-http.ts` 의 머리말이 정본이다.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ② ④ ⑥ ⑨
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiTranslateEstimate, aiTranslateResponse } from '@/lib/ai/translate-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/translate'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const params = new URL(request.url).searchParams
  return aiTranslateEstimate(session.ctx, { pageId: params.get('pageId'), language: params.get('language') })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  return aiTranslateResponse(session.ctx, parsed.body, request.signal)
}
