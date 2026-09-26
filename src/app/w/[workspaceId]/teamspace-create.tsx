'use client'

/**
 * teamspace 만들기 — 사이드바 Teamspaces 머리의 `+` 가 여는 폼 (7c-2 · 7c-5조각 · F-06-04)
 *
 * 이름과 **공개 범위**를 묻는다. 7c-2 에서는 공개 범위를 고르게 하지 않았다 — 저장만 되고 아무것도 바꾸지 않았기 때문이다
 * (§3.3-193 ⑦). 7c-5 가 둘러보기와 참여를 붙여 뜻이 생겼으므로 만들 때 고른다. 기본은 **초대(closed)** 다 — 만드는 사람이
 * 아무것도 고르지 않았을 때 워크스페이스 전원이 들어올 수 있게 되는 쪽이 놀랍다.
 *
 * 만들면 그 teamspace 의 화면으로 옮겨 간다 — 첫 페이지를 만들고 멤버를 넣는 자리가 거기다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  TEAMSPACE_VISIBILITY_ORDER,
  teamspaceFailureMessage,
  teamspaceVisibilityHint,
  teamspaceVisibilityLabel,
  type TeamspaceVisibilityName,
} from './teamspace-messages'

export function TeamspaceCreateForm({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<TeamspaceVisibilityName>('closed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, visibility }),
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
      <fieldset data-testid="teamspace-create-visibility" className="flex flex-col gap-0.5">
        <legend className="sr-only">공개 범위</legend>
        {TEAMSPACE_VISIBILITY_ORDER.map((v) => (
          <label key={v} className="flex items-start gap-1 text-xs">
            <input
              type="radio"
              name="teamspace-visibility"
              value={v}
              data-testid={`teamspace-visibility-${v}`}
              checked={visibility === v}
              onChange={() => setVisibility(v)}
              className="mt-0.5 flex-none"
            />
            <span className="min-w-0">
              <span className="font-medium">{teamspaceVisibilityLabel(v)}</span>
              <span className="ml-1 text-neutral-500">{teamspaceVisibilityHint(v)}</span>
            </span>
          </label>
        ))}
      </fieldset>
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
