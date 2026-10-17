/**
 * 성능 계측의 보고 — 운영자 명령 (플랫폼 잔여 10e-1a · F-12-18)
 *
 *   npm run perf -- [일수]      지난 N일(기본 7)의 지표 · 경로마다 p50 · p75 · p95(끝난 측정) · 끝나지 않은 비율 · 추정 수
 *
 * 정본: docs/research/00-canonical-data-model.md §3.10 끝 [보강] 성능 계측 ④ — 읽는 곳은 이 명령 하나다(HTTP 로 열지 않는다 · 서버 셸에서만).
 * 일은 `src/lib/perf/perf-store.ts` 의 `perfReport` 가 한다.
 */

import { existsSync, readFileSync } from 'node:fs'

/** .env 를 아주 단순하게 읽는다(`moderation.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
function loadEnv(file = '.env') {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

for (const [key, value] of Object.entries(loadEnv())) process.env[key] ??= value

const { perfReport } = await import('../src/lib/perf/perf-store.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const days = Number(process.argv[2] ?? 7)
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error('쓰는 법: npm run perf -- [일수 1~365]')
  process.exit(1)
}

try {
  const rows = await perfReport(days)
  if (rows.length === 0) {
    console.log(`지난 ${days}일의 측정값이 없습니다.`)
  } else {
    const ms = (v, metric) => (v === null ? '-' : metric === 'CLS' ? v.toFixed(3) : `${Math.round(v)}ms`)
    console.log(`지난 ${days}일 — 끝난 측정의 백분위 · 끝나지 않은 비율 · 추정 수(표본 비율로 되돌림)\n`)
    console.table(
      rows.map((r) => ({
        지표: r.metric,
        경로: r.route,
        표본: r.samples,
        추정: r.estimated,
        p50: ms(r.p50, r.metric),
        p75: ms(r.p75, r.metric),
        p95: ms(r.p95, r.metric),
        미완료: `${(r.incompleteRate * 100).toFixed(1)}%`,
      })),
    )
  }
} finally {
  await closePool()
}
