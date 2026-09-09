/**
 * PATCH /api/workspaces/[workspaceId]/pages/[pageId] — 제목 변경
 *
 * 본문(블록) 저장은 여기가 아니다. Phase 0 의 본문 저장은 **페이지 단위 LWW**
 * 이고 별도 엔드포인트로 온다(W4 후속). 제목만 먼저 나온 이유는 페이지를
 * 만들고 이름을 붙이는 것이 에디터보다 앞에 필요했기 때문이다.
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { renamePage, titleFromPlainText, PageError } from '@/lib/block/page'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]'>,
): Promise<Response> {
  const { workspaceId, pageId: rawPageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  let pageId
  try {
    pageId = asBlockId(rawPageId)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { title?: unknown }

  if (typeof body.title !== 'string') {
    return Response.json({ error: 'invalid_input', message: 'title 은 문자열이어야 합니다' }, { status: 400 })
  }

  try {
    const page = await renamePage(session.ctx, pageId, titleFromPlainText(body.title))
    return Response.json({ ok: true, page: { id: page.id, title: page.plainTitle, version: page.version } })
  } catch (e) {
    if (e instanceof PageError) {
      const status = e.code === 'not_found' ? 404 : 400
      return Response.json({ error: e.code, message: e.message }, { status })
    }
    throw e
  }
}
