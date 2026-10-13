/**
 * 멘션 노드가 그릴 이름 — GET `/api/workspaces/[workspaceId]/mention-labels?users=a,b&pages=c&emoji=d` (코멘트 5b조각 · 7c-3a)
 *
 * 멘션 노드에는 id 뿐이다. 편집기가 모르는 id 를 받으면(다른 참여자가 넣은 멘션) 이것으로 다시 읽는다 —
 * 하위 페이지 참조의 `page-ref-titles` 와 같은 자리, 같은 규칙. 볼 수 없는 페이지는 null 이다. 커스텀 이모지(7c-3a)는 이름 · 지웠는가
 * (`emoji` — 지운 것도 이름을 준다 · 이 워크스페이스에 없으면 null).
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
  const labels = await loadMentionLabels(session.ctx, {
    userIds: listOf(params.get('users')),
    pageIds: listOf(params.get('pages')),
    emojiIds: listOf(params.get('emoji')),
  })
  return Response.json({ ok: true, ...labels })
}
