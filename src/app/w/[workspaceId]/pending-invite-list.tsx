'use client'

/**
 * 대기 중인 초대 — 홈의 "멤버 초대" 절 아래 목록과 취소 (7g-3 · F-14-10)
 *
 * owner · membership_admin 에게만 온다(홈이 `canInvite` 로 가른다 — 판정은 취소 라우트가 다시 한다). 멤버 초대와 게스트의 대기
 * 초대(7g-1)가 한 목록이다. **취소는 한 번에 한다** — 되돌릴 수 없지만 다시 초대하면 되고, 받는 사람의 무엇도 걷지 않는다(게스트
 * 빼기 · 그룹 지우기처럼 두 번 묻는 것들과 다르다). 취소하면 그 줄을 곧바로 빼고 서버 렌더를 다시 받는다.
 *
 * 이미 받아들였거나 다른 사람이 먼저 취소했으면(404) 그 줄도 뺀다 — 목록이 낡았다는 뜻이다.
 *
 * 목록은 **props 가 정본**이고 여기는 뺀 id 만 든다 — 목록을 상태로 복사하면 "초대" 폼이 보낸 새 초대가 서버 렌더로 와도 이
 * 목록에 서지 않는다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { inviteRoleLabel, revokeFailureMessage, revokedNotice } from './pending-invite-messages'

export type PendingInviteView = {
  readonly inviteId: string
  readonly email: string
  readonly role: string
}

export function PendingInviteList({
  workspaceId,
  initialInvites,
}: {
  workspaceId: string
  initialInvites: PendingInviteView[]
}) {
  const router = useRouter()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const invites = initialInvites.filter((i) => !removed.has(i.inviteId))
  const drop = (inviteId: string) => setRemoved((prev) => new Set(prev).add(inviteId))
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function revoke(invite: PendingInviteView): Promise<void> {
    setBusy(invite.inviteId)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${invite.inviteId}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; email?: unknown }
      if (res.ok) {
        drop(invite.inviteId)
        setNotice(revokedNotice(typeof data.email === 'string' ? data.email : invite.email))
        router.refresh()
        return
      }
      if (data.error === 'not_found') drop(invite.inviteId)
      setError(revokeFailureMessage(data.error))
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="pending-invites">
      {invites.length > 0 && (
        <>
          <h3 className="mt-6 text-xs font-medium text-neutral-500">대기 중인 초대 {invites.length}건</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {invites.map((i) => (
              <li
                key={i.inviteId}
                data-testid="pending-invite-row"
                data-invite-id={i.inviteId}
                className="flex items-center justify-between gap-2 text-neutral-500"
              >
                <span className="min-w-0 truncate">
                  {i.email} — {inviteRoleLabel(i.role)}
                </span>
                <button
                  type="button"
                  data-testid="pending-invite-revoke"
                  disabled={busy !== null}
                  onClick={() => void revoke(i)}
                  className="flex-none rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700"
                >
                  {busy === i.inviteId ? '취소하는 중…' : '취소'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {notice !== null && (
        <p role="status" data-testid="pending-invite-notice" className="mt-2 text-xs text-neutral-500">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
