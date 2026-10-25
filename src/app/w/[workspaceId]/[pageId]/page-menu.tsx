'use client'

/**
 * 페이지 메뉴("···") — 디자인-2b(노션 앱 실측 · `docs/design/notion-measurements.md` 의 "앱 화면")
 *
 * 노션의 상단 바에는 공유 · 즐겨찾기 · "···" 만 서고, 복제 · 옮기기 · 버전 기록 · 잠금 · 휴지통 같은 나머지 동작은 "···" 메뉴 안에 있다.
 * 이 부품이 그 메뉴다 — 안에 넣은 머리 부품(옮기기 · 기록 · 업데이트 · 내보내기 · 복제 · 삭제 · 잠금)은 `usePageMenu()` 로 메뉴 안인 것을
 * 알고 **메뉴 줄** 모양으로 그린다.
 *
 *   - **카드는 늘 DOM 에 있다** — 닫히면 `hidden` 이다. 서버가 그린 HTML 에도 항목이 있어 "이 사람에게 이 동작이 있는가" 가 그대로 보인다.
 *   - **패널이 열리면 목록 대신 패널** — 줄을 누른 부품이 자기 패널(옮기기 고르개 · 내보내기 · 기록 …)을 열면 `hold` 로 알린다. 그동안 카드는
 *     바탕 · 그림자를 거두고 줄을 감춘다(`invisible`) · 패널은 카드 자리(오른쪽 위)에 보인다(`visible` — 조상의 숨김을 이긴다). 노션의
 *     "···" → 옮기기와 같은 흐름이다.
 *   - **닫기** — 바깥을 누르거나 Escape 면 목록과 열린 패널을 모두 닫는다(부품이 `register` 로 건 닫기 함수를 부른다).
 *
 * 모양(노션 실측): 폭 256px · 둥글기 10px · 그림자 세 겹 · 안쪽 4px · 줄 높이 28px · 둥글기 6px · 글자 14px.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TOPBAR_ICON_BUTTON } from '../topbar-style'

/** 메뉴 줄(노션 실측: 높이 28px · 둥글기 6px · 글자 14px · 마우스를 올리면 따뜻한 회색 5%). 메뉴 안의 부품이 쓴다. */
export const MENU_ROW =
  'flex h-7 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-[rgb(44,44,43)] hover:bg-[rgba(33,27,23,0.05)] disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/5'

/** 메뉴 안에서 열린 패널의 자리 — 카드의 오른쪽 위 · 조상의 숨김을 이긴다. */
export const MENU_PANEL_PLACE = 'absolute right-0 top-0 z-20 visible'

type PageMenuApi = {
  /** 이 부품의 패널이 열렸는가 — 열리면 목록을 닫고 카드가 패널 자리가 된다. */
  hold(key: string, holding: boolean): void
  /** 바깥 누르기 · Escape 에 부를 닫기 함수를 건다 — 거둘 함수를 돌려준다. */
  register(key: string, close: () => void): () => void
  /** 패널을 닫은 뒤 포커스를 "···" 단추로 — 연 줄은 닫힌 카드 안이라 받을 수 없다. */
  focusTrigger(): void
}

const PageMenuContext = createContext<PageMenuApi | null>(null)

/** 메뉴 안이면 그 API · 아니면 null(상단 바 · 데이터베이스 화면 그대로). */
export function usePageMenu(): PageMenuApi | null {
  return useContext(PageMenuContext)
}

export function PageMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [holding, setHolding] = useState<ReadonlySet<string>>(new Set())
  const closers = useRef(new Map<string, () => void>())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const held = holding.size > 0

  const closeAll = useCallback(() => {
    setOpen(false)
    for (const close of closers.current.values()) close()
  }, [])

  const api = useMemo<PageMenuApi>(
    () => ({
      hold(key, on) {
        setHolding((current) => {
          if (current.has(key) === on) return current
          const next = new Set(current)
          if (on) next.add(key)
          else next.delete(key)
          return next
        })
        // 패널이 열리면 목록은 닫는다 — 카드는 패널이 쥐고 있는 동안 남는다
        if (on) setOpen(false)
      },
      register(key, close) {
        closers.current.set(key, close)
        return () => {
          closers.current.delete(key)
        }
      },
      focusTrigger() {
        triggerRef.current?.focus()
      },
    }),
    [],
  )

  useEffect(() => {
    if (!open && !held) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) closeAll()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      closeAll()
      // 포커스는 "···" 단추로 — 연 줄은 닫힌 카드 안이다. 패널 자신의 Esc 처리기에 맡기지 않는다: 이 처리기가 먼저 돌아 패널을 닫으면
      // React 가 그 사이에 다시 그려 패널의 처리기를 떼어 버린다(업데이트 패널의 포커스가 body 로 갔다)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, held, closeAll])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="page-menu"
        aria-label="페이지 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          // 패널이 열려 있으면 그것을 닫고 목록으로
          if (held) {
            for (const close of closers.current.values()) close()
            setOpen(true)
            return
          }
          setOpen((value) => !value)
        }}
        className={TOPBAR_ICON_BUTTON}
      >
        <span aria-hidden className="leading-none tracking-[0.1em]">···</span>
      </button>
      <div
        data-testid="page-menu-list"
        role="group"
        aria-label="페이지 메뉴"
        hidden={!open && !held}
        data-holding={held || undefined}
        className={`absolute right-0 top-full z-40 mt-1 w-64 ${
          held
            ? ''
            : 'popover-surface p-1'
        }`}
      >
        <PageMenuContext.Provider value={api}>
          <div className={`flex flex-col ${held ? 'invisible' : ''}`}>{children}</div>
        </PageMenuContext.Provider>
      </div>
    </div>
  )
}

/** 메뉴 안의 구분선(노션 실측: 1px · 따뜻한 회색 7%). */
export function PageMenuDivider() {
  return <div role="separator" className="mx-2 my-1 h-px bg-[rgba(42,28,0,0.07)] dark:bg-white/10" />
}
