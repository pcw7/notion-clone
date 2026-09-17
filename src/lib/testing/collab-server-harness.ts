/**
 * 협업 서버 검사의 도우미 — 서버 띄우기 · provider 참여자 · 커밋 신호 붙잡기 (DB · 실제 WebSocket)
 *
 * `collab/collab-server.db.test.ts`(서버)와 `collab/collab-connection.db.test.ts`(브라우저 연결)가 함께 쓴다.
 */

import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'

import * as Y from 'yjs'
import { HocuspocusProvider, type HocuspocusProviderConfiguration } from '@hocuspocus/provider'
import type { Server } from '@hocuspocus/server'

import { SESSION_COOKIE } from '../auth/constants.ts'
import { projectPendingBody } from '../block/body-write.ts'
import { openChangeFeed, type ChangeFeed, type ChangeFeedHandlers, type CollabSignal } from '../collab/change-feed.ts'
import { createCollabServer, type CollabContext, type CollabServerOptions } from '../collab/collab-server.ts'
import { createProjectionScheduler, type ProjectionScheduler } from '../collab/projection-scheduler.ts'
import type { Actor } from './db-fixtures.ts'

export const APP_ORIGIN = 'http://app.test'

export type Running = {
  readonly url: string
  readonly projector: ProjectionScheduler
  /** Hocuspocus 서버 — 검사가 연결을 직접 닫을 때(`closeConnections`). */
  readonly server: Server<CollabContext>
  stop(): Promise<void>
}

/**
 * 검사마다 서버를 띄운다 — 포트는 OS 가 고른다. 검사가 끝나면 내린다.
 *
 * 밀린 투영의 창은 길게 둔다 — 행을 보는 검사는 그 전에 `projector.flush()` 한다. 창이 지나기를 시간으로 기다리지 않는다.
 * 창 자체가 도는지는 ⑮ 이 본다.
 */
export async function startServer(t: TestContext, extra: Pick<CollabServerOptions, 'openFeed' | 'projector'> = {}): Promise<Running> {
  const projector =
    extra.projector ?? createProjectionScheduler({ project: (pageId, ctx) => projectPendingBody(ctx, pageId), delayMs: 600_000 })
  const server = createCollabServer({ port: 0, allowedOrigins: [APP_ORIGIN], quiet: true, stopOnSignals: false, ...extra, projector })
  await server.listen()
  const stop = () => Promise.race([server.destroy(), new Promise<void>((resolve) => setTimeout(resolve, 5000))])
  t.after(stop)
  return { url: `ws://127.0.0.1:${server.address.port}`, projector, server, stop }
}

export type Participant = {
  readonly doc: Y.Doc
  readonly provider: HocuspocusProvider
  /** 연결을 받지 않은 이유. */
  failure: string | null
  /** 받은 뒤에 서버가 이 문서 연결을 닫은 이유. */
  readonly closed: string[]
}

export const cookieOf = (actor: Actor, extra: Record<string, string> = {}): Record<string, string> => ({
  cookie: `${SESSION_COOKIE}=${actor.token}`,
  ...extra,
})

/** 페이지 하나에 붙는 참여자. `headers` 는 업그레이드 요청에 싣는다 — 브라우저가 쿠키 · Origin 을 싣는 것처럼. */
export function join(t: TestContext, url: string, name: string, headers: Record<string, string>, clientId?: number): Participant {
  class HeaderSocket extends WebSocket {
    constructor(address: string | URL) {
      // Node 의 WebSocket(undici)은 두 번째 인자로 헤더를 받는다(진단으로 확인).
      super(address, { headers } as unknown as string[])
    }
  }
  const doc = new Y.Doc()
  if (clientId !== undefined) doc.clientID = clientId
  const closed: string[] = []
  const state = { failure: null as string | null }
  const provider = new HocuspocusProvider({
    url,
    name,
    document: doc,
    WebSocketPolyfill: HeaderSocket,
    onAuthenticationFailed: ({ reason }: { reason: string }) => {
      state.failure = reason
    },
    // 소켓이 끊길 때도 불리지만 이유가 비어 있다. 서버가 문서 연결을 닫을 때만 이유가 있다.
    onClose: ({ event }: { event: { reason: string } }) => {
      if (event.reason) closed.push(event.reason)
    },
    // `WebSocketPolyfill` 은 런타임에 소켓 설정으로 넘어가지만 provider 설정 타입에는 없다 — 검사는 소켓을 provider 에 맡긴다.
  } as HocuspocusProviderConfiguration)
  t.after(() => provider.destroy())
  return {
    doc,
    provider,
    closed,
    get failure() {
      return state.failure
    },
  }
}

export async function waitFor(label: string, check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > end) assert.fail(`기다리다 끝났다 — ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

export const ready = (...participants: Participant[]) =>
  waitFor('연결 · 첫 동기화', () => participants.every((p) => p.provider.isAuthenticated && p.provider.isSynced))

/** 조건이 서거나 시간이 다 될 때까지 — 실패하지 않는다. 뒤따르는 단언이 무엇이 달랐는지 보여 준다. */
export async function waitUntil(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
}

/** 커밋 신호를 붙잡아 두었다가 차례대로 놓는다 — 신호가 늦게 도착하는 장면을 만든다(실제 LISTEN 을 감싼다). */
export function holdableFeed() {
  let target: ChangeFeedHandlers | null = null
  let held: CollabSignal[] | null = null
  return {
    open(handlers: ChangeFeedHandlers): Promise<ChangeFeed> {
      target = handlers
      return openChangeFeed({
        onSignal: (signal) => {
          if (held === null) handlers.onSignal(signal)
          else held.push(signal)
        },
        onResync: () => handlers.onResync(),
      })
    },
    hold(): void {
      held = []
    },
    held: (): readonly CollabSignal[] => held ?? [],
    /** 붙잡고 있으면 전부 놓는다 — 검사가 실패해 `release` 에 닿지 못해도 서버가 내려가게 뒤처리(`t.after`)에 건다. */
    releaseIfHeld(): void {
      if (held === null || target === null) return
      const all = held
      held = null
      for (const signal of all) target.onSignal(signal)
    },
    /** 붙잡은 신호를 `until` 에 맞는 것까지 차례대로 놓는다. `until` 이 없으면 전부 놓고 붙잡기를 끝낸다. */
    release(until?: (signal: CollabSignal) => boolean): void {
      assert.ok(held !== null && target !== null, '붙잡고 있지 않다')
      if (until === undefined) {
        const all = held
        held = null
        for (const signal of all) target.onSignal(signal)
        return
      }
      const index = held.findIndex(until)
      assert.ok(index >= 0, '놓을 신호를 붙잡지 않았다')
      for (const signal of held.splice(0, index + 1)) target.onSignal(signal)
    },
  }
}

export const docSignal = (pageId: string, seq: string) => (signal: CollabSignal) =>
  signal.kind === 'doc' && signal.pageId === pageId && signal.seq === seq
