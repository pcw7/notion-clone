'use client'

/**
 * 페이지 메뉴("···")의 "번역" 줄 (AI-4 · F-10-03)
 *
 * 첫 JS 에는 이 줄만 든다 — 언어 피커 · 확인 · 진행 토스트(`translate-page-panel.tsx`)는 처음 누를 때 지연 로드한다(페이지 화면의 첫 JS 예산 ·
 * `check:bundle`). 한 번 받으면 남는다 — 메뉴를 닫아도 진행 토스트가 이어진다.
 *
 * 고칠 수 있는 사람에게만 세운다(번역본은 그 아래의 새 하위 페이지다 — 서버가 다시 묻는다). AI 를 쓸 수 없으면 패널이 까닭을 말한다.
 */

import dynamic from 'next/dynamic'
import { useState } from 'react'

import type { AiEntry } from '@/lib/ai/usage'
import { MENU_ROW } from './page-menu'

const TranslatePanel = dynamic(() => import('./translate-page-panel').then((m) => m.TranslatePanel), { ssr: false })

export function TranslatePageButton({ workspaceId, pageId, ai }: { workspaceId: string; pageId: string; ai: AiEntry }) {
  // 누른 횟수 — 패널이 바뀔 때마다 언어 피커를 다시 연다
  const [opens, setOpens] = useState(0)
  return (
    <>
      <button type="button" data-testid="page-translate" className={MENU_ROW} onClick={() => setOpens((n) => n + 1)}>
        번역
      </button>
      {opens > 0 && <TranslatePanel workspaceId={workspaceId} pageId={pageId} ai={ai} opens={opens} />}
    </>
  )
}
