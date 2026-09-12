/**
 * 즐겨찾기 토글 — POST/DELETE `/api/workspaces/[workspaceId]/pages/[pageId]/favorite`
 *
 * 정본: 07-search-navigation.md F-07-16 ("사용자별 개인 목록")
 *
 * 이 표는 **권한의 저장 지점이 아니다**(C-7). 그래서 여기서 하는 검사는 하나뿐이다 —
 * *볼 수 있는 페이지인가*. 즐겨찾기에 넣는다고 접근이 생기지 않고, 접근을 잃으면
 * 조회 시점 필터가 목록에서 빼 준다(`nav/recent.ts`).
 */

import { asBlockId } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { addFavorite, removeFavorite } from '@/lib/nav/recent'
import { canViewPage } from '@/lib/permissions/effective'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/favorite'>

async function resolve(ctx: Ctx, workspaceIdParam: string, raw: string) {
  const session = await requireWorkspaceSession(workspaceIdParam)
  if (!session.ok) return { ok: false as const, response: session.response }

  let pageId
  try {
    pageId = asBlockId(raw)
  } catch {
    return { ok: false as const, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  }

  // 볼 수 없는 페이지는 없는 페이지와 같다 — 즐겨찾기로 존재를 확인할 수 없어야 한다.
  if (!(await canViewPage(session.ctx, pageId))) {
    return { ok: false as const, response: Response.json({ error: 'not_found' }, { status: 404 }) }
  }
  return { ok: true as const, ctx: session.ctx, pageId }
}

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const resolved = await resolve(ctx, workspaceId, raw)
  if (!resolved.ok) return resolved.response

  await addFavorite(resolved.ctx, resolved.pageId)
  return Response.json({ ok: true, favorite: true })
}

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId: raw } = await ctx.params
  const resolved = await resolve(ctx, workspaceId, raw)
  if (!resolved.ok) return resolved.response

  await removeFavorite(resolved.ctx, resolved.pageId)
  return Response.json({ ok: true, favorite: false })
}
