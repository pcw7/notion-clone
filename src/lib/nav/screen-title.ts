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
  workspaces: '워크스페이스',
  noAccess: '접근 요청',
} as const

/** 틀을 씌운 전체 제목 — 브라우저에서 탭 제목을 쓸 때(10d-7b · `DocumentTitle`) · 틀이 닿지 않는 루트 구간의 화면. */
export function fullTitle(name: string): string {
  // 함수로 바꾼다 — 글로 주면 이름 속의 `$&` · `$1` 같은 치환 패턴이 풀린다
  return TITLE_TEMPLATE.replace('%s', () => name)
}

/** 비어 있는 이름(10d-7b) — 편집기의 자리 표시와 같은 말. */
export const UNTITLED_TITLE = '제목 없음'

/** 탭 제목에 싣는 이름의 최대 글자 수(10d-7b) — 넘으면 자르고 말줄임표. */
export const MAX_TITLE_CHARS = 80

/** 내용(페이지 · 데이터베이스 · teamspace)의 이름(10d-7b) — 공백을 접고 · 비면 "제목 없음" · 길면 자른다. */
export function contentTitle(text: string): string {
  const folded = text.replace(/\s+/g, ' ').trim()
  if (folded === '') return UNTITLED_TITLE
  const chars = [...folded]
  return chars.length > MAX_TITLE_CHARS ? `${chars.slice(0, MAX_TITLE_CHARS - 1).join('')}…` : folded
}

/** 템플릿 편집 화면의 이름(10d-7b) — 그 데이터베이스의 이름으로. */
export function templateTitle(databaseName: string): string {
  return `템플릿 — ${contentTitle(databaseName)}`
}

/** 공개 화면의 제목 — 틀을 씌우지 않는다(게시 페이지 · 폼 · 신고). */
export function publicTitle(text: string): { readonly absolute: string } {
  return { absolute: text }
}
