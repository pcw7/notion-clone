/**
 * GET /api/workspaces/[workspaceId]/link-preview?url= — 북마크의 메타 (32번 트랙 F-4a · 정본 §3.4 [보강 F-4] ④)
 *
 * 워크스페이스 멤버가 북마크 카드를 그리려고 묻는다. 살아 있는 캐시가 있으면 그것, 없으면 서버가 그 주소에서 가져와 적는다
 * (`link-preview/link-preview.ts` — SSRF 방어 · 속도 제한 · 음성 캐시). 주소가 북마크 주소가 아니면 400 · 속도 제한에 걸리면 429.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { ensureLinkPreview } from '@/lib/link-preview/link-preview'

export async function GET(request: Request, ctx: RouteContext<'/api/workspaces/[workspaceId]/link-preview'>): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const url = new URL(request.url).searchParams.get('url') ?? ''
  const result = await ensureLinkPreview(session.ctx, url)
  if (!result.ok) {
    return result.reason === 'invalid_url'
      ? Response.json({ error: 'invalid_url', message: 'http 또는 https 주소(2,048자 이하)여야 합니다.' }, { status: 400 })
      : Response.json({ error: 'rate_limited', message: '잠시 뒤에 다시 시도해 주세요.' }, { status: 429 })
  }
  return Response.json(
    { ok: true, preview: result.preview },
    // 같은 주소를 짧게 다시 묻지 않게 — 사람마다(공용 캐시에는 두지 않는다)
    { headers: { 'cache-control': 'private, max-age=300' } },
  )
}
