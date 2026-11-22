/**
 * 코멘트 패널을 여는 DOM 이벤트(BD-1 — `comment-panel.tsx` 에서 떼어 냈다).
 *
 * 본문 편집기는 이 함수 하나만 부른다. 패널 모듈 전체(목록 · 반응 · 답글)를 끌고 오면 패널이 없는 화면(데이터베이스 템플릿 편집)의 첫 JS 가
 * 그만큼 커졌다 — 부르는 쪽과 그리는 쪽이 서로를 모르는 이 방식(검색 오버레이와 같은 규칙)은 그대로다.
 */

export const COMMENT_FOCUS_EVENT = 'nc:comment-focus'

/**
 * 패널을 열고 그 스레드를 보여준다 — 본문의 하이라이트를 눌렀을 때 · 방금 만든 스레드.
 *
 * 모듈 스토어를 두지 않고 DOM 이벤트로 알린다(검색 오버레이와 같은 규칙) — 부르는 쪽(본문 편집기)과 그리는 쪽(패널)이
 * 서로를 모르는 것이 이 한 기능에는 충분하고, 상태를 둘로 두지 않는다.
 */
export function openCommentThread(discussionId: string): void {
  window.dispatchEvent(new CustomEvent(COMMENT_FOCUS_EVENT, { detail: discussionId }))
}
