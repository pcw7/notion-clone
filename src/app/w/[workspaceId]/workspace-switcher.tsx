'use client'

/**
 * 워크스페이스 스위처 — 사이드바 머리의 이름을 누르면 열린다 (잔여 묶음 8j-1 · 8j-3 · F-14-09 · F-02-17)
 *
 * 정본: 14-auth-accounts.md F-14-09 *"좌상단 워크스페이스 스위처 클릭 → 로그인된 계정들과 각 계정의 워크스페이스 목록이 함께 보인다 …
 *       Add another account → 다른 이메일로 로그인 → 기존 계정 로그아웃 없이 두 계정이 병존"* · 00-canonical-data-model.md §3.2 [보강] 다중 계정
 *
 *   · 목록은 서버가 준다(`switcherOf` · `withWorkspaces` — 만든 순서 · 역할). **권한의 근거가 아니다** — 고르면 그 워크스페이스의 게이트를 다시 거친다
 *   · 지금 계정 — 이메일과 워크스페이스(지금 것에 ✓ · 아홉째까지 단축키 — 단축키 자체는 `workspace-shortcut.tsx`)
 *   · **함께 로그인한 다른 계정들(8j-3)** — 계정마다 이메일 · 상태 · 그 워크스페이스. 고르면 계정을 바꾸고(`switch-account`) 그리로 간다 —
 *     쿠키가 바뀌므로 문서째 옮긴다. 2단계 인증이 남았으면 둘째 단계로 · 끝났으면 "다시 로그인"(로그인 화면의 더하기) · 계정마다 로그아웃
 *   · 아래에 모든 워크스페이스(처음 화면) · 다른 계정 더하기 · 로그아웃(지금 계정) · 모든 계정에서 로그아웃(다른 계정이 있을 때)
 *   · 밖을 누르거나 Esc 면 닫힌다(Esc 는 이름 버튼으로 초점을 돌린다) · 고르면 닫힌다
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { addAccountHref } from '@/lib/auth/account-set'
import type { AccountState } from '@/lib/auth/accounts'
import { roleLabel } from '@/lib/settings/registry'
import { shortcutHint } from '@/lib/workspace/switcher'

import { accountStateLabel, switchFailureMessage } from './switcher-messages'

export type SwitcherWorkspace = { readonly workspaceId: string; readonly name: string; readonly role: string }
export type SwitcherOtherAccount = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly state: AccountState
  readonly workspaces: readonly SwitcherWorkspace[]
}

const ITEM = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800'
const HEAD = 'truncate px-2 py-1 text-xs text-neutral-400'

export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
  email,
  workspaces,
  otherAccounts = [],
}: {
  workspaceId: string
  workspaceName: string
  email: string
  workspaces: readonly SwitcherWorkspace[]
  /** 이 브라우저에 함께 로그인한 다른 계정들(8j-3) — 서버가 쿠키에서 읽어 준다. 토큰은 없다. */
  otherAccounts?: readonly SwitcherOtherAccount[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
    <div ref={boxRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid="sidebar-workspace-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        title="워크스페이스 바꾸기"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1 rounded px-1 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span data-testid="sidebar-workspace-name" className="truncate">
          {workspaceName || '워크스페이스'}
        </span>
        <span aria-hidden className="text-xs text-neutral-400">
          ▾
        </span>
      </button>

      {open && (
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
                onClick={() => setOpen(false)}
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
                    disabled={busy}
                    onClick={() => void signOutOther(account.userId)}
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
                    onClick={() => setOpen(false)}
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
          <Link role="menuitem" href="/" data-testid="switcher-all" onClick={() => setOpen(false)} className={`${ITEM} text-neutral-500`}>
            모든 워크스페이스 · 새로 만들기
          </Link>
          <Link
            role="menuitem"
            href={addAccountHref()}
            data-testid="switcher-add-account"
            onClick={() => setOpen(false)}
            className={`${ITEM} text-neutral-500`}
          >
            다른 계정 더하기
          </Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" role="menuitem" data-testid="switcher-logout" className={`${ITEM} text-neutral-500`}>
              {otherAccounts.length > 0 ? `${email} 에서 로그아웃` : '로그아웃'}
            </button>
          </form>
          {otherAccounts.length > 0 && (
            <form action="/api/auth/logout" method="post">
              <input type="hidden" name="scope" value="all" />
              <button type="submit" role="menuitem" data-testid="switcher-logout-all" className={`${ITEM} text-neutral-500`}>
                모든 계정에서 로그아웃
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
