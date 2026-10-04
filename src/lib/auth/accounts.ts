/**
 * 한 브라우저에 로그인한 계정들 — 세션의 상태 · 폐기 · 화면에 보일 요약 (잔여 묶음 8j-2 · F-14-09)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 다중 계정 ① · ⑤ · ⑥
 *
 * 무엇을 남기고 폐기하는가는 `account-set.ts`(순수)가 정한다. 여기는 그 판단에 필요한 사실(살아 있는가 · 둘째 단계 전인가 · 누구인가)을
 * DB 에서 읽고, 정한 것을 폐기한다. 쿠키는 여기 없다(`session-cookie.ts`).
 *
 *   · 살아 있다 = 폐기되지 않았고 만료되지 않았고 계정이 active — 게이트(`getCurrentUser`)의 조건과 같다
 *   · 둘째 단계 전 = 확정된 수단이 있는 사람의 `mfa_satisfied` 가 아닌 세션 — 게이트의 조건과 같다
 *   · **화면에는 토큰을 주지 않는다** — 사람(id · 이름 · 이메일)과 상태만. 바꾸기 · 로그아웃은 사람의 id 로 고르고 서버가 쿠키에서 토큰을 찾는다
 */

import { query } from '../db/pool.ts'
import type { TokenInfo } from './account-set.ts'
import { hashSessionToken } from './session-context.ts'

/** 토큰들의 상태 — 순서를 지킨다 · DB 에 없는 토큰은 뺀다. */
export async function describeTokens(tokens: readonly string[]): Promise<TokenInfo[]> {
  if (tokens.length === 0) return []
  const hashes = tokens.map(hashSessionToken)
  const rows = await query<{ token_hash: string; user_id: string; live: boolean; mfa_pending: boolean; expires_at: Date }>(
    `SELECT s.token_hash,
            s.user_id,
            s.expires_at,
            (s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active') AS live,
            (NOT s.mfa_satisfied
              AND EXISTS (SELECT 1 FROM mfa_method mm WHERE mm.user_id = s.user_id AND mm.confirmed_at IS NOT NULL)) AS mfa_pending
       FROM user_session s
       JOIN "user" u ON u.id = s.user_id
      WHERE s.token_hash = ANY($1::text[])`,
    [hashes],
  )
  const byHash = new Map(rows.map((r) => [r.token_hash, r]))
  return tokens.flatMap((token, i) => {
    const row = byHash.get(hashes[i]!)
    return row === undefined ? [] : [{ token, userId: row.user_id, live: row.live, mfaPending: row.mfa_pending, expiresAt: row.expires_at }]
  })
}

/** 정한 세션들을 폐기한다 — 이미 폐기된 것은 그대로 둔다. */
export async function revokeTokens(tokens: readonly string[], reason: string): Promise<void> {
  if (tokens.length === 0) return
  await query(
    `UPDATE user_session SET revoked_at = now(), revoked_reason = $2
      WHERE token_hash = ANY($1::text[]) AND revoked_at IS NULL`,
    [tokens.map(hashSessionToken), reason],
  )
}

export type AccountState = 'signed_in' | 'mfa_required' | 'signed_out'

export type SignedInAccount = {
  readonly userId: string
  readonly name: string
  readonly email: string
  /** 들어와 있음 · 2단계 인증이 남음 · 다시 로그인해야 함(만료 · 폐기). */
  readonly state: AccountState
}

const stateOf = (info: TokenInfo): AccountState => (!info.live ? 'signed_out' : info.mfaPending ? 'mfa_required' : 'signed_in')

/** 화면에 보일 계정들 — 지금 계정과 함께 로그인한 다른 계정들(쿠키 순서). 토큰은 싣지 않는다. */
export async function signedInAccounts(
  active: TokenInfo | null,
  others: readonly TokenInfo[],
): Promise<{ readonly current: SignedInAccount | null; readonly others: SignedInAccount[] }> {
  const all = [...(active === null ? [] : [active]), ...others]
  if (all.length === 0) return { current: null, others: [] }
  const rows = await query<{ id: string; name: string; email: string | null }>(
    `SELECT u.id, u.name, ue.email
       FROM "user" u
       LEFT JOIN user_email ue ON ue.id = u.primary_email_id
      WHERE u.id = ANY($1::uuid[])`,
    [[...new Set(all.map((i) => i.userId))]],
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const view = (info: TokenInfo): SignedInAccount => ({
    userId: info.userId,
    name: byId.get(info.userId)?.name ?? '',
    email: byId.get(info.userId)?.email ?? '',
    state: stateOf(info),
  })
  return { current: active === null ? null : view(active), others: others.map(view) }
}
