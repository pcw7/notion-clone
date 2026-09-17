/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/page-ref-titles — 본문의 하위 페이지 참조 제목 (CRDT 6b조각)
 *
 * 참조 노드는 제목을 싣지 않는다(HANDOFF §3.2-22). 협업 편집기는 본문을 Y.Doc 으로 받으므로, 다른 참여자가 만든 · 되살린 ·
 * 옮겨 온 참조를 받으면 그 제목을 모른다 — 그때 이것으로 다시 읽는다. 맵은 본문 GET 의 `pageRefTitles` 와 같다: 볼 수 있는
 * 하위 페이지는 평문, 볼 수 없으면 `null`.
 *
 * 볼 수 없는 페이지 · 없는 페이지 · uuid 가 아닌 id 는 모두 404 다 — 가르면 존재가 새어나간다.
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadPageRefTitles } from '@/lib/block/save-page-body'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/page-ref-titles'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const titles = await loadPageRefTitles(session.ctx, pageId)
  if (titles === null) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ ok: true, pageRefTitles: titles })
}
