'use client'

/**
 * 보고 있는 표가 바뀌면 알린다 — SSE 구독 (표 변경 알림 2k-2조각 · F-04-24)
 *
 * 정본: 판결 X-5 [보강] "X-5 의 단계"(0단계 — 봉투는 "바뀌었다" 한 종류) · 서버는 `…/data-sources/[id]/changes`
 *
 *   changed     다시 읽어라(서버가 250ms 모아서 보낸다)
 *   revoked     더 볼 수 없다 — 닫는다(다시 붙지 않는다 · 부르는 쪽이 화면을 다시 읽어 "없음"을 보인다)
 *   reconnect   서버가 닫는다 — 브라우저가 알아서 다시 붙는다(`EventSource` 의 기본)
 *   ready       붙었다 — **두 번째부터는** 끊긴 사이의 신호를 잃었을 수 있으니 "바뀌었다"로 친다
 *   personal    **내** 개인 필터 · 정렬이 다른 탭 · 기기에서 바뀌었다(RT-3 — 서버가 이 사람에게만 보낸다 · 남은 받지 않는다). 이 탭이 바꾼
 *               것(`origin`)은 버린다. 받는 화면은 서버 화면을 다시 부른다(도구줄의 칩까지 — 새 필터면 표가 새로 선다)
 *
 * 첫 구독이 붙기 전의 틈(#250) — 서버 렌더로 읽은 뒤 이 구독이 붙기까지의 변경은 신호가 이미 지나갔다. 서버 화면이 준 렌더 시각
 * (`since` — 읽기 전의 시각)을 주소에 실으면 서버가 그 사이에 바뀌었을 때 `ready` 바로 뒤에 `changed` 를 보낸다. 렌더 시각은 **마운트
 * 때의 것**만 쓴다 — 다시 그린 서버 화면이 새 시각을 주어도 구독을 다시 열지 않는다(열린 구독이 그 뒤의 신호를 받는다).
 *
 * 부르는 쪽의 함수는 렌더마다 새로 만들어지므로 ref 로 최신 것을 부른다 — 구독을 매번 다시 열지 않는다.
 *
 * **뒤로 가기 캐시(bfcache)에 들면 닫고 돌아오면 다시 연다**(10n-7) — 떠난 화면이 캐시에 얼어 있는 동안 구독이 열린 채 남으면, 표 화면을 몇 번
 * 옮겨 다니는 사이 호스트당 연결 수를 다 차지해 새 화면의 요청이 막힌다. 링크가 보이기만 해도 미리받던 동안은 떠날 때 늘 진행 중인 요청이 있어
 * 화면이 캐시에 들지 못해 가려져 있었다.
 *
 * **신호는 커서를 싣는다**(RT-1) — `onChanged` 가 `{ cursor, reconnect }` 를 받는다. 커서를 들고 다니는 화면(표 — RT-2)은 바뀐 행만 묻고,
 * 다른 화면은 지금처럼 다시 읽는다. `reconnect` 는 끊긴 사이의 신호를 잃었을 수 있다는 뜻이다 — 다시 붙은 `ready` · bfcache 에서 돌아옴 ·
 * 오프라인에서 돌아옴(`online`) · 끊긴 채 숨었던 탭이 다시 보임(`visibilitychange`). 뒤의 둘은 구독이 닫혀 있으면(브라우저가 다시 붙기를
 * 포기했다) 새로 연다 — 커서를 든 화면은 그 사이를 델타로 메운다(F-05-06).
 */

import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { viewOrigin } from '@/lib/database/view-origin'

/**
 * 이 안의 화면은 변경 알림을 구독하지 않는다 — 대시보드의 위젯(DB-2). 위젯마다 열면 위젯 수만큼 연결이 열려 호스트당 연결 수(HTTP/1.1 은 6)를
 * 다 차지한다(아래 bfcache 와 같은 까닭 · 10n-7). 위젯은 연 때의 판이고, 고치거나 따라가려면 "전체로 열기" 다.
 */
const ChangesOff = createContext(false)
export function WithoutTableChanges({ children }: { readonly children: ReactNode }) {
  return createElement(ChangesOff.Provider, { value: true }, children)
}

/**
 * 서버 화면이 **읽기 전에** 받은 변경 기록의 커서(RT-1 · `currentChangeCursor`) — 구독할 때 `?after=` 로 들고 가면 서버가 구독이 붙기 전의
 * 틈을 변경 기록(DB 의 xid)으로 판정한다(서버 프로세스가 여럿이어도 · 다시 떠도 같다). 없으면 옛 길(`since` — 렌더 시각)만 간다.
 * 화면 한 장에 하나라 속성(`renderedAt`)처럼 컴포넌트마다 내리지 않고 서버 화면이 감싼다.
 */
