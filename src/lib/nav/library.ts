/**
 * Library — 성격별 탭 · 이름으로 찾기 (플랫폼 잔여 10c-2 · F-07-19 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] Home ⑤
 *       07-search-navigation.md F-07-19 *"Library 의 검색은 이름(제목) 기준이고 스코프가 탭으로 미리 고정된다 — 전문 검색이 아니다"* ·
 *       *"계층을 무시한 평면 목록"* · 엣지 *"Library 필터 상태는 URL 에 직렬화"* · *"제목 없는 항목도 정렬 대상에 포함"*
 *
 * 목록은 이미 권한으로 걸러 온 것이다(Home 과 같은 함수). 여기는 탭 · 검색어의 다듬기, 트리를 펴기, 이름 맞추기, 주소만 정한다.
 */

import type { PageIcon } from '../block/page-icon.ts'

export const LIBRARY_TABS = ['recent', 'favorites', 'teamspaces', 'workspace', 'shared', 'private'] as const
export type LibraryTab = (typeof LIBRARY_TABS)[number]
export const DEFAULT_LIBRARY_TAB: LibraryTab = 'recent'
/** 최근 방문 탭의 수 — 사이드바(7) · Home(20)보다 길게. */
export const LIBRARY_RECENT_LIMIT = 100
export const MAX_LIBRARY_QUERY = 100

const UNTITLED = '제목 없음'

const TAB_LABEL: Readonly<Record<LibraryTab, string>> = {
  recent: '최근 방문',
  favorites: '즐겨찾기',
  teamspaces: '팀스페이스',
  workspace: '워크스페이스',
  shared: '공유됨',
  private: '개인',
}

export function libraryTabLabel(tab: LibraryTab): string {
  return TAB_LABEL[tab]
}

/** 모르는 탭은 기본 탭. */
export function normalizeLibraryTab(raw: unknown): LibraryTab {
  return typeof raw === 'string' && (LIBRARY_TABS as readonly string[]).includes(raw) ? (raw as LibraryTab) : DEFAULT_LIBRARY_TAB
}

/** 검색어 — 공백을 접고 다듬어 상한으로 자른다. */
export function normalizeLibraryQuery(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LIBRARY_QUERY)
}

export type LibraryItem = {
  readonly id: string
  readonly title: string
  readonly icon: PageIcon | null
  readonly kind: 'page' | 'database'
  /** 위치 — 부모의 제목, 루트면 그 무리의 이름(팀스페이스 이름 등) · 없으면 null. */
  readonly where: string | null
}

type TreeLike = {
  readonly id: string
  readonly title: string
  readonly icon: PageIcon | null
  readonly kind: 'page' | 'database'
  readonly children: readonly TreeLike[]
}

/** 트리를 편다 — 트리 차례(부모 다음에 그 아래) · 루트의 위치는 `where`, 그 아래는 부모의 제목. */
export function flattenTree(nodes: readonly TreeLike[], where: string | null): LibraryItem[] {
  const out: LibraryItem[] = []
  const walk = (list: readonly TreeLike[], at: string | null) => {
    for (const node of list) {
      out.push({ id: node.id, title: node.title, icon: node.icon, kind: node.kind, where: at })
      walk(node.children, node.title || UNTITLED)
    }
  }
  walk(nodes, where)
  return out
}

/** 이름에 든 말인가 — 대소문자를 가리지 않는다 · 제목 없는 페이지는 "제목 없음" 으로 찾는다 · 빈 말이면 모두. */
export function matchesName(item: { readonly title: string }, query: string): boolean {
  if (query === '') return true
  return (item.title || UNTITLED).toLowerCase().includes(query.toLowerCase())
}

/** Library 의 주소 — 기본 탭 · 빈 검색어는 뺀다. */
export function libraryHref(workspaceId: string, params: { readonly tab?: LibraryTab; readonly q?: string }): string {
  const query = new URLSearchParams()
  if (params.tab !== undefined && params.tab !== DEFAULT_LIBRARY_TAB) query.set('tab', params.tab)
  if (params.q !== undefined && params.q !== '') query.set('q', params.q)
  const text = query.toString()
  return `/w/${workspaceId}/library${text === '' ? '' : `?${text}`}`
}

/** 항목의 주소 — 데이터베이스면 데이터베이스 화면. */
export function libraryItemHref(workspaceId: string, item: Pick<LibraryItem, 'id' | 'kind'>): string {
  return item.kind === 'database' ? `/w/${workspaceId}/db/${item.id}` : `/w/${workspaceId}/${item.id}`
}
