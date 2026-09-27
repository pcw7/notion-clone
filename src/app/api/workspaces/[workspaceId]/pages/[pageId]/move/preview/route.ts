/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/move/preview — 옮기면 누가 잃고 얻는가 (7c-13 · F-06-20)
 *
 * 몸체는 옮기기(`…/move`)와 같다(`move-http.ts`). 거부도 같다 — 미리보기는 옮기기의 검사를 그대로 지나고, 실제로 옮겨 본 뒤
 * 되돌린다(`previewMove`). 아무것도 바꾸지 않으므로 GET 이어도 되지만 몸체가 옮기기와 같아야 해서 POST 다.
 *
 * `{ noop, lose: { count, names }, gain: { count, names }, keep, keptBelow: { pages, people } }` — `names` 는 그 페이지를 공유할 수
 * 있는 사람에게만 온다(아니면 null).
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { MoveError, previewMove } from '@/lib/block/move-page'
import { moveErrorResponse, readMoveDestination } from '@/lib/block/move-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/move/preview'>

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
  const read = readMoveDestination(parsed.body)
  if (!read.ok) return read.response

  try {
    return Response.json({ preview: await previewMove(session.ctx, pageId, read.destination) })
  } catch (e) {
    if (e instanceof MoveError) return moveErrorResponse(e)
    throw e
  }
}
