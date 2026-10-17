/**
 * 화면 제목 — 플랫폼 잔여 10d-7a (F-12-13 · 정본 §3.1 [보강] 문서의 언어 · 화면 제목)
 *
 * 탭 · 창 목록 · 방문 기록은 문서의 제목으로 화면을 가린다(WCAG 2.4.2). 루트 레이아웃이 **틀**을 정하고 화면이 이름을 준다. 공개 화면은
 * 틀을 씌우지 않는다 — 쓴 사람의 글이다(`publicTitle`).
 */

export const APP_NAME = 'notion-clone'

/** 화면의 이름이 `%s` 에 들어간다. */
export const TITLE_TEMPLATE = `%s · ${APP_NAME}`

/** 루트 레이아웃의 제목 — 틀을 쓰려면 기본값이 있어야 한다(이름을 주지 않는 화면의 제목). */
export const ROOT_TITLE = { default: APP_NAME, template: TITLE_TEMPLATE } as const

/** 고정 화면의 이름 — 사이드바 · 머리(`h1`)와 같은 말. */
export const SCREEN_TITLES = {
  home: '홈',
  inbox: '인박스',
  library: '라이브러리',
  settings: '설정',
  teamspaces: 'Teamspace 둘러보기',
  login: '로그인',
  invite: '초대',
} as const

/** 공개 화면의 제목 — 틀을 씌우지 않는다(게시 페이지 · 폼 · 신고). */
export function publicTitle(text: string): { readonly absolute: string } {
  return { absolute: text }
}
