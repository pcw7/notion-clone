/**
 * GET /api/workspaces/[workspaceId]/places/search?q= — 장소 찾기 (MP-1 · 정본 §3.5 [보강 MP-1] ②)
 *
 * 워크스페이스 멤버가 장소 칸의 편집기에서 Enter 로 한 번 묻는다. 서버가 `PLACE_SEARCH_URL` 에 대신 묻고(SSRF 방어 · 사람마다 초당 1번 ·
 * 결과 5개 — `database/place-search.ts`) 좌표로 쓴 글은 외부에 묻지 않는다. 글이 비었거나 길면 400 · 찾기를 껐으면 404 · 속도 제한 429 ·
 * 외부가 실패하면 502.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { searchPlaces } from '@/lib/database/place-search'

const FAILURE = {
  invalid_query: { status: 400, message: '찾을 글을 입력하세요(200자 이하).' },
  disabled: { status: 404, message: '장소 찾기가 꺼져 있습니다. 좌표(37.5665, 126.978)를 직접 입력할 수 있습니다.' },
  rate_limited: { status: 429, message: '잠시 뒤에 다시 시도해 주세요.' },
  failed: { status: 502, message: '찾지 못했습니다. 좌표(37.5665, 126.978)를 직접 입력할 수 있습니다.' },
} as const

export async function GET(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/places/search'>): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const result = await searchPlaces(session.ctx, new URL(request.url).searchParams.get('q'))
  if (!result.ok) {
    const f = FAILURE[result.reason]
    return Response.json({ error: result.reason, message: f.message }, { status: f.status })
  }
  return Response.json(
    { ok: true, source: result.source, places: result.places },
    { headers: { 'cache-control': 'private, no-store' } },
  )
}
