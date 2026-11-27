/**
 * 대표 주소 바꾸기 — POST `/api/workspaces/[workspaceId]/account/emails/[emailId]/primary` (AC-1 · F-14-07 · F-14-15)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑥ ⑦ ⑧
 *
 *   POST { currentPassword? } → { ok: true, email: { id, email, isPrimary: true } }   대표가 바뀌었다 · **옛 대표 주소로** 알렸다
 *
 * 자기 주소만(not_found 404) · 이미 대표면 already_primary(409) · 10분 안에 로그인한 세션이 아니면 지금 비밀번호(reauth_required 403).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { makePrimaryEmail } from '@/lib/auth/account-email'
import { emailFailure, fieldsOf } from '../../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/emails/[emailId]/primary'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, emailId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const result = await makePrimaryEmail(session.ctx, { emailId, currentPassword: fieldsOf(parsed.body).currentPassword })
  if (!result.ok) return emailFailure(result.reason)
  return Response.json({ ok: true, email: result.value })
}
