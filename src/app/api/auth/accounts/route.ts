/**
 * GET /api/auth/accounts — 이 브라우저에 로그인한 계정들 (잔여 묶음 8j-2 · F-14-09)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 다중 계정 ⑤
 *
 * 지금 계정과 함께 로그인한 다른 계정들 — 사람(id · 이름 · 이메일)과 상태(`signed_in` · `mfa_required` · `signed_out`)만. **토큰은 주지
 * 않는다.** 아무도 로그인하지 않았으면 `{ current: null, others: [] }`. 스위처(8j-3)는 같은 함수(`signedInAccounts`)를 레이아웃에서 부른다.
 */

import { readAccounts } from '@/lib/auth/accounts-cookie'
import { signedInAccounts } from '@/lib/auth/accounts'

export async function GET(): Promise<Response> {
  const accounts = await readAccounts()
  return Response.json(await signedInAccounts(accounts.active, accounts.others))
}
