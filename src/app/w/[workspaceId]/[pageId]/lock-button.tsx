'use client'

/**
 * 잠금 버튼 — 페이지(7f-1) · 데이터베이스(7f-2) (F-06-16)
 *
 * 잠겼으면 누구에게나 "잠김"이 보이고, 잠금이 막는 것을 고칠 수 있는 사람(`canToggle`)에게는 잠그기 · 풀기 버튼이 있다. 판정은
 * 서버가 한다(`lib/permissions/lock.ts`).
 *
 * **페이지는 풀면 다시 연다**(`reloadOnUnlock`). 잠기는 순간 서버가 열린 편집 연결을 읽기 전용으로 다시 열고(0034 의 협업 신호),
 * 협업 연결은 권한이 늘어도 올라가지 않는다(`collab-server.ts` 머리말 — 다시 열면 편집이다). 그래서 푼 사람의 편집기가 곧바로 고칠
 * 수 있으려면 새로 붙어야 한다. 데이터베이스의 구조는 협업 연결이 아니라 요청으로 고치므로 서버 렌더만 다시 받는다.
 */

import { TOPBAR_BUTTON } from '../topbar-style'
import { useEffect, useState } from 'react'
import { MENU_PANEL_PLACE, MENU_ROW, usePageMenu } from './page-menu'
import { useRouter } from 'next/navigation'

export function LockButton({
  lockUrl,
  locked,
  canToggle,
  reloadOnUnlock,
  hint,
  part = 'both',
}: {
  /** `PUT` 이 잠그고 `DELETE` 가 푼다 — `…/pages/{id}/lock` · `…/databases/{id}/lock`. */
  lockUrl: string
  locked: boolean
  canToggle: boolean
  /** 풀면 화면을 다시 연다 — 협업 편집기가 있는 페이지(머리말). */
  reloadOnUnlock: boolean
  /** "잠김"에 걸어 두는 설명 — 무엇이 막히는가. */
  hint: string
  /** 무엇을 그리나(디자인-2b) — 상단 바의 "잠김" 표시(`badge`) · 페이지 메뉴의 단추(`toggle`) · 둘 다(데이터베이스 화면). */
  part?: 'badge' | 'toggle' | 'both'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 페이지 메뉴("···") 안이면 줄 모양 · 패널은 카드 자리(디자인-2b · `page-menu.tsx`)
  const menu = usePageMenu()
  useEffect(() => menu?.register('lock', () => {
    setError(null)
  }), [menu])
  useEffect(() => {
    menu?.hold('lock', error !== null)
  }, [menu, error])
  useEffect(() => () => menu?.hold('lock', false), [menu])

  async function toggle(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(lockUrl, { method: locked ? 'DELETE' : 'PUT' })
      if (!res.ok) {
        setError(locked ? '잠금을 풀지 못했습니다.' : '잠그지 못했습니다.')
        return
      }
      if (locked && reloadOnUnlock) window.location.reload()
      else router.refresh()
    } catch {
      setError('연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (!canToggle && !locked) return null
  if (part === 'toggle' && !canToggle) return null
  if (part === 'badge' && !locked) return null
  return (
    <span className={menu ? 'flex w-full flex-col' : 'flex flex-none items-center gap-1'}>
      {locked && part !== 'toggle' && (
        <span data-testid="page-locked" className="text-xs text-neutral-500" title={hint}>
          🔒 잠김
        </span>
      )}
      {canToggle && part !== 'badge' && (
        <button
          type="button"
          data-testid="page-lock-toggle"
          aria-pressed={locked}
          disabled={busy}
          onClick={() => void toggle()}
          className={menu ? MENU_ROW : TOPBAR_BUTTON}
        >
          {locked ? '잠금 풀기' : '잠그기'}
        </button>
      )}
      {error !== null && (
        <span role="alert" className={menu ? `${MENU_PANEL_PLACE} w-64 popover-surface p-3 text-xs text-red-600` : 'text-xs text-red-600'}>
          {error}
        </span>
      )}
    </span>
  )
}
