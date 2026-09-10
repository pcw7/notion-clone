/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/move — 페이지 이동 (F-02-08)
 *
 * `{ "targetParentId": "<uuid>" | null }`. `null` 이면 워크스페이스 최상위로.
 *
 * PATCH 가 아니라 POST 인 이유: 이동은 필드 하나를 고치는 것이 아니라
 * **서브트리 전체의 경로와 권한 스코프를 다시 쓰는 연산**이다(X-7 / §3.11).
 * 부분 갱신처럼 보이는 계약을 주면 나중에 `parent_id` 만 PATCH 하는 호출자가
 * 생기고, 그건 트리를 조용히 깨뜨린다.
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { movePage, MoveError } from '@/lib/block/move-page'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/move'>

/** MoveError 를 HTTP 로. 존재를 유출하지 않는 쪽으로 고른다. */
function statusFor(code: MoveError['code']): number {
  switch (code) {
    case 'not_found':
    case 'target_not_found':
      return 404
    case 'cycle':
    case 'too_deep':
      return 400
  }
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
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
  const body = (parsed.body ?? {}) as { targetParentId?: unknown }

  let targetParentId = null
  if (body.targetParentId != null) {
    try {
      targetParentId = asBlockId(body.targetParentId)
    } catch {
      // uuid 가 아니면 "그런 대상은 없다"와 구분할 이유가 없다.
      return Response.json({ error: 'target_not_found' }, { status: 404 })
    }
  }

  try {
    const result = await movePage(session.ctx, pageId, targetParentId)
    return Response.json({
      ok: true,
      noop: result.noop,
      page: {
        id: result.pageId,
        parentPageId: result.parentBlockId,
        ancestors: result.ancestors,
        version: result.version,
      },
      movedDescendants: result.movedDescendants,
    })
  } catch (e) {
    if (e instanceof MoveError) {
      return Response.json({ error: e.code, message: e.message }, { status: statusFor(e.code) })
    }
    throw e
  }
}
