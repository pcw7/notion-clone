#!/usr/bin/env node
/**
 * 워크스페이스의 요금제를 바꾼다 — 운영자 명령 (잔여 묶음 8k-1 · F-13-18)
 *
 *   npm run plan:set -- <workspaceId> <free|plus|business|enterprise>
 *
 * 결제 연동은 없다(CLAUDE.md 절대 제약 1 — 유료 SaaS 의존 금지). 요금제는 운영자가 이 명령으로 준다. 구독 한 줄과
 * `workspace.plan_code` 를 한 트랜잭션에서 쓰는 것은 `setWorkspacePlan` 하나다 — 이 스크립트는 그것을 부를 뿐이다.
 */

import { existsSync, readFileSync } from 'node:fs'

/** .env 를 아주 단순하게 읽는다(`migrate.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
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
const { setWorkspacePlan, PLAN_CODES } = await import('../src/lib/billing/plan.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const [workspaceId, plan] = process.argv.slice(2)
if (!workspaceId || !plan) {
  console.error(`쓰는 법: npm run plan:set -- <workspaceId> <${PLAN_CODES.join('|')}>`)
  process.exit(2)
}

try {
  const result = await setWorkspacePlan(workspaceId, plan)
  if (!result.ok) {
    console.error(result.reason === 'invalid_plan' ? `모르는 요금제다: ${plan} (${PLAN_CODES.join(' · ')})` : `워크스페이스가 없다: ${workspaceId}`)
    process.exitCode = 1
  } else if (!result.changed) {
    console.log(`이미 ${result.to} 다 — 바꾸지 않았다.`)
  } else {
    console.log(`${result.from} → ${result.to} 로 바꿨다.`)
  }
} finally {
  await closePool()
}
