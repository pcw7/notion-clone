/**
 * GET /api/workspaces/[workspaceId]/audit/csv — 감사 로그 CSV (게시 · 공유 6d-2 · F-11-12)
 *
 *   ?type=<종류>   그 종류만. 최근 것부터 `AUDIT_CSV_MAX`(10,000) 줄까지 — 넘으면 마지막 줄 뒤에 남은 것이 있다는 것을 머리에 싣는다
 *                  (`x-audit-truncated: 1`). 빈 결과도 머리 줄만 있는 파일이다(11 *"빈 CSV 도 생성해 내보내기 실패와 구분"*).
 *
 * 판정은 목록과 같다(owner · Enterprise). 문구는 화면과 같은 함수다(`audit-labels.ts`) · 모든 칸에 수식 막기.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { AUDIT_CSV_MAX, listWorkspaceAudit } from '@/lib/audit/audit'
import { auditCsv } from '@/lib/audit/audit-csv'

export async function GET(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/audit/csv'>): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const type = new URL(request.url).searchParams.get('type')
  const result = await listWorkspaceAudit(session.ctx, { limit: AUDIT_CSV_MAX + 1, ...(type ? { type } : {}) }, AUDIT_CSV_MAX + 1)
  if (!result.ok) return Response.json({ error: result.reason }, { status: 403 })
  const rows = result.value.slice(0, AUDIT_CSV_MAX)
  return new Response(auditCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-log.csv"`,
      'cache-control': 'no-store',
      'x-audit-truncated': result.value.length > AUDIT_CSV_MAX ? '1' : '0',
    },
  })
}
