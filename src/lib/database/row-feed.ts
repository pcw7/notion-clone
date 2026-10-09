/**
 * 표가 바뀌었다는 신호의 허브 — Next 서버 프로세스 하나에 LISTEN 하나 (뷰 결과 실시간 동기화 2k-1조각 · F-04-24)
 *
 * 정본: 00-canonical-data-model.md §3.7 런타임 구독 레지스트리 · 판결 X-5 · [보강] X-5 의 단계
 *       04-database-views.md F-04-24 *"(1) MVP: 폴링 또는 SSE 로 뷰 전체 재조회 알림만"*
 *
 * 보고 있는 뷰마다 하나씩 열린 SSE 연결(`…/data-sources/[id]/changes`)이 여기 구독한다. Postgres 연결은 **프로세스에 하나**다 — 구독마다
 * LISTEN 을 걸면 연결 수가 보는 사람 수만큼 는다. 신호는 커밋 신호 모듈(`collab/change-feed.ts`)이 받는다(끊기면 다시 붙고, 다시 붙은
 * 뒤에는 그 사이 잃었을 수 있으니 모두에게 "다시 읽어라"를 준다).
 *
 *   rows(표)        그 표를 보는 구독 모두에게 `onChanged`
 *   access(워크스페이스)   그 워크스페이스의 구독에게 `onAccess` — 구독이 권한을 다시 확인하고, 잃었으면 닫는다(정본 §3.7
 *                   *"권한 회수 시 서버 강제 unsubscribe"*)
 *   session(사용자)  그 사용자의 구독에게 `onSession` — 세션이 끝났을 수 있다. 구독이 닫고 받는 쪽이 다시 붙어 다시 확인받는다
 *
 * 개발 서버의 모듈 다시 읽기에서도 허브가 하나로 남도록 `globalThis` 에 둔다.
 */

import { ACCESS_CHANNEL, openChangeFeed, ROWS_CHANNEL, type ChangeFeed, type CollabSignal } from '../collab/change-feed.ts'

export type RowFeedListener = {
  readonly dataSourceId: string
  readonly workspaceId: string
  readonly userId: string
  /** 표가 바뀌었다 — 또는 신호를 잃었을 수 있다(다시 붙었다). 다시 읽어라. */
  onChanged(): void
  /** 이 워크스페이스의 권한이 바뀌었을 수 있다 — 다시 확인하라. */
  onAccess(): void
  /** 이 사용자의 세션이 바뀌었다(로그아웃 · 범위 있는 로그아웃) — 닫아라. 다시 붙으면 다시 확인받는다. */
  onSession(): void
}

type Hub = { feed: Promise<ChangeFeed> | null; readonly listeners: Set<RowFeedListener> }

const HUB_KEY = Symbol.for('notion-clone.row-feed')

function hub(): Hub {
  const g = globalThis as { [HUB_KEY]?: Hub }
  return (g[HUB_KEY] ??= { feed: null, listeners: new Set() })
}

/** 신호 하나를 그 범위의 구독에게. 테스트가 연결 없이 부를 수 있게 내보낸다. */
export function dispatchRowSignal(signal: CollabSignal, listeners: Iterable<RowFeedListener> = hub().listeners): void {
  for (const l of listeners) {
    if (signal.kind === 'rows' && l.dataSourceId === signal.dataSourceId) l.onChanged()
    else if (signal.kind === 'access' && l.workspaceId === signal.workspaceId) l.onAccess()
    else if (signal.kind === 'session' && l.userId === signal.userId) l.onSession()
  }
}

/**
 * 구독한다 — 돌려준 함수로 끊는다. 허브의 연결은 처음 구독할 때 연다(처음 붙기가 실패하면 던지고, 다음 구독이 다시 연다).
 * 처음 붙을 때의 "다시 읽어라"는 주지 않는다 — 구독하는 쪽은 방금 읽었다.
 */
export async function subscribeRows(listener: RowFeedListener): Promise<() => void> {
  const h = hub()
  if (h.feed === null) {
    let first = true
    h.feed = openChangeFeed(
      {
        onSignal: (signal) => dispatchRowSignal(signal, h.listeners),
        onResync: () => {
          if (first) {
            first = false
            return
          }
          for (const l of h.listeners) l.onChanged()
        },
      },
      { channels: [ROWS_CHANNEL, ACCESS_CHANNEL], applicationName: 'notion-clone-row-feed' },
    )
    h.feed.catch(() => {
      h.feed = null
    })
  }
  await h.feed
  h.listeners.add(listener)
  return () => {
    h.listeners.delete(listener)
  }
}

/** 지금 구독 수 — 검사가 끊긴 연결이 정리됐는지 본다. */
export function rowFeedListenerCount(): number {
  return hub().listeners.size
}

/** 허브의 연결을 닫고 구독을 비운다 — 검사가 끝날 때 부른다(열린 LISTEN 이 프로세스를 붙잡지 않게). */
export async function closeRowFeed(): Promise<void> {
  const h = hub()
  const feed = h.feed
  h.feed = null
  h.listeners.clear()
  if (feed !== null) await (await feed.catch(() => null))?.close()
}
