/**
 * POST /api/auth/logout — 세션 폐기
 *
 * 세션 행을 지우지 않고 `revoked_at` 을 채운다. "언제 누가 로그아웃했는가"가
 * 감사에 필요하고, 기기 목록(F-14-08)에서도 이력이 보여야 한다.
 *
 * GET 이 아니라 POST 인 이유: GET 이면 <img src="/api/auth/logout"> 하나로
 * 남을 로그아웃시킬 수 있다.
 *
 * **계정이 여럿이면 범위를 고른다**(8j-2 · F-14-09 · 정본 §3.2 [보강] 다중 계정 ④) — 폼 필드 또는 JSON:
 *   (없음)            지금 계정만 — 함께 로그인한 계정 중 살아 있는 첫째가 지금 계정이 된다
 *   scope=all         모든 계정
 *   userId=<id>       목록의 그 계정만(지금 계정이면 "지금 계정만"과 같다)
 * 14 F-14-09 *"다중 계정 로그인 중 한 계정 전체 로그아웃 — 다른 계정 세션에 영향 없음"*.
 */

import { planLogout, type LogoutScope } from '@/lib/auth/account-set'
import { applyAccountsPlan, readAccounts } from '@/lib/auth/accounts-cookie'

/** 폼(HTML form) · JSON(fetch) · 빈 몸 모두 받는다. 모르는 모양이면 지금 계정만. */
async function scopeOf(request: Request): Promise<LogoutScope> {
  let fields: { scope?: unknown; userId?: unknown } = {}
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) fields = ((await request.json()) ?? {}) as typeof fields
    else if (type.includes('form')) {
      const form = await request.formData()
      fields = { scope: form.get('scope'), userId: form.get('userId') }
    }
  } catch {
    // 몸을 읽지 못했다 — 지금 계정만
  }
  if (fields.scope === 'all') return { kind: 'all' }
  if (typeof fields.userId === 'string' && fields.userId !== '') return { kind: 'account', userId: fields.userId }
  return { kind: 'current' }
}

export async function POST(request: Request): Promise<Response> {
  const scope = await scopeOf(request)
  const accounts = await readAccounts()
  const plan = planLogout({ active: accounts.active, others: accounts.others, scope })
  // 활성이 없으면 쿠키도 지운다 — 이미 폐기된 세션의 쿠키가 남아 있을 수 있다(DB 에 없는 토큰은 readAccounts 가 뺐다).
  await applyAccountsPlan(plan, accounts, scope.kind === 'all' ? 'user_logout_all' : 'user_logout')

  // 일반 HTML form 에서 왔으면 JSON 을 보여줄 게 아니라 화면으로 보낸다 — 남은 계정이 있으면 처음 화면, 없으면 로그인.
  // fetch 로 왔으면 JSON 을 원한다.
  const wantsJson = request.headers.get('accept')?.includes('application/json')
  if (wantsJson) {
    return Response.json({ ok: true, signedIn: plan.active !== null })
  }

  // 303: POST 의 결과를 GET 으로 가져오라는 뜻. 307/308 이면 브라우저가
  // /login 에도 POST 를 보낸다.
  return Response.redirect(new URL(plan.active === null ? '/login' : '/', request.url), 303)
}
