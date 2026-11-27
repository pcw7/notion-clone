/**
 * 주소 더하기 1 — POST `/api/workspaces/[workspaceId]/account/emails` (AC-1 · F-14-07)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ③ ⑦ ⑩
 *
 *   POST { email, currentPassword? } → { ok: true }   그 주소로 확인 코드를 보냈다(다른 계정의 주소여도 같은 응답 · 같은 시간)
 *
 * 계정의 것이지만 이 워크스페이스의 세션으로 쓴다(비밀번호 · 2단계 인증과 같은 길 — `SessionContext` 가 그 사람이라는 증명이다).
 * 개발 transport 의 코드는 응답에 넣지 않는다 — 다른 계정의 주소면 코드가 없어 응답이 갈라진다(서버 콘솔에서 읽는다).
 */

import { readJsonBody, requireWorkspaceSession } from '@/lib/auth/route-session'
import { requestEmailVerification } from '@/lib/auth/account-email'
import { requestMeta } from '@/lib/auth/request-meta'
import { withMinimumDuration } from '@/lib/auth/timing'
import { emailFailure, fieldsOf } from './http'

type Ctx = RouteContext<'/api/workspaces/[workspaceId]/account/emails'>

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { workspaceId } = await ctx.params
  const session = await requireWorkspaceSession(workspaceId)
  if (!session.ok) return session.response
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = fieldsOf(parsed.body)

  return withMinimumDuration(async () => {
    const result = await requestEmailVerification(
      session.ctx,
      { email: body.email, currentPassword: body.currentPassword },
      requestMeta(request),
    )
    if (!result.ok) return emailFailure(result.reason)
    return Response.json({ ok: true })
  })
}
