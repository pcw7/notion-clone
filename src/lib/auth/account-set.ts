/**
 * 한 브라우저에 로그인한 계정들 — 쿠키의 모양과 바꾸는 규칙 (잔여 묶음 8j-2 · F-14-09, DB · 쿠키 없음)
 *
 * 정본: 00-canonical-data-model.md §3.2 [보강] 다중 계정 ① ~ ⑥
 *
 * 쿠키는 둘이다 — 지금 계정의 세션(`nc_session` · 모든 게이트가 읽는 그대로)과 **함께 로그인한 다른 계정의 세션들**(`nc_accounts` ·
 * 토큰 원문을 `.` 으로 이은 것 · httpOnly). 서버 스키마는 그대로다 — 계정마다 세션 행이 하나씩 있을 뿐이다(14 F-14-09 *"서버 스키마 변경은
 * 거의 없다 — 이 기능은 클라이언트 상태 모델이 본체다"*).
 *
 * 여기는 **무엇을 남기고 무엇을 폐기하는가**만 정한다. 세션이 살아 있는가는 DB 가 알려 준다(`accounts.ts` 의 `describeTokens`).
 *
 *   · 더하기(`planLogin` · keepPrevious) — 앞의 활성 세션이 **다른 사람의 살아 있는** 세션이면 목록으로. 같은 사람이면 새 세션이 대신한다
 *   · 같은 사람은 목록에 한 번 — 새로 들어온 사람의 옛 토큰 · 겹친 토큰은 폐기한다
 *   · 계정은 모두 다섯까지 — 넘치면 오래된 쪽(목록의 뒤)을 폐기한다
 *   · 바꾸기(`planSwitch`) — 목록의 **살아 있는** 세션과 맞바꾼다. 둘째 단계 전의 세션이어도 바꾼다(게이트가 둘째 단계로 보낸다)
 *   · 로그아웃(`planLogout`) — 지금 계정만(남은 것 중 살아 있는 첫째가 활성) · 목록의 한 계정만 · 모두
 *   · 죽은 세션(만료 · 폐기)은 목록에 남는다 — 화면이 "다시 로그인"을 말한다(14 *"A만 재로그인 필요 표시. 앱 전체를 로그아웃시키면 안 된다"*)
 */

export const MAX_SIGNED_IN_ACCOUNTS = 5

/** 세션 토큰의 모양 — 32바이트 base64url(`session.ts` 의 `createSession`). 그 밖의 것은 쿠키에 있어도 버린다. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export type TokenInfo = {
  readonly token: string
  readonly userId: string
  /** 폐기되지 않았고 만료되지 않았고 계정이 살아 있다 — 게이트의 조건과 같다. */
  readonly live: boolean
  /** 2단계 인증을 켠 사람의, 아직 둘째 단계를 거치지 않은 세션. */
  readonly mfaPending: boolean
  /** 세션이 끝나는 때 — 활성 쿠키를 다시 쓸 때 그 만료를 따른다. */
  readonly expiresAt: Date
}

export type AccountsPlan = {
  /** 새 활성 세션 — null 이면 아무도 로그인하지 않은 브라우저가 된다. */
  readonly active: string | null
  /** 함께 로그인한 다른 계정의 세션들(쿠키 순서 — 앞이 최근). */
  readonly others: readonly string[]
  /** 폐기할 세션들. */
  readonly revoke: readonly string[]
}

export function parseAccountTokens(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw === '') return []
  const seen = new Set<string>()
  for (const token of raw.split('.')) if (TOKEN.test(token)) seen.add(token)
  return [...seen].slice(0, MAX_SIGNED_IN_ACCOUNTS - 1)
}

export const serializeAccountTokens = (tokens: readonly string[]): string => tokens.join('.')

/**
 * 다른 계정 더하기 · 다시 로그인의 주소(8j-3) — 로그인 화면의 더하기 모드(`?add=1`). 이메일(채워 둘 것) · 돌아올 곳(`next`)을 함께 싣는다 —
 * 스위처와 초대 화면이 같이 쓴다.
 */
export function addAccountHref(options: { readonly email?: string; readonly next?: string } = {}): string {
  const params = new URLSearchParams({ add: '1' })
  if (options.email) params.set('email', options.email)
  if (options.next) params.set('next', options.next)
  return `/login?${params.toString()}`
}

