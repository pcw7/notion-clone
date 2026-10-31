/**
 * GET /api/workspaces/[workspaceId]/files/[fileId] — 파일의 메타 (F-1b · 정본 §3.4 [보강 F-1] ⑧)
 *
 * 파일 블록에는 `file_id` 만 있고 이름 · 크기는 `file` 행의 것이라 노드 뷰가 여기서 읽는다. 세션이 판정한다(`content/` 와 같다) —
 * 없는 파일과 다른 워크스페이스의 파일을 구분하지 않는다(404 · id 를 찍어보는 것으로 존재를 알아낼 수 없어야 한다). 바이트는 `content/` 다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { getFile } from '@/lib/file/file'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/files/[fileId]'>,
): Promise<Response> {
  const { workspaceId, fileId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const found = await getFile(session.ctx, fileId)
  if (found === null) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(
    {
      ok: true,
      // 올리기(`POST /files`)의 답과 같은 모양
      file: { id: found.id, mime: found.mime, size: found.sizeBytes, name: found.originalName },
    },
    // 같은 id 의 메타는 바뀌지 않는다 — 공용 캐시에는 두지 않는다
    { headers: { 'cache-control': 'private, max-age=3600' } },
  )
}
