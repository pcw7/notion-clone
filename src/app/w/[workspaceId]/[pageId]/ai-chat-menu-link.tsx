'use client'

/**
 * 페이지 메뉴("···")의 "AI 와 이 페이지 대화" 줄 (AI-6 · F-10-17)
 *
 * 링크 하나뿐이다 — 채팅은 따로인 화면(`/w/{id}/ai?page=<id>` — 범위를 이 페이지로)이라 페이지 화면의 첫 JS 에 채팅이 들지 않는다.
 */

import Link from '@/app/link'
import { MENU_ROW } from './page-menu'

export function AiChatMenuLink({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  return (
    <Link href={`/w/${workspaceId}/ai?page=${pageId}`} data-testid="page-ai-chat" className={MENU_ROW}>
      AI 와 이 페이지 대화
    </Link>
  )
}
