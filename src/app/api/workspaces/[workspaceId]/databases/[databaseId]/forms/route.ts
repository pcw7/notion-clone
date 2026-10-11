/**
 * POST /api/workspaces/[workspaceId]/databases/[databaseId]/forms — 폼 뷰를 만든다 (인접 제품 7a-1 · F-13-01)
 *
 * 몸체 `{ name?, dataSourceId? }` — 소유한 data source 의 뷰 탭 끝에 폼 하나(첫 질문은 제목). 구조를 고치는 사람만(403 `forbidden` ·
 * 잠기면 409 `locked`). 응답은 폼(`{ form }` — 201).
 *
 * 정본: 00-canonical-data-model.md §3.6 끝 [보강] 폼. 판정은 `database/form.ts`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createFormView, formFailureStatus } from '@/lib/database/form'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/databases/[databaseId]/forms'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, databaseId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (typeof parsed.body === 'object' && parsed.body !== null ? parsed.body : {}) as { name?: unknown; dataSourceId?: unknown }
  const result = await createFormView(session.ctx, databaseId, {
    ...('name' in body ? { name: body.name } : {}),
    ...('dataSourceId' in body ? { dataSourceId: body.dataSourceId } : {}),
  })
  return result.ok
    ? Response.json({ ok: true, form: result.value }, { status: 201 })
    : Response.json({ ok: false, error: result.reason }, { status: formFailureStatus(result.reason) })
}
