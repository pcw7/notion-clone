'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AcceptInviteButton({ token }: { token: string }) {
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
        setError(
          data.error === 'already_member'
            ? '이미 이 워크스페이스의 멤버입니다.'
            : data.error === 'email_mismatch'
              ? '이 초대는 다른 이메일 앞으로 왔습니다.'
              : data.error === 'seat_limit'
                ? '워크스페이스의 좌석이 가득 찼습니다.'
                : '초대가 유효하지 않습니다.',
        )
        return
      }

      router.push(`/w/${data.workspaceId}`)
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
        {busy ? '참여하는 중…' : '워크스페이스 참여'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
