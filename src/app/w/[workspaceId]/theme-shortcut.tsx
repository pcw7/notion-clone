'use client'

/**
 * 테마 단축키 — Ctrl/Cmd + Shift + L 이 밝게 ↔ 어둡게를 바꾼다 (잔여 묶음 8h · F-12-03)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강] 설정 값 표 · 테마 ④ — 지금 보이는 것의 반대(`system` 이면 OS 가 고른 것의 반대 ·
 * `toggledTheme`). 설정 화면의 테마와 **같은 설정**(`account.theme`)을 같은 라우트로 쓴다.
 *
 * 먼저 칠하고(`<html data-theme>`) 저장한다 — 거부되거나 끊기면 되돌린다. 저장되면 서버가 다시 그린다(루트 레이아웃이 같은 값을 싣고,
 * 설정 화면의 고르개가 따라온다). 한글 조합 중의 키는 건드리지 않는다. 그리는 것이 없다.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { isTheme, toggledTheme } from '@/lib/settings/registry'

export function ThemeShortcut({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing || e.key.toLowerCase() !== 'l') return
      e.preventDefault()
      const root = document.documentElement
      const before = isTheme(root.dataset.theme) ? root.dataset.theme : 'system'
      const next = toggledTheme(before, window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = next
      fetch(`/api/workspaces/${workspaceId}/settings/account.theme`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: next }),
      })
        .then((res) => {
          if (res.ok) router.refresh()
          else root.dataset.theme = before
        })
        .catch(() => {
          root.dataset.theme = before
        })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaceId, router])

  return null
}
