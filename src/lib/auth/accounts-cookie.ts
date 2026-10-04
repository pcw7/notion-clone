/**
 * 한 브라우저에 로그인한 계정들 — 쿠키를 읽고 정한 것을 적용한다 (잔여 묶음 8j-2 · F-14-09) — **Next.js 런타임 전용**
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 다중 계정
 *
 * 읽기(`readAccounts` — 두 쿠키의 토큰 → DB 의 상태) → 정하기(`account-set.ts` 의 plan*) → 적용(`applyAccountsPlan` — 폐기 · 두 쿠키)의 세 걸음.
 * 로그인 라우트는 세션 쿠키를 쓰기 **전에** 읽어 두어야 한다(`finishLogin` 의 `before`) — 쓴 뒤에 읽으면 앞의 활성 세션을 잃는다.
 */

import { planLogin, type AccountsPlan, type TokenInfo } from './account-set.ts'
import { describeTokens, revokeTokens } from './accounts.ts'
import type { IssuedSession } from './session.ts'
import { clearSessionCookie, readAccountTokens, readSessionToken, setAccountTokens, setSessionCookie } from './session-cookie.ts'

export type BrowserAccounts = {
  /** 지금 계정의 세션 — 쿠키에 없거나 DB 에 없으면 null. */
  readonly active: TokenInfo | null
  /** 함께 로그인한 다른 계정의 세션들(쿠키 순서). DB 에 없는 토큰은 빠진다. */
  readonly others: readonly TokenInfo[]
}

export async function readAccounts(): Promise<BrowserAccounts> {
  const activeToken = await readSessionToken()
  const otherTokens = (await readAccountTokens()).filter((t) => t !== activeToken)
  const infos = await describeTokens([...(activeToken === null ? [] : [activeToken]), ...otherTokens])
  return {
    active: infos.find((i) => i.token === activeToken) ?? null,
    others: infos.filter((i) => i.token !== activeToken),
  }
}

/** 정한 것을 적용한다 — 폐기하고, 활성 쿠키(새 활성의 만료로)와 목록 쿠키를 쓴다. 활성이 없으면 활성 쿠키를 지운다. */
export async function applyAccountsPlan(plan: AccountsPlan, known: BrowserAccounts, reason: string): Promise<void> {
  await revokeTokens(plan.revoke, reason)
  if (plan.active === null) {
    await clearSessionCookie()
  } else if (plan.active !== known.active?.token) {
    const next = known.others.find((i) => i.token === plan.active)
    if (next !== undefined) await setSessionCookie({ sessionId: '', token: next.token, expiresAt: next.expiresAt })
  }
  await setAccountTokens(plan.others)
}

/**
 * 로그인 라우트의 끝 — 새 세션을 활성 쿠키에 쓰고 목록을 정리한다. `keepPrevious`(계정 더하기)면 앞의 활성 세션이 다른 사람의 살아 있는
 * 세션일 때 목록으로 간다. `before` 는 세션 쿠키를 쓰기 전에 읽은 것.
 */
export async function finishLogin(before: BrowserAccounts, session: IssuedSession, userId: string, keepPrevious: boolean): Promise<void> {
  const plan = planLogin({ previous: before.active, others: before.others, fresh: { token: session.token, userId }, keepPrevious })
  await revokeTokens(plan.revoke, 'superseded')
  await setSessionCookie(session)
  await setAccountTokens(plan.others)
}
