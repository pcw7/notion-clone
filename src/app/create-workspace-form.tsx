'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CreateWorkspaceForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'invalid_name' ? '이름을 확인해주세요.' : '만들지 못했습니다.')
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
    <form onSubmit={submit} className="mt-4 flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="워크스페이스 이름"
        maxLength={100}
        required
        className="flex-1 rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
      />
      <button
        type="submit"
        disabled={busy || name.trim().length === 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? '만드는 중…' : '만들기'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
