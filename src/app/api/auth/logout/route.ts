/**
 * POST /api/auth/logout — 세션 폐기
 *
 * 세션 행을 지우지 않고 `revoked_at` 을 채운다. "언제 누가 로그아웃했는가"가
 * 감사에 필요하고, 기기 목록(F-14-08)에서도 이력이 보여야 한다.
 *
 * GET 이 아니라 POST 인 이유: GET 이면 <img src="/api/auth/logout"> 하나로
 * 남을 로그아웃시킬 수 있다.
 */

import { clearSessionCookie, readSessionToken } from '@/lib/auth/session-cookie'
import { revokeSession } from '@/lib/auth/session'

export async function POST(request: Request): Promise<Response> {
  const token = await readSessionToken()

  if (token) {
    await revokeSession(token, 'user_logout')
  }

  // 토큰이 없어도 쿠키는 지운다. 이미 폐기된 세션의 쿠키가 남아 있을 수 있다.
  await clearSessionCookie()

  // 일반 HTML form 에서 왔으면 JSON 을 보여줄 게 아니라 로그인 화면으로 보낸다.
  // fetch 로 왔으면 JSON 을 원한다.
  const wantsJson = request.headers.get('accept')?.includes('application/json')
  if (wantsJson) {
    return Response.json({ ok: true })
  }

  // 303: POST 의 결과를 GET 으로 가져오라는 뜻. 307/308 이면 브라우저가
  // /login 에도 POST 를 보낸다.
  return Response.redirect(new URL('/login', request.url), 303)
}
