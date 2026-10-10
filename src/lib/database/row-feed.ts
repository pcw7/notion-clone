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
 * **구독이 붙기 전의 틈**(#250 · 정본 X-5 [보강] "X-5 의 단계") — 화면은 서버 렌더로 읽은 뒤에 구독한다. 그 사이의 신호는 지나갔다.
 * 허브가 표마다 마지막 신호를 받은 시각과 **듣기 시작한 시각**(LISTEN 이 걸린 때 · 다시 붙으면 새로)을 기억하고, 구독이 렌더 시각을
 * 들고 오면 `rowsChangedSince` 가 그 사이에 바뀌었는가를 답한다 — 모르면(그때 듣고 있지 않았으면) "바뀌었다"다.
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

type Hub = {
  feed: Promise<ChangeFeed> | null
  readonly listeners: Set<RowFeedListener>
  /** LISTEN 이 (다시) 걸린 시각 — 이보다 앞의 신호는 받지 못했을 수 있다. 아직 듣지 않았으면 null. */
  listeningSince: number | null
  /** 표마다 마지막으로 "바뀌었다"를 받은 시각. */
  readonly lastChanged: Map<string, number>
}

/**
 * 허브의 시계 — 신호를 받은 시각 · 듣기 시작한 시각 · **서버 화면이 읽기 전의 시각**(`renderedAt`)이 모두 이것을 쓴다(같은 프로세스의
 * 시계 하나 — 정본 X-5 [보강]). 서버 화면은 요청마다 한 번 그려지므로 렌더 중에 불러도 된다(클라이언트 컴포넌트에서는 부르지 않는다).
 */
export const feedClock = (): number => Date.now()

/** 기억하는 표의 수 — 넘으면 비우고 듣기 시작한 시각을 지금으로 한다(그 앞의 렌더는 "바뀌었을 수 있다"가 된다 · 보수적). */
const LAST_CHANGED_CAP = 10_000

const HUB_KEY = Symbol.for('notion-clone.row-feed')

function hub(): Hub {
  const g = globalThis as { [HUB_KEY]?: Hub }
  return (g[HUB_KEY] ??= { feed: null, listeners: new Set(), listeningSince: null, lastChanged: new Map() })
}

/** 신호를 받은 시각을 적는다(표의 신호만). */
function recordRowSignal(h: Hub, signal: CollabSignal, at: number): void {
  if (signal.kind !== 'rows') return
  if (h.lastChanged.size >= LAST_CHANGED_CAP && !h.lastChanged.has(signal.dataSourceId)) {
    h.lastChanged.clear()
    h.listeningSince = at
  }
  h.lastChanged.set(signal.dataSourceId, at)
}

/**
 * `since`(화면이 서버에서 읽기 **전**의 시각 — 같은 서버 프로세스의 시계) 뒤에 이 표가 바뀌었을 수 있는가. 그 시각에 허브가 듣고
 * 있지 않았으면(아직 열리지 않았거나 · 끊겼다 다시 붙었거나 · 기억이 넘쳐 비웠으면) 모른다 — 참이다. 거짓 양성(이미 읽은 것을 한 번
 * 더 읽음)은 허용한다 — 읽기 전의 시각을 쓰므로 읽은 뒤의 변경을 놓치지는 않는다.
 */
export function rowsChangedSince(dataSourceId: string, since: number): boolean {
  const h = hub()
  if (h.listeningSince === null || since < h.listeningSince) return true
  return (h.lastChanged.get(dataSourceId) ?? Number.NEGATIVE_INFINITY) >= since
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
        onSignal: (signal) => {
          recordRowSignal(h, signal, feedClock())
          dispatchRowSignal(signal, h.listeners)
        },
        onResync: () => {
          // LISTEN 이 (다시) 걸렸다 — 이 앞의 신호는 받지 못했을 수 있다(머리말 "구독이 붙기 전의 틈")
          h.listeningSince = feedClock()
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
  h.listeningSince = null
  h.lastChanged.clear()
  if (feed !== null) await (await feed.catch(() => null))?.close()
}
