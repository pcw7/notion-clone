'use client'

/**
 * 워크스페이스 스위처의 메뉴(BD-2 — `workspace-switcher.tsx` 에서 떼어 냈다). 이름을 누른 뒤에야 받는다 — 무엇을 그리는지는 그 파일의 머리말.
 */

import { useState, type FormEvent } from 'react'
import Link from '@/app/link'
import { useRouter } from 'next/navigation'

import { useLogoutGuard, type LogoutGuardTarget } from '@/app/logout-guard'
import { addAccountHref } from '@/lib/auth/account-set'
import { roleLabel } from '@/lib/settings/registry'
import { shortcutHint } from '@/lib/workspace/switcher'

import { accountStateLabel, switchFailureMessage } from './switcher-messages'
import type { SwitcherOtherAccount, SwitcherWorkspace } from './workspace-switcher'

const ITEM = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800'
const HEAD = 'truncate px-2 py-1 text-xs text-neutral-400'

export function WorkspaceSwitcherMenu({
  workspaceId,
  email,
  userId,
  collabUrl,
  workspaces,
  otherAccounts,
  onClose,
}: {
  workspaceId: string
  email: string
  userId: string | null
  collabUrl: string | null
  workspaces: readonly SwitcherWorkspace[]
  otherAccounts: readonly SwitcherOtherAccount[]
  onClose: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logout = useLogoutGuard()
  const flushAs = userId !== null && collabUrl !== null ? { userId, collabUrl } : null

  /** 폼으로 보내는 로그아웃 — 지우고(남으면 묻고) 그 폼을 그대로 보낸다. */
  const guardedSubmit = (users: LogoutGuardTarget['users']) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    logout.guard({ users, flushAs }, () => form.submit())
  }

  /** 다른 계정으로 바꾸고 그리로 — 쿠키가 바뀌므로 문서째 옮긴다(앞 계정의 화면 상태를 남기지 않는다). */
  const switchTo = async (userId: string, destination: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/switch-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = (await res.json().catch(() => null)) as { mfaRequired?: unknown; error?: unknown } | null
      if (!res.ok) {
        setError(switchFailureMessage(data?.error))
        router.refresh()
        return
      }
      window.location.assign(data?.mfaRequired === true ? '/login?mfa=1' : destination)
    } catch {
      setError(switchFailureMessage(null))
    } finally {
      setBusy(false)
    }
  }

  /** 다른 계정 하나만 로그아웃 — 지금 계정은 그대로라 목록만 다시 그린다. */
  const signOutOther = async (userId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ userId }),
      }).then((r) => r.text())
      router.refresh()
    } catch {
      setError('로그아웃하지 못했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="menu"
      aria-label="워크스페이스"
      aria-busy={busy}
      data-testid="workspace-switcher-menu"
      className="absolute left-0 top-full z-30 mt-1 flex max-h-[70vh] w-64 flex-col gap-0.5 overflow-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
    >
      <p data-testid="switcher-email" className={HEAD}>
        {email}
      </p>
      {workspaces.map((w, i) => {
        const current = w.workspaceId === workspaceId
        const hint = shortcutHint(i)
        return (
          <Link
            key={w.workspaceId}
            role="menuitem"
            href={`/w/${w.workspaceId}`}
            data-testid="switcher-workspace"
            data-workspace-id={w.workspaceId}
            aria-current={current ? 'true' : undefined}
            title={hint ?? undefined}
            onClick={onClose}
            className={`${ITEM} ${current ? 'font-medium' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate">{w.name || '워크스페이스'}</span>
            <span className="text-xs text-neutral-400">{roleLabel(w.role)}</span>
            <span aria-hidden className="w-3 text-xs">
              {current ? '✓' : ''}
            </span>
            {hint !== null && (
              <kbd aria-hidden className="w-6 text-right font-sans text-[10px] text-neutral-400">
                ⇧{i + 1}
              </kbd>
            )}
          </Link>
        )
      })}

      {otherAccounts.map((account) => {
        const label = accountStateLabel(account.state)
        return (
          <section
            key={account.userId}
            data-testid="switcher-account"
            data-user-id={account.userId}
            data-state={account.state}
            aria-label={account.email}
            className="mt-1 flex flex-col gap-0.5 border-t border-neutral-200 pt-1 dark:border-neutral-800"
          >
            <div className="flex items-center gap-1">
              <p className={`${HEAD} min-w-0 flex-1`}>
                {account.email}
                {label !== null && <span className="ml-1 text-amber-600 dark:text-amber-400">· {label}</span>}
              </p>
              <button
                type="button"
                role="menuitem"
                data-testid="switcher-account-logout"
                title={`${account.email} 에서 로그아웃`}
                disabled={busy || logout.checking}
                // 다른 계정의 남은 편집은 보내지 않는다(이 탭의 세션이 그 사람의 것이 아니다) — 남았으면 묻는다
                onClick={() => logout.guard({ users: [account.userId], flushAs: null }, () => void signOutOther(account.userId))}
                className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                로그아웃
              </button>
            </div>
            {account.state === 'signed_in' &&
              account.workspaces.map((w) => (
                <button
                  key={w.workspaceId}
                  type="button"
                  role="menuitem"
                  data-testid="switcher-account-workspace"
                  data-workspace-id={w.workspaceId}
                  disabled={busy}
                  onClick={() => void switchTo(account.userId, `/w/${w.workspaceId}`)}
                  className={`${ITEM} disabled:opacity-40`}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name || '워크스페이스'}</span>
                  <span className="text-xs text-neutral-400">{roleLabel(w.role)}</span>
                </button>
              ))}
            {account.state === 'signed_in' && account.workspaces.length === 0 && (
              <button
                type="button"
                role="menuitem"
                data-testid="switcher-account-home"
                disabled={busy}
                onClick={() => void switchTo(account.userId, '/')}
                className={`${ITEM} text-neutral-500 disabled:opacity-40`}
              >
                이 계정으로 바꾸기
              </button>
            )}
            {account.state === 'mfa_required' && (
              <button
                type="button"
                role="menuitem"
                data-testid="switcher-account-mfa"
                disabled={busy}
                onClick={() => void switchTo(account.userId, '/login?mfa=1')}
                className={`${ITEM} text-neutral-500 disabled:opacity-40`}
              >
                2단계 인증하고 바꾸기
              </button>
            )}
            {account.state === 'signed_out' && (
              <Link
                role="menuitem"
                href={addAccountHref({ email: account.email })}
                data-testid="switcher-account-relogin"
                onClick={onClose}
                className={`${ITEM} text-neutral-500`}
              >
                다시 로그인
              </Link>
            )}
          </section>
        )
      })}

      <hr className="my-1 border-neutral-200 dark:border-neutral-800" />
      {error !== null && (
        <p role="alert" data-testid="switcher-error" className="px-2 py-1 text-xs text-red-600">
          {error}
        </p>
      )}
      <Link role="menuitem" href="/" data-testid="switcher-all" onClick={onClose} className={`${ITEM} text-neutral-500`}>
        모든 워크스페이스 · 새로 만들기
      </Link>
      <Link
        role="menuitem"
        href={addAccountHref()}
        data-testid="switcher-add-account"
        onClick={onClose}
        className={`${ITEM} text-neutral-500`}
      >
        다른 계정 더하기
      </Link>
      <form action="/api/auth/logout" method="post" onSubmit={guardedSubmit(userId === null ? [] : [userId])}>
        <button type="submit" role="menuitem" data-testid="switcher-logout" disabled={logout.checking} className={`${ITEM} text-neutral-500 disabled:opacity-40`}>
          {otherAccounts.length > 0 ? `${email} 에서 로그아웃` : '로그아웃'}
        </button>
      </form>
      {otherAccounts.length > 0 && (
        <form action="/api/auth/logout" method="post" onSubmit={guardedSubmit([...(userId === null ? [] : [userId]), ...otherAccounts.map((a) => a.userId)])}>
          <input type="hidden" name="scope" value="all" />
          <button type="submit" role="menuitem" data-testid="switcher-logout-all" disabled={logout.checking} className={`${ITEM} text-neutral-500 disabled:opacity-40`}>
            모든 계정에서 로그아웃
          </button>
        </form>
      )}
      {logout.prompt}
    </div>
  )
}
