/**
 * 멘션 노드가 그릴 이름 — GET `/api/workspaces/[workspaceId]/mention-labels?users=a,b&pages=c` (코멘트 5b조각)
 *
 * 멘션 노드에는 id 뿐이다. 편집기가 모르는 id 를 받으면(다른 참여자가 넣은 멘션) 이것으로 다시 읽는다 —
 * 하위 페이지 참조의 `page-ref-titles` 와 같은 자리, 같은 규칙. 볼 수 없는 페이지는 null 이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { loadMentionLabels } from '@/lib/block/mention-candidates'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/mention-labels'>

const listOf = (raw: string | null): string[] => (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const params = new URL(request.url).searchParams
  const labels = await loadMentionLabels(session.ctx, { userIds: listOf(params.get('users')), pageIds: listOf(params.get('pages')) })
  return Response.json({ ok: true, ...labels })
}
