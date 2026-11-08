/**
 * DELETE /api/workspaces/[workspaceId] — 워크스페이스 삭제 (AD-1 · F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-1] — owner 만 · 이름을 그대로 다시 친다. 본문 `{ confirmName }`.
 * 응답 `{ ok, next }` — `next` 는 지운 사람이 이어서 갈 곳(다른 워크스페이스 · 없으면 새로 만들기).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteWorkspace } from '@/lib/workspace/delete'
import { nextWorkspaceHref } from '@/lib/workspace/list'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]'>

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const confirmName = (body as { confirmName?: unknown } | null)?.confirmName

  const done = await deleteWorkspace(session.ctx, { confirmName })
  if (!done.ok) {
    if (done.reason === 'forbidden') return Response.json({ error: 'forbidden' }, { status: 403 })
    if (done.reason === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ error: 'name_mismatch' }, { status: 400 })
  }
  return Response.json({ ok: true, next: await nextWorkspaceHref(session.ctx.userId) })
}
