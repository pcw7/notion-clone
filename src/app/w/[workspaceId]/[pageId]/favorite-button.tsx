'use client'

/**
 * 즐겨찾기 별 — F-07-16.
 *
 * 낙관적으로 먼저 칠한다. 별은 **되돌리기 쉬운 조작**이고(다시 누르면 끝),
 * 왕복을 기다리는 동안 아무 반응이 없으면 사용자는 한 번 더 누른다.
 * 실패하면 원래대로 되돌리고 조용히 둔다 — 여기서 빨간 배너를 띄우는 것은
 * 이 조작의 무게에 맞지 않는다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function FavoriteButton({
  workspaceId,
  pageId,
  initial,
}: {
  workspaceId: string
  pageId: string
  initial: boolean
}) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)

  const toggle = async (): Promise<void> => {
    const next = !on
    setOn(next)
    setBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pages/${pageId}/favorite`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setOn(!next)
        return
      }
      // 사이드바는 서버 렌더다.
      router.refresh()
    } catch {
      setOn(!next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      // 상태를 **이름으로도** 알린다 — 별 모양(★/☆)만으로는 스크린리더에
      // 아무것도 전달되지 않는다(F-12-12).
      aria-pressed={on}
      aria-label={on ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}
      title={on ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기'}
      // 상단 바의 아이콘 단추(디자인-2a — 28×28 · 테두리 없음) — 켜지면 별이 노랗다
      className={`inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-base hover:bg-[rgba(33,27,23,0.05)] disabled:opacity-40 dark:hover:bg-white/5 ${
        on ? 'text-amber-500' : 'text-neutral-400'
      }`}
    >
      {on ? '★' : '☆'}
    </button>
  )
}
