/**
 * AI 한도의 셈 — 하루 · 6시간 창 · 월 · 체험 · 보충 (AI-1 · F-10-12 · 순수 — 시각은 넘겨받는다)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강 AI-1] ③ ④ · CLAUDE.md 절대 제약 2
 *
 * 차례: 앱 전체 하루 → (요금제 몫: 6시간 창 · 월) → 체험 → 보충. 모자라면 거부하고 **어느 한도 · 언제 풀리는지**를 말한다.
 *
 *   · 요금제 몫(`plan`)은 월 한도가 0 이 아닐 때만 있다 — 창은 그 몫을 조이는 것이다(월이 0 인 Free · Plus 에서는 쓰이지 않는다)
 *   · 몫마다 그 몫에서 센 것만 센다(창 · 월은 `plan` · 체험은 `trial`) — 보충으로 넘어간 응답이 창의 풀림을 늦추지 않는다
 *   · 보충은 만료가 이른 것부터(만료 없음은 끝) — 남은 것이 있고 만료 전인 것만
 *   · 둘 다 막혔으면(창 · 월) **늦게 풀리는 쪽**을 말한다 — 먼저 풀리는 쪽이 풀려도 아직 쓸 수 없다
 *   · 체험은 다시 차지 않는다(`resetsAt` null — 보충이 필요하다)
 *   · 값 null 은 무제한(엔타이틀먼트의 limit 규칙)
 */

export const AI_FEATURES = ['ask', 'edit', 'translate', 'block', 'chat'] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export const isAiFeature = (v: unknown): v is AiFeature => typeof v === 'string' && (AI_FEATURES as readonly string[]).includes(v)

/** 어느 몫에서 셌는가 — `ai_usage.quota`. */
export type AiQuota = 'plan' | 'trial' | 'grant'
/** 거부의 까닭이 된 한도. */
export type AiLimitKind = 'daily' | 'window' | 'month' | 'trial'

export const AI_WINDOW_MS = 6 * 60 * 60 * 1000

export type AiLimits = {
  /** 평생 체험 — null 무제한. */
  readonly trial: number | null
  /** UTC 달력 달 — 0 이면 요금제 몫이 없다 · null 무제한. */
  readonly monthly: number | null
  /** 지난 6시간 — 요금제 몫을 조인다 · null 이면 조이지 않는다. */
  readonly window: number | null
}

export type AiCounts = {
  /** 체험에서 센 것(평생). */
  readonly trial: number
  /** 이번 UTC 달에 요금제 몫에서 센 것. */
  readonly month: number
  /** 지난 6시간에 요금제 몫에서 센 것의 시각 — 오래된 것부터. 개수가 창의 쓴 양이다. */
  readonly windowTimes: readonly Date[]
}

export type AiGrantLeft = {
  readonly id: string
  /** 남은 응답 수(줄 수 - 센 것). */
  readonly left: number
  readonly grantedAt: Date
  readonly expiresAt: Date | null
}

export type AiDecision =
  | { readonly ok: true; readonly quota: 'plan' | 'trial' }
  | { readonly ok: true; readonly quota: 'grant'; readonly grantId: string }
  | { readonly ok: false; readonly limit: AiLimitKind; readonly resetsAt: Date | null }

// ── 시각 ──────────────────────────────────────────────────────────────

/** UTC 날 — `YYYY-MM-DD`(`ai_daily_usage.day`). */
export const utcDayOf = (now: Date): string => now.toISOString().slice(0, 10)
export const nextUtcDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
export const utcMonthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
export const nextUtcMonthStart = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
/** 창의 시작 — 이 시각 **뒤**(초과)에 센 것만 창에 든다. */
export const windowStart = (now: Date): Date => new Date(now.getTime() - AI_WINDOW_MS)

/**
 * 창이 풀리는 시각 — 쓴 양이 한도 아래로 내려가는 때. 오래된 것부터 `개수 - 한도 + 1` 개가 창을 벗어나야 한다 — 그중 마지막 것이 들어온
 * 시각 + 6시간. 한도 아래면 null(막히지 않았다) · 한도 0 이면 null(풀리지 않는다).
 */
export function windowResetAt(timesAsc: readonly Date[], limit: number): Date | null {
  if (limit <= 0 || timesAsc.length < limit) return null
  const t = timesAsc[timesAsc.length - limit]
  return t === undefined ? null : new Date(t.getTime() + AI_WINDOW_MS)
}

// ── 판정 ──────────────────────────────────────────────────────────────

