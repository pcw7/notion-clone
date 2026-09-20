/**
 * 이 칸에 더할 수 있는 행 — GET `/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]/candidates?q=`
 * (relation 5b-2조각)
 *
 * 정본: 03-database-core.md F-03-10 시나리오 4 (*"셀 클릭 → 대상 DB 페이지 검색 팝오버 → 선택"*)
 *
 * 주소가 **행**이다 — 대상 표를 요청이 말하지 않는다. 서버가 프로퍼티에서 읽고, 이미 연결된 행은 뺀다. 규칙은
 * `lib/database/relation.ts` `searchCandidates`. 대상 표를 못 보면 빈 목록이다.
 *
 * `views/{id}/rows` 를 쓰지 않는 이유: 그 라우트는 필터를 요청에서 받지 않는다(뷰 설정은 공유 상태다 · F-03-17).
 * 고르기용 검색은 뷰가 아니라 **이 칸**의 일이다.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { searchCandidates } from '@/lib/database/relation'
import { failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]/candidates'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const found = await searchCandidates(session.ctx, rowId, propertyId, q)
  if (!found.ok) return failureResponse(found.reason === 'not_found' ? 404 : 400, found)
  return Response.json({ ok: true, items: found.value.items })
}
