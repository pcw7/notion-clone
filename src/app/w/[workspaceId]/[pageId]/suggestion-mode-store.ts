/**
 * 제안 모드를 켠 페이지 — 보는 사람의 화면 상태 (SG-1 · F-05-12 · 정본 [보강 SG-1] ②)
 *
 * 저장하지 않는다 — 새로 고치거나 페이지를 떠나면 꺼진다(메뉴 항목이 떠날 때 끈다). 페이지 메뉴의 항목 · 머리의 표시 · 본문
 * 편집기가 같은 값을 본다(`useSyncExternalStore`).
 */

const suggesting = new Set<string>()
const listeners = new Set<() => void>()

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
  for (const listener of listeners) listener()
}

/** 서버 렌더 · 하이드레이션의 값 — 늘 꺼져 있다. */
export const notSuggesting = (): boolean => false
