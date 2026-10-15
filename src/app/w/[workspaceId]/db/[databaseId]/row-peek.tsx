'use client'

/**
 * 행 피크 — 데이터베이스 화면 위의 패널 (게시 · 공유 8n-1 · F-02-20)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 페이지 열기 모드 ①②④
 *
 * 안은 행 화면의 몸(`PageContent frame="peek"` — 서버가 그려 `children` 으로 온다)이다. 여기는 틀만 — 사이드 피크는 오른쪽 패널(뒤 화면을
 * 그대로 만진다) · 가운데 피크는 가운데 상자. 머리에 "전체 페이지로 열기"(행 화면으로) · "닫기"(`peek` 을 뺀 주소로). `Esc` 는 글을 쓰는 칸
 * (입력 · 본문 편집기 · 메뉴) 밖에서만 닫는다 — 편집기 안의 `Esc` 는 편집기의 것이다.
 *
 * 이전 · 다음 행(8n-3a · 정본 ⑦) — 이웃의 주소는 서버가 준다(이 화면이 그린 행의 순서 · `peekNeighbors`). 없으면 그 단추는 서지 않고 자리만
 * 흐리게 남는다(머리가 흔들리지 않게).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

const BUTTON =
  'rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'

/** 이 키 입력이 글을 쓰는 칸에서 왔는가 — 그때 `Esc` 는 그 칸의 것이다. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [role="dialog"] [role="menu"], [role="listbox"]') !== null
}

export function RowPeek({
  mode,
  closeHref,
  fullHref,
  prevHref,
  nextHref,
  children,
}: {
  mode: 'side' | 'center'
  closeHref: string
  fullHref: string
  /** 이전 · 다음 행의 피크 주소(8n-3a) — 없으면 null. */
  prevHref: string | null
  nextHref: string | null
  children: ReactNode
}) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typingIn(e.target)) return
      e.preventDefault()
      router.push(closeHref, { scroll: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, closeHref])

  const header = (
    <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <nav aria-label="행 사이 옮기기" className="mr-auto flex items-center gap-1">
        {prevHref !== null ? (
          <Link href={prevHref} scroll={false} data-testid="peek-prev" aria-label="이전 행" className={BUTTON}>
            ↑ 이전 행
          </Link>
        ) : (
          <span data-testid="peek-prev" aria-disabled="true" className={`${BUTTON} opacity-40`}>
            ↑ 이전 행
          </span>
        )}
        {nextHref !== null ? (
          <Link href={nextHref} scroll={false} data-testid="peek-next" aria-label="다음 행" className={BUTTON}>
            ↓ 다음 행
          </Link>
        ) : (
          <span data-testid="peek-next" aria-disabled="true" className={`${BUTTON} opacity-40`}>
            ↓ 다음 행
          </span>
        )}
      </nav>
      <Link href={fullHref} data-testid="peek-expand" className={BUTTON}>
        전체 페이지로 열기
      </Link>
      <Link href={closeHref} scroll={false} data-testid="peek-close" aria-label="미리보기 닫기" className={BUTTON}>
        닫기
      </Link>
    </div>
  )

  if (mode === 'center') {
    return (
      <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10">
        <div
          role="dialog"
          aria-label="행 미리보기"
          data-testid="row-peek"
          data-mode="center"
          className="w-full max-w-3xl rounded-lg bg-white shadow-2xl dark:bg-neutral-950"
        >
          {header}
          {children}
        </div>
      </div>
    )
  }
  return (
    <aside
      role="dialog"
      aria-label="행 미리보기"
      data-testid="row-peek"
      data-mode="side"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[720px] overflow-y-auto border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
    >
      {header}
      {children}
    </aside>
  )
}
