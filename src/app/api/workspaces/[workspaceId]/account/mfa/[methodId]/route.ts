/**
 * 2단계 인증 수단 하나 — DELETE `/api/workspaces/[workspaceId]/account/mfa/[methodId]` (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ⑥
 *
 * 본문 `{ code }`(어느 수단의 지금 코드 또는 백업 코드) → `{ disabled }` — 마지막 수단이면 백업 코드도 지우고 2단계 인증이 꺼진다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { removeMfaMethod } from '@/lib/auth/mfa'
import { field, mfaFailure } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/mfa/[methodId]'>

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, methodId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(methodId)) return mfaFailure('not_found')
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const removed = await removeMfaMethod(session.ctx, methodId, field(parsed.body, 'code'))
  if (!removed.ok) return mfaFailure(removed.reason)
  return Response.json({ ok: true, disabled: removed.value.disabled })
}
