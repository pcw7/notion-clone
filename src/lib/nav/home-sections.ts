/**
 * Home 의 섹션 — 검색 없이 찾는 표면 (플랫폼 잔여 10c-1 · F-07-19 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] Home
 *       07-search-navigation.md F-07-19 *"검색어를 치지 않고도 워크스페이스 콘텐츠를 성격별 목록으로 브라우징"* · 엣지 *"빈 섹션 7개는
 *       '고장난 화면'으로 읽힌다 → 온보딩 카드로 대체"* · *"같은 페이지가 여러 탭에 중복 — 정상(dedup 금지)"*
 *
 * 목록은 이미 권한으로 걸러 온 것이다(최근 방문 · 즐겨찾기 · 사이드바의 섹션 — 각자 조회 시점에 거른다). 여기는 차례와 빈 섹션만 정한다:
 *
 *   · 차례 — 최근 방문 · 즐겨찾기 · 팀스페이스(내가 멤버인 것마다) · 공유됨 · 개인 페이지 · 워크스페이스 페이지
 *   · **빈 섹션은 세우지 않는다**(팀스페이스도 — 페이지가 없는 팀스페이스는 사이드바의 `+` 가 그 자리다). 모두 비면 시작 카드
 *   · 같은 페이지가 여러 섹션에 서는 것은 정상이다(성격이 다른 목록 — 빼지 않는다)
 *   · 섹션마다 처음 `HOME_SECTION_LIMIT` 개만 보이고 나머지는 "모두 보기"(화면이 편다)
 */

import type { PageIcon } from '../block/page-icon.ts'

/** 섹션이 처음 보이는 수 — 나머지는 "모두 보기". */
export const HOME_SECTION_LIMIT = 6
/** Home 의 최근 방문 수 — 사이드바(7)보다 길게 읽는다(펴면 다 보인다). */
export const HOME_RECENT_LIMIT = 20

export type HomeItem = {
  readonly id: string
  readonly title: string
  readonly icon: PageIcon | null
  /** 데이터베이스 루트는 데이터베이스 화면으로 연다(사이드바와 같다). 최근 방문 · 즐겨찾기는 페이지뿐이다. */
  readonly kind?: 'page' | 'database'
}

/** 항목의 주소 — 데이터베이스면 데이터베이스 화면. */
export function homeItemHref(workspaceId: string, item: HomeItem): string {
  return item.kind === 'database' ? `/w/${workspaceId}/db/${item.id}` : `/w/${workspaceId}/${item.id}`
}

export type HomeSectionKey = 'recent' | 'favorites' | 'teamspace' | 'shared' | 'private' | 'workspace'

export type HomeSection = {
  /** 화면의 열쇠 — 팀스페이스는 `teamspace:{id}`. */
  readonly key: string
  readonly kind: HomeSectionKey
  readonly title: string
  readonly items: readonly HomeItem[]
}

const TITLE: Readonly<Record<Exclude<HomeSectionKey, 'teamspace'>, string>> = {
  recent: '최근 방문',
  favorites: '즐겨찾기',
  shared: '공유된 페이지',
  private: '개인 페이지',
  workspace: '워크스페이스 페이지',
}

export function homeSections(input: {
  readonly recent: readonly HomeItem[]
  readonly favorites: readonly HomeItem[]
  readonly teamspaces: readonly { readonly id: string; readonly name: string; readonly pages: readonly HomeItem[] }[]
  readonly shared: readonly HomeItem[]
  readonly privatePages: readonly HomeItem[]
  readonly workspacePages: readonly HomeItem[]
}): HomeSection[] {
  const sections: HomeSection[] = [
    { key: 'recent', kind: 'recent', title: TITLE.recent, items: input.recent },
    { key: 'favorites', kind: 'favorites', title: TITLE.favorites, items: input.favorites },
    ...input.teamspaces.map((t) => ({ key: `teamspace:${t.id}`, kind: 'teamspace' as const, title: t.name, items: t.pages })),
    { key: 'shared', kind: 'shared', title: TITLE.shared, items: input.shared },
    { key: 'private', kind: 'private', title: TITLE.private, items: input.privatePages },
    { key: 'workspace', kind: 'workspace', title: TITLE.workspace, items: input.workspacePages },
  ]
  return sections.filter((section) => section.items.length > 0)
}

/** 처음 보이는 것과 접힌 수 — 펴면(`expanded`) 다. */
export function visibleItems(items: readonly HomeItem[], expanded: boolean): { readonly shown: readonly HomeItem[]; readonly hidden: number } {
  if (expanded || items.length <= HOME_SECTION_LIMIT) return { shown: items, hidden: 0 }
  return { shown: items.slice(0, HOME_SECTION_LIMIT), hidden: items.length - HOME_SECTION_LIMIT }
}
