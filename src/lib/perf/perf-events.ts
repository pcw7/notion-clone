/**
 * 성능 계측 — 측정값 다듬기 · 경로의 틀 · 백분위 (플랫폼 잔여 10e-1a · F-12-18 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 성능 계측
 *       12-platform-ux.md F-12-18 *"P95 를 본다"* · *"sample_rate 와 completed 를 같이 저장"* · *"계측 payload 에 페이지 제목 · 본문이 섞이면
 *       정보 유출 — 식별자만"*
 *
 * 브라우저가 보낸 것을 믿지 않는다 — 지표는 닫힌 목록 · 값은 범위 · 경로는 **다시 틀로 만든다**(알려진 정적 조각만 남기고 나머지는
 * 자리표시 — 토큰 · 사이트 이름 · 제목이 경로에 섞여 와도 남지 않는다). 브라우저(수집기)와 서버(받는 라우트)가 같은 함수를 쓴다.
 */

export const PERF_METRICS = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'editor_ready'] as const
export type PerfMetric = (typeof PERF_METRICS)[number]

export const PERF_NAVIGATIONS = ['navigate', 'reload', 'prerender', 'back-forward', 'back-forward-cache', 'restore'] as const
export type PerfNavigation = (typeof PERF_NAVIGATIONS)[number]

/** 한 번에 받는 측정값의 상한 — 브라우저가 모아 보낸다. */
export const MAX_PERF_BATCH = 20
/** 값의 상한(밀리초) — 이보다 크면 잰 것이 아니라 잘못 잰 것이다(탭이 잠들었다 깬 것 등). */
export const MAX_PERF_VALUE = 600_000

/** 경로에 남기는 정적 조각 — 화면 경로의 이름들. 나머지는 자리표시다. */
const STATIC_SEGMENTS = new Set([
  'w', 'db', 'p', 'f', 's', 'settings', 'library', 'inbox', 'teamspaces', 'templates', 'login', 'invite', 'report', 'submit', 'blocks', 'emoji',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 경로의 틀 — 쿼리 · 조각을 버리고, uuid 는 `[id]` · 정적 조각은 그대로 · 나머지는 `[x]`. 8조각까지. */
export function routeTemplate(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? ''
  const segments = path.split('/').filter((s) => s !== '').slice(0, 8)
  if (segments.length === 0) return '/'
  return `/${segments.map((seg) => (UUID.test(seg) ? '[id]' : STATIC_SEGMENTS.has(seg) ? seg : '[x]')).join('/')}`
}

export type PerfEvent = {
  readonly metric: PerfMetric
  readonly value: number
  readonly route: string
  readonly navigation: PerfNavigation | null
  readonly completed: boolean
  readonly sampleRate: number
}

/** 받은 것 하나 → 측정값. 모양이 틀리면 null(그 하나만 버린다 — 나머지는 받는다). 경로는 다시 틀로 만든다. */
export function normalizePerfEvent(raw: unknown): PerfEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as { metric?: unknown; value?: unknown; route?: unknown; navigation?: unknown; completed?: unknown; sampleRate?: unknown }
  if (typeof r.metric !== 'string' || !(PERF_METRICS as readonly string[]).includes(r.metric)) return null
  if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0 || r.value >= MAX_PERF_VALUE) return null
  if (typeof r.route !== 'string' || r.route.length > 2000) return null
  if (typeof r.sampleRate !== 'number' || !(r.sampleRate > 0 && r.sampleRate <= 1)) return null
  const navigation = typeof r.navigation === 'string' && (PERF_NAVIGATIONS as readonly string[]).includes(r.navigation) ? (r.navigation as PerfNavigation) : null
  return {
    metric: r.metric as PerfMetric,
    value: r.value,
    route: routeTemplate(r.route),
    navigation,
    completed: r.completed !== false,
    sampleRate: r.sampleRate,
  }
}

/** 받은 묶음 → 측정값들. 배열이 아니면 없다 · 상한까지만 · 모양이 틀린 것은 빠진다. */
export function normalizePerfBatch(raw: unknown): PerfEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_PERF_BATCH).map(normalizePerfEvent).filter((e): e is PerfEvent => e !== null)
}

/** 백분위(가장 가까운 순위) — 비면 null. `p` 는 0~100. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length)
  return sorted[Math.max(rank, 1) - 1]!
}
