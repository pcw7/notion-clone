'use client'

/**
 * 다시 붙으면 내려받은 페이지를 서버와 맞춘다 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④) — 워크스페이스 레이아웃에 단다.
 *
 * 앱을 열 때와 브라우저가 `online` 을 알릴 때 청한다. 하는 일은 모두 지연 로드한 모듈과 그 워커가 한다(`lib/offline/offline-sync-client.ts`
 * → `offline-sync.ts` — 판 묻기 · 남은 편집 보내기 · 바뀐 것 다시 받기 · 볼 수 없게 된 것 지우기). 모든 화면의 첫 JS 를 늘리지 않으려고 여기엔
 * 알림만 있다 — 지운 사본 수 · 서버가 받지 않아 버린 편집(그 글을 복사할 수 있게). 알릴 것이 없으면 그리는 것이 없다.
 */

import { useEffect, useState } from 'react'

type Notice = { readonly messages: readonly string[]; readonly unsaved: string | null }

export function OfflineResync({ userId, collabUrl }: { userId: string; collabUrl: string }) {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let alive = true
    const request = (): void => {
      void import('@/lib/offline/offline-sync-client')
        .then((m) => m.requestResync({ userId, collabUrl }, (next) => alive && setNotice(next)))
        .catch(() => undefined)
    }
    request()
    window.addEventListener('online', request)
    return () => {
      alive = false
      window.removeEventListener('online', request)
    }
  }, [userId, collabUrl])

  if (notice === null) return null
  return (
    <div
      role="status"
      data-testid="offline-resync-notice"
      className="fixed bottom-4 left-4 z-50 flex max-w-sm flex-col gap-2 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      {notice.messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {notice.unsaved !== null && (
        <textarea readOnly value={notice.unsaved} data-testid="offline-resync-unsaved" className="h-24 w-full resize-y rounded border border-neutral-200 p-1 text-xs dark:border-neutral-700" />
      )}
      <button type="button" data-testid="offline-resync-dismiss" className="self-end text-neutral-500" onClick={() => setNotice(null)}>
        닫기
      </button>
    </div>
  )
}
