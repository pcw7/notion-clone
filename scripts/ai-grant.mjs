#!/usr/bin/env node
/**
 * 워크스페이스에 AI 응답을 보충한다 — 운영자 명령 (AI-1 · F-10-12)
 *
 *   npm run ai:grant -- <workspaceId> <responses> [--days=N] [--reason=까닭]
 *
 * 노션의 크레딧 자리다 — **결제 없음**(CLAUDE.md 절대 제약 2: 자동 충전 · 초과 과금 · 나중 청구가 없다). 요금제 몫(창 · 월 · 체험)을 다
 * 쓴 뒤에 쓰고, 만료가 이른 것부터 쓴다. 서버 셸에서만 — HTTP 로 열지 않는다. 같은 명령을 두 번 돌리면 두 번 준다(멱등이 아니다) —
 * 그래서 끝에 만료 전 보충의 남은 수를 찍는다. 쓰기는 `grantAiResponses` 하나다 — 이 스크립트는 그것을 부를 뿐이다.
 */

import { existsSync, readFileSync } from 'node:fs'

/** .env 를 아주 단순하게 읽는다(`set-plan.mjs` 와 같다). 이미 있는 환경 변수가 이긴다. */
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
const { grantAiResponses, AI_GRANT_MAX, AI_GRANT_MAX_DAYS } = await import('../src/lib/ai/usage.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const [workspaceId, responses] = args.filter((a) => !a.startsWith('--'))
if (!workspaceId || !responses) {
  console.error('쓰는 법: npm run ai:grant -- <workspaceId> <responses> [--days=N] [--reason=까닭]')
  process.exit(2)
}

const MESSAGES = {
  not_found: `워크스페이스가 없다(지웠거나 id 가 틀렸다): ${workspaceId}`,
  invalid_responses: `응답 수는 1 ~ ${AI_GRANT_MAX} 의 정수다: ${responses}`,
  invalid_days: `--days 는 1 ~ ${AI_GRANT_MAX_DAYS} 의 정수다: ${flag('days')}`,
  invalid_reason: '--reason 은 1 ~ 200자다',
}

try {
  const result = await grantAiResponses(workspaceId, { responses, days: flag('days'), reason: flag('reason') })
  if (!result.ok) {
    console.error(MESSAGES[result.reason] ?? result.reason)
    process.exitCode = 1
  } else {
    const until = result.value.expiresAt === null ? '만료 없음' : `${result.value.expiresAt} 까지`
    console.log(`보충 ${responses}회를 줬다(${until}) — 만료 전 보충의 남은 수: ${result.value.balance}회`)
  }
} finally {
  await closePool()
}
