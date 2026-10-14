/**
 * 페이지 열기 모드 — 뷰의 열기 방식 · 행 링크 (게시 · 공유 8n-1 · F-02-20 · F-04-21 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 페이지 열기 모드
 *
 * 피크는 데이터베이스 화면의 쿼리(`?peek={행}`)다 — 가로채기 경로를 쓰지 않는다(정본 ①). 행 링크는 뷰의 열기 방식을 따른다: `full_page`
 * 면 행 화면으로, 그 밖이면 지금 화면의 주소(뷰 · 검색 · 달)에 `peek` 을 더한다. 서버(데이터베이스 화면)와 브라우저(표 · 보드 · 갤러리 ·
 * 캘린더)가 함께 쓴다 — DB · 서버 모듈을 가져오지 않는다.
 */

/** 뷰의 열기 방식 — 정본 `view.open_pages_in` 의 CHECK 과 같다. 기본은 사이드 피크. */
export const OPEN_PAGES_IN = ['side_peek', 'center_peek', 'full_page'] as const
export type OpenPagesIn = (typeof OPEN_PAGES_IN)[number]
export const DEFAULT_OPEN_PAGES_IN: OpenPagesIn = 'side_peek'

/** 고르개의 이름(8n-2) — 무엇이 열리는지까지. */
const OPEN_PAGES_IN_LABEL: Readonly<Record<OpenPagesIn, string>> = {
  side_peek: '사이드 피크 — 오른쪽 패널(뒤의 표를 그대로 보며)',
  center_peek: '가운데 피크 — 가운데 상자',
  full_page: '전체 페이지 — 행 화면으로 옮겨 간다',
}

export function openPagesInLabel(mode: OpenPagesIn): string {
  return OPEN_PAGES_IN_LABEL[mode]
}

export function isOpenPagesIn(value: unknown): value is OpenPagesIn {
  return typeof value === 'string' && (OPEN_PAGES_IN as readonly string[]).includes(value)
}

/** 데이터베이스 화면의 주소 — 지금 보는 뷰 · 검색 · 달을 지닌 채(`peek` 은 빼고). 피크를 닫는 주소이자 피크를 여는 주소의 바탕. */
export function databaseHref(
  workspaceId: string,
  databaseId: string,
  params: { readonly v?: string | null; readonly q?: string | null; readonly m?: string | null },
): string {
  const query = new URLSearchParams()
  for (const key of ['v', 'q', 'm'] as const) {
    const value = params[key]
    if (typeof value === 'string' && value !== '') query.set(key, value)
  }
  const text = query.toString()
  return `/w/${workspaceId}/db/${databaseId}${text === '' ? '' : `?${text}`}`
}

/**
 * 행을 여는 주소 — `peekBase` 가 null 이면(전체 페이지) 행 화면, 아니면 그 주소에 `peek` 을 더한다(이미 있으면 바꾼다 — 피크를 쌓지 않는다).
 */
export function rowOpenHref(workspaceId: string, rowId: string, peekBase: string | null): string {
  if (peekBase === null) return `/w/${workspaceId}/${rowId}`
  const [path, search = ''] = peekBase.split('?')
  const query = new URLSearchParams(search)
  query.set('peek', rowId)
  return `${path}?${query.toString()}`
}
