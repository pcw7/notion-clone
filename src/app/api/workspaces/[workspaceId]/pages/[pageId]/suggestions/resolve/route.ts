/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/suggestions/resolve — 제안 수락 · 거절의 기록 (SG-3 · F-05-12)
 *
 * 받는 것: `{ action: 'accept' | 'reject', ids: string[] }` — 카드의 하나 · 목록의 모두 수락 · 모두 거절이 같은 문이다. 본문은 편집기가
 * 먼저 바꿨다(`editor/suggestion-resolve.ts`) — 여기는 메타 표만 맞춘다(`lib/suggestion/resolve.ts` 머리말의 차례).
 * 본문을 고칠 수 없으면 403 · 볼 수 없거나 없는 페이지면 404.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { resolveSuggestions } from '@/lib/suggestion/resolve'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/suggestions/resolve'>

const STATUS = { not_found: 404, forbidden: 403, invalid: 400 } as const

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const body = await readJsonBody(request)
  if (!body.ok) return body.response

  const input = (body.body ?? {}) as { action?: unknown; ids?: unknown }
  const result = await resolveSuggestions(session.ctx, pageId, input.ids, input.action)
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  return Response.json({ ok: true, resolved: result.resolved })
}