/** 같은 사람은 한 번 — 앞의 것을 남기고 뒤의 것은 폐기 목록으로. */
function onePerPerson(list: readonly TokenInfo[], revoke: string[]): TokenInfo[] {
  const seen = new Set<string>()
  const kept: TokenInfo[] = []
  for (const info of list) {
    if (seen.has(info.userId)) {
      revoke.push(info.token)
      continue
    }
    seen.add(info.userId)
    kept.push(info)
  }
  return kept
}

/**
 * 로그인했다 — 새 세션이 활성이 된다. `keepPrevious`(계정 더하기)면 앞의 활성 세션이 다른 사람의 살아 있는 세션일 때 목록의 맨 앞으로 간다.
 * 그냥 로그인이면 앞의 활성 세션은 쿠키에서 빠질 뿐 폐기하지 않는다(이 조각 전과 같다).
 */
export function planLogin(input: {
  readonly previous: TokenInfo | null
  readonly others: readonly TokenInfo[]
  readonly fresh: { readonly token: string; readonly userId: string }
  readonly keepPrevious: boolean
}): AccountsPlan {
  const revoke: string[] = []
  const { previous, fresh } = input
  const list: TokenInfo[] = []
  if (input.keepPrevious && previous !== null && previous.token !== fresh.token) {
    if (previous.userId === fresh.userId) revoke.push(previous.token)
    else if (previous.live) list.push(previous)
  }
  for (const info of input.others) {
    if (info.token === fresh.token) continue
    if (info.userId === fresh.userId) revoke.push(info.token)
    else list.push(info)
  }
  const kept = onePerPerson(list, revoke)
  for (const info of kept.slice(MAX_SIGNED_IN_ACCOUNTS - 1)) revoke.push(info.token)
  return { active: fresh.token, others: kept.slice(0, MAX_SIGNED_IN_ACCOUNTS - 1).map((i) => i.token), revoke }
}

export type SwitchPlan =
  | { readonly ok: true; readonly plan: AccountsPlan; readonly mfaPending: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'signed_out' }

/** 목록의 그 사람으로 바꾼다 — 살아 있는 세션이 있어야 한다. 지금 계정은 목록의 맨 앞으로(죽었어도 — "다시 로그인"으로 보인다). */
export function planSwitch(input: { readonly active: TokenInfo | null; readonly others: readonly TokenInfo[]; readonly userId: string }): SwitchPlan {
  const { active, others, userId } = input
  if (active !== null && active.userId === userId) {
    return { ok: true, plan: { active: active.token, others: others.map((i) => i.token), revoke: [] }, mfaPending: active.mfaPending }
  }
  const target = others.find((i) => i.userId === userId && i.live)
  if (target === undefined) return { ok: false, reason: others.some((i) => i.userId === userId) ? 'signed_out' : 'not_found' }
  const revoke: string[] = []
  const rest = onePerPerson([...(active === null ? [] : [active]), ...others.filter((i) => i !== target)], revoke)
  return { ok: true, plan: { active: target.token, others: rest.map((i) => i.token), revoke }, mfaPending: target.mfaPending }
}

export type LogoutScope = { readonly kind: 'current' } | { readonly kind: 'all' } | { readonly kind: 'account'; readonly userId: string }

/** 로그아웃 — 지금 계정만 · 모두 · 목록의 한 계정만. 지금 계정이 나가면 남은 것 중 살아 있는 첫째가 활성이 된다. */
export function planLogout(input: { readonly active: TokenInfo | null; readonly others: readonly TokenInfo[]; readonly scope: LogoutScope }): AccountsPlan {
  const { active, others, scope } = input
  if (scope.kind === 'all') {
    return { active: null, others: [], revoke: [...(active === null ? [] : [active.token]), ...others.map((i) => i.token)] }
  }
  if (scope.kind === 'account' && (active === null || active.userId !== scope.userId)) {
    const leaving = others.filter((i) => i.userId === scope.userId)
    return { active: active?.token ?? null, others: others.filter((i) => i.userId !== scope.userId).map((i) => i.token), revoke: leaving.map((i) => i.token) }
  }
  // 지금 계정이 나간다
  const next = others.find((i) => i.live) ?? null
  return {
    active: next?.token ?? null,
    others: others.filter((i) => i !== next).map((i) => i.token),
    revoke: active === null ? [] : [active.token],
  }
}
