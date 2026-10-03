/**
 * GET /api/workspaces/[workspaceId]/pages/[pageId]/versions — 페이지 버전 목록 (잔여 묶음 8d-1 · F-11-01)
 *
 * 최신순 · 보관 기간 안의 것만 · 바이트는 싣지 않는다(`history/version.ts`). 열 때 버전 판정을 한 번 한다 — 마지막 편집 뒤 2분이
 * 지났으면 그 세션의 버전이 여기서 선다(정본 §3.7 [보강] 버전 기록 ②).
 *
 * 고칠 수 있는 사람만 — 볼 수만 있으면 403, 볼 수 없거나 없는 페이지면 404(F-11-01 *"`Can edit` 이상"*).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listVersions } from '@/lib/history/version'
import { versionFailureStatus } from '@/lib/history/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/versions'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const listed = await listVersions(session.ctx, pageId)
  if (!listed.ok) return Response.json({ error: listed.reason }, { status: versionFailureStatus(listed.reason) })
  return Response.json({ ok: true, versions: listed.value })
}
