'use client'

/**
 * 페이지 안 찾기 막대 — 플랫폼 잔여 10b (F-07-05)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 페이지 안 찾기 ④ ⑤
 *
 * 그리기만 한다 — 찾는 것은 편집기의 플러그인(`find-in-page.ts`)이고, 여닫기 · 옮기기는 본문 편집기가 한다. 입력의 키: `Enter` 다음 ·
 * `Shift+Enter` 이전 · `Esc` 닫기(IME 조합 중의 Enter 는 후보 확정이라 가로채지 않는다). 0건이면 `0/0` 과 붉은 테두리.
 */

import type { RefObject } from 'react'

export function FindBar({
  inputRef,
  query,
  counter,
  empty,
  onQuery,
  onStep,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  /** `n/N` · `0/0` · 빈 말(검색어 없음). */
  counter: string
  /** 검색어가 있는데 0건. */
  empty: boolean
  onQuery: (query: string) => void
  onStep: (step: 1 | -1) => void
  onClose: () => void
}) {
  const BUTTON = 'rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
  return (
    // 높이 0 의 sticky 줄 — 본문을 밀지 않고 굴려도 위에 남는다
    <div className="sticky top-2 z-30 h-0">
      <div
        role="search"
        aria-label="페이지 안 찾기"
        data-testid="find-bar"
        className="absolute right-0 top-0 flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              onStep(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
          placeholder="페이지에서 찾기"
          aria-label="페이지에서 찾기"
          aria-invalid={empty || undefined}
          data-testid="find-input"
          autoComplete="off"
          className={`w-48 rounded border bg-transparent px-1.5 py-0.5 outline-none ${
            empty ? 'border-red-400 dark:border-red-500' : 'border-neutral-200 focus:border-neutral-400 dark:border-neutral-700'
          }`}
        />
        <span data-testid="find-count" aria-live="polite" className="min-w-[3.5rem] text-center text-xs tabular-nums text-neutral-500">
          {counter}
        </span>
        <button type="button" aria-label="이전" data-testid="find-prev" disabled={counter === '' || empty} onClick={() => onStep(-1)} className={BUTTON}>
          ↑
        </button>
        <button type="button" aria-label="다음" data-testid="find-next" disabled={counter === '' || empty} onClick={() => onStep(1)} className={BUTTON}>
          ↓
        </button>
        <button type="button" aria-label="찾기 닫기" data-testid="find-close" onClick={onClose} className={BUTTON}>
          ×
        </button>
      </div>
    </div>
  )
}
