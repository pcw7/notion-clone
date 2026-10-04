'use client'

/**
 * 워크스페이스 스위처 — 사이드바 머리의 이름을 누르면 열린다 (잔여 묶음 8j-1 · F-14-09 · F-02-17)
 *
 * 정본: 14-auth-accounts.md F-14-09 *"좌상단 워크스페이스 스위처 클릭 → 로그인된 계정들과 각 계정의 워크스페이스 목록이 함께 보인다"* —
 *       계정이 여럿인 것(다중 계정)은 다음 조각이다. 지금은 이 계정 하나와 그 워크스페이스들.
 *
 *   · 목록은 서버가 준다(`switcherOf` — 만든 순서 · 역할). **권한의 근거가 아니다** — 고르면 그 워크스페이스의 게이트를 다시 거친다
 *   · 지금 있는 곳에 ✓ · 아홉째까지 단축키를 적는다(단축키 자체는 `workspace-shortcut.tsx` — 사이드바를 접어도 돈다)
 *   · 밖을 누르거나 Esc 면 닫힌다(Esc 는 이름 버튼으로 초점을 돌린다) · 고르면 닫힌다
 *   · 아래에 모든 워크스페이스(처음 화면 — 새로 만들기도 거기) · 로그아웃
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import { roleLabel } from '@/lib/settings/registry'
import { shortcutHint } from '@/lib/workspace/switcher'

export type SwitcherWorkspace = { readonly workspaceId: string; readonly name: string; readonly role: string }

const ITEM = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800'

export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
  email,
  workspaces,
}: {
  workspaceId: string
  workspaceName: string
  email: string
  workspaces: readonly SwitcherWorkspace[]
}) {
  const [open, setOpen] = useState(false)
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
          data-testid="workspace-switcher-menu"
          className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col gap-0.5 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          <p data-testid="switcher-email" className="truncate px-2 py-1 text-xs text-neutral-400">
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
          <hr className="my-1 border-neutral-200 dark:border-neutral-800" />
          <Link role="menuitem" href="/" data-testid="switcher-all" onClick={() => setOpen(false)} className={`${ITEM} text-neutral-500`}>
            모든 워크스페이스 · 새로 만들기
          </Link>
          <form action="/api/auth/logout" method="post">
            <button type="submit" role="menuitem" data-testid="switcher-logout" className={`${ITEM} text-neutral-500`}>
              로그아웃
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
