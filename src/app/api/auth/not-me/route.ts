/**
 * POST /api/auth/not-me — 새 기기 알림의 "내가 아니에요" (AC-3 · F-14-08)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강 AC-0] ⑭ [AC-3] · 14-auth-accounts.md F-14-08 *"본인이 아니면 This was not me"*
 *
 * 세션이 없어도 된다 — 메일을 연 기기가 로그인해 있지 않을 수 있다. 증명은 서명 링크의 토큰이다(`device-identity.ts` · 7일 · 한 번).
 * 그 사람의 **모든** 세션을 폐기한다(`user_reported` · API 토큰은 그대로). GET 이 아니다 — 메일의 링크 미리보기가 누르지 않게 화면
 * (`/account/not-me`)의 단추가 이리로 보낸다.
 *
 *   폼 { t }         → 303 `/account/not-me?t=…&done=1`(화면이 그 토큰이 쓰였는지 다시 보고 그린다) · 실패도 그 화면으로
 *   JSON { token }   → 200 { ok, revokedSessions, hasPassword } · invalid · expired 400 · already_used 409
 */

import { reportNewDevice } from '@/lib/auth/devices'

async function tokenOf(request: Request): Promise<{ token: unknown; form: boolean }> {
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) return { token: ((await request.json()) as { token?: unknown } | null)?.token, form: false }
    if (type.includes('form')) return { token: (await request.formData()).get('t'), form: true }
  } catch {
    // 몸을 읽지 못했다 — 틀린 토큰과 같다
  }
  return { token: null, form: type.includes('form') }
}

export async function POST(request: Request): Promise<Response> {
  const { token, form } = await tokenOf(request)
  const result = await reportNewDevice(token)

  if (form) {
    // 303: POST 의 결과를 GET 으로 가져오라는 뜻. 화면은 토큰을 다시 보고(쓰였는가) 그린다 — 주소의 `done` 만으로 "로그아웃했다"고 말하지 않는다.
    const back = new URL('/account/not-me', request.url)
    if (typeof token === 'string') back.searchParams.set('t', token)
    if (result.ok) back.searchParams.set('done', '1')
    return Response.redirect(back, 303)
  }
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.reason === 'already_used' ? 409 : 400 })
  return Response.json({ ok: true, revokedSessions: result.value.revokedSessions, hasPassword: result.value.hasPassword })
}
