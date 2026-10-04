/**
 * 2단계 인증 등록 확정 — POST `/api/workspaces/[workspaceId]/account/mfa/[methodId]/confirm` (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ③
 *
 * 본문 `{ code }`(그 앱의 지금 6자리) → `{ backupCodes }` — 처음으로 켜는 것이면 백업 코드 6개(**이 응답에서 한 번만**), 아니면 null.
 * 이 세션은 둘째 단계를 통과한 것이 된다.
 */

import { isUuid } from '@/lib/ids'
import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { confirmTotpEnrollment } from '@/lib/auth/mfa'
import { field, mfaFailure } from '../../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/mfa/[methodId]/confirm'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId, methodId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  if (!isUuid(methodId)) return mfaFailure('not_found')
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const confirmed = await confirmTotpEnrollment(session.ctx, methodId, field(parsed.body, 'code'))
  if (!confirmed.ok) return mfaFailure(confirmed.reason)
  return Response.json({ ok: true, backupCodes: confirmed.value.backupCodes })
}
