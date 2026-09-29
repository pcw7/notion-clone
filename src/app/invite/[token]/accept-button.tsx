'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { acceptDestination, acceptFailureMessage, acceptLabel } from './invite-messages'

export function AcceptInviteButton({ token, role }: { token: string; role: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(acceptFailureMessage(data.error))
        return
      }

      // 게스트 초대(7g-1)는 받은 페이지로 — 워크스페이스 홈에는 그 사람이 볼 것이 거의 없다.
      router.push(acceptDestination(data))
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="rounded-md bg-neutral-900 px-4 py-2.5 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {acceptLabel(role, busy)}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
