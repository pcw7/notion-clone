/**
 * 제안 모드를 켠 페이지 — 보는 사람의 화면 상태 (SG-1 · F-05-12 · 정본 [보강 SG-1] ②)
 *
 * 저장하지 않는다 — 새로 고치거나 페이지를 떠나면 꺼진다(메뉴 항목이 떠날 때 끈다). 페이지 메뉴의 항목 · 머리의 표시 · 본문
 * 편집기가 같은 값을 본다(`useSyncExternalStore`).
 *
 * SG-3 — 본문의 제안 수(편집기가 문서에서 센다)와 "제안" 목록이 열렸는가도 여기다. 메뉴의 "제안 n개" · 머리의 표시가 열고, 편집기가
 * 목록을 그린다(편집기를 쥔 쪽이라 수락 · 거절 · 자리 고르기를 한다).
 */

const suggesting = new Set<string>()
const counts = new Map<string, number>()
const panels = new Set<string>()
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

export function subscribeSuggestionMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isSuggesting(pageId: string): boolean {
  return suggesting.has(pageId)
}

export function setSuggesting(pageId: string, on: boolean): void {
  if (suggesting.has(pageId) === on) return
  if (on) suggesting.add(pageId)
  else suggesting.delete(pageId)
  notify()
}

/** 서버 렌더 · 하이드레이션의 값 — 늘 꺼져 있다. */
export const notSuggesting = (): boolean => false

/** 본문의 제안 수(sid) — 편집기가 문서를 바꿀 때마다 센다. 모르면 0. */
export function suggestionCount(pageId: string): number {
  return counts.get(pageId) ?? 0
}

export function setSuggestionCount(pageId: string, count: number): void {
  if (suggestionCount(pageId) === count) return
  counts.set(pageId, count)
  notify()
}

/** 서버 렌더의 제안 수 — 편집기가 세기 전이다. */
export const noSuggestionCount = (): number => 0

export function isSuggestionPanelOpen(pageId: string): boolean {
  return panels.has(pageId)
}

export function setSuggestionPanelOpen(pageId: string, open: boolean): void {
  if (panels.has(pageId) === open) return
  if (open) panels.add(pageId)
  else panels.delete(pageId)
  notify()
}
