/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/suggestions — 페이지의 걸린 제안 (SG-2 · F-05-12)
 *
 * 메타 표 `suggestion` 의 `open` 행 — 협업 서버의 투영이 본문의 sid 마크로 맞춘다(`lib/suggestion/project.ts`). 볼 수 없거나 없는 페이지면 404.
 * 화면(제안 목록 · 카드)은 SG-3 이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listOpenSuggestions } from '@/lib/suggestion/list'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/suggestions'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const read = await listOpenSuggestions(session.ctx, pageId)
  if (!read.ok) return Response.json({ error: read.reason }, { status: 404 })
  return Response.json({
    ok: true,
    suggestions: read.suggestions.map((s) => ({
      id: s.id,
      kind: s.kind,
      authorId: s.authorId,
      authorName: s.authorName,
      preview: s.preview,
      createdAt: s.createdAt.toISOString(),
    })),
  })
}
