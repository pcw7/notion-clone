/**
 * POST /api/workspaces/[workspaceId]/pages/[pageId]/buttons/[blockId]/press — 버튼 블록을 누른다 (자동화 5e-1 · F-08-06)
 *
 * `{ "idempotencyKey": "<uuid>" }` — 화면이 누를 때마다 만든다(버튼 속성과 같다). 그 페이지의 `edit_content` — 볼 수 없으면 404, 볼
 * 수만 있으면 403, 잠긴 페이지 · 꺼진 버튼이면 409. 결과는 실행 기록(상태 · 단계마다의 결과).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { buttonBlockFailureStatus, pressButtonBlock } from '@/lib/automation/button-block'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/pages/[pageId]/buttons/[blockId]/press'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, pageId, blockId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const key = typeof parsed.body === 'object' && parsed.body !== null ? (parsed.body as { idempotencyKey?: unknown }).idempotencyKey : undefined
  const pressed = await pressButtonBlock(session.ctx, pageId, blockId, key)
  if (!pressed.ok) return Response.json({ error: pressed.reason }, { status: buttonBlockFailureStatus(pressed.reason) })
  return Response.json({ ok: true, run: pressed.value })
}
