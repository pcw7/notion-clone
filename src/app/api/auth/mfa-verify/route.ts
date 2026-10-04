/**
 * POST /api/auth/mfa-verify — 로그인의 둘째 단계 (잔여 묶음 8i-2a · F-14-05)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 2단계 인증 ④ · ⑤
 *
 * 첫 단계(로그인 코드 · 비밀번호)로 받은 세션 쿠키와 코드 하나(인증 앱의 6자리 또는 백업 코드). 맞으면 그 세션이 둘째 단계를 통과한
 * 것이 된다 — 그 전까지 그 세션은 진입 게이트에서 `mfa_required` 로 막혀 있다.
 *
 *   no_session         401  세션이 없거나 끝났다 — 처음부터 다시
 *   invalid_code       400  코드가 맞지 않는다(이미 쓴 TOTP 창 · 쓴 백업 코드 포함)
 *   too_many_attempts  429  15분에 10번 — 로그아웃 뒤 다시
 */

import { verifySecondFactor } from '@/lib/auth/mfa'
import { requestMeta } from '@/lib/auth/request-meta'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { withMinimumDuration } from '@/lib/auth/timing'

const STATUS = { no_session: 401, invalid_code: 400, too_many_attempts: 429 } as const

export async function POST(request: Request): Promise<Response> {
  return withMinimumDuration(async () => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_code' }, { status: 400 })
    }
    const code = (typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined) ?? null
    const meta = requestMeta(request)
    const result = await verifySecondFactor({ token: await readSessionToken(), code, ip: meta.ip, userAgent: meta.userAgent })
    if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
    return Response.json({ ok: true, via: result.value.via })
  })
}
