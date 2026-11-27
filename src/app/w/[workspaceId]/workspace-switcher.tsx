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
 *   · **로그아웃은 그 사람의 오프라인 사본 · 남은 편집을 먼저 지운다**(OF-3 · `app/logout-guard.tsx`) — 지금 계정의 남은 편집은 보내 보고,
 *     그래도 남으면 메뉴 안에서 "보내지 못한 편집이 사라집니다"로 묻는다
 *   · 밖을 누르거나 Esc 면 닫힌다(Esc 는 이름 버튼으로 초점을 돌린다) · 고르면 닫힌다
 *
 * 이 파일은 이름 단추와 여닫기만 한다 — 메뉴(목록 · 계정 바꾸기 · 로그아웃)는 `workspace-switcher-menu.tsx` 로, 누른 뒤에야 받는다(BD-2).
 * 단추에 올리거나 포커스하면 미리 받는다.
 */

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AccountState } from '@/lib/auth/accounts'

export type SwitcherWorkspace = { readonly workspaceId: string; readonly name: string; readonly role: string }
export type SwitcherOtherAccount = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly state: AccountState
  readonly workspaces: readonly SwitcherWorkspace[]
}

const WorkspaceSwitcherMenu = dynamic(() => import('./workspace-switcher-menu').then((m) => m.WorkspaceSwitcherMenu))
const prefetchMenu = (): void => {
  void import('./workspace-switcher-menu').catch(() => undefined)
}

export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
  email,
  userId = null,
  collabUrl = null,
  workspaces,
  otherAccounts = [],
}: {
  workspaceId: string
  workspaceName: string
  email: string
  /** 지금 계정(OF-3 — 로그아웃할 때 이 사람의 오프라인 사본 · 남은 편집을 지운다). 모르면 지우지 않는다. */
  userId?: string | null
  /** 남은 편집을 먼저 보내 볼 협업 서버 주소(OF-3). */
  collabUrl?: string | null
  workspaces: readonly SwitcherWorkspace[]
  /** 이 브라우저에 함께 로그인한 다른 계정들(8j-3) — 서버가 쿠키에서 읽어 준다. 토큰은 없다. */
  otherAccounts?: readonly SwitcherOtherAccount[]
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

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
        onPointerEnter={prefetchMenu}
        onFocus={prefetchMenu}
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
        <WorkspaceSwitcherMenu
          workspaceId={workspaceId}
          email={email}
          userId={userId}
          collabUrl={collabUrl}
          workspaces={workspaces}
          otherAccounts={otherAccounts}
          onClose={close}
        />
      )}
    </div>
  )
}
