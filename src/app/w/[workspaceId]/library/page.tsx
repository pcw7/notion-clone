/**
 * Library — 성격별 탭 · 이름으로 찾기 (플랫폼 잔여 10c-2 · F-07-19)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] Home ⑤
 *
 * 서버 컴포넌트 하나 — 주소가 상태다(`?tab=` · `?q=`). 탭은 링크(검색어를 지닌다) · 찾기는 GET 폼이라 브라우저 스크립트 없이 선다. 목록은
 * Home 과 같은 함수(각자 권한 · 휴지통을 거른다)이고 **탭이 고른 목록만 읽는다**. 팀스페이스 · 워크스페이스 · 공유됨 · 개인은 사이드바의 섹션
 * 나누기 그대로 계층을 펴서(`flattenTree`) 줄마다 위치를 함께 보인다. 이름은 그 탭의 목록에서 찾는다(`matchesName` — 전문 검색이 아니다).
 */

import type { Metadata } from 'next'
import Link from '@/app/link'

import { requirePageSession } from '@/lib/auth/page-session'
import { groupSidebarRoots, listPageTree } from '@/lib/block/page-tree'
import {
  LIBRARY_RECENT_LIMIT,
  LIBRARY_TABS,
  flattenTree,
  libraryHref,
  libraryItemHref,
  libraryTabLabel,
  matchesName,
  normalizeLibraryQuery,
  normalizeLibraryTab,
  type LibraryItem,
  type LibraryTab,
} from '@/lib/nav/library'
import { listFavorites, listRecent, type NavEntry } from '@/lib/nav/recent'
import { listMyTeamspaces } from '@/lib/workspace/teamspace'
import type { SessionContext } from '@/lib/auth/session-context'
import { PageIconView } from '../page-icon-view'
import { SCREEN_TITLES } from '@/lib/nav/screen-title'

const UNTITLED = '제목 없음'

const fromNav = (entry: NavEntry): LibraryItem => ({ id: entry.id, title: entry.title, icon: entry.icon, kind: 'page', where: null })

/** 탭이 고른 목록만 읽는다 — 최근 방문 · 즐겨찾기는 그 목록 하나, 나머지는 트리(와 내 팀스페이스). */
async function itemsOf(ctx: SessionContext, tab: LibraryTab): Promise<LibraryItem[]> {
  if (tab === 'recent') return (await listRecent(ctx, LIBRARY_RECENT_LIMIT)).map(fromNav)
  if (tab === 'favorites') return (await listFavorites(ctx)).map(fromNav)
  const [tree, teamspaces] = await Promise.all([listPageTree(ctx), tab === 'teamspaces' ? listMyTeamspaces(ctx) : Promise.resolve([])])
  const grouped = groupSidebarRoots(tree, teamspaces)
  switch (tab) {
    case 'teamspaces':
      return grouped.teamspaces.flatMap(({ teamspace, pages }) => flattenTree(pages, teamspace.name))
    case 'workspace':
      return flattenTree(grouped.workspacePages, null)
    case 'shared':
      return flattenTree(grouped.shared, null)
    case 'private':
      return flattenTree(grouped.privatePages, null)
  }
}

// 화면 제목(10d-7a · F-12-13) — 루트의 틀이 `… · notion-clone` 을 붙인다
export const metadata: Metadata = { title: SCREEN_TITLES.library }

export default async function LibraryPage({ params, searchParams }: PageProps<'/w/[workspaceId]/library'>) {
  const { workspaceId } = await params
  const { tab: rawTab, q: rawQuery } = await searchParams
  const ctx = await requirePageSession(workspaceId)
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const tab = normalizeLibraryTab(first(rawTab))
  const query = normalizeLibraryQuery(first(rawQuery))

  const all = await itemsOf(ctx, tab)
  const items = all.filter((item) => matchesName(item, query))

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">라이브러리</h1>
        <p className="text-sm text-neutral-500">이 워크스페이스의 페이지를 성격별로 — 이름으로 찾는다(본문은 검색 Ctrl/Cmd + K).</p>
      </header>

      <nav aria-label="라이브러리 탭" className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {LIBRARY_TABS.map((t) => (
          <Link
            key={t}
            href={libraryHref(workspaceId, { tab: t, q: query })}
            data-testid="library-tab"
            data-tab={t}
            aria-current={t === tab ? 'page' : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800 aria-[current=page]:border-neutral-900 aria-[current=page]:text-neutral-900 dark:hover:text-neutral-200 dark:aria-[current=page]:border-neutral-100 dark:aria-[current=page]:text-neutral-100"
          >
            {libraryTabLabel(t)}
          </Link>
        ))}
      </nav>

      {/* 이름으로 찾기 — GET 폼(주소가 상태다) · 탭을 지닌다 */}
      <form method="get" action={`/w/${workspaceId}/library`} role="search" data-testid="library-search" className="flex gap-2">
        {tab !== 'recent' && <input type="hidden" name="tab" value={tab} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={`${libraryTabLabel(tab)}에서 이름으로 찾기`}
          aria-label="이름으로 찾기"
          data-testid="library-query"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
        />
        <button type="submit" data-testid="library-submit" className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
          찾기
        </button>
      </form>

      <p className="text-xs text-neutral-400" data-testid="library-count">
        {query === '' ? `${items.length}개` : `${all.length}개 중 ${items.length}개`}
      </p>

      {items.length === 0 ? (
        <p data-testid="library-empty" className="text-sm text-neutral-500">
          {query === '' ? `${libraryTabLabel(tab)}에 페이지가 없습니다.` : `“${query}” 와 이름이 맞는 페이지가 없습니다.`}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {items.map((item, i) => (
            // 같은 페이지가 두 번 설 수는 없지만(한 탭 안) 펴는 중 같은 id 가 오면 열쇠가 겹친다 — 자리를 함께 쓴다
            <li key={`${item.id}:${i}`}>
              <Link
                href={libraryItemHref(workspaceId, item)}
                data-testid="library-item"
                data-page-id={item.id}
                className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <PageIconView icon={item.icon} fallback />
                <span className="truncate">{item.title || UNTITLED}</span>
                {item.where !== null && (
                  <span data-testid="library-where" className="ml-auto shrink-0 truncate text-xs text-neutral-400">
                    {item.where}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
