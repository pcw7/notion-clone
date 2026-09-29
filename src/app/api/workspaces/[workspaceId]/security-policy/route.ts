/**
 * PUT /api/workspaces/[workspaceId]/security-policy — 워크스페이스 정책을 바꾼다 (7g-2 · F-06-15)
 *
 * `{ "allowNonmemberPageAccessRequest": boolean }` — 워크스페이스 밖의 사람이 페이지 접근을 요청할 수 있는가. owner 만
 * (`canManageSecurityPolicy`) — 아니면 403. 모양이 아니면 400 `invalid_policy`. 바뀐 정책을 돌려준다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { updateSecurityPolicy } from '@/lib/workspace/security-policy'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/security-policy'>

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const body = await readJsonBody(request)
  if (!body.ok) return body.response

  const result = await updateSecurityPolicy(session.ctx, body.body)
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: result.reason === 'forbidden' ? 403 : 400 })
  }
  return Response.json({ ok: true, policy: result.value })
}
