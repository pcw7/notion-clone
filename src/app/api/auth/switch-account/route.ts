/**
 * POST /api/auth/switch-account — 함께 로그인한 다른 계정으로 바꾼다 (잔여 묶음 8j-2 · F-14-09)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 다중 계정 ③
 *
 * 몸은 `{ userId }` — 화면은 토큰을 모른다. 서버가 목록 쿠키에서 그 사람의 살아 있는 세션을 찾아 지금 세션과 맞바꾼다(`planSwitch`).
 * 그 세션이 둘째 단계 전이면 바꾸되 `mfaRequired` 로 알린다 — 게이트가 둘째 단계로 보낸다(바꾼다고 건너뛰지 않는다).
 *
 *   not_found   404  이 브라우저에 그 계정이 없다
 *   signed_out  409  그 계정의 세션이 끝났다(만료 · 폐기) — 다시 로그인
 */

import { planSwitch } from '@/lib/auth/account-set'
import { applyAccountsPlan, readAccounts } from '@/lib/auth/accounts-cookie'

const STATUS = { not_found: 404, signed_out: 409 } as const

export async function POST(request: Request): Promise<Response> {
  let userId: unknown = null
  try {
    userId = ((await request.json()) as { userId?: unknown } | null)?.userId ?? null
  } catch {
    // 몸이 없다 — 아래에서 not_found
  }
  if (typeof userId !== 'string' || userId === '') return Response.json({ error: 'not_found' }, { status: 404 })

  const accounts = await readAccounts()
  const result = planSwitch({ active: accounts.active, others: accounts.others, userId })
  if (!result.ok) return Response.json({ error: result.reason }, { status: STATUS[result.reason] })
  await applyAccountsPlan(result.plan, accounts, 'superseded')
  return Response.json({ ok: true, mfaRequired: result.mfaPending })
}
