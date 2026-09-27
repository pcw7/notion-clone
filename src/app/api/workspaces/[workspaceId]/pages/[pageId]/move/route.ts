/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/move — 페이지 이동 (F-02-08)
 *
 * `{ "targetParentId": "<uuid>" | null }`. `null` 이면 워크스페이스 최상위로. `{ "targetTeamspaceId": "<uuid>" }` 면 그 teamspace 의
 * 최상위로(7c-3). `{ "targetPrivate": true }` 면 **내 개인 최상위**로 — 나만 보게 되고 이 페이지에 따로 준 공유가 걷힌다
 * (정본 §3.11 `move_to_private` · 7c-7). 자리 지정을 둘 이상 함께 주면 400 이다.
 *
 * PATCH 가 아니라 POST 인 이유: 이동은 필드 하나를 고치는 것이 아니라
 * **서브트리 전체의 경로와 권한 스코프를 다시 쓰는 연산**이다(X-7 / §3.11).
 * 부분 갱신처럼 보이는 계약을 주면 나중에 `parent_id` 만 PATCH 하는 호출자가
 * 생기고, 그건 트리를 조용히 깨뜨린다.
 */

import { asBlockId } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { movePage, MoveError } from '@/lib/block/move-page'
import { moveErrorResponse, readMoveDestination } from '@/lib/block/move-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/move'>

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
  // 몸체의 모양은 미리보기(`…/move/preview`)와 같은 함수가 읽는다(`move-http.ts`).
  const read = readMoveDestination(parsed.body)
  if (!read.ok) return read.response
  const destination = read.destination

  try {
    const result = await movePage(session.ctx, pageId, destination)
    return Response.json({
      ok: true,
      noop: result.noop,
      page: {
        id: result.pageId,
        parentPageId: result.parentBlockId,
        teamspaceId: result.teamspaceId,
        privateTop: result.privateTop,
        ancestors: result.ancestors,
        version: result.version,
      },
      movedDescendants: result.movedDescendants,
    })
  } catch (e) {
    if (e instanceof MoveError) return moveErrorResponse(e)
    throw e
  }
}
