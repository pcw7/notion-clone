/**
 * /api/workspaces/[workspaceId]/ai/models — 워크스페이스의 AI 모델 설정 (AI-7 · F-10-26)
 *
 *   GET — `{ models: { autoModel, allowed, defaultModel, canManage, available, source } }` — 게스트가 아닌 사람(게스트 · 공급자 없음은 404).
 *         공급자의 목록(`available`)은 소유자에게만(1시간 캐시 · 못 받으면 자동 하나 · `source: 'fallback'`)
 *   PUT — `{ allowed: string[], default: string | null }` — 소유자만(403 `forbidden`). 400 `invalid_value` · `too_many_models` ·
 *         `unknown_model`(공급자의 목록에 없는 새 모델) · `default_not_allowed` · 503 `ai_unavailable`. 바뀌면 감사(`ai.models`)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ⑫. 판정은 `lib/ai/model-setting.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { readAiConfig } from '@/lib/ai/config'
import { aiModelSettingsFor, setAiModels } from '@/lib/ai/model-setting'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/ai/models'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const view = await aiModelSettingsFor(session.ctx, { config: readAiConfig() })
  return view === null ? Response.json({ ok: false, error: 'not_found' }, { status: 404 }) : Response.json({ ok: true, models: view })
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const result = await setAiModels(session.ctx, parsed.body, { config: readAiConfig() })
  if (result.ok) return Response.json({ ok: true, allowed: result.value.allowed, defaultModel: result.value.defaultModel })
  const status = result.reason === 'forbidden' ? 403 : result.reason === 'ai_unavailable' ? 503 : 400
  return Response.json({ ok: false, error: result.reason }, { status })
}
