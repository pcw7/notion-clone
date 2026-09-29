'use client'

/**
 * 잠금 버튼 — 페이지(7f-1) · 데이터베이스(7f-2) (F-06-16)
 *
 * 잠겼으면 누구에게나 "잠김"이 보이고, 잠금이 막는 것을 고칠 수 있는 사람(`canToggle`)에게는 잠그기 · 풀기 버튼이 있다. 판정은
 * 서버가 한다(`lib/permissions/lock.ts`).
 *
 * **페이지는 풀면 다시 연다**(`reloadOnUnlock`). 잠기는 순간 서버가 열린 편집 연결을 읽기 전용으로 다시 열고(0034 의 협업 신호),
 * 협업 연결은 권한이 늘어도 올라가지 않는다(`collab-server.ts` 머리말 — 다시 열면 편집이다). 그래서 푼 사람의 편집기가 곧바로 고칠
 * 수 있으려면 새로 붙어야 한다. 데이터베이스의 구조는 협업 연결이 아니라 요청으로 고치므로 서버 렌더만 다시 받는다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function LockButton({
  lockUrl,
  locked,
  canToggle,
  reloadOnUnlock,
  hint,
}: {
  /** `PUT` 이 잠그고 `DELETE` 가 푼다 — `…/pages/{id}/lock` · `…/databases/{id}/lock`. */
  lockUrl: string
  locked: boolean
  canToggle: boolean
  /** 풀면 화면을 다시 연다 — 협업 편집기가 있는 페이지(머리말). */
  reloadOnUnlock: boolean
  /** "잠김"에 걸어 두는 설명 — 무엇이 막히는가. */
  hint: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(lockUrl, { method: locked ? 'DELETE' : 'PUT' })
      if (!res.ok) {
        setError(locked ? '잠금을 풀지 못했습니다.' : '잠그지 못했습니다.')
        return
      }
      if (locked && reloadOnUnlock) window.location.reload()
      else router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (!canToggle && !locked) return null
  return (
    <span className="flex flex-none items-center gap-1">
      {locked && (
        <span data-testid="page-locked" className="text-xs text-neutral-500" title={hint}>
          🔒 잠김
        </span>
      )}
      {canToggle && (
        <button
          type="button"
          data-testid="page-lock-toggle"
          aria-pressed={locked}
          disabled={busy}
          onClick={() => void toggle()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {locked ? '잠금 풀기' : '잠그기'}
        </button>
      )}
      {error !== null && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  )
}
