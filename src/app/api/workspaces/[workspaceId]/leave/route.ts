/**
 * POST /api/workspaces/[workspaceId]/leave — 이 워크스페이스에서 스스로 나간다 (멤버 관리 10o-3 · F-14-10)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 ⑨ — 내보내기와 같은 규칙(마지막 owner · teamspace 의 마지막
 * owner 는 나가지 못한다 · M1). 활성 · 게스트 아닌 사람만. 거부 코드는 멤버 관리와 같다(`member-http.ts`).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { leaveWorkspace } from '@/lib/workspace/member'
import { memberManageResponse } from '@/lib/workspace/member-http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/leave'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const left = await leaveWorkspace(session.ctx)
  if (!left.ok) return memberManageResponse(left)
  return Response.json({ ok: true, role: left.value.role })
}
