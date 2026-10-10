/**
 * GET /api/workspaces/[workspaceId]/audit — 감사 로그 (게시 · 공유 6d-2 · F-11-12)
 *
 *   ?type=<종류>   그 종류만 · ?before=<ISO 시각> 그보다 앞의 것 · ?limit=<1~500>(기본 100)
 *
 *   forbidden      403  owner 가 아니다
 *   plan_required  403  요금제가 감사 로그를 읽게 하지 않는다(Enterprise 만 — 권한 거부와 코드가 다르다)
 *
 * 판정은 `audit/audit.ts` `listWorkspaceAudit` 가 한다(정본 §3.8 끝 [보강] 감사 로그 ⑤⑥).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { listWorkspaceAudit } from '@/lib/audit/audit'

export async function GET(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/audit'>): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const params = new URL(request.url).searchParams
  const limit = Number(params.get('limit') ?? '100')
  const result = await listWorkspaceAudit(session.ctx, {
    limit: Number.isFinite(limit) ? limit : 100,
    ...(params.get('before') ? { before: params.get('before')! } : {}),
    ...(params.get('type') ? { type: params.get('type')! } : {}),
  })
  if (!result.ok) return Response.json({ error: result.reason }, { status: 403 })
  return Response.json({ events: result.value })
}
