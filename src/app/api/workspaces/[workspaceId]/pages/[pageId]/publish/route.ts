/**
 * /api/workspaces/[workspaceId]/pages/[pageId]/publish — 웹 게시 (게시 · 공유 6a-1 · F-06-08)
 *
 *   GET    — 게시 상태(볼 수 있으면). 토큰은 게시를 바꿀 수 있는 사람에게만.
 *   PUT    — 게시한다(`manage_perm` · 페이지만 · 휴지통 아님 · 정책 허용). 해제했던 것은 같은 주소로 다시 켠다.
 *   DELETE — 게시를 해제한다(행과 토큰은 남는다). 정책과 무관하게 된다.
 *
 * 판정은 `publish/public-link.ts` 가 한다(정본 §3.3 끝 [정정] 웹 게시 ④⑤).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { publishFailureStatus, publishPage, readPublishState, unpublishPage, type PublishResult } from '@/lib/publish/public-link'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/publish'>

function respond(result: PublishResult): Response {
  if (!result.ok) return Response.json({ ok: false, error: result.reason }, { status: publishFailureStatus(result.reason) })
  return Response.json({ ok: true, ...result.value })
}

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return respond(await readPublishState(session.ctx, pageId))
}

export async function PUT(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return respond(await publishPage(session.ctx, pageId))
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return respond(await unpublishPage(session.ctx, pageId))
}
