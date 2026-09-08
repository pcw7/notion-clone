/**
 * POST /api/auth/request-code — 로그인 코드 발급 (F-14-02)
 *
 * 응답은 **계정 존재 여부와 무관하게 동일**하다. 본문도, 상태 코드도,
 * 응답 시간도(withMinimumDuration).
 */

import { requestLoginCode } from '@/lib/auth/login-code'
import { requestMeta } from '@/lib/auth/request-meta'
import { withMinimumDuration } from '@/lib/auth/timing'

/** 이메일 형식만 본다. 존재 여부는 응답에 드러내지 않으므로 여기서 확인하지 않는다. */
function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  if (email.length < 3 || email.length > 254) return null
  // 지나치게 엄격한 정규식은 정상 주소를 막는다. 최소한만 본다.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
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
    if (email === null) {
      return Response.json({ error: 'invalid_email' }, { status: 400 })
    }

    const meta = requestMeta(request)
    const result = await requestLoginCode(email, meta)

    if (result.rateLimited) {
      return Response.json(
        { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      )
    }

    // 개발 환경에서만 코드를 내려준다. 메일함을 열지 않고 로그인할 수 있게.
    // 운영에서는 mailer 가 devCode 를 만들지 않으므로 이 필드는 없다.
    const devCode = process.env.NODE_ENV === 'production' ? undefined : result.devCode

    return Response.json({ ok: true, ...(devCode ? { devCode } : {}) })
  })
}
