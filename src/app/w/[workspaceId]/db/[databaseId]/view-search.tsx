'use client'

/**
 * 뷰 검색 — 화면 (DB 심화 2e-2조각 · F-04-27)
 *
 * 04: *"DB 상단 🔍 클릭 → 입력창 등장 → 타이핑 → 입력하는 동안 실시간으로 행이 좁혀짐 → `Esc` 또는 X 로 해제하면 원래 결과로 복귀."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 검색어는 주소의 `q` 다 — 뷰에 저장하지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 치는 동안 잠깐 쉬면(`SEARCH_DEBOUNCE_MS`) 주소의 `q` 를 바꾼다(`router.replace` — 뒤로 가기에 글자마다 쌓이지 않는다). 서버 렌더가 그
 * 검색어로 첫 페이지 · 열 집계 · 보드를 다시 읽고, 표 · 보드는 다시 마운트 기준(`contentKey`)에 든 검색어 때문에 새 결과로 선다. 검색 칸은
 * 도구줄에 있어 다시 서지 않는다 — 치던 글자와 커서가 남는다. 그 뒤의 읽기("더 보기" · 보드의 머리 값)도 같은 검색어를 싣는다.
 *
 * 검색어는 요청마다 서버가 다시 다듬는다(`normalizeSearch`) — 여기서 자르는 것은 화면 편의일 뿐이다.
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/** 치다가 이만큼 쉬면 검색한다 — 04 *"디바운스(200~300ms)"*. */
export const SEARCH_DEBOUNCE_MS = 300

/** 주소의 `q` 를 바꾼다(빈 글이면 뺀다). 다른 파라미터(`v` — 지금 뷰)는 그대로 둔다. */
export function useSetSearch(): (next: string | null) => void {
  const router = useRouter()
  const pathname = usePathname()
  return (next) => {
    const query = new URLSearchParams(window.location.search)
    const term = next?.trim() ?? ''
    if (term === '') query.delete('q')
    else query.set('q', term)
    const qs = query.toString()
    router.replace(qs === '' ? pathname : `${pathname}?${qs}`, { scroll: false })
  }
}

/**
 * 도구줄의 검색 칸. 검색어가 없으면 "검색" 버튼만, 누르면 입력 칸이 열린다. `Esc` 나 `×` 는 지우고 닫는다. 뷰를 바꾸면(탭) 새로 선다
 * (`key` — 부르는 쪽이 뷰 id 를 준다).
 */
export function ViewSearch({ search }: { search: string | null }) {
  const setSearch = useSetSearch()
  const [open, setOpen] = useState(search !== null)
  const [draft, setDraft] = useState(search ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 바깥에서 지워졌으면(결과 없음의 "검색어 지우기") 칸도 비우고 닫는다. 치는 중에 비운 것(칸이 이미 비었다)은 그대로 열어 둔다 —
  // 서버의 답이 치는 것보다 늦게 와도 칸의 글자를 되돌리지 않으려고 "null 이 되었고 칸에 글자가 있다"만 본다.
  const [seen, setSeen] = useState(search)
  if (search !== seen) {
    setSeen(search)
    if (search === null && draft.trim() !== '') {
      setDraft('')
      setOpen(false)
    }
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const schedule = (value: string) => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSearch(value), SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    setDraft('')
    setOpen(false)
    if (search !== null) setSearch(null)
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="db-search-button"
        aria-label="이 뷰에서 검색"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        검색
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1 rounded border border-neutral-300 px-1 dark:border-neutral-700">
      <input
        ref={inputRef}
        type="search"
        data-testid="db-search-input"
        aria-label="이 뷰에서 검색"
        placeholder="제목 · 글 · 선택에서 찾기"
        value={draft}
        autoFocus
        onChange={(e) => {
          setDraft(e.target.value)
          schedule(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            clear()
          }
        }}
        className="w-48 bg-transparent px-1 py-1 text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        data-testid="db-search-clear"
        aria-label="검색 지우기"
        onClick={clear}
        className="px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        ×
      </button>
    </span>
  )
}

/**
 * 검색에 맞는 행이 없을 때 — 04 *"매칭 0건 → '검색 결과 없음 + 검색어 지우기' 안내. 빈 테이블만 보이면 필터 버그로 오인된다."*
 */
export function SearchEmpty({ search }: { search: string }) {
  const setSearch = useSetSearch()
  return (
    <p className="flex flex-wrap items-center gap-2 px-2 text-sm text-neutral-500" data-testid="db-search-empty">
      <span>‘{search}’에 맞는 행이 없습니다.</span>
      <button
        type="button"
        data-testid="db-search-reset"
        onClick={() => setSearch(null)}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        검색어 지우기
      </button>
    </p>
  )
}
