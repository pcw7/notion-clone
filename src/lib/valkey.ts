/**
 * Valkey 클라이언트.
 *
 * Redis 가 아니라 Valkey(BSD-3)를 쓴다 — CLAUDE.md 절대 제약 1.
 * 클라이언트는 ioredis(MIT)다. Valkey 는 Redis 프로토콜 호환이라 그대로 붙는다.
 * iovalkey(Valkey 진영의 ioredis 포크)도 MIT 이지만 0.4.0 이라, 레이트리밋처럼
 * 인증 표면에 걸린 경로에는 더 검증된 쪽을 쓴다.
 *
 * 용도 (정본 §3.11 캐시 키 규약):
 *   - 레이트리밋 카운터 (F-14-16 — "DB 아님"이 명시되어 있다)
 *   - perm_gen / acl_epoch 세대 카운터 (W6 권한)
 *   - presence, 구독 레지스트리 (Phase 1)
 */

import Redis, { type RedisOptions } from 'ioredis'

declare global {
  // Next.js 개발 모드는 모듈을 다시 평가한다. 그때마다 새 연결을 만들면 샌다.
  var __notionCloneValkey: Redis | undefined
}

function createClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'

  const options: RedisOptions = {
    // 오프라인 큐는 켜 둔다. 끄면 연결이 맺어지기 전 첫 명령이 즉시
    // "Stream isn't writeable" 로 실패한다 — 부팅 직후 레이트리밋이 헛되이
    // fail-open 되는 창이 생긴다.
    //
    // 대신 commandTimeout 으로 빨리 실패시킨다. Valkey 가 정말 죽었다면
    // 1초 안에 에러가 나고 호출자가 fail-open 을 판단한다. 레이트리밋 검사가
    // 로그인 응답 시간을 좌우해서는 안 된다.
    enableOfflineQueue: true,
    commandTimeout: Number(process.env.VALKEY_COMMAND_TIMEOUT_MS ?? 1000),
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: false,
    retryStrategy(times) {
      // 서버는 계속 재시도해야 하지만, 스크립트·테스트는 Valkey 가 없을 때
      // 끝나지 않으면 안 된다. 무한 재시도는 열린 핸들로 남아 프로세스를 붙잡는다.
      // null 을 돌려주면 재시도를 멈춘다.
      const maxRetries = Number(process.env.VALKEY_MAX_RETRIES ?? 20)
      if (times > maxRetries) return null
      // 지수 백오프, 최대 3초
      return Math.min(times * 200, 3000)
    },
  }

  const client = new Redis(url, options)

  // 연결 오류를 잡지 않으면 프로세스가 죽는다. 레이트리밋은 Valkey 가 없어도
  // 동작해야 하므로(fail-open) 여기서는 로그만 남긴다.
  client.on('error', (err: Error) => {
    console.error('[valkey] 연결 오류:', err.message)
  })

  return client
}

export function getValkey(): Redis {
  if (!globalThis.__notionCloneValkey) {
    globalThis.__notionCloneValkey = createClient()
  }
  return globalThis.__notionCloneValkey
}

/** 테스트·스크립트 종료용. */
export async function closeValkey(): Promise<void> {
  const c = globalThis.__notionCloneValkey
  if (c) {
    globalThis.__notionCloneValkey = undefined
    await c.quit().catch(() => c.disconnect())
  }
}
