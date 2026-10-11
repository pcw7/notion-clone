/**
 * /api/workspaces/[workspaceId]/forms/[viewId] — 폼의 설정 (인접 제품 7a-1 · F-13-01 · F-13-02)
 *
 *   GET   — 폼(`{ form }` — 설정 · 질문 · 더할 수 있는 속성 · 할 수 있는 일). 표를 여는 사람. 폼이 아니면 404
 *   PATCH — `{ title?, description?, submitLabel?, confirmationTitle?, confirmationBody?, access?: 'closed' | 'public' }` — 글 칸은 구조를
 *           고치는 사람 · 공개 · 닫기는 `manage_perm`(403) · 정책이 막으면 409 `policy_disabled` · 틀린 몸체는 400 `invalid_input`
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼 ③. 판정은 `database/form.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { formFailureStatus, readForm, updateFormSettings, type FormResult, type FormDetail } from '@/lib/database/form'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/forms/[viewId]'>

const respond = (result: FormResult<FormDetail>): Response =>
  result.ok
    ? Response.json({ ok: true, form: result.value })
    : Response.json({ ok: false, error: result.reason }, { status: formFailureStatus(result.reason) })

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  return respond(await readForm(session.ctx, viewId))
}

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, viewId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  return respond(await updateFormSettings(session.ctx, viewId, parsed.body))
}
