/**
 * 협업 서버가 듣는 커밋 신호 — Postgres LISTEN (F-05-19 · F-05-02 · CRDT 5c조각)
 *
 * 정본: §3.7 런타임 구독 레지스트리("구독 시점 권한검사 + 권한 회수 시 서버 강제 unsubscribe") · 판결 C-11
 *       마이그레이션 0016_collab_notify.sql — 무엇이 언제 신호를 보내는가
 *
 * 다른 프로세스(Next 의 명령 · 권한 변경)가 쓴 것을 협업 서버가 곧바로 알게 하는 통로다. 신호는 쓰는 트랜잭션의 트리거가 보내므로
 * **커밋된 것만** 오고 **커밋 순서대로** 온다(0016 머리말 — 진단으로 쟀다). 신호는 무엇이 바뀌었는지만 싣는다 — 받는 쪽이 본문은
 * 로그에서, 권한은 판정 함수로 다시 읽는다.
 *
 *   - 신호는 받은 순서대로 **동기로** 넘긴다. 받는 쪽이 그 순서에 기대어 "권한을 다시 본 뒤에 퍼뜨린다"를 지킨다
 *     (`collab-server.ts`)
 *   - 끊기면 그 사이의 신호는 사라진다 — Postgres 는 쌓아 두지 않고, 다시 LISTEN 해도 오지 않는다(진단). 그래서 다시 붙어 LISTEN 한
 *     **뒤에** `onResync` 를 부른다. 받는 쪽은 그때 가진 것을 전부 다시 맞춘다. 처음 붙을 때도 부른다 — 듣기 전에 받은 연결이 있을
 *     수 있다
 *   - 새 연결로 받은 신호는 **`onResync` 뒤에** 넘긴다. 앞에 넘기면 끊긴 사이 잃은 권한 회수를 다시 판정하기 전에 그 뒤에 커밋된
 *     본문을 퍼뜨릴 수 있다. ⚠ 검사로 강제하지 못한 방어다 — LISTEN 응답과 같은 묶음에 신호가 실려 오는 장면을 만들지 못했고,
 *     이 버퍼를 빼는 반사실에서 검사가 전부 통과했다
 *   - 끊긴 pg 클라이언트는 다시 쓸 수 없다(진단) — 붙을 때마다 새로 만든다
 *   - 커넥션 풀을 쓰지 않는다. LISTEN 은 그 세션에 걸리므로 풀에 돌려주면 다른 쿼리가 그 세션을 쓴다
 */

import pg from 'pg'

import { isUuid } from '../ids.ts'

export const DOC_CHANNEL = 'collab_doc'
export const ACCESS_CHANNEL = 'collab_access'

/** `pg_stat_activity` 에서 이 연결을 알아본다. */
export const FEED_APPLICATION_NAME = 'notion-clone-collab-feed'

export type CollabSignal =
  /** 그 페이지 로그에 `seq` 가 쌓였다. */
  | { readonly kind: 'doc'; readonly pageId: string; readonly seq: string }
  /** 그 워크스페이스의 누군가의 페이지 권한이 바뀌었을 수 있다. */
  | { readonly kind: 'access'; readonly workspaceId: string }
  /** 그 사용자의 세션이 바뀌었다. */
  | { readonly kind: 'session'; readonly userId: string }

export type ChangeFeedHandlers = {
  /** 신호 하나. 받은 순서(= 커밋 순서)대로 동기로 부른다. */
  onSignal(signal: CollabSignal): void
  /** LISTEN 이 (다시) 걸렸다 — 그 전의 신호는 잃었을 수 있다. */
  onResync(): void
}

export type ChangeFeed = {
  /** 지금 듣고 있는 세션의 backend pid. 끊겨서 다시 붙기 전이면 null. */
  backendPid(): number | null
  close(): Promise<void>
}

