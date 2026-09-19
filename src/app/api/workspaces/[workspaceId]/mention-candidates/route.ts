/**
 * `@` 자동완성 후보 — GET `/api/workspaces/[workspaceId]/mention-candidates?q=` (F-07-08 · 코멘트 5b조각)
 *
 * 07 F-07-08: *"자동완성 전용 경량 엔드포인트 … 전문 검색과 같은 엔드포인트를 쓰면 지연이 사용자에게 그대로 보인다."*
 * 권한은 서버 명령이 쿼리 안에서 거른다(`block/mention-candidates.ts`) — 이 파일은 옮기기만 한다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { searchMentionCandidates } from '@/lib/block/mention-candidates'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/mention-candidates'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const q = new URL(request.url).searchParams.get('q') ?? ''
  return Response.json({ ok: true, candidates: await searchMentionCandidates(session.ctx, q.slice(0, 100)) })
}
