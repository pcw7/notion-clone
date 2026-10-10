#!/usr/bin/env node
/**
 * 워커를 띄운다 — `npm run worker` (공용 스케줄러 · 히스토리 · 활동 4a-1)
 *
 * 정본: 00-canonical-data-model.md §3.10 [보강] 공용 스케줄러 ⑤ — 별도 프로세스(협업 서버처럼) · 세션 없는 시스템 주체.
 * 일의 규칙은 `src/lib/jobs/scheduler.ts` 에 있고, 여기서는 환경을 읽어 돌리기만 한다:
 *
 *   · 뜰 때 주기 일을 넣어 본다(이미 살아 있으면 그대로)
 *   · `WORKER_INTERVAL_MS`(기본 30초)마다 때가 된 일을 돌린다 — 한 판이 꽉 찼으면 쉬지 않고 바로 다음 판
 *   · SIGINT · SIGTERM 이면 지금 판을 끝내고 멈춘다
 *
 * 여러 개를 띄워도 된다 — 일을 `FOR UPDATE SKIP LOCKED` 로 가져가므로 겹치지 않는다.
 *
 *   DATABASE_URL         앱과 같은 DB
 *   WORKER_INTERVAL_MS   판 사이의 쉼(기본 30000)
 */

import { existsSync, readFileSync } from 'node:fs'

/** .env 를 아주 단순하게 읽는다(`collab-server.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
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

// 환경을 채운 뒤에 불러온다 — DB 풀이 DATABASE_URL 을 읽는다.
const { ensureRecurringJobs, runDueJobs } = await import('../src/lib/jobs/scheduler.ts')

const interval = Number(process.env.WORKER_INTERVAL_MS ?? 30_000)
const LIMIT = 10
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (stopping = true))

const added = await ensureRecurringJobs(new Date())
console.log(`워커 — 판마다 ${LIMIT}개 · 쉼 ${interval}ms · 새로 넣은 주기 일 ${added}개`)

while (!stopping) {
  let ran = 0
  try {
    const result = await runDueJobs({ limit: LIMIT })
    ran = result.ran
    if (result.ran > 0) console.log(`[worker] ${result.ran}개 돌림 · 실패 ${result.failed}개`)
  } catch (e) {
    // 판 자체가 실패했다(DB 가 잠깐 없다 등) — 다음 판에 다시 한다
    console.error(`[worker] 판이 실패했다: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (ran < LIMIT) await new Promise((resolve) => setTimeout(resolve, interval))
}

const { closePool } = await import('../src/lib/db/pool.ts')
await closePool()
console.log('워커 — 멈췄다')
