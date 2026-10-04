/**
 * 스위처의 다른 계정 — 상태 · 바꾸기 실패의 말 (잔여 묶음 8j-3 · F-14-09, DOM · DB 없음) — 더하기 주소는 `lib/auth/account-set.ts`
 *
 * 상태는 서버가 준다(`signedInAccounts` — 정본 §3.2 [보강] 다중 계정 ⑤). 여기는 말과 주소만.
 */

import type { AccountState } from '@/lib/auth/accounts'

/** 계정 머리에 붙는 말 — 들어와 있으면 없다. */
export function accountStateLabel(state: AccountState): string | null {
  switch (state) {
    case 'signed_in':
      return null
    case 'mfa_required':
      return '2단계 인증 남음'
    case 'signed_out':
      return '다시 로그인 필요'
  }
}

/** 바꾸기가 거부됐을 때 — 그 사이 세션이 끝났거나 이 브라우저에서 빠졌다. */
export function switchFailureMessage(reason: unknown): string {
  return reason === 'signed_out'
    ? '그 계정은 로그인이 끝났습니다. 다시 로그인하세요.'
    : reason === 'not_found'
      ? '그 계정은 이 브라우저에 더 이상 없습니다.'
      : '계정을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.'
}
