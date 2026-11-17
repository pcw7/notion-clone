/**
 * /api/workspaces/[workspaceId]/ai — 워크스페이스의 AI 스위치 · 쓴 양 (AI-1 · F-10-12)
 *
 *   GET — `{ ai: { enabled, canManage, available, providerHost, model, quota } }` — 게스트가 아닌 사람(게스트는 404)
 *   PUT — `{ enabled: boolean }` — 소유자만(403 `forbidden`) · 참거짓이 아니면 400 `invalid_value`. 바뀌면 감사(`ai.enabled`)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑤. 판정은 `lib/ai/usage.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { readAiConfig } from '@/lib/ai/config'
import { aiSettingsSummary, setAiEnabled } from '@/lib/ai/usage'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const summary = await aiSettingsSummary(session.ctx, { config: readAiConfig() })
  return summary === null ? Response.json({ ok: false, error: 'not_found' }, { status: 404 }) : Response.json({ ok: true, ai: summary })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  if (typeof body !== 'object' || body === null || !('enabled' in body)) return Response.json({ ok: false, error: 'invalid_value' }, { status: 400 })
  const result = await setAiEnabled(session.ctx, (body as { enabled: unknown }).enabled)
  return result.ok
    ? Response.json({ ok: true, enabled: result.value.enabled })
    : Response.json({ ok: false, error: result.reason }, { status: result.reason === 'forbidden' ? 403 : 400 })
}
