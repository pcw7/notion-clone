#!/usr/bin/env node
/**
 * 지운 워크스페이스를 되살린다 — 운영자 명령 (AD-1 · F-14-13 · 정본 §3.1 [보강 AD-1] ⑥)
 *
 *   npm run workspace:restore -- <workspaceId>
 *
 * 서버 셸에서만 — HTTP 로 열지 않는다. `deleted_at` · `deleted_by` 를 비우고 감사 `workspace.restored` 를 쌓는 것은
 * `restoreWorkspace` 하나다 — 이 스크립트는 그것을 부를 뿐이다. 몇 번 돌려도 같다(지운 상태가 아니면 아무것도 바꾸지 않는다).
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
const { restoreWorkspace } = await import('../src/lib/workspace/delete.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const [workspaceId] = process.argv.slice(2)
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
  console.error('쓰는 법: npm run workspace:restore -- <workspaceId>')
  process.exit(2)
}

try {
  const result = await restoreWorkspace(workspaceId)
  if (result.ok) console.log(`되살렸다: ${result.name} (${workspaceId})`)
  else {
    console.error(result.reason === 'not_found' ? `워크스페이스가 없다: ${workspaceId}` : '지운 워크스페이스가 아니다 — 바꾸지 않았다.')
    process.exitCode = 1
  }
} finally {
  await closePool()
}
