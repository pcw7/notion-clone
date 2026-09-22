'use client'

/**
 * teamspace 만들기 — 사이드바 Teamspaces 머리의 `+` 가 여는 한 줄 폼 (7c-2조각 · F-06-04)
 *
 * 이름만 묻는다. 보이는 범위(open · closed · private)는 둘러보기 · 참여가 없는 지금 **저장만 되고 아무것도 바꾸지 않으므로**
 * 고르게 하지 않는다 — 서버의 기본(closed)으로 만든다(§7). 만들면 그 teamspace 의 화면으로 옮겨 간다 — 첫 페이지를 만들고
 * 멤버를 넣는 자리가 거기다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { teamspaceFailureMessage } from './teamspace-messages'

export function TeamspaceCreateForm({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; teamspace?: { id: string } }
      if (!res.ok || !data.teamspace) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      onClose()
      router.push(`/w/${workspaceId}/teamspaces/${data.teamspace.id}`)
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      data-testid="teamspace-create-form"
      className="flex flex-col gap-1 px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        data-testid="teamspace-create-name"
        aria-label="새 teamspace 이름"
        placeholder="teamspace 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        maxLength={100}
        autoFocus
        className="rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          data-testid="teamspace-create"
          disabled={busy || name.trim().length === 0}
          className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          만들기
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700"
        >
          취소
        </button>
      </div>
      {error && (
        <p role="alert" data-testid="teamspace-create-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  )
}
