'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { roleLabel } from '@/lib/settings/registry'

type InviteRole = 'member' | 'membership_admin' | 'owner'

/**
 * 워크스페이스 초대 폼. `roles` 는 이 사람이 고를 수 있는 역할이다 — 서버가 `invitableRoles` 로 정해 넘긴다(관리 역할로 들이는 것은
 * owner 만 · 정본 §3.3 [보강] 멤버 내보내기 ① ⑧). 서버의 초대 명령이 같은 규칙으로 다시 묻는다.
 */
export function InviteForm({ workspaceId, roles }: { workspaceId: string; roles: readonly InviteRole[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>(roles[0] ?? 'member')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [devLink, setDevLink] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    setDevLink(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMessage(
          data.error === 'already_member'
            ? '이미 이 워크스페이스의 멤버입니다.'
            : data.error === 'forbidden'
              ? '초대 권한이 없습니다.'
              : '초대하지 못했습니다.',
        )
        return
      }

      setMessage(`${email} 에게 초대를 보냈습니다.`)
      setEmail('')
      // 개발 환경에서만 내려온다. 메일함 없이 수락 흐름을 확인할 수 있게.
      if (data.devLink) setDevLink(data.devLink)
      router.refresh()
    } catch {
      setMessage('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} data-testid="invite-form" className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="초대할 이메일"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
        />
        <select
          value={role}
          aria-label="초대할 역할"
          onChange={(e) => setRole(e.target.value as InviteRole)}
          className="rounded-md border border-neutral-300 px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? '보내는 중…' : '초대'}
        </button>
      </div>

      {message && <p className="text-sm text-neutral-500">{message}</p>}
      {devLink && (
        <p className="break-all text-xs text-neutral-400">
          개발 모드 수락 링크: <span className="font-mono">{devLink}</span>
        </p>
      )}
    </form>
  )
}
