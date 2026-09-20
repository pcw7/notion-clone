/**
 * 템플릿 하나 — DELETE(휴지통) `/api/workspaces/[workspaceId]/templates/[templateId]` (템플릿 6c-1조각)
 *
 * 정본: 00-canonical-data-model.md §3.5 / 08-templates-automation.md F-08-02
 *
 * 주소에 표가 없다 — 템플릿 id 가 곧 블록 id 이고(C-3) 어느 표의 것인지는 `page.data_source_id` 가 안다.
 * 행 라우트(`rows/{rowId}`)와 같은 규칙이다.
 *
 * **고치는 길은 여기 없다.** 템플릿의 이름은 title 셀이고 본문은 Y.Doc 이므로 `PATCH /rows/{rowId}` 와 협업
 * 서버가 그대로 듣는다(`template.ts` 머리말 — 템플릿만의 편집 명령을 만들지 않는다).
 */

import { isUuid } from '@/lib/ids'
import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { deleteTemplate } from '@/lib/database/template'
import { failureResponse, templateFailureStatus } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/templates/[templateId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, templateId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(templateId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const deleted = await deleteTemplate(session.ctx, templateId)
  if (!deleted.ok) return failureResponse(templateFailureStatus(deleted.reason), deleted)
  return Response.json({ ok: true })
}
