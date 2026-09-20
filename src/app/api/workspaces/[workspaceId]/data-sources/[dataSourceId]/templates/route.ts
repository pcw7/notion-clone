/**
 * 데이터베이스 템플릿 — GET(목록) · POST(만들기)
 * `/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/templates` (템플릿 6c-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5(`page.is_template` · 불변식 R1) / 08-templates-automation.md F-08-02
 *
 * 주소에 표(data_source)가 **있다**. 행 라우트가 `rows/{rowId}` 로 표를 뺀 것과 다른 이유는 이 주소가 묻는 것이
 * "이 표의 템플릿 목록"이어서다 — 만들기도 같은 자리에 있어야 `New ▾` 가 한 주소만 알면 된다. 템플릿 하나를
 * 가리키는 주소(지우기)는 행과 같은 규칙으로 `templates/{templateId}` 다(id 가 곧 블록 id 다 · C-3).
 *
 * 목록은 `view` 만 있으면 읽고, 만들기는 `edit_structure` 를 묻는다 — 08 의 *"템플릿 목록 노출은 하되 생성 불가"*
 * (`template.ts` 머리말).
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createTemplate, listTemplates } from '@/lib/database/template'
import { failureResponse, templateFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/data-sources/[dataSourceId]/templates'>

export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const listed = await listTemplates(session.ctx, dataSourceId)
  if (!listed.ok) return failureResponse(templateFailureStatus(listed.reason), listed)

  return Response.json({
    templates: listed.value.map((t) => ({ id: t.id, title: t.title, lastEditedAt: t.lastEditedAt.toISOString() })),
  })
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, dataSourceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(dataSourceId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { title?: unknown }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return Response.json({ error: 'invalid_value' }, { status: 400 })
  }

  const created = await createTemplate(session.ctx, dataSourceId, {
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
  })
  if (!created.ok) return failureResponse(templateFailureStatus(created.reason), created)

  const row = created.value
  return Response.json({ template: { id: row.id, title: row.title, lastEditedAt: row.lastEditedAt.toISOString() } }, { status: 201 })
}
