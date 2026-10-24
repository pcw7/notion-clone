/**
 * 필터 값으로 고를 행 — GET `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations/[propertyId]/candidates?q=` (10n-45)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-45] ③ 값 고르개의 후보 / 04 F-04-09
 *
 * 필터 패널의 relation "포함 · 포함하지 않음" 은 행이 없는 자리라 칸의 후보 라우트(`rows/{id}/relations/{propertyId}/candidates` — 그 칸에
 * 이미 이어진 행을 뺀다)를 쓰지 않는다. 대상 표는 서버가 프로퍼티에서 읽는다. 규칙은 `lib/database/relation.ts` `searchFilterCandidates` —
 * 표를 못 보면 404 · relation 이 아니면 400 · 대상 표를 못 보면 빈 목록.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { searchFilterCandidates } from '@/lib/database/relation'
import { failureResponse } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/relations/[propertyId]/candidates'>

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const found = await searchFilterCandidates(session.ctx, dataSourceId, propertyId, q)
  if (!found.ok) return failureResponse(found.reason === 'not_found' ? 404 : 400, found)
  return Response.json({ ok: true, items: found.value.items })
}
