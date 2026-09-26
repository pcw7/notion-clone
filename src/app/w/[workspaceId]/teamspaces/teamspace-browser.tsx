'use client'

/**
 * 둘러보기 — 참여할 수 있는 teamspace 목록 (7c-5조각 · F-06-04)
 *
 * 서버가 볼 수 있는 것만 싣는다(`listBrowsableTeamspaces` — private 는 멤버가 아니면 오지 않는다). 이 파일이 하는 일은
 * 줄마다 무엇을 둘지 고르고(`teamspaceJoinAction` — 서버의 `joinTeamspace` 와 같은 규칙) 참여 요청을 보내는 것뿐이다.
 *
 * 참여하면 사이드바에 그 teamspace 가 서야 하므로 `router.refresh()` 를 부르고(레이아웃이 다시 읽는다), 목록도 이 자리에서
 * 다시 읽어 그 줄이 "멤버"로 바뀌게 한다 — 두 번 눌러도 서버가 성공을 돌려주지만, 화면이 바뀌지 않으면 눌린 줄 모른다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import {
  teamspaceFailureMessage,
  teamspaceJoinAction,
  teamspaceVisibilityHint,
  teamspaceVisibilityLabel,
  type TeamspaceRoleName,
  type TeamspaceVisibilityName,
} from '../teamspace-messages'

export type BrowseRow = {
  readonly id: string
  readonly name: string
  readonly visibility: TeamspaceVisibilityName
  readonly memberCount: number
  readonly role: TeamspaceRoleName | null
}

export function TeamspaceBrowser({ workspaceId, initialRows }: { workspaceId: string; initialRows: BrowseRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/workspaces/${workspaceId}/teamspaces`

  async function join(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/${id}/join`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (!res.ok) {
        setError(teamspaceFailureMessage(data.error))
        return
      }
      const read = await fetch(`${base}?scope=browse`)
      if (read.ok) {
        const listed = (await read.json()) as { teamspaces: BrowseRow[] }
        setRows(listed.teamspaces)
      }
      // 사이드바의 Teamspaces 섹션에 이 teamspace 가 서야 한다 — 레이아웃을 다시 받는다.
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const visible = rows.filter((row) => teamspaceJoinAction(row) !== 'hidden')

  if (visible.length === 0) {
    return (
      <p data-testid="teamspace-browse-empty" className="text-sm text-neutral-400">
        둘러볼 teamspace 가 없습니다. 비공개 teamspace 는 멤버에게만 보입니다.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul
        data-testid="teamspace-browse-list"
        className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
      >
        {visible.map((row) => {
          const action = teamspaceJoinAction(row)
          return (
            <li
              key={row.id}
              data-testid="teamspace-browse-row"
              data-teamspace-id={row.id}
              data-action={action}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  {action === 'member' ? (
                    <Link
                      href={`/w/${workspaceId}/teamspaces/${row.id}`}
                      className="truncate text-sm font-medium hover:underline underline-offset-4"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium">{row.name}</span>
                  )}
                  <span
                    data-testid="teamspace-browse-visibility"
                    className="flex-none rounded border border-neutral-300 px-1 text-xs text-neutral-500 dark:border-neutral-700"
                  >
                    {teamspaceVisibilityLabel(row.visibility)}
                  </span>
                  <span className="flex-none text-xs text-neutral-500">멤버 {row.memberCount}명</span>
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">{teamspaceVisibilityHint(row.visibility)}</span>
              </span>
              <span className="flex-none">
                {action === 'join' && (
                  <button
                    type="button"
                    data-testid="teamspace-join"
                    disabled={busy}
                    onClick={() => void join(row.id)}
                    className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    참여
                  </button>
                )}
                {action === 'needs_invite' && (
                  <span data-testid="teamspace-needs-invite" className="text-xs text-neutral-500">
                    초대가 필요합니다
                  </span>
                )}
                {action === 'member' && (
                  <span data-testid="teamspace-joined" className="text-xs text-neutral-500">
                    이미 멤버
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" data-testid="teamspace-browse-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
