'use client'

/**
 * 게스트 — 목록 · 멤버로 올리기 · 빼기 (7d-3조각 · F-06-09)
 *
 * 워크스페이스 홈의 한 절이다. **owner · membership_admin 에게만** 그린다(부모가 `canManageGuests` 로 가른다 — 서버가 다시
 * 묻는다). 줄마다 이름 · 이메일 · 받은 페이지 수. 0 개면 그렇게 말한다 — 정리할 사람을 찾는 줄이다.
 *
 * **올리기와 빼기는 두 번 누른다**(그룹 지우기 · 나가기와 같은 규칙 · §3.3-188) — 올리면 워크스페이스 전체를 보고 좌석을 쓰고,
 * 빼면 받은 공유가 모두 걷힌다. 누르기 전에 그 한 줄을 그 자리에서 말한다. 끝나면 이 절의 목록을 다시 읽고 서버 렌더도 다시
 * 받는다 — 올린 사람은 멤버 절로 옮겨 간다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  PROMOTE_NOTICE,
  REMOVE_NOTICE,
  guestManageFailureMessage,
  guestPagesLabel,
  promotedNotice,
  removedNotice,
  type GuestView,
} from './guest-messages'

const SMALL = 'rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700'

export function GuestPanel({ workspaceId, initialGuests }: { workspaceId: string; initialGuests: GuestView[] }) {
  const router = useRouter()
  const [guests, setGuests] = useState(initialGuests)
  const [confirming, setConfirming] = useState<{ userId: string; action: 'promote' | 'remove' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/workspaces/${workspaceId}/guests`

  async function act(guest: GuestView, action: 'promote' | 'remove'): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(action === 'promote' ? `${base}/${guest.userId}/promote` : `${base}/${guest.userId}`, {
        method: action === 'promote' ? 'POST' : 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; teamspaces?: number; pages?: number }
      if (!res.ok) {
        setError(guestManageFailureMessage(data.error))
      } else {
        setNotice(action === 'promote' ? promotedNotice(guest.name, data.teamspaces ?? 0) : removedNotice(guest.name, data.pages ?? 0))
      }
      const read = await fetch(base)
      if (read.ok) setGuests(((await read.json()) as { guests: GuestView[] }).guests)
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <div data-testid="guest-panel" className="mt-3 flex flex-col gap-2">
      {guests.length === 0 ? (
        <p data-testid="guest-empty" className="text-sm text-neutral-400">
          게스트가 없습니다. 페이지의 공유 패널에서 이메일로 초대하면 여기에 섭니다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {guests.map((g) => {
            const asking = confirming?.userId === g.userId ? confirming.action : null
            return (
              <li key={g.userId} data-testid="guest-row" data-user-id={g.userId} className="flex flex-col gap-1 px-4 py-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{g.name}</span>
                    <span className="block truncate text-xs text-neutral-500">{g.email}</span>
                  </span>
                  <span data-testid="guest-pages" className="flex-none text-xs text-neutral-500">
                    {guestPagesLabel(g.pages)}
                  </span>
                  {asking === null && (
                    <span className="flex flex-none gap-1">
                      <button
                        type="button"
                        data-testid="guest-promote"
                        disabled={busy}
                        onClick={() => setConfirming({ userId: g.userId, action: 'promote' })}
                        className={SMALL}
                      >
                        멤버로
                      </button>
                      <button
                        type="button"
                        data-testid="guest-remove"
                        disabled={busy}
                        onClick={() => setConfirming({ userId: g.userId, action: 'remove' })}
                        className={SMALL}
                      >
                        빼기
                      </button>
                    </span>
                  )}
                </span>
                {asking !== null && (
                  <span className="flex flex-col gap-1">
                    <span className="text-xs text-neutral-500">{asking === 'promote' ? PROMOTE_NOTICE : REMOVE_NOTICE}</span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        data-testid={asking === 'promote' ? 'guest-promote-confirm' : 'guest-remove-confirm'}
                        disabled={busy}
                        onClick={() => void act(g, asking)}
                        className={
                          asking === 'remove'
                            ? 'rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-800'
                            : SMALL
                        }
                      >
                        {asking === 'promote' ? '정말 멤버로' : '정말 빼기'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={SMALL}>
                        취소
                      </button>
                    </span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {notice && (
        <p data-testid="guest-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="guest-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
