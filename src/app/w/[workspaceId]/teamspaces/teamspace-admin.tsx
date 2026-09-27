'use client'

/**
 * 모든 teamspace — 워크스페이스 owner 의 관리 절 (7c-10조각 · F-06-04)
 *
 * 비공개 · 보관된 것까지 이름 · 상태 · owner 수를 보여 주고, **소유자로 들어가기**를 준다. owner 가 한 명도 없는 teamspace
 * (고아)는 경고로 그린다 — 이 절이 있는 까닭이 그것을 되살리는 것이다. 콘텐츠는 보여 주지 않는다: 보려면 들어간다(들어가면
 * 멤버 목록에 이름이 선다).
 *
 * 들어가면 사이드바가 바뀌어야 하므로 `router.refresh()` 를 부르고, 이 절의 목록도 `?scope=all` 로 다시 읽는다. 보관된
 * teamspace 에 들어가면 같은 화면의 "보관된 teamspace" 절에 서고, 거기서 되살린다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { teamspaceFailureMessage, teamspaceVisibilityLabel, type TeamspaceVisibilityName } from '../teamspace-messages'

export type AdminRow = {
  readonly id: string
  readonly name: string
  readonly visibility: TeamspaceVisibilityName
  readonly isDefault: boolean
  readonly archivedAt: string | null
  readonly ownerCount: number
  readonly role: 'owner' | 'member' | null
}

export function TeamspaceAdmin({ workspaceId, initialRows }: { workspaceId: string; initialRows: AdminRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/workspaces/${workspaceId}/teamspaces`

  async function claim(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/${id}/claim`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      const read = await fetch(`${base}?scope=all`)
      if (read.ok) setRows(((await read.json()) as { teamspaces: AdminRow[] }).teamspaces)
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) return null

  return (
    <section data-testid="teamspace-admin" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-neutral-500">모든 teamspace — 워크스페이스 소유자</h2>
      <p className="text-xs text-neutral-500">
        비공개 · 보관된 것까지 보입니다. 내용은 소유자로 들어가야 보이고, 들어가면 멤버 목록에 이름이 섭니다. 소유자가 없는
        teamspace 는 여기서 되살립니다.
      </p>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="teamspace-admin-row"
            data-teamspace-id={row.id}
            data-orphan={row.ownerCount === 0 ? 'true' : 'false'}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <span className="flex-none rounded border border-neutral-300 px-1 text-xs text-neutral-500 dark:border-neutral-700">
                  {teamspaceVisibilityLabel(row.visibility)}
                </span>
                {row.isDefault && (
                  <span data-testid="teamspace-admin-default" className="flex-none text-xs text-neutral-500">
                    기본
                  </span>
                )}
                {row.archivedAt !== null && <span className="flex-none text-xs text-neutral-500">보관됨</span>}
              </span>
              {row.ownerCount === 0 ? (
                <span data-testid="teamspace-admin-orphan" className="mt-0.5 block text-xs text-red-600">
                  소유자가 없습니다 — 아무도 설정을 고칠 수 없습니다
                </span>
              ) : (
                <span className="mt-0.5 block text-xs text-neutral-500">소유자 {row.ownerCount}명</span>
              )}
            </span>
            <span className="flex-none">
              {row.role === 'owner' ? (
                <span data-testid="teamspace-admin-owned" className="text-xs text-neutral-500">
                  소유자
                </span>
              ) : (
                <button
                  type="button"
                  data-testid="teamspace-claim"
                  disabled={busy}
                  onClick={() => void claim(row.id)}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                >
                  소유자로 들어가기
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" data-testid="teamspace-admin-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
