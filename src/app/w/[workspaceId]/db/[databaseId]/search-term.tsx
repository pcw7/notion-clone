'use client'

/**
 * 맞은 글자 강조 — 화면 (뷰 검색의 나머지 트랙 V-3 · 정본 §3.6 [보강] 뷰 검색 ⑦)
 *
 * 데이터베이스 화면이 지금의 검색어를 내려 준다(`SearchTermProvider` — `page.tsx`). 제목 · 글 칸과 카드 제목이 `Highlighted` 로 맞은 부분을
 * `<mark>` 로 감싼다. 제공자가 없는 곳(행 페이지 · 공개 화면)은 검색어가 없어 그대로 그린다.
 */

import { createContext, useContext, type ReactNode } from 'react'

import { searchMarks } from '@/lib/database/search-marks'

const SearchTermContext = createContext<string | null>(null)

export function SearchTermProvider({ term, children }: { term: string | null; children: ReactNode }) {
  return <SearchTermContext.Provider value={term}>{children}</SearchTermContext.Provider>
}

export function Highlighted({ text }: { text: string }) {
  const term = useContext(SearchTermContext)
  const pieces = searchMarks(text, term)
  if (!pieces.some((p) => p.hit)) return <>{text}</>
  return (
    <>
      {pieces.map((p, i) =>
        p.hit ? (
          <mark key={i} data-testid="db-search-mark" className="rounded-sm bg-yellow-200/80 text-inherit dark:bg-yellow-500/30">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
