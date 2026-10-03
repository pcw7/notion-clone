/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]/restore — 이 버전으로 되돌린다 (잔여 묶음 8d-3 · F-11-02)
 *
 * 앞으로 쓰는 되돌리기다 — 되돌리기 전의 상태가 버전으로 남고, 되돌린 상태도 버전(`restore`)으로 남는다(`history/restore.ts`). 지금 본문과
 * 같으면 아무것도 쓰지 않는다(`noop`). 몸체는 없다.
 *
 * 고칠 수 있는 사람만 — 볼 수만 있으면 403 · 볼 수 없거나 없는 페이지 · 버전이면 404 · 잠긴 페이지 409 · 지난 버전 410.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { restoreVersion } from '@/lib/history/restore'
import { restoreFailureStatus } from '@/lib/history/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/versions/[versionId]/restore'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, versionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const restored = await restoreVersion(session.ctx, pageId, versionId)
  if (!restored.ok) return Response.json({ error: restored.reason }, { status: restoreFailureStatus(restored.reason) })
  return Response.json({ ok: true, ...restored.value })
}
