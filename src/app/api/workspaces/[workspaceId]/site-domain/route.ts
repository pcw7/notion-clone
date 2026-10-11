/**
 * /api/workspaces/[workspaceId]/site-domain — 워크스페이스의 사이트 주소 (게시 · 공유 6c-1 · F-13-08)
 *
 *   GET — `{ name }`(없으면 null) — 이 워크스페이스의 누구나(게시 패널이 사이트 주소를 보인다)
 *   PUT — `{ name: string | null }` — 정한다 · `null` · 빈 글자는 지운다. 소유자만(403 `forbidden`) · 모양이 틀리면 400 `invalid_name` ·
 *         앱이 쓰는 이름이면 400 `reserved` · 다른 워크스페이스가 쓰면 409 `taken`
 *
 * 정본: 00-canonical-data-model.md §3.3 끝 [보강] 사이트 주소 ③. 판정은 `publish/site.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { readSiteDomain, setSiteDomain, siteDomainFailureStatus } from '@/lib/publish/site'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/site-domain'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return Response.json({ ok: true, name: await readSiteDomain(session.ctx) })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  if (typeof body !== 'object' || body === null || !('name' in body)) {
    return Response.json({ ok: false, error: 'invalid_input' }, { status: 400 })
  }
  const result = await setSiteDomain(session.ctx, (body as { name: unknown }).name)
  return result.ok
    ? Response.json({ ok: true, name: result.value.name })
    : Response.json({ ok: false, error: result.reason }, { status: siteDomainFailureStatus(result.reason) })
}
