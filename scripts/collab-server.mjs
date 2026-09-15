#!/usr/bin/env node
/**
 * 협업 서버를 띄운다 — `npm run collab` (F-05-02 · CRDT 5a조각)
 *
 * 마스터 문서 §6.2: Hocuspocus 를 **별도 프로세스**로 둔다(API 3000 / 협업 3001). 서버 코드는
 * `src/lib/collab/collab-server.ts` 이고, 여기서는 환경을 읽어 띄우기만 한다.
 *
 *   COLLAB_PORT          기본 3001
 *   NEXT_PUBLIC_APP_URL  받을 Origin — 앱의 출처. 기본 http://localhost:3000
 *   DATABASE_URL         앱과 같은 DB
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
const { createCollabServer } = await import('../src/lib/collab/collab-server.ts')

const port = Number(process.env.COLLAB_PORT ?? 3001)
const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').origin

const server = createCollabServer({ port, allowedOrigins: [appOrigin], quiet: true })
await server.listen()
console.log(`협업 서버 — ws://localhost:${server.address.port} · 받는 Origin ${appOrigin}`)
