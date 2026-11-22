'use client'

/**
 * AI 단축키 — Ctrl/Cmd + Shift + J 가 AI 채팅 화면으로 간다 (AI-6 · F-10-17 *"단축키 `Shift + Cmd + J` / `Shift + Ctrl + J`"*)
 *
 * 앱 안에서 이 조합은 비어 있다(편집기의 Ctrl/Cmd + J 는 Shift 없이 — 고치기 AI-3). 브라우저의 같은 조합(Chrome 의 콘솔 열기)보다 앞서 받아
 * 막는다(노션과 같다). 한글 조합 중의 키는 건드리지 않는다. 그리는 것이 없다.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function AiShortcut({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing) return
      if (e.code !== 'KeyJ' && e.key.toLowerCase() !== 'j') return
      e.preventDefault()
      router.push(`/w/${workspaceId}/ai`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaceId, router])

  return null
}
