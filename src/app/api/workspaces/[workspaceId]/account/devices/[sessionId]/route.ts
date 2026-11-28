/**
 * 기기 하나 로그아웃 — DELETE `/api/workspaces/[workspaceId]/account/devices/[sessionId]` (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3]
 *
 *   DELETE → { ok: true }   그 세션을 폐기했다 — 그 기기의 다음 요청은 401 · 열린 협업 연결은 닫힌다(0016 의 신호)
 *
 * 계정의 것이지만 이 워크스페이스의 세션으로 쓴다(비밀번호 · 이메일과 같은 길 — `SessionContext` 가 그 사람이라는 증명이다). 자기 세션만
 * (남의 세션 id 는 not_found) · 이 세션은 current_session(로그아웃 단추로).
 */

import { requireWorkspaceSession } from '@/lib/auth/route-session'
import { signOutDevice } from '@/lib/auth/devices'
import { deviceFailure } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/devices/[sessionId]'>

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, sessionId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response

  const result = await signOutDevice(session.ctx, { sessionId })
  if (!result.ok) return deviceFailure(result.reason)
  return Response.json({ ok: true })
}
