/**
 * /api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations/[automationId]/runs — 실행 기록 (자동화 5b-3a · F-08-09)
 *
 *   GET — 새것부터 50개(보관 상한) `{ runs: [{ id, status, startedAt, finishedAt, triggerPageId, steps }], titles: { [pageId]: 제목 | null } }`.
 *         `titles` 는 보는 사람의 권한으로 — 볼 수 없으면 null, 지워졌으면 키가 없다(정본 [보강] DB automation — 화면 ⓓ).
 *
 * 권한은 정의와 같다(`../../route.ts` — 그 데이터베이스의 전체 권한).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { dbAutomationFailureStatus, listDbAutomationRuns } from '@/lib/automation/db-automation'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/automations/[automationId]/runs'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId, automationId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const listed = await listDbAutomationRuns(session.ctx, dataSourceId, automationId)
  if (!listed.ok) return Response.json({ error: listed.reason }, { status: dbAutomationFailureStatus(listed.reason) })
  return Response.json({ ok: true, runs: listed.value.runs, titles: listed.value.titles })
}
