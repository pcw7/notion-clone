/**
 * 코멘트 반응의 글자 — 칩의 이름 · 빠른 고르개 (인접 제품 7c-3d-1 · F-05-08 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 반응 화면 ①②
 */

/** 빠른 고르개의 여덟 — 자주 쓰는 것을 먼저(노션의 반응 고르개와 같은 태도). 전체 · 커스텀은 다음 조각(7c-3d-2). */
export const QUICK_REACTIONS = ['👍', '❤️', '😄', '🎉', '😮', '😢', '👀', '✅'] as const

/**
 * 칩의 `title` — 누른 사람의 이름을 누른 순으로(서버가 그 순서로 준다). 나는 "나". 모르는 사람은 "알 수 없는 사용자".
 * 예: `나 · 박동료`
 */
export function reactionTitle(userIds: readonly string[], me: string, nameOf: (userId: string) => string | null): string {
  return userIds.map((id) => (id === me ? '나' : (nameOf(id) ?? '알 수 없는 사용자'))).join(' · ')
}

/** 칩의 읽는 이름 — 이모지 · 수 · 내가 눌렀는가. 예: `👍 반응 2명, 나도 눌렀습니다` */
export function reactionLabel(emoji: string, count: number, mine: boolean): string {
  return `${emoji} 반응 ${count}명${mine ? ', 나도 눌렀습니다' : ''}`
}
