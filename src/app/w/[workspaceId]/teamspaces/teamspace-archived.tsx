'use client'

/**
 * 보관된 teamspace — 되살리기 (7c-6조각 · F-06-04)
 *
 * **내가 owner 인 보관된 teamspace 만** 온다(`listArchivedTeamspaces`). 되살릴 수 있는 사람만 그 존재를 보는 것이 보관의
 * 뜻이다 — 이름만 보이고 콘텐츠는 없다.
 *
 * 되살리면 사이드바에 다시 서야 하므로 `router.refresh()` 를 부르고, 이 절에서도 그 줄을 지운다 — 목록을 다시 읽는 대신
 * 지우는 까닭은 되살린 것이 이 목록의 조건(보관됨)을 더 이상 만족하지 않아서다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { archivedAtLabel, teamspaceFailureMessage, teamspaceVisibilityLabel, type TeamspaceVisibilityName } from '../teamspace-messages'

export type ArchivedRow = {
  readonly id: string
  readonly name: string
  readonly visibility: TeamspaceVisibilityName
  readonly archivedAt: string
}

export function TeamspaceArchived({ workspaceId, initialRows }: { workspaceId: string; initialRows: ArchivedRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restore(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/teamspaces/${id}/restore`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      setRows((was) => was.filter((r) => r.id !== id))
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-neutral-500">보관된 teamspace</h2>
      <p className="text-xs text-neutral-500">
        내가 소유자인 것만 보입니다. 되살리면 멤버와 페이지가 그대로 돌아옵니다.
      </p>
      <ul
        data-testid="teamspace-archived-list"
        className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
      >
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="teamspace-archived-row"
            data-teamspace-id={row.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <span className="flex-none rounded border border-neutral-300 px-1 text-xs text-neutral-500 dark:border-neutral-700">
                  {teamspaceVisibilityLabel(row.visibility)}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-neutral-500">{archivedAtLabel(row.archivedAt)}</span>
            </span>
            <button
              type="button"
              data-testid="teamspace-restore"
              disabled={busy}
              onClick={() => void restore(row.id)}
              className="flex-none rounded-md border border-neutral-300 px-3 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
            >
              되살리기
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" data-testid="teamspace-archived-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
