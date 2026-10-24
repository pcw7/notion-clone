/**
 * 이 칸에서 새 행을 만들며 잇는다 — POST `/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]/create` { title }
 * (§7 정리 10n-41 · F-03-10 *"셀에서 + 새 페이지"*)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강] `relation_edge` 의 규칙 — [보강 10n-41] 만들며 잇기
 *
 * 주소가 **행**이다 — 대상 표를 요청이 말하지 않는다(후보 라우트와 같다). 서버가 프로퍼티에서 읽고, 그 표에 제목으로 행을 만들어 이 칸에
 * 잇는다 — 한 트랜잭션(`lib/database/relation-create.ts`). 답은 바뀐 이 행과 새로 만든 행이다(화면이 칩의 제목을 곧바로 그린다).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { createLinkedRow } from '@/lib/database/relation-create'
import { failureResponse, relationFailureStatus, rowJson } from '@/lib/database/http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/relations/[propertyId]/create'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { title?: unknown }

  const made = await createLinkedRow(session.ctx, rowId, propertyId, { title: body.title })
  if (!made.ok) return failureResponse(relationFailureStatus(made.reason), made)
  return Response.json({ ok: true, row: rowJson(made.value.row), created: rowJson(made.value.created) }, { status: 201 })
}
