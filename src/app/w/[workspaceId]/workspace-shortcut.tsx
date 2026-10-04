'use client'

/**
 * 워크스페이스 단축키 — Ctrl/Cmd + Shift + 1~9 가 목록의 그 자리로 옮긴다 (잔여 묶음 8j-1 · F-14-09)
 *
 * 판정은 `lib/workspace/switcher.ts` 에 있다(자리로 읽는다 · 편집기가 쓴 키와 조합 중의 키는 건드리지 않는다). 사이드바 밖(레이아웃)에
 * 두는 이유는 테마 단축키와 같다 — 사이드바를 접어도 돈다. 그리는 것이 없다.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { shortcutTarget, workspaceShortcutIndex } from '@/lib/workspace/switcher'

export function WorkspaceShortcut({ workspaceId, workspaceIds }: { workspaceId: string; workspaceIds: readonly string[] }) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const index = workspaceShortcutIndex(e)
      if (index === null) return
      // 단축키를 썼다 — 그 자리가 비었거나 지금 있는 곳이어도 브라우저의 동작으로 새지 않게 막는다.
      e.preventDefault()
      const target = shortcutTarget(workspaceIds, workspaceId, index)
      if (target !== null) router.push(`/w/${target}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaceId, workspaceIds, router])

  return null
}