const RenderedCursor = createContext<string | null>(null)
export function RenderedChangeCursor({ cursor, children }: { readonly cursor: string | null; readonly children: ReactNode }) {
  return createElement(RenderedCursor.Provider, { value: cursor }, children)
}

/** 서버 화면이 읽기 전에 받은 커서 — 마운트 때의 것을 쓰는 것은 부르는 쪽의 일이다(RT-2 — 화면이 처음 아는 자리). */
export function useRenderedChangeCursor(): string | null {
  return useContext(RenderedCursor)
}

/** "바뀌었다" 한 번 — 신호가 실어 온 커서(없을 수 있다)와 끊긴 뒤인가(머리말). */
export type ChangeSignal = { readonly cursor: string | null; readonly reconnect: boolean }

/** 사건이 실어 온 값 하나 — 모양이 틀리면 없다. */
const fieldOf = (event: Event, key: string): unknown => {
  try {
    const data: unknown = JSON.parse(String((event as MessageEvent).data))
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined
  } catch {
    return undefined
  }
}

const cursorOf = (event: Event): string | null => {
  const cursor = fieldOf(event, 'cursor')
  return typeof cursor === 'string' && cursor !== '' ? cursor : null
}

export function useTableChanges(
  workspaceId: string,
  dataSourceId: string,
  handlers: {
    readonly onChanged: (signal: ChangeSignal) => void
    readonly onRevoked: () => void
    /**
     * **내** 개인 필터 · 정렬이 다른 탭 · 기기에서 바뀌었다(RT-3 · `personal` 사건 — 서버가 이 사람에게만 보낸다 · 이 탭이 바꾼 것은 버린다)
     * 또는 렌더 뒤로 이미 바뀌었다(첫 `ready` 의 `personal`). 없으면 듣지 않는다(행 페이지 — 뷰가 없다).
     */
    readonly onPersonal?: () => void
  },
  enabled = true,
  /** 서버 화면이 읽기 전의 시각(ms) — 머리말. 없으면 첫 구독 전의 틈을 메우지 않는다. */
  since?: number,
): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const sinceAtMount = useRef(since)
  // 렌더 커서도 마운트 때의 것만(렌더 시각과 같다 — 다시 그린 서버 화면이 새 커서를 주어도 열린 구독이 그 뒤를 받는다)
  const renderedCursor = useContext(RenderedCursor)
  const cursorAtMount = useRef(renderedCursor)
  const off = useContext(ChangesOff)

  useEffect(() => {
    if (!enabled || off || typeof EventSource === 'undefined') return
    let source: EventSource | null = null
    let revoked = false
    const open = (at: number | undefined, cursor: string | null) => {
      const query = new URLSearchParams()
      if (at !== undefined) query.set('since', String(Math.floor(at)))
      if (cursor !== null) query.set('after', cursor)
      const qs = query.toString()
      const opened = new EventSource(`/api/workspaces/${workspaceId}/data-sources/${dataSourceId}/changes${qs === '' ? '' : `?${qs}`}`)
      let readyCount = 0
      opened.addEventListener('ready', (event) => {
        readyCount += 1
        // 두 번째부터는 다시 붙은 것 — 끊긴 사이를 메운다(커서를 든 화면은 델타로 · 내 개인 설정은 델타의 `personalChanged`)
        if (readyCount > 1) latest.current.onChanged({ cursor: cursorOf(event), reconnect: true })
        // 첫 `ready` — 렌더 뒤 · 구독 전에 내 개인 설정이 바뀌었다(RT-3)
        else if (fieldOf(event, 'personal') === true) latest.current.onPersonal?.()
      })
      opened.addEventListener('changed', (event) => latest.current.onChanged({ cursor: cursorOf(event), reconnect: false }))
      // 내 개인 설정(RT-3) — 이 탭이 바꾼 것은 이미 다시 그렸다
      opened.addEventListener('personal', (event) => {
        if (fieldOf(event, 'origin') !== viewOrigin()) latest.current.onPersonal?.()
      })
      opened.addEventListener('revoked', () => {
        revoked = true
        opened.close()
        source = null
        latest.current.onRevoked()
      })
      source = opened
    }
    // 뒤로 가기 캐시(bfcache)에 들면 닫는다 — 얼어 있는 화면의 구독이 열린 채 남아, 쌓이면 호스트당 연결 수(HTTP/1.1 은 6)를 다 차지해 새 화면의
    // 요청이 서버에 닿지도 못하고 줄을 섰다(10n-7 · HANDOFF §3.3-475). 돌아오면 다시 열고, 숨은 동안의 신호는 지나갔으니 한 번 다시 읽는다 —
    // 서버의 `since` 로 묻지 않는다(브라우저의 시계로 숨은 때를 재면 서버의 시계와 어긋나 놓칠 수 있다).
    const onHide = (event: PageTransitionEvent) => {
      if (!event.persisted || source === null) return
      source.close()
      source = null
    }
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted || revoked || source !== null) return
      open(undefined, null)
      latest.current.onChanged({ cursor: null, reconnect: true })
    }
    // 끊긴 구독을 새로 열고 그 사이를 메운다(F-05-06) — 렌더 시각 · 커서는 싣지 않는다(화면이 자기 커서로 묻는다)
    const reopen = () => {
      source?.close()
      open(undefined, null)
      latest.current.onChanged({ cursor: null, reconnect: true })
    }
    // 오프라인에서 돌아왔다 — 브라우저가 다시 붙기를 포기했으면(닫힘) · 아직 기다리는 중이면(연결 중) 새로 연다. 열려 있어도 그 사이의 신호가
    // 막혀 있었을 수 있으니 한 번 맞춘다
    const onOnline = () => {
      if (revoked) return
      if (source === null || source.readyState !== EventSource.OPEN) reopen()
      else latest.current.onChanged({ cursor: null, reconnect: true })
    }
    // 다시 보인다 — 숨은 동안 구독이 닫혔으면(브라우저가 포기했다) 새로 연다. 열려 있거나 다시 붙는 중이면 그 `ready` 가 메운다
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || revoked) return
      if (source === null || source.readyState === EventSource.CLOSED) reopen()
    }
    open(sinceAtMount.current, cursorAtMount.current)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [workspaceId, dataSourceId, enabled, off])
}

