/**
 * 이동 단축키 — 키 고르기 · 위 칸 · 히스토리 끝 (59번 트랙 NV-1 · F-07-12 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ② ③ ④ ⑤
 *
 *   · `Ctrl/Cmd + [` 뒤로 · `Ctrl/Cmd + ]` 앞으로 — 브라우저의 세션 히스토리를 한 칸(앱의 스택이 없다 · ①)
 *   · `Ctrl/Cmd + Shift + U` 위 칸 — 그 화면의 경로 줄(권한으로 거른 것)의 바로 위 칸(④)
 *   · `Ctrl/Cmd + L` 링크 복사 — 커맨드 팔레트의 "링크 복사"와 같은 일(⑤)
 *
 * 받지 않는 키(②) — 한글 조합 중 · Alt 가 함께(AltGr 배열은 Ctrl+Alt 로 `[` 를 친다) · 뒤로 · 앞으로 · 복사에 Shift 가 함께(`Ctrl+Shift+L` 은
 * 테마 — 8h) · 앞선 처리가 이미 막은 키. 글자는 `key` 와 `code` 어느 쪽이 맞아도 받는다(한글 입력기가 켜져도 선다 — AI 단축키와 같은 규칙).
 */

import type { BreadcrumbTrail } from '../block/breadcrumb.ts'

export type NavKey = 'back' | 'forward' | 'up' | 'copy-link'

/** 키 이벤트에서 읽는 것만 — `KeyboardEvent` 가 그대로 맞는다. */
export type NavKeyEvent = {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly isComposing: boolean
  readonly defaultPrevented: boolean
}

/** 이 키가 이동 단축키인가 — 아니면 null. */
export function navKeyOf(e: NavKeyEvent): NavKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing || e.defaultPrevented) return null
  const key = e.key.toLowerCase()
  if (e.shiftKey) return e.code === 'KeyU' || key === 'u' ? 'up' : null
  if (e.code === 'BracketLeft' || key === '[') return 'back'
  if (e.code === 'BracketRight' || key === ']') return 'forward'
  if (e.code === 'KeyL' || key === 'l') return 'copy-link'
  return null
}

/**
 * 위 칸의 주소 — 경로 줄의 지금 칸 바로 위에서부터 거슬러 처음 만나는 링크. 줄은 서버가 권한으로 거른 것이라(볼 수 있는 조상만 · teamspace 는
 * 멤버에게만 · 열 수 있는 데이터베이스만) 여기서 새로 판정하지 않는다. 첫 칸(워크스페이스 홈)이 늘 링크라 경로가 있으면 갈 곳이 있다.
 */
export function upHrefOf(trail: BreadcrumbTrail): string | null {
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    const href = trail[i]!.href
    if (href !== null) return href
  }
  return null
}

/** Navigation API 가 알려 주는 것 — 같은 출처의 항목만 센다. 없는 브라우저면 null. */
export type HistoryReach = { readonly canGoBack: boolean; readonly canGoForward: boolean } | null

/**
 * 한 칸 옮길 것인가(③) — 끝이면 무시한다(첫 앱 항목에서 뒤로가 앱 밖으로 나가지 않게). API 가 없는 브라우저는 브라우저에 맡긴다(브라우저의
 * 뒤로 단추와 같다).
 */
export function mayStep(direction: 'back' | 'forward', reach: HistoryReach): boolean {
  if (reach === null) return true
  return direction === 'back' ? reach.canGoBack : reach.canGoForward
}
