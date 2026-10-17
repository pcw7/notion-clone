/**
 * POST /api/perf — 실사용 측정값을 받는다 (플랫폼 잔여 10e-1a · F-12-18)
 *
 * 정본: 00-canonical-data-model.md §3.10 끝 [보강] 성능 계측 ③
 *
 * 몸: `{ events: [{ metric, value, route, navigation?, completed?, sampleRate }] }`(20개까지 — 브라우저가 모아 `sendBeacon` 으로 보낸다 ·
 * 그래서 `text/plain` 으로 올 수 있다 — 몸을 글로 읽어 JSON 으로 푼다).
 *
 *   204  받았다(모양이 틀린 것은 그 하나만 버린다 — 몇 개를 쌓았는지는 알리지 않는다)
 *   401  살아 있는 세션이 없다(로그인한 화면만 잰다 — 바깥에서 표를 채우지 못하게)
 *   429  너무 잦다(사람마다 1분에 60번)
 *
 * 워크스페이스를 묻지 않는다 — 측정값은 아무 사람 · 워크스페이스도 가리키지 않는다(경로는 틀로만 남는다 · `perf-events.ts`).
 */

import { readSessionToken } from '@/lib/auth/session-cookie'
import { normalizePerfBatch } from '@/lib/perf/perf-events'
import { recordPerfEvents, sessionUserOf } from '@/lib/perf/perf-store'
import { consume } from '@/lib/rate-limit'

const RULE = { limit: 60, windowSeconds: 60 } as const

export async function POST(request: Request): Promise<Response> {
  const userId = await sessionUserOf(await readSessionToken())
  if (userId === null) return new Response(null, { status: 401 })
  if (!(await consume('perf', userId, RULE)).allowed) return new Response(null, { status: 429 })

  let body: unknown = null
  try {
    body = JSON.parse(await request.text())
  } catch {
    // 몸이 JSON 이 아니면 받을 것이 없다
  }
  const events = normalizePerfBatch((body as { events?: unknown } | null)?.events)
  if (events.length > 0) await recordPerfEvents(events)
  return new Response(null, { status: 204 })
}
