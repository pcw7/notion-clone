#!/usr/bin/env node
/**
 * 검색 전체 재색인 — 운영자 명령 (10p-4 · F-07-06)
 *
 *   npm run search:reindex                 # 모든 워크스페이스
 *   npm run search:reindex -- <workspaceId> # 그 워크스페이스만
 *
 * 색인 텍스트를 행에서 다시 쓴다(`src/lib/search/reindex.ts` — 저장 경로와 같은 규칙). 마이그레이션 0012 의 백필 행 · 색인 규칙이 바뀐 뒤의 옛
 * 행을 고친다. 서버 셸에서만 — HTTP 로 열지 않는다. 몇 번을 돌려도 같다(같은 행에서 같은 텍스트).
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
const { reindexAllPages } = await import('../src/lib/search/reindex.ts')
const { closePool } = await import('../src/lib/db/pool.ts')

const [workspaceId] = process.argv.slice(2)
const started = Date.now()
try {
  const result = await reindexAllPages({
    ...(workspaceId ? { workspaceId } : {}),
    onProgress: (done) => process.stdout.write(`\r다시 색인한 페이지 ${done}개`),
  })
  process.stdout.write('\n')
  console.log(`끝 — 다시 씀 ${result.indexed} · 사라짐 ${result.missing} · 실패 ${result.failed.length} · ${((Date.now() - started) / 1000).toFixed(1)}초`)
  if (result.failed.length > 0) {
    console.error(`실패한 페이지(다시 돌리면 된다): ${result.failed.slice(0, 20).join(', ')}${result.failed.length > 20 ? ' …' : ''}`)
    process.exitCode = 1
  }
} finally {
  await closePool()
}
