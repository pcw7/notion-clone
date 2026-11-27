/**
 * 주소 빼기 — DELETE `/api/workspaces/[workspaceId]/account/emails/[emailId]` (AC-1 · F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑥ ⑦ ⑨
 *
 *   DELETE { currentPassword? } → { ok: true, revokedSessions }   뺐다 · 이 세션을 뺀 세션을 폐기했다 · 대표 주소로 알렸다
 *
 * 대표는 못 뺀다(primary_locked 409 — 먼저 다른 주소를 대표로). 10분 안에 로그인한 세션이 아니면 지금 비밀번호(reauth_required 403).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { removeEmail } from '@/lib/auth/account-email'
import { emailFailure, fieldsOf } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/emails/[emailId]'>

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, emailId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const result = await removeEmail(session.ctx, { emailId, currentPassword: fieldsOf(parsed.body).currentPassword })
  if (!result.ok) return emailFailure(result.reason)
  return Response.json({ ok: true, revokedSessions: result.value.revokedSessions })
}
