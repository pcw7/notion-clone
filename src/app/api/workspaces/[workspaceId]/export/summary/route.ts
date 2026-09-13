/**
 * GET /api/workspaces/[workspaceId]/export/summary — 내려받기 전에 무엇이 들어가는가 (F-09-14)
 *
 * 쿼리는 `/export` 와 같다. 내려받기와 **같은 준비**(`prepareExport`)를 돌리고 ZIP 대신 개수 · 크기
 * 상한만 준다. 거부도 같은 상태 코드다 — 요약이 통과하면 내려받기도 통과한다(그 사이에 내용이 늘어
 * 상한을 넘는 경우만 예외다).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { prepareExport } from '@/lib/export/download'
import { exportRejectionStatus, exportScopeOf, exportSummaryJson } from '@/lib/export/http'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/export/summary'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const prepared = await prepareExport(session.ctx, exportScopeOf(new URL(request.url)))
  if (!prepared.ok) {
    return Response.json({ error: prepared.reason }, { status: exportRejectionStatus(prepared.reason) })
  }
  return Response.json(exportSummaryJson(prepared.value), { headers: { 'cache-control': 'no-store' } })
}
