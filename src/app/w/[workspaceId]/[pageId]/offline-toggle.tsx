'use client'

/**
 * 페이지 메뉴의 "오프라인으로 쓰기" 자리 (OF-2 · F-12-04) — 메뉴를 처음 열 때 스위치(`offline-switch.tsx`)를 지연 로드한다.
 *
 * 페이지 화면의 첫 JS 는 예산 끝에 있다(`check:bundle`) — IndexedDB 저장소 · 받기 · 받아 두기는 메뉴를 연 사람만 받는다. 그 전에는 같은 모양의
 * 줄을 그린다(메뉴 카드는 닫혀도 DOM 에 있다 — 서버가 그린 HTML 에도 이 줄이 있다 · `page-menu.tsx`). 한 번 받으면 메뉴를 닫아도 남는다 —
 * 내려받는 동안 메뉴를 닫아도 끊기지 않는다.
 *
 * 내려받을 수 없는 사람(내보내기 정책 — 소유자만)에게는 페이지가 이 부품을 세우지 않는다(`mayDownloadOffline`).
 */

import dynamic from 'next/dynamic'
import { useState } from 'react'

import { MENU_ROW, usePageMenuOpen } from './page-menu'

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

const OfflineSwitch = dynamic(() => import('./offline-switch').then((m) => m.OfflineSwitch), { ssr: false, loading: PendingRow })

export function OfflineToggle({ workspaceId, pageId, userId }: { workspaceId: string; pageId: string; userId: string }) {
  const open = usePageMenuOpen()
  // 한 번 열면 남는다 — 렌더 중에 고친다(효과 안의 setState 는 렌더를 연쇄시킨다 · React 의 "이전 값으로 상태 고치기")
  const [wanted, setWanted] = useState(false)
  if (open && !wanted) setWanted(true)
  return wanted ? <OfflineSwitch workspaceId={workspaceId} pageId={pageId} userId={userId} /> : <PendingRow />
}
