/**
 * PUT /api/workspaces/[workspaceId]/forms/[viewId]/questions — 폼의 질문 목록을 통째로 바꾼다 (인접 제품 7a-1 · F-13-01)
 *
 * 몸체 `{ questions: [{ propertyId, label?, helpText?, required? }] }` — 순서대로. 같은 속성 두 번 · 틀린 모양은 400 `invalid_input` ·
 * 받지 않는 타입 · 다른 표 · 지운 속성은 400 `unsupported_type`. 구조를 고치는 사람만(403 · 잠기면 409).
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ②. 판정은 `database/form.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { formFailureStatus, setFormQuestions } from '@/lib/database/form'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/forms/[viewId]/questions'>

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const questions = (parsed.body as { questions?: unknown } | null)?.questions
  const result = await setFormQuestions(session.ctx, viewId, questions)
  return result.ok
    ? Response.json({ ok: true, form: result.value })
    : Response.json({ ok: false, error: result.reason }, { status: formFailureStatus(result.reason) })
}
