/**
 * 주소 더하기 2 — POST `/api/workspaces/[workspaceId]/account/emails/verify` (AC-1 · F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ③ ⑧
 *
 *   POST { email, code } → { ok: true, email: { id, email, isPrimary } }   그 주소가 이 계정의 별칭이 됐다 · 대표 주소로 알렸다
 *
 * 이 계정이 낸 대기만 맞힌다. 틀리면 invalid(400) · 다섯 번 틀리면 too_many_attempts(429) · 그새 다른 계정이 가졌으면 unavailable(409).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { verifyEmail } from '@/lib/auth/account-email'
import { requestMeta } from '@/lib/auth/request-meta'
import { emailFailure, fieldsOf } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/emails/verify'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = fieldsOf(parsed.body)

  const result = await verifyEmail(session.ctx, { email: body.email, code: body.code }, requestMeta(request))
  if (!result.ok) return emailFailure(result.reason)
  return Response.json({ ok: true, email: result.value })
}
