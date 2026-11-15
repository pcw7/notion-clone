'use client'

/**
 * 데이터베이스 화면 머리의 "오프라인" — 창을 처음 열 때 스위치(`offline-database-switch.tsx`)를 지연 로드한다 (OF-4 · F-12-04)
 *
 * 페이지 메뉴의 스위치(OF-2 · `[pageId]/offline-toggle.tsx`)와 같은 규칙이다 — IndexedDB 저장소 · 받기는 창을 연 사람만 받는다. 그 전에는 같은
 * 모양의 줄을 그린다. 한 번 받으면 창을 닫아도 남는다(창은 숨길 뿐이다) — 내려받는 동안 닫아도 끊기지 않는다.
 *
 * 내려받을 수 없는 사람(내보내기 정책 — 소유자만)에게는 화면이 이 부품을 세우지 않는다(`mayDownloadOffline`).
 */

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

import { OFFLINE_DATABASE_ROWS } from '@/lib/offline/offline-table'

import { MENU_ROW } from '../../[pageId]/page-menu'
import { TOPBAR_BUTTON } from '../../topbar-style'

function PendingRow() {
  return (
    <button type="button" role="switch" aria-checked={false} aria-busy disabled data-testid="offline-toggle" data-state="checking" className={`${MENU_ROW} justify-between`}>
      오프라인으로 쓰기
      <span aria-hidden className="relative h-3.5 w-6 rounded-full bg-neutral-300 dark:bg-neutral-600">
        <span className="absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-white" />
      </span>
    </button>
  )
}

const OfflineDatabaseSwitch = dynamic(() => import('./offline-database-switch').then((m) => m.OfflineDatabaseSwitch), { ssr: false, loading: PendingRow })

export function OfflineDatabaseButton({ workspaceId, databaseId, userId }: { workspaceId: string; databaseId: string; userId: string }) {
  const [open, setOpen] = useState(false)
  // 한 번 열면 남는다 — 렌더 중에 고친다(`offline-toggle.tsx` 와 같다)
  const [wanted, setWanted] = useState(false)
  if (open && !wanted) setWanted(true)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="db-offline-button"
        className={TOPBAR_BUTTON}
      >
        오프라인
      </button>
      <div
        role="dialog"
        aria-label="오프라인으로 쓰기"
        data-testid="db-offline-panel"
        hidden={!open}
        className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-1.5 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        {wanted ? <OfflineDatabaseSwitch workspaceId={workspaceId} databaseId={databaseId} userId={userId} /> : <PendingRow />}
        <p className="whitespace-normal px-2 pb-1 pt-0.5 text-xs leading-snug text-neutral-400">
          첫 뷰의 처음 {OFFLINE_DATABASE_ROWS}행을 이 기기에 받아 둡니다 — 네트워크 없이 읽기만 합니다.
        </p>
      </div>
    </div>
  )
}
