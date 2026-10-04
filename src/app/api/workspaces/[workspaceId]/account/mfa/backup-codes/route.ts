/**
 * 백업 코드 새로 받기 — POST `/api/workspaces/[workspaceId]/account/mfa/backup-codes` (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ⑥
 *
 * 본문 `{ code }`(지금 코드 또는 백업 코드) → `{ backupCodes }` — 옛 묶음은 지운다. 새 코드는 **이 응답에서 한 번만** 보인다.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { regenerateBackupCodes } from '@/lib/auth/mfa'
import { field, mfaFailure } from '../http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/mfa/backup-codes'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const regenerated = await regenerateBackupCodes(session.ctx, field(parsed.body, 'code'))
  if (!regenerated.ok) return mfaFailure(regenerated.reason)
  return Response.json({ ok: true, backupCodes: regenerated.value.backupCodes })
}
