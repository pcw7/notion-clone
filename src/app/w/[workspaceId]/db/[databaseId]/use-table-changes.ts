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
 * 부르는 쪽의 함수는 렌더마다 새로 만들어지므로 ref 로 최신 것을 부른다 — 구독을 매번 다시 열지 않는다.
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export function useTableChanges(
  workspaceId: string,
  dataSourceId: string,
  handlers: { readonly onChanged: () => void; readonly onRevoked: () => void },
  enabled = true,
): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/workspaces/${workspaceId}/data-sources/${dataSourceId}/changes`)
    let readyCount = 0
    source.addEventListener('ready', () => {
      readyCount += 1
      if (readyCount > 1) latest.current.onChanged()
    })
    source.addEventListener('changed', () => latest.current.onChanged())
    source.addEventListener('revoked', () => {
      source.close()
      latest.current.onRevoked()
    })
    return () => source.close()
  }, [workspaceId, dataSourceId, enabled])
}

/**
 * 보드 · 갤러리 · 캘린더(2k-3) — "바뀌었다"면 서버 렌더를 다시 부른다(`router.refresh()`). 이 화면들은 데이터를 서버 렌더에서 받는다
 * (보드의 그룹 · 캘린더의 달) — 표처럼 따로 읽는 길을 두지 않는다. 끌기 · 편집 · 추가 중(`busy`)이면 미뤘다가 끝나면 부른다. 새 값은
 * `useAdoptServerValue` 가 상태로 받아들인다.
 */
export function useLiveServerRefresh(workspaceId: string, dataSourceId: string, busy: boolean, enabled = true): void {
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
    enabled,
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
