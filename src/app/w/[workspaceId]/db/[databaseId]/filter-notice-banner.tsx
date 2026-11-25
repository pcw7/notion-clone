'use client'

/**
 * 지운 속성의 조건을 뺐다는 띠 — 한 번만 (DB 실시간 동기화 RT-3조각 · F-05-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] ③ — 05 F-05-16 *"그 조건만 drop 하고 배너 표시"*
 *
 * 서버 화면이 아직 보지 않은 알림을 준다(`listViewNotices`). 띄우면 곧바로 "봤다"고 적는다(`ackViewNotices`) — 새로 읽어도 다시 뜨지 않는다.
 * 띠는 닫을 때까지 남는다: 속성 하나를 지우면 서버 화면이 두어 번 다시 불리는데(스키마 · 개인 설정의 신호) 두 번째부터는 알림이 비어 온다.
 * 그래서 받은 알림을 모아 두고(이전 값과 비교해 렌더 중에 더한다) 닫기만 비운다.
 */

import { useEffect, useRef, useState } from 'react'

import type { ViewFilterNotice } from '@/lib/database/view'
import { viewNoticeText } from '@/lib/database/view-notice-text'
import { ackViewNotices } from './table-api'

export function FilterNoticeBanner({
  workspaceId,
  viewId,
  notices,
}: {
  readonly workspaceId: string
  readonly viewId: string
  readonly notices: readonly ViewFilterNotice[]
}) {
  const [previous, setPrevious] = useState(notices)
  const [shown, setShown] = useState<readonly ViewFilterNotice[]>(notices)
  // 새로 온 알림을 더한다(렌더 중 — 앞의 값과 다를 때만)
  if (notices !== previous) {
    setPrevious(notices)
    const fresh = notices.filter((n) => !shown.some((s) => s.id === n.id))
    if (fresh.length > 0) setShown([...shown, ...fresh])
  }
  const acked = useRef(new Set<string>())
  useEffect(() => {
    const ids = shown.map((n) => n.id).filter((id) => !acked.current.has(id))
    if (ids.length === 0) return
    for (const id of ids) acked.current.add(id)
    // 적지 못해도 띠는 그대로다 — 다음에 한 번 더 뜰 뿐
    void ackViewNotices(workspaceId, viewId, ids)
  }, [shown, workspaceId, viewId])

  if (shown.length === 0) return null
  return (
    <div
      role="status"
      data-testid="db-filter-notice"
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <ul className="min-w-0 flex-1 space-y-1 break-words">
        {shown.map((n) => (
          <li key={n.id} data-testid="db-filter-notice-item">
            {viewNoticeText(n)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="db-filter-notice-close"
        aria-label="알림 닫기"
        onClick={() => setShown([])}
        className="shrink-0 rounded px-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
      >
        ×
      </button>
    </div>
  )
}
