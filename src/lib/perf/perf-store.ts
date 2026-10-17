/**
 * 성능 계측 — 쌓기 · 보고 (플랫폼 잔여 10e-1a · F-12-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 성능 계측
 *
 * 쌓는 것은 받는 라우트(`POST /api/perf` — 로그인한 세션 · 속도 제한)가, 읽는 것은 운영자의 보고 명령(`npm run perf`)이 한다. 둘 다 다듬은
 * 측정값만 다룬다(`perf-events.ts` — 사람 · 워크스페이스 · 페이지를 가리키는 것이 없다).
 *
 * 보고는 **끝난 측정의 백분위**(p50 · p75 · p95 — 12 *"P95 를 본다"*)와 **끝나지 않은 비율**(생존자 편향을 함께 본다)과 **추정 수**(표본
 * 비율로 되돌린 수 — `sum(1 / sample_rate)`)다.
 */

import { query, queryMaybe } from '../db/pool.ts'
import { hashSessionToken } from '../auth/session-context.ts'
import type { PerfEvent } from './perf-events.ts'

/** 받는 쪽의 문 — 살아 있는 세션이면 그 사람의 id(속도 제한의 열쇠), 아니면 null. 워크스페이스는 묻지 않는다. */
export async function sessionUserOf(token: string | null | undefined): Promise<string | null> {
  if (!token) return null
  const row = await queryMaybe<{ user_id: string }>(
    `SELECT user_id FROM user_session WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashSessionToken(token)],
  )
  return row?.user_id ?? null
}

/** 측정값들을 쌓는다 — 한 번의 INSERT. 쌓은 수. */
export async function recordPerfEvents(events: readonly PerfEvent[]): Promise<number> {
  if (events.length === 0) return 0
  const rows = await query<{ id: string }>(
    `INSERT INTO perf_event (metric_key, value, route, navigation, completed, sample_rate)
     SELECT * FROM unnest($1::text[], $2::float8[], $3::text[], $4::text[], $5::boolean[], $6::real[])
     RETURNING id`,
    [
      events.map((e) => e.metric),
      events.map((e) => e.value),
      events.map((e) => e.route),
      events.map((e) => e.navigation),
      events.map((e) => e.completed),
      events.map((e) => e.sampleRate),
    ],
  )
  return rows.length
}

export type PerfReportRow = {
  readonly metric: string
  readonly route: string
  /** 받은 줄 수(표본). */
  readonly samples: number
  /** 표본 비율로 되돌린 수. */
  readonly estimated: number
  /** 끝난 측정의 백분위 — 끝난 것이 없으면 null. */
  readonly p50: number | null
  readonly p75: number | null
  readonly p95: number | null
  /** 끝나지 않은 측정의 비율(0~1). */
  readonly incompleteRate: number
}

/** 지난 `days` 일의 보고 — 지표 · 경로마다. */
export async function perfReport(days: number): Promise<PerfReportRow[]> {
  const rows = await query<{
    metric_key: string
    route: string
    samples: number
    estimated: number
    p50: number | null
    p75: number | null
    p95: number | null
    incomplete_rate: number
  }>(
    `SELECT metric_key, route,
            count(*)::int AS samples,
            round(sum(1.0 / sample_rate))::int AS estimated,
            percentile_disc(0.50) WITHIN GROUP (ORDER BY value) FILTER (WHERE completed) AS p50,
            percentile_disc(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE completed) AS p75,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY value) FILTER (WHERE completed) AS p95,
            avg(CASE WHEN completed THEN 0 ELSE 1 END)::float8 AS incomplete_rate
       FROM perf_event
      WHERE recorded_at > now() - make_interval(days => $1)
      GROUP BY metric_key, route
      ORDER BY metric_key, route`,
    [Math.max(1, Math.floor(days))],
  )
  return rows.map((r) => ({
    metric: r.metric_key,
    route: r.route,
    samples: r.samples,
    estimated: r.estimated,
    p50: r.p50,
    p75: r.p75,
    p95: r.p95,
    incompleteRate: r.incomplete_rate,
  }))
}
