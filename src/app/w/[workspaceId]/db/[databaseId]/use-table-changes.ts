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
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export function useTableChanges(
  workspaceId: string,
  dataSourceId: string,
  handlers: { readonly onChanged: () => void; readonly onRevoked: () => void },
  enabled = true,
  /** 서버 화면이 읽기 전의 시각(ms) — 머리말. 없으면 첫 구독 전의 틈을 메우지 않는다. */
  since?: number,
): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const sinceAtMount = useRef(since)

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    let source: EventSource | null = null
    let revoked = false
    const open = (at: number | undefined) => {
      const opened = new EventSource(
        `/api/workspaces/${workspaceId}/data-sources/${dataSourceId}/changes${at === undefined ? '' : `?since=${Math.floor(at)}`}`,
      )
      let readyCount = 0
      opened.addEventListener('ready', () => {
        readyCount += 1
        if (readyCount > 1) latest.current.onChanged()
      })
      opened.addEventListener('changed', () => latest.current.onChanged())
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
      open(undefined)
      latest.current.onChanged()
    }
    open(sinceAtMount.current)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      source?.close()
    }
  }, [workspaceId, dataSourceId, enabled])
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
  useTableChanges(
    workspaceId,
    dataSourceId,
    {
      onChanged: () => {
        if (busyRef.current) pending.current = true
        else router.refresh()
      },
      onRevoked: () => router.refresh(),
    },
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
