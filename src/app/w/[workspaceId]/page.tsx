/**
 * 워크스페이스 홈 — **`SessionContext` 를 요구하는 첫 화면.**
 *
 * 여기부터는 `getCurrentUser()`(신원 조회)로는 부족하다.
 * `requirePageSession()` → `resolveSessionContext()` 가 0단계 게이트(SSO 강제)까지
 * 통과시킨 뒤에야 워크스페이스 안의 것을 보여준다 — 정본 불변식 A9.
 *
 * 멤버가 아니거나 워크스페이스가 없으면 **둘 다 404** 다 (F-02-17).
 * 403 을 주면 "그 워크스페이스는 존재한다"를 알려주는 셈이 된다.
 *
 * 관리 절(멤버 · 초대 · 게스트 · 그룹 · 정책 · 내보내기)은 설정 화면으로 옮겼다(8g-1 · 8g-2 · F-17-12) — 홈은 페이지로 들어가는 곳이다.
 *
 * Home(10c-1 · F-07-19 · 정본 §3.9 [보강] Home) — 검색 없이 성격별 목록으로 찾는다: 최근 방문 · 즐겨찾기 · 팀스페이스 · 공유됨 · 개인 ·
 * 워크스페이스. 목록은 모두 이미 있는 것(각자 조회 시점에 권한을 거른다)이고 한 번에 읽는다. 빈 섹션은 세우지 않고 모두 비면 시작 카드.
 */

import Link from 'next/link'

import { requirePageSession } from '@/lib/auth/page-session'
import type { PageIcon } from '@/lib/block/page-icon'
import { groupSidebarRoots, listPageTree } from '@/lib/block/page-tree'
import { HOME_RECENT_LIMIT, homeSections, type HomeItem } from '@/lib/nav/home-sections'
import { listFavorites, listRecent } from '@/lib/nav/recent'
import { listMyTeamspaces } from '@/lib/workspace/teamspace'
import { visiblePanels } from '@/lib/settings/panels'
import { workspaceNameOf } from '@/lib/workspace/list'
import { HomeSection } from './home-section'
import { NewPageButton } from './new-page-button'

/** 목록의 한 줄 → Home 의 항목. 최근 방문 · 즐겨찾기는 페이지뿐이고, 트리의 루트는 데이터베이스일 수 있다. */
function homeItem(node: { readonly id: string; readonly title: string; readonly icon: PageIcon | null; readonly kind?: 'page' | 'database' }): HomeItem {
  return { id: node.id, title: node.title, icon: node.icon, kind: node.kind ?? 'page' }
}

export default async function WorkspacePage({ params }: PageProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params

  // 진입 게이트는 page-session.ts 가 소유한다. 거부 코드 매핑
  // (멤버 아님 → 404) 을 화면마다 복사하면 한 곳만 틀려도 존재가 유출된다.
  const ctx = await requirePageSession(workspaceId)

  // Home 의 목록 — 모두 이미 있는 것이고 각자 권한 · 휴지통을 거른다. 한 번에 읽는다(07 *"여러 쿼리 → 묶을 것"*).
  const [tree, teamspaces, recent, favorites, workspaceName] = await Promise.all([
    listPageTree(ctx),
    listMyTeamspaces(ctx),
    listRecent(ctx, HOME_RECENT_LIMIT),
    listFavorites(ctx),
    workspaceNameOf(ctx),
  ])
  const grouped = groupSidebarRoots(tree, teamspaces)
  const sections = homeSections({
    recent: recent.map(homeItem),
    favorites: favorites.map(homeItem),
    teamspaces: grouped.teamspaces.map(({ teamspace, pages }) => ({ id: teamspace.id, name: teamspace.name, pages: pages.map(homeItem) })),
    shared: grouped.shared.map(homeItem),
    privatePages: grouped.privatePages.map(homeItem),
    workspacePages: grouped.workspacePages.map(homeItem),
  })

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="workspace-title">
            {workspaceName || '워크스페이스'}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            내 역할: <span className="font-medium">{ctx.role}</span> · 로그인 방식:{' '}
            {ctx.authMethod}
          </p>
        </div>
        <div className="flex gap-3 text-sm text-neutral-500">
          {/* 사람 · 정책 · 이름 · 내보내기는 설정 화면에 있다(8g-1 · 8g-2 · F-17-12). */}
          <Link href={`/w/${workspaceId}/settings`} data-testid="home-settings" className="underline underline-offset-4">
            설정
          </Link>
          <Link href="/" className="underline underline-offset-4">
            전체 목록
          </Link>
        </div>
      </header>

      {/* Home(10c-1) — 빈 섹션은 세우지 않는다 · 모두 비면 시작 카드(07 — 빈 섹션 여럿은 고장 난 화면으로 읽힌다) */}
      {sections.length === 0 ? (
        <section
          data-testid="home-empty"
          className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-neutral-300 p-6 dark:border-neutral-700"
        >
          <h2 className="text-base font-medium">아직 아무것도 없습니다</h2>
          <p className="text-sm text-neutral-500">첫 페이지를 만들어 시작하세요 — 왼쪽 사이드바의 &ldquo;+ 새 페이지&rdquo;와 같습니다.</p>
          <NewPageButton workspaceId={workspaceId} />
        </section>
      ) : (
        <>
          {sections.map((section) => (
            <HomeSection key={section.key} workspaceId={workspaceId} section={section} />
          ))}
          <NewPageButton workspaceId={workspaceId} />
        </>
      )}

      {/* 사람 절이 서는 사람에게만(게스트에게는 없다) — 판정은 패널의 것이다. */}
      {visiblePanels(ctx).some((panel) => panel.section === 'workspace.people') && (
        <p className="text-sm text-neutral-500">
          멤버 · 초대 · 그룹은{' '}
          <Link href={`/w/${workspaceId}/settings?s=workspace.people`} className="underline underline-offset-4">
            설정 → 사람
          </Link>
          에 있습니다.
        </p>
      )}
    </main>
  )
}
