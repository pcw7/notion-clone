'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 풀페이지 데이터베이스를 만들고 바로 연다 — `NewPageButton` 의 짝(F-04-14 · 7c-4).
 *
 * 이름을 먼저 묻지 않는다 — 사이드바의 "+ 새 데이터베이스"와 같은 규칙이다. 자리는 teamspace 의 최상위(`teamspaceId`) 또는
 * 워크스페이스 최상위(없음)다.
 */
export function NewDatabaseButton({
  workspaceId,
  teamspaceId = null,
}: {
  workspaceId: string
  teamspaceId?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/databases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(teamspaceId === null ? {} : { teamspaceId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error === 'not_found' ? '여기에 데이터베이스를 둘 수 없습니다.' : '만들지 못했습니다.')
        return
      }
      startTransition(() => {
        router.push(`/w/${workspaceId}/db/${data.database.id}`)
        router.refresh()
      })
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={create}
        disabled={busy || pending}
        data-testid="new-database"
        className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {busy || pending ? '만드는 중…' : '+ 새 데이터베이스'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
