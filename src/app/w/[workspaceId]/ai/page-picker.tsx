'use client'

/**
 * 페이지 고르개 — 제목으로 찾아 하나를 고른다 (AI-6 · AI 채팅의 범위 · 설정의 "내 AI 지시")
 *
 * 후보는 `@` 자동완성과 같은 끝점(`GET …/mention-candidates?q=` — 권한으로 거른 페이지 · 빈 입력이면 최근 연 것)에서 페이지만 쓴다. 판정은
 * 고른 뒤에 서버가 다시 한다(범위는 턴마다 · 지시는 저장할 때).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export type PickedPage = { readonly id: string; readonly title: string }

const ROW = 'w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800'

export function PagePicker({
  workspaceId,
  testId,
  onPick,
  onCancel,
}: {
  workspaceId: string
  testId: string
  onPick: (page: PickedPage) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState<PickedPage[] | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    const stop = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/workspaces/${workspaceId}/mention-candidates?q=${encodeURIComponent(query.trim())}`, { signal: stop.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { candidates?: { kind: string; id: string; label: string }[] } | null) => {
          setPages((body?.candidates ?? []).filter((c) => c.kind === 'page').map((c) => ({ id: c.id, title: c.label })))
          setActive(0)
        })
        .catch(() => undefined)
    }, 150)
    return () => {
      clearTimeout(timer)
      stop.abort()
    }
  }, [workspaceId, query])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = pages?.length ?? 0
      if (n > 0) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const page = pages?.[active]
      if (page) onPick(page)
    }
  }

  return (
    <div data-testid={testId} className="popover-surface flex w-full max-w-sm flex-col gap-1 p-2">
      <input
        ref={inputRef}
        data-testid={`${testId}-input`}
        aria-label="페이지 찾기"
        placeholder="페이지 제목으로 찾기…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
      />
      <ul role="listbox" aria-label="페이지" className="max-h-56 overflow-auto">
        {pages === null && <li className="px-2 py-1 text-xs text-neutral-400">찾는 중…</li>}
        {pages !== null && pages.length === 0 && <li className="px-2 py-1 text-xs text-neutral-400">맞는 페이지가 없습니다</li>}
        {pages?.map((page, i) => (
          <li key={page.id} role="option" aria-selected={i === active}>
            <button
              type="button"
              data-testid={`${testId}-option`}
              data-page-id={page.id}
              className={`${ROW} ${i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(page)}
            >
              {page.title.trim() === '' ? '제목 없음' : page.title}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" data-testid={`${testId}-cancel`} className="self-end rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onCancel}>
        취소
      </button>
    </div>
  )
}
