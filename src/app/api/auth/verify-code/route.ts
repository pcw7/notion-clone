/**
 * POST /api/auth/verify-code — 코드 검증 · 계정 생성 · 세션 발급
 *
 * 정본: F-14-02(검증), F-14-01(계정 생성), §3.2(user_session)
 *
 * `addAccount: true` 면 다른 계정 더하기다(8j-2 · F-14-09) — 앞의 활성 세션이 다른 사람의 살아 있는 세션이면 로그아웃하지 않고 목록으로
 * 옮긴다(`finishLogin` · 정본 §3.2 [보강] 다중 계정 ②).
 */

import { finishLogin, readAccounts } from '@/lib/auth/accounts-cookie'
import { establishLogin } from '@/lib/auth/establish-login'
import { verifyLoginCode } from '@/lib/auth/login-code'
import { mfaEnabledFor } from '@/lib/auth/mfa'
import { requestMeta } from '@/lib/auth/request-meta'
import { withMinimumDuration } from '@/lib/auth/timing'

function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  if (email.length < 3 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function parseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // 사용자가 붙여넣기하면 공백·하이픈이 섞인다. 숫자만 남긴다.
  const code = value.replace(/\D/g, '')
  return code.length === 6 ? code : null
}

export async function POST(request: Request): Promise<Response> {
  return withMinimumDuration(async () => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 })
    }

    const email = parseEmail((body as { email?: unknown })?.email)
    const code = parseCode((body as { code?: unknown })?.code)

    if (email === null || code === null) {
      // 형식 오류도 검증 실패와 같은 모양으로 돌려준다. 형식만 맞으면
      // 다른 응답이 온다는 사실 자체가 탐색에 쓰인다.
      return Response.json({ error: 'invalid_code' }, { status: 400 })
    }

    const meta = requestMeta(request)
    // 세션 쿠키를 쓰기 전에 읽어 둔다 — 더하기면 앞의 활성 세션이 목록으로 간다.
    const before = await readAccounts()
    const verified = await verifyLoginCode(email, code, meta)

    if (!verified.ok) {
      // 만료와 오입력은 구분해서 알려준다 — 같으면 사용자가 무한 재시도한다.
      // 계정 존재 여부는 어느 쪽으로도 드러나지 않는다.
      const status = verified.reason === 'too_many_attempts' ? 429 : 400
      return Response.json({ error: verified.reason }, { status })
    }

    const login = await establishLogin({
      email: verified.email,
      existingUserId: verified.userId,
      authMethod: 'login_code',
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    await finishLogin(before, login.session, login.userId, (body as { addAccount?: unknown })?.addAccount === true)

    return Response.json({
      ok: true,
      // 신규 가입이면 온보딩으로 보낸다.
      created: login.created,
      // 2단계 인증을 켠 사람이면 이 세션은 둘째 단계를 거쳐야 들어온다(8i-2a) — 화면이 그 단계로 간다.
      mfaRequired: await mfaEnabledFor(login.userId),
    })
  })
}
