/**
 * GET /api/workspaces/[workspaceId]/export — Markdown & CSV ZIP 내려받기 (F-09-14)
 *
 * 쿼리: `root` — 페이지 · 데이터베이스 id. **없으면** 워크스페이스 전체(소유자만). 빈 값은 전체가 아니다
 * (`lib/export/http.ts` 의 `exportScopeOf`).
 *
 * 준비(권한 → 스냅샷 → 조립 → 크기 추정)는 `prepareExport` 가 하고, 거부는 **응답 헤더를 보내기 전에**
 * 상태 코드로 준다. 통과하면 ZIP 을 흘려보낸다 — 크기를 미리 알 수 없어 content-length 가 없다.
 *
 * 화면은 먼저 `/export/summary` 로 무엇이 들어가는지 · 거부되는지 보여주고 이 주소는 평범한 링크로 연다.
 * 링크로 여는 이유는 `export-button.tsx` 머리말.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { exportZipStream, prepareExport } from '@/lib/export/download'
import { exportRejectionStatus, exportScopeOf, zipResponseHeaders } from '@/lib/export/http'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/workspaces/[workspaceId]/export'>,
): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const prepared = await prepareExport(session.ctx, exportScopeOf(new URL(request.url)))
  if (!prepared.ok) {
    return Response.json({ error: prepared.reason }, { status: exportRejectionStatus(prepared.reason) })
  }

  return new Response(exportZipStream(session.ctx, prepared.value.plan), {
    headers: zipResponseHeaders(prepared.value.fileName),
  })
}
