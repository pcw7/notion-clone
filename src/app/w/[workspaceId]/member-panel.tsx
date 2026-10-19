'use client'

/**
 * 멤버 — 목록 · 역할 바꾸기 · 내보내기 (멤버 관리 10o-2 · F-06-02)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 ⑧
 *
 * 설정의 사람 절이다. 누구에게나 목록을 그리고(역할은 이름으로), **다룰 수 있는 줄에만** 역할 고르개와 "내보내기" 를 세운다 — 판정은
 * 명령과 같은 순수 함수(`member-rules.ts` `assignableRoles` · `mayManage`)다. 게스트 · 초대만 받은 · 멈춘 사람의 줄에는 서지 않는다
 * (게스트는 게스트 절). 자기 줄에는 내보내기가 없다(나가기는 다른 길이다).
 *
 * 고르개는 고르는 순간 바꾼다 — 거부되면 원래 역할로 돌아가고 이유를 말한다. **내보내기는 두 번 누른다**(게스트 빼기와 같은 규칙) —
 * 누르기 전에 그 자리에서 M1 을 말한다. 끝나면 서버 렌더를 다시 받는다(목록 · 사이드바가 함께 바뀐다).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { roleLabel } from '@/lib/settings/registry'
import { assignableRoles, mayManage } from '@/lib/workspace/member-rules'
import {
  REMOVE_MEMBER_NOTICE,
  memberManageFailureMessage,
  memberRoleText,
  removedMemberNotice,
  roleChangedNotice,
  type MemberView,
} from './member-messages'

const SMALL = 'rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-neutral-700'

export function MemberPanel({
  workspaceId,
  viewerId,
  viewerRole,
  members,
}: {
  workspaceId: string
  viewerId: string
  viewerRole: string
  members: MemberView[]
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<string | null>(null)
  // 고른 역할 — 서버 렌더가 새 값을 줄 때까지 고르개가 옛 값으로 튀지 않게 붙든다. 거부되면 버린다(원래 역할로 돌아간다)
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/workspaces/${workspaceId}/members`
  const forget = (userId: string) =>
    setChosen((now) => Object.fromEntries(Object.entries(now).filter(([id]) => id !== userId)))

  async function send(member: MemberView, request: { method: 'PATCH' | 'DELETE'; role?: string }): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`${base}/${member.userId}`, {
        method: request.method,
        ...(request.role === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: request.role }) }),
      })
      // 거부면 `teamspaces` 는 이름 목록(teamspace 의 마지막 owner), 역할 바꾸기의 성공이면 들어간 기본 팀스페이스 수다
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; teamspaces?: unknown; to?: unknown }
      if (!res.ok) {
        setError(memberManageFailureMessage(data.error, Array.isArray(data.teamspaces) ? data.teamspaces.map(String) : undefined))
        forget(member.userId)
      } else if (request.method === 'DELETE') {
        setNotice(removedMemberNotice(member.name))
      } else {
        const to = typeof data.to === 'string' ? data.to : (request.role ?? member.role)
        setNotice(roleChangedNotice(member.name, to, typeof data.teamspaces === 'number' ? data.teamspaces : 0))
      }
      router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
      forget(member.userId)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {members.map((m) => {
          const active = m.status === 'active'
          const choices = active ? assignableRoles(viewerRole, m.role) : []
          const removable = active && m.userId !== viewerId && m.role !== 'guest' && mayManage(viewerRole, m.role)
          const asking = confirming === m.userId
          return (
            <li key={m.userId} data-testid="member-row" data-user-id={m.userId} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-neutral-500">{m.email}</span>
                </span>
                <span className="flex flex-none items-center gap-2">
                  {choices.length > 0 ? (
                    // 고르는 순간 바꾼다 — 거부되면 고른 값을 버려 서버의 역할(`m.role`)로 돌아간다
                    <select
                      aria-label={`${m.name} 님의 역할`}
                      data-testid="member-role-select"
                      value={chosen[m.userId] ?? m.role}
                      disabled={busy}
                      onChange={(event) => {
                        const role = event.target.value
                        setChosen((now) => ({ ...now, [m.userId]: role }))
                        void send(m, { method: 'PATCH', role })
                      }}
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    >
                      {choices.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span data-testid="member-role" className="text-xs text-neutral-500">
                      {memberRoleText(m)}
                    </span>
                  )}
                  {removable && !asking && (
                    <button type="button" data-testid="member-remove" disabled={busy} onClick={() => setConfirming(m.userId)} className={SMALL}>
                      내보내기
                    </button>
                  )}
                </span>
              </span>
              {asking && (
                <span className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">{REMOVE_MEMBER_NOTICE}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      data-testid="member-remove-confirm"
                      disabled={busy}
                      onClick={() => void send(m, { method: 'DELETE' })}
                      className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 disabled:opacity-40 dark:border-red-800"
                    >
                      정말 내보내기
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
      {notice && (
        <p data-testid="member-notice" className="text-xs text-neutral-500">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="member-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
