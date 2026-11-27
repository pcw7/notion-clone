/**
 * 링크를 누른 것 — 앱 안 이동인가 · 브라우저에 맡기는가 · 편집기가 새 탭으로 여는가 (59번 트랙 NV-3 · F-07-12 · 순수 · DOM 없음)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑪ [NV-3 고침]
 *
 *   · 원자 링크(`atomLinkClick`) — 노드 뷰의 진짜 `<a href>`(페이지 멘션 칩 · 하위 페이지 · 인라인 데이터베이스 · 경로 블록). 편집되지 않는
 *     섬(`contenteditable=false`)이라 브라우저가 링크로 다룬다. 그냥 누르면(왼쪽 · 보조 키 없이) 앱 안(클라이언트 라우터), 보조 키(`Ctrl/Cmd`
 *     새 탭 · `Shift` 새 창 · `Alt`)나 가운데 단추면 브라우저의 것 — Next `Link` 와 같은 규칙.
 *   · 글 속 링크(`textLinkClick`) — link 서식. **편집 중이면 글자다** — 그냥 누르면 캐럿 · `Shift` 는 선택 늘리기(편집이 이긴다). 브라우저는
 *     편집 가능한 글 속의 링크를 `Ctrl+클릭` 으로도 열지 않으므로 `Ctrl/Cmd + 클릭` · 가운데 클릭은 편집기가 받아 새 탭으로 연다. 읽기
 *     전용이면 살아 있는 링크다 — 브라우저에 맡긴다.
 */

/** 누른 것에서 읽는 것만 — `MouseEvent` 가 그대로 맞는다. */
export type LinkPointer = {
  readonly button: number
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

const MAIN = 0
const MIDDLE = 1

/** 원자 링크 — `in-app` 이면 막고 라우터로 · `browser` 면 그대로 둔다(새 탭 · 새 창) · `ignore` 는 링크가 아닌 단추(오른쪽 · 뒤로 단추 …). */
export function atomLinkClick(e: LinkPointer): 'in-app' | 'browser' | 'ignore' {
  if (e.button === MAIN) return e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ? 'browser' : 'in-app'
  return e.button === MIDDLE ? 'browser' : 'ignore'
}

/**
 * 글 속 링크 — `new-tab` 이면 편집기가 막고 새 탭으로 연다 · `pass` 면 편집기 · 브라우저의 기본(캐럿 · 선택 · 읽기 전용의 링크). `Alt` 가
 * 함께면 열지 않는다(브라우저에서 `Alt + 클릭` 은 내려받기다 — 편집 중에는 글자로 둔다).
 */
export function textLinkClick(e: LinkPointer, editable: boolean): 'new-tab' | 'pass' {
  if (!editable || e.altKey) return 'pass'
  if (e.button === MIDDLE) return 'new-tab'
  return e.button === MAIN && (e.ctrlKey || e.metaKey) ? 'new-tab' : 'pass'
}
