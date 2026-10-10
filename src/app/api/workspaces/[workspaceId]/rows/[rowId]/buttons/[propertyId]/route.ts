/**
 * POST /api/workspaces/[workspaceId]/rows/[rowId]/buttons/[propertyId] — 그 행의 버튼을 누른다 (자동화 5a-1 · F-03-15)
 *
 * `{ "idempotencyKey": "<uuid>" }` — 화면이 누를 때마다 만든다. 같은 키가 다시 오면 실행하지 않고 처음 결과를 준다(`duplicate`).
 * 그 행의 `edit_content` — 볼 수 없으면 404, 볼 수만 있으면 403, 꺼진 버튼이면 409. 결과는 실행 기록(상태 · 단계마다의 결과).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { buttonFailureStatus, pressButton } from '@/lib/automation/button-property'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/rows/[rowId]/buttons/[propertyId]'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, rowId, propertyId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const key = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { idempotencyKey?: unknown }).idempotencyKey : undefined
  const pressed = await pressButton(session.ctx, rowId, propertyId, key)
  if (!pressed.ok) return Response.json({ error: pressed.reason }, { status: buttonFailureStatus(pressed.reason) })
  return Response.json({ ok: true, run: pressed.value })
}
