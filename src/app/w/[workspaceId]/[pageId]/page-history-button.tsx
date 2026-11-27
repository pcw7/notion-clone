'use client'

/**
 * 페이지 기록의 "기록" 단추(BD-2 — `page-history.tsx` 에서 떼어 냈다). 창(목록 · 미리보기 · 되돌리기)은 연 뒤에야 받는다.
 *
 * 페이지 메뉴("···")가 열리거나 단추에 올리거나 포커스하면 창의 청크를 미리 받는다 — 누를 때는 대개 이미 와 있다.
 */

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'

import { TOPBAR_BUTTON } from '../topbar-style'
import { MENU_ROW, usePageMenu, usePageMenuOpen } from './page-menu'

const PageHistoryDialog = dynamic(() => import('./page-history').then((m) => m.PageHistoryDialog))
const prefetchDialog = (): void => {
  void import('./page-history').catch(() => undefined)
}

export function PageHistoryButton({ workspaceId, pageId }: { workspaceId: string; pageId: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // 페이지 메뉴("···") 안이면 줄 모양 · 패널은 카드 자리(디자인-2b · `page-menu.tsx`)
  const menu = usePageMenu()
  const menuOpen = usePageMenuOpen()
  useEffect(() => {
    if (menuOpen) prefetchDialog()
  }, [menuOpen])
  useEffect(() => menu?.register('history', () => {
    setOpen(false)
  }), [menu])
  useEffect(() => {
    menu?.hold('history', open)
  }, [menu, open])
  useEffect(() => () => menu?.hold('history', false), [menu])
  const close = useCallback(() => {
    setOpen(false)
    // 메뉴 안의 줄은 닫힌 카드 안이라 포커스를 받을 수 없다 — "···" 단추로
    if (menu) menu.focusTrigger()
    else triggerRef.current?.focus()
  }, [menu])
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="page-history-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onPointerEnter={prefetchDialog}
        onFocus={prefetchDialog}
        className={menu ? MENU_ROW : TOPBAR_BUTTON}
      >
        {menu ? '버전 기록' : '기록'}
      </button>
      {open && <PageHistoryDialog workspaceId={workspaceId} pageId={pageId} onClose={close} />}
    </>
  )
}
