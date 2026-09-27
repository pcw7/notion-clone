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

import { asBlockId, isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { movePage, MoveError } from '@/lib/block/move-page'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/move'>

/** MoveError 를 HTTP 로. 존재를 유출하지 않는 쪽으로 고른다. */
function statusFor(code: MoveError['code']): number {
  switch (code) {
    case 'not_found':
    case 'target_not_found':
      return 404
    // 볼 수는 있는데 옮길 수 없다. 볼 수 없으면 not_found 다(§3.3-31).
    case 'forbidden':
    // 뿌리가 바뀌는 이동에 페이지의 전체 권한이 없다(7c-3).
    case 'needs_full_access':
      return 403
    case 'cycle':
    case 'too_deep':
    // 그 대상 종류가 이 노드에 맞지 않는다 — 데이터베이스를 페이지 밑으로(7c-8).
    case 'invalid_target':
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
  const body = (parsed.body ?? {}) as { targetParentId?: unknown; targetTeamspaceId?: unknown; targetPrivate?: unknown }

  let targetParentId = null
  if (body.targetParentId != null) {
    try {
      targetParentId = asBlockId(body.targetParentId)
    } catch {
      // uuid 가 아니면 "그런 대상은 없다"와 구분할 이유가 없다.
      return Response.json({ error: 'target_not_found' }, { status: 404 })
    }
  }

  let destination: Parameters<typeof movePage>[2] = targetParentId
  if (body.targetTeamspaceId != null) {
    if (targetParentId !== null) {
      return Response.json({ error: 'invalid_target', message: '부모 페이지와 teamspace 를 함께 줄 수 없습니다.' }, { status: 400 })
    }
    if (typeof body.targetTeamspaceId !== 'string' || !isUuid(body.targetTeamspaceId)) {
      return Response.json({ error: 'target_not_found' }, { status: 404 })
    }
    destination = { teamspaceId: body.targetTeamspaceId }
  }
  if (body.targetPrivate != null) {
    if (body.targetPrivate !== true) {
      return Response.json({ error: 'target_not_found' }, { status: 404 })
    }
    if (targetParentId !== null || body.targetTeamspaceId != null) {
      return Response.json({ error: 'invalid_target', message: '자리 지정은 하나만 줄 수 있습니다.' }, { status: 400 })
    }
    destination = { privateTop: true }
  }

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
    if (e instanceof MoveError) {
      return Response.json({ error: e.code, message: e.message }, { status: statusFor(e.code) })
    }
    throw e
  }
}
