'use client'

/**
 * 제안 모드 켜고 끄기 — 페이지 메뉴의 항목 · 머리의 표시 (SG-1 · F-05-12 · 정본 [보강 SG-1] ②)
 *
 * 고칠 수 있는 사람(`edit_content`)에게만 선다 — 페이지 화면이 그 사람에게만 그린다. 단축키 `Ctrl/Cmd+Shift+Alt+S` 도 이 항목이
 * 건다(항목이 없는 사람에게는 단축키도 없다). 켜는 것은 화면 상태다(`suggestion-mode-store.ts` — 저장하지 않는다). 편집기는 그 값을
 * 보고 입력을 제안으로 바꾼다(`body-editor.tsx` → `editor/suggestion-mode.ts`).
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { MENU_ROW, PageMenuDivider, usePageMenu } from './page-menu'
import { usePageCommand } from '../page-commands'
import {
  isSuggesting,
  noSuggestionCount,
  notSuggesting,
  setSuggesting,
  setSuggestionPanelOpen,
  subscribeSuggestionMode,
  suggestionCount,
} from './suggestion-mode-store'

/** 커맨드 팔레트에서 찾는 낱말. */
const SUGGEST_WORDS = ['제안 모드', '제안', 'suggest', 'suggesting'] as const

function useSuggesting(pageId: string): boolean {
  return useSyncExternalStore(subscribeSuggestionMode, () => isSuggesting(pageId), notSuggesting)
}

function useSuggestionCount(pageId: string): number {
  return useSyncExternalStore(subscribeSuggestionMode, () => suggestionCount(pageId), noSuggestionCount)
}

/**
 * 페이지 메뉴의 "제안 n개" 줄(SG-3) — 본문에 제안이 있을 때만 선다(볼 수 있는 사람 모두 · 수락 · 거절 단추는 고칠 수 있는 사람에게만 —
 * 목록이 정한다). 누르면 메뉴를 닫고 편집기가 "제안" 목록을 연다. `divider` 면 줄 아래에 구분선(줄이 없으면 구분선도 없다).
 */
export function SuggestionListButton({ pageId, divider = false }: { pageId: string; divider?: boolean }) {
  const count = useSuggestionCount(pageId)
  const menu = usePageMenu()
  if (count === 0) return null
  return (
    <>
      <button
        type="button"
        data-testid="suggestion-list-open"
        onClick={() => {
          menu?.close()
          setSuggestionPanelOpen(pageId, true)
        }}
        className={MENU_ROW}
      >
        제안 {count}개
      </button>
      {divider && <PageMenuDivider />}
    </>
  )
}

/** 페이지 메뉴의 "제안 모드" 줄 — 스위치 · 단축키 · 팔레트 작업. 떠나면 끈다(저장하지 않는다). */
export function SuggestionModeToggle({ pageId }: { pageId: string }) {
  const on = useSuggesting(pageId)
  const toggle = useCallback(() => setSuggesting(pageId, !isSuggesting(pageId)), [pageId])
  usePageCommand('toggle-suggestion-mode', pageId, on ? '제안 모드 끄기' : '제안 모드 켜기', SUGGEST_WORDS, toggle)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.code !== 'KeyS' || !(event.ctrlKey || event.metaKey) || !event.shiftKey || !event.altKey) return
      event.preventDefault()
      toggle()
    }
    // capture — 편집기의 키맵보다 먼저 본다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggle])
  useEffect(() => () => setSuggesting(pageId, false), [pageId])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-keyshortcuts="Control+Shift+Alt+S"
      data-testid="suggestion-mode-toggle"
      onClick={toggle}
      className={`${MENU_ROW} justify-between`}
    >
      제안 모드
      <span aria-hidden className={`relative h-3.5 w-6 rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? 'left-3' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** 머리의 표시 — 켜진 동안만 선다(제안이 있으면 "제안 n개" 목록 열기 · 끄기 단추). */
export function SuggestionModePill({ pageId }: { pageId: string }) {
  const on = useSuggesting(pageId)
  const count = useSuggestionCount(pageId)
  if (!on) return null
  return (
    <span
      role="status"
      data-testid="suggestion-mode-pill"
      className="flex items-center gap-1 rounded-full border border-green-600/40 bg-green-50 py-0.5 pl-2.5 pr-1 text-xs text-green-800 dark:border-green-400/40 dark:bg-green-950 dark:text-green-200"
    >
      제안 모드
      {count > 0 && (
        <button
          type="button"
          data-testid="suggestion-pill-list"
          onClick={() => setSuggestionPanelOpen(pageId, true)}
          className="rounded-full px-1.5 hover:bg-green-600/10 dark:hover:bg-green-400/10"
        >
          제안 {count}개
        </button>
      )}
      <button
        type="button"
        aria-label="제안 모드 끄기"
        onClick={() => setSuggesting(pageId, false)}
        className="rounded-full px-1.5 hover:bg-green-600/10 dark:hover:bg-green-400/10"
      >
        끄기
      </button>
    </span>
  )
}
