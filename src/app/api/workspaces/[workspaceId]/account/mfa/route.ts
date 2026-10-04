/**
 * 2단계 인증 등록 시작 — POST `/api/workspaces/[workspaceId]/account/mfa` (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ① · ③
 *
 * 본문 `{ label? }` → 201 `{ methodId, secret, uri }` — 비밀값(base32)과 QR 주소는 **이 응답에서 한 번만** 보인다. 확정은
 * `POST …/mfa/{methodId}/confirm`. 비밀번호가 없으면 409 `password_required` · TOTP 가 둘이면 409 `too_many_methods`.
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { startTotpEnrollment } from '@/lib/auth/mfa'
import { field, mfaFailure } from './http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/mfa'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  const started = await startTotpEnrollment(session.ctx, { label: field(parsed.body, 'label') })
  if (!started.ok) return mfaFailure(started.reason)
  return Response.json({ ok: true, ...started.value }, { status: 201 })
}
