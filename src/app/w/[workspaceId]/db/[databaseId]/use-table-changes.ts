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