/** 남은 보충 중 쓸 것 — 만료 전 · 남은 것 · 만료가 이른 것부터(없음은 끝) · 같으면 먼저 준 것. */
export function pickGrant(grants: readonly AiGrantLeft[], now: Date): AiGrantLeft | null {
  const live = grants.filter((g) => g.left > 0 && (g.expiresAt === null || g.expiresAt.getTime() > now.getTime()))
  live.sort(
    (a, b) =>
      (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
      a.grantedAt.getTime() - b.grantedAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return live[0] ?? null
}

/** 요금제 몫이 있는가 — 월 한도가 0 이 아니다(null 은 무제한). */
export const hasPlanQuota = (limits: AiLimits): boolean => limits.monthly === null || limits.monthly > 0

/** 늦게 풀리는 것 — null(풀리지 않는다)이 가장 늦다. */
function later(a: { limit: AiLimitKind; resetsAt: Date | null }, b: { limit: AiLimitKind; resetsAt: Date | null }) {
  if (a.resetsAt === null) return a
  if (b.resetsAt === null) return b
  return b.resetsAt.getTime() > a.resetsAt.getTime() ? b : a
}

/**
 * 이 응답을 어느 몫에서 셀 것인가 — 모자라면 거부와 까닭.
 *
 * @param daily 앱 전체의 오늘(UTC) 쓴 양과 상한 — 상한에 닿으면 보충도 넘지 못한다(공급자의 무료 한도를 모두가 나눠 쓴다)
 */
export function decideAiQuota(
  now: Date,
  limits: AiLimits,
  counts: AiCounts,
  grants: readonly AiGrantLeft[],
  daily: { readonly used: number; readonly cap: number },
): AiDecision {
  if (daily.used >= daily.cap) return { ok: false, limit: 'daily', resetsAt: nextUtcDay(now) }

  let blocked: { limit: AiLimitKind; resetsAt: Date | null } | null = null
  if (hasPlanQuota(limits)) {
    const windowUsed = counts.windowTimes.length
    const windowFull = limits.window !== null && windowUsed >= limits.window
    const monthFull = limits.monthly !== null && counts.month >= limits.monthly
    if (!windowFull && !monthFull) return { ok: true, quota: 'plan' }
    const byWindow = windowFull ? { limit: 'window' as const, resetsAt: windowResetAt(counts.windowTimes, limits.window ?? 0) } : null
    const byMonth = monthFull ? { limit: 'month' as const, resetsAt: nextUtcMonthStart(now) } : null
    blocked = byWindow !== null && byMonth !== null ? later(byWindow, byMonth) : (byWindow ?? byMonth)
  }

  if (limits.trial === null || counts.trial < limits.trial) return { ok: true, quota: 'trial' }

  const grant = pickGrant(grants, now)
  if (grant !== null) return { ok: true, quota: 'grant', grantId: grant.id }

  const why = blocked ?? { limit: 'trial' as const, resetsAt: null }
  return { ok: false, limit: why.limit, resetsAt: why.resetsAt }
}

// ── 화면 · 응답의 끝 사건이 보이는 모양 ────────────────────────────────

export type AiQuotaView = {
  /** 이 요금제의 몫 — 요금제(월 · 창) · 체험 · 없음. */
  readonly kind: 'plan' | 'trial' | 'none'
  readonly window: { readonly used: number; readonly limit: number | null; readonly resetsAt: string | null } | null
  readonly month: { readonly used: number; readonly limit: number | null; readonly resetsAt: string } | null
  readonly trial: { readonly used: number; readonly limit: number | null } | null
  /** 만료 전 보충의 남은 수 합. */
  readonly grantsLeft: number
  /** 남은 보충 중 가장 이른 만료(없으면 null). */
  readonly grantsExpireAt: string | null
  /** 지금 몇 번 더 쓸 수 있는가(앱 전체 하루 상한은 빼고) — null 무제한. */
  readonly remaining: number | null
}

const leftOf = (limit: number | null, used: number): number | null => (limit === null ? null : Math.max(0, limit - used))
const sumLeft = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a + b)

/** 지금의 쓴 양 · 남은 양 — 설정 화면과 응답의 끝 사건(`remaining`)이 함께 쓴다. */
export function aiQuotaView(now: Date, limits: AiLimits, counts: AiCounts, grants: readonly AiGrantLeft[]): AiQuotaView {
  const live = grants.filter((g) => g.left > 0 && (g.expiresAt === null || g.expiresAt.getTime() > now.getTime()))
  const grantsLeft = live.reduce((sum, g) => sum + g.left, 0)
  const expiries = live.flatMap((g) => (g.expiresAt === null ? [] : [g.expiresAt.getTime()]))
  const grantsExpireAt = expiries.length === 0 ? null : new Date(Math.min(...expiries)).toISOString()

  const plan = hasPlanQuota(limits)
  const trialOffered = limits.trial === null || limits.trial > 0 || counts.trial > 0
  const windowUsed = counts.windowTimes.length
  const window = plan
    ? {
        used: windowUsed,
        limit: limits.window,
        resetsAt: limits.window === null ? null : (windowResetAt(counts.windowTimes, limits.window)?.toISOString() ?? null),
      }
    : null
  const month = plan ? { used: counts.month, limit: limits.monthly, resetsAt: nextUtcMonthStart(now).toISOString() } : null
  const trial = trialOffered ? { used: counts.trial, limit: limits.trial } : null

  const planLeft = plan
    ? (() => {
        const w = leftOf(limits.window, windowUsed)
        const m = leftOf(limits.monthly, counts.month)
        return w === null ? m : m === null ? w : Math.min(w, m)
      })()
    : 0
  const trialLeft = leftOf(limits.trial, counts.trial)
  const remaining = sumLeft(sumLeft(planLeft, trialLeft), grantsLeft)
  return { kind: plan ? 'plan' : trialOffered ? 'trial' : 'none', window, month, trial, grantsLeft, grantsExpireAt, remaining }
}
