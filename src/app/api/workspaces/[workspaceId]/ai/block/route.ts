/**
 * /api/workspaces/[workspaceId]/ai/block — AI 블록 만들기 · 다시 만들기 (AI-5 · F-10-04 · F-10-12)
 *
 * POST `{ pageId, blockId }` — 종류 · 지시는 서버 본문의 그 블록에서 읽고, 문맥은 그 페이지의 원문에서 AI 블록을 모두 뺀 것. 예약 → 공급자 →
 * SSE(`delta` … `done` / `error`) → 다 받으면 서버가 그 블록의 자식을 결과로 간다(출처 `ai`). 형식 · 상태는 `lib/ai/block-http.ts` 의 머리말이
 * 정본이다. 바뀜(stale) 판정은 편집기가 같은 함수로 한다(`lib/ai/block-source.ts`) — 읽기 끝점은 두지 않는다.
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑩
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { aiBlockResponse } from '@/lib/ai/block-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/block'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  return aiBlockResponse(session.ctx, parsed.body, request.signal)
}