export type ChangeFeedOptions = {
  readonly connectionString?: string
  /** 끊긴 뒤 다시 붙기까지. 기본 200ms — 이어서 실패하면 두 배씩, 최대 5초. */
  readonly retryDelayMs?: number
}

const MAX_RETRY_DELAY_MS = 5000

export function parseCollabSignal(channel: string, payload: string | undefined): CollabSignal | null {
  if (payload === undefined) return null
  if (channel === DOC_CHANNEL) {
    const colon = payload.lastIndexOf(':')
    const pageId = payload.slice(0, colon)
    const seq = payload.slice(colon + 1)
    return colon > 0 && isUuid(pageId) && /^[0-9]+$/.test(seq) ? { kind: 'doc', pageId, seq } : null
  }
  if (channel === ACCESS_CHANNEL) {
    if (payload.startsWith('ws:') && isUuid(payload.slice(3))) return { kind: 'access', workspaceId: payload.slice(3) }
    if (payload.startsWith('user:') && isUuid(payload.slice(5))) return { kind: 'session', userId: payload.slice(5) }
  }
  return null
}

/** 처음 붙기가 실패하면 던진다 — 신호 없이 뜬 협업 서버는 명령이 쓴 것 · 권한 회수를 모른다. */
export async function openChangeFeed(handlers: ChangeFeedHandlers, options: ChangeFeedOptions = {}): Promise<ChangeFeed> {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL 이 설정되지 않았습니다 — 협업 서버가 커밋 신호를 들을 수 없다.')
  const baseDelay = options.retryDelayMs ?? 200

  let closed = false
  let current: pg.Client | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let delay = baseDelay

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect().then(
        () => {
          delay = baseDelay
        },
        (error: unknown) => {
          console.error('[collab] 커밋 신호에 다시 붙지 못했다:', describe(error))
          delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS)
          scheduleRetry()
        },
      )
    }, delay)
  }

  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString, application_name: FEED_APPLICATION_NAME })
    let lost = false
    // 끊기면 'error' 가 두 번 오고 'end' 가 온다(진단). 한 번만 처리한다. 붙기 전에 잃으면 connect 가 던져 호출자가 다시 잡는다.
    const onLost = (error?: unknown): void => {
      if (lost) return
      lost = true
      if (current === client) {
        current = null
        if (!closed) console.error('[collab] 커밋 신호 연결이 끊겼다 — 다시 붙는다:', describe(error))
        scheduleRetry()
      }
      client.end().catch(() => undefined)
    }
    client.on('error', onLost)
    client.on('end', () => onLost())
    /** `onResync` 를 부르기 전에 받은 신호 — 머리말. */
    let early: CollabSignal[] | null = []
    client.on('notification', (message) => {
      const signal = parseCollabSignal(message.channel, message.payload)
      if (signal === null) {
        console.error('[collab] 읽을 수 없는 커밋 신호:', message.channel, message.payload)
        return
      }
      if (early !== null) early.push(signal)
      else handlers.onSignal(signal)
    })

    try {
      await client.connect()
      await client.query(`LISTEN ${DOC_CHANNEL}`)
      await client.query(`LISTEN ${ACCESS_CHANNEL}`)
    } catch (error) {
      lost = true
      client.end().catch(() => undefined)
      throw error
    }
    if (lost) throw new Error('LISTEN 을 거는 사이에 연결이 끊겼다')
    if (closed) {
      lost = true
      await client.end().catch(() => undefined)
      return
    }
    current = client
    handlers.onResync()
    const buffered = early
    early = null
    for (const signal of buffered) handlers.onSignal(signal)
  }

  await connect()

  return {
    backendPid: () => (current as (pg.Client & { processID?: number }) | null)?.processID ?? null,
    async close() {
      closed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      const client = current
      current = null
      await client?.end().catch(() => undefined)
    },
  }
}

function describe(error: unknown): string {
  if (error === undefined) return '(이유 없음)'
  const e = error as { code?: string; message?: string }
  return [e.code, e.message].filter(Boolean).join(' ') || String(error)
}
