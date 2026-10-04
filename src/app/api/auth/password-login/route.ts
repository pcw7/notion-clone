/**
 * POST /api/auth/password-login — 이메일 + 비밀번호로 세션 발급 (잔여 묶음 8i-1a · F-14-03)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 비밀번호 ⑤ — 실패는 모두 같은 말 · 같은 시간(열거 방지) · 15분에 10번 틀린 이메일은 막는다.
 *
 * 들어올 사람을 찾는 것은 `findPasswordLogin` 이고, 세션은 로그인 코드와 같은 길(`establishLogin` — 세션 · `login_succeeded` 이벤트를 한
 * 트랜잭션에)로 만든다. 계정을 만들지 않는다 — 비밀번호는 이미 있는 계정에만 있다.
 *
 *   invalid_credentials  401  없는 이메일 · 비밀번호 없는 계정 · 틀린 비밀번호 — 구분하지 않는다
 *   too_many_attempts    429  로그인 코드로는 들어올 수 있다
 *
 * `addAccount: true` 면 다른 계정 더하기다(8j-2 — 로그인 코드와 같다 · `finishLogin`).
 */

import { finishLogin, readAccounts } from '@/lib/auth/accounts-cookie'
import { establishLogin } from '@/lib/auth/establish-login'
import { mfaEnabledFor } from '@/lib/auth/mfa'
import { findPasswordLogin } from '@/lib/auth/password'
import { requestMeta } from '@/lib/auth/request-meta'
import { withMinimumDuration } from '@/lib/auth/timing'

export async function POST(request: Request): Promise<Response> {
  return withMinimumDuration(async () => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_credentials' }, { status: 401 })
    }
    const { email, password, addAccount } = (typeof body === 'object' && body !== null ? body : {}) as {
      email?: unknown
      password?: unknown
      addAccount?: unknown
    }

    const meta = requestMeta(request)
    // 세션 쿠키를 쓰기 전에 읽어 둔다 — 더하기면 앞의 활성 세션이 목록으로 간다.
    const before = await readAccounts()
    const found = await findPasswordLogin({ email, password, ip: meta.ip, userAgent: meta.userAgent })
    if (!found.ok) {
      return Response.json({ error: found.reason }, { status: found.reason === 'too_many_attempts' ? 429 : 401 })
    }

    const login = await establishLogin({
      email: found.value.email,
      existingUserId: found.value.userId,
      authMethod: 'password',
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    await finishLogin(before, login.session, login.userId, addAccount === true)
    // 2단계 인증을 켠 사람이면 이 세션은 둘째 단계를 거쳐야 들어온다(8i-2a) — 화면이 그 단계로 간다.
    return Response.json({ ok: true, mfaRequired: await mfaEnabledFor(login.userId) })
  })
}