/**
 * 보드 · 갤러리 · 캘린더(2k-3) — "바뀌었다"면 서버 렌더를 다시 부른다(`router.refresh()`). 이 화면들은 데이터를 서버 렌더에서 받는다
 * (보드의 그룹 · 캘린더의 달) — 표처럼 따로 읽는 길을 두지 않는다. 끌기 · 편집 · 추가 중(`busy`)이면 미뤘다가 끝나면 부른다. 새 값은
 * `useAdoptServerValue` 가 상태로 받아들인다.
 */
export function useLiveServerRefresh(workspaceId: string, dataSourceId: string, busy: boolean, since?: number, enabled = true): void {
  const router = useRouter()
  const pending = useRef(false)
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  })
  const refresh = () => {
    if (busyRef.current) pending.current = true
    else router.refresh()
  }
  useTableChanges(
    workspaceId,
    dataSourceId,
    // 내 개인 설정(RT-3)도 같은 길 — 서버 화면이 내 필터 · 정렬로 다시 그린다
    { onChanged: refresh, onPersonal: refresh, onRevoked: () => router.refresh() },
    // 그룹 덩이(G-3a)는 바깥이 하나로 구독한다 — 덩이마다 열면 그룹 수만큼 연결이 열린다
    enabled,
    since,
  )
  useEffect(() => {
    if (busy || !pending.current) return
    pending.current = false
    router.refresh()
  }, [busy, router])
}

/**
 * 서버 렌더가 새 값을 주면(다시 부른 뒤 — 값의 정체가 바뀐다) 상태로 받아들인다. 바쁘면(끌기 · 편집 중) 끝난 뒤에. 처음 값은 이미
 * 상태의 시작이라 받아들이지 않는다.
 */
export function useAdoptServerValue<T>(value: T, busy: boolean, adopt: (value: T) => void): void {
  const seen = useRef(value)
  const latest = useRef(adopt)
  useEffect(() => {
    latest.current = adopt
  })
  useEffect(() => {
    if (value === seen.current || busy) return
    seen.current = value
    latest.current(value)
  }, [value, busy])
}

/**
 * 맞추기를 어떻게 했나 — 바뀐 행만(`delta`) · 처음부터(`full`) 의 마지막 것과 센 수(RT-2). 화면에 그리지 않는 신호다 — e2e 가 "이번
 * 맞추기는 델타였다"를 시간 재기 없이 본다(표의 `data-sync` · `data-sync-delta` · `data-sync-full`). 뷰마다 모듈에 둔다 — 스키마가 바뀌면 표가
 * 다시 마운트되는데 그 다시 읽기도 세어야 한다.
 */
export type SyncStats = { readonly last: 'delta' | 'full' | null; readonly delta: number; readonly full: number }
const syncStats = new Map<string, SyncStats>()
export function syncStatsOf(viewId: string): SyncStats {
  return syncStats.get(viewId) ?? { last: null, delta: 0, full: 0 }
}
export function noteSync(viewId: string, how: 'delta' | 'full'): SyncStats {
  const now = syncStatsOf(viewId)
  const next = { last: how, delta: now.delta + (how === 'delta' ? 1 : 0), full: now.full + (how === 'full' ? 1 : 0) }
  syncStats.set(viewId, next)
  return next
}
