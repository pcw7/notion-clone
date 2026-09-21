/**
 * 그룹에 사람 넣기 — POST `/api/workspaces/[workspaceId]/groups/[groupId]/members` `{ userId }` (7a조각 · F-06-03)
 *
 * 이미 있는 사람을 또 넣어도 200 이다(아무것도 바뀌지 않는다). 게스트 · 이 워크스페이스의 활성 멤버가 아닌 사람은
 * 400 `invalid_member` 다(G2). 빼기는 `members/{userId}` 의 DELETE.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { addGroupMember } from '@/lib/workspace/group'
import { userGroupFailureResponse } from '@/lib/workspace/group-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/groups/[groupId]/members'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, groupId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(groupId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = (parsed.body ?? {}) as { userId?: unknown }
  // 모양이 틀린 id 는 "그런 멤버가 없다"와 같다 — DB 까지 보내면 uuid 캐스팅이 500 을 낸다.
  if (typeof body.userId !== 'string' || !isUuid(body.userId)) {
    return Response.json({ error: 'invalid_member' }, { status: 400 })
  }

  const added = await addGroupMember(session.ctx, groupId, body.userId)
  if (!added.ok) return userGroupFailureResponse(added)
  return Response.json({ ok: true })
}
