/**
 * POST /api/workspaces/[workspaceId]/pages — 페이지 생성 (`{ parentPageId?, teamspaceId?, title?, at? }` — `at` 은 부모 본문에서 참조를 넣을 자리,
 *   `teamspaceId` 는 그 teamspace 의 최상위에 만든다 · 7c-1)
 * GET  /api/workspaces/[workspaceId]/pages?parent=<pageId> — 자식 페이지 목록
 *
 * 정본: 00-canonical-data-model.md §3.4 (페이지는 `type='page'` 블록이다 — C-3)
 */

import { asBlockId, isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import {
  createPage,
  listChildPages,
  titleFromPlainText,
  PageError,
} from '@/lib/block/page'

/** PageError 를 HTTP 로 옮긴다. 코드가 곧 상태다. */
function errorResponse(e: PageError): Response {
  const status = e.code === 'parent_not_found' ? 404 : 400
  return Response.json({ error: e.code, message: e.message }, { status })
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/pages'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { parentPageId?: unknown; teamspaceId?: unknown; title?: unknown; at?: unknown }

  let parentPageId = null
  if (body.parentPageId != null) {
    try {
      parentPageId = asBlockId(body.parentPageId)
    } catch {
      // uuid 가 아니면 "그런 부모는 없다"와 구분할 이유가 없다.
      return Response.json({ error: 'parent_not_found' }, { status: 404 })
    }
  }

  // teamspace 의 최상위(7c-1). 부모 페이지와 같은 규칙 — uuid 가 아니면 "그런 teamspace 는 없다"와 같다.
  let teamspaceId: string | null = null
  if (body.teamspaceId != null) {
    if (typeof body.teamspaceId !== 'string' || !isUuid(body.teamspaceId)) {
      return Response.json({ error: 'parent_not_found' }, { status: 404 })
    }
    teamspaceId = body.teamspaceId
  }

  // 부모 본문에서 참조를 넣을 자리 — 편집기의 캐럿이 있던 블록(`createPage` 의 `at`). 본문에 없는 블록이면 맨 뒤라
  // 무엇도 알려주지 않는다. uuid 가 아닌 것만 요청이 틀렸다.
  let at = null
  if (body.at != null) {
    try {
      at = asBlockId(body.at)
    } catch {
      return Response.json({ error: 'invalid_at' }, { status: 400 })
    }
  }

  try {
    const page = await createPage(session.ctx, {
      parentPageId,
      teamspaceId,
      title: titleFromPlainText(body.title),
      at,
    })
    return Response.json({
      ok: true,
      page: { id: page.id, title: page.plainTitle, parentPageId: page.parentPageId, teamspaceId: page.teamspaceId },
    })
  } catch (e) {
    if (e instanceof PageError) return errorResponse(e)
    throw e
  }
}

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/pages'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const raw = new URL(request.url).searchParams.get('parent')
  let parentPageId = null
  if (raw != null && raw !== '') {
    try {
      parentPageId = asBlockId(raw)
    } catch {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
  }

  const pages = await listChildPages(session.ctx, parentPageId)
  return Response.json({
    ok: true,
    pages: pages.map((p) => ({ id: p.id, title: p.plainTitle, orderKey: p.orderKey })),
  })
}
