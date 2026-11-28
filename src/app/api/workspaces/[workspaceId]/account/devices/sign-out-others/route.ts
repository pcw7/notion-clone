/**
 * 다른 모든 기기에서 로그아웃 — POST `/api/workspaces/[workspaceId]/account/devices/sign-out-others` (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · ⑫ "API 토큰을 끊지 않는다"
 *
 *   POST → { ok: true, revokedSessions }   이 세션을 뺀 이 사람의 살아 있는 세션을 모두 폐기했다(0 이어도 성공)
 *
 * 재인증을 묻지 않는다(끊기는 새 접근을 주지 않는다 — 정본 [AC-3]). 위임 · API 토큰 컨텍스트는 session_required.
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { signOutOtherDevices } from '@/lib/auth/devices'
import { deviceFailure } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/devices/sign-out-others'>

export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const result = await signOutOtherDevices(session.ctx)
  if (!result.ok) return deviceFailure(result.reason)
  return Response.json({ ok: true, revokedSessions: result.value.revokedSessions })
}
