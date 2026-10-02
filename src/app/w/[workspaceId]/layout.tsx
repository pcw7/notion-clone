/**
 * 워크스페이스 레이아웃 — 사이드바가 여기 산다 (F-02-03).
 *
 * 페이지마다 사이드바를 렌더하면 페이지를 옮길 때마다 트리가 다시 마운트되고
 * 펼침 상태·스크롤이 날아간다. 레이아웃에 두면 자식 라우트가 바뀌어도
 * 사이드바 컴포넌트는 살아 있다.
 *
 * 진입 게이트가 레이아웃과 페이지 양쪽에서 돈다. 중복 조회로 보이지만
 * **레이아웃만 검사하고 페이지가 믿는 구조는 위험하다** — 나중에 이 레이아웃
 * 밖에 라우트가 하나 생기면 그 라우트만 통째로 무방비가 된다. 각자 확인한다.
 *
 * **워크스페이스 밖의 사람**(로그인했지만 멤버십이 없거나 떠난 사람 · 7g-2)에게는 404 로 끝내지 않고 **빈 틀**만 준다 — 사이드바도
 * 검색도 없이 자식만. 그 사람이 볼 수 있는 자식은 페이지 화면의 접근 요청 하나이고(`[pageId]/page.tsx`), 나머지 화면은 각자의
 * 게이트(`requirePageSession`)가 404 로 끝낸다 — 위의 "각자 확인한다"가 여기서 지켜야 할 규칙이 된다. 없는 워크스페이스에도 같은
 * 틀이 선다(존재를 가르지 않는다).
 */

import { requirePageVisitor } from '@/lib/auth/page-session'
import { groupSidebarRoots, listPageTree } from '@/lib/block/page-tree'
import { listTrash } from '@/lib/block/trash'
import { listFavorites, listRecent } from '@/lib/nav/recent'
import { unreadCount } from '@/lib/notification/inbox'
import { canBrowseTeamspaces, canCreateTeamspace, listMyTeamspaces } from '@/lib/workspace/teamspace'
import { Sidebar, type SidebarNode } from './sidebar'
import { SearchOverlay } from './search-overlay'

/**
 * 서버 타입에서 클라이언트로 넘길 최소 모양만 남긴다. `teamspaceId` 는 넘기지 않는다 — 섹션은 여기서 이미 갈랐고, 멤버가
 * 아닌 teamspace 에서 공유받은 페이지의 그 id 를 화면에 줄 까닭이 없다(7c-2).
 */
function toSidebarNode(node: Awaited<ReturnType<typeof listPageTree>>[number]): SidebarNode {
  return {
    id: node.id,
    title: node.title,
    icon: node.icon,
    kind: node.kind,
    hasChildren: node.hasChildren,
    children: node.children.map(toSidebarNode),
  }
}

export default async function WorkspaceLayout({
  params,
  children,
}: LayoutProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params
  const visitor = await requirePageVisitor(workspaceId)
  if ('outsider' in visitor) return <div className="min-h-screen">{children}</div>
  const ctx = visitor.member

  const [tree, teamspaces, trash, recent, favorites, inboxUnread] = await Promise.all([
    listPageTree(ctx),
    listMyTeamspaces(ctx),
    listTrash(ctx),
    listRecent(ctx),
    listFavorites(ctx),
    unreadCount(ctx),
  ])
  // 루트를 섹션으로 가른다(F-07-16 의 파생 섹션 · 판결문 C-9 — Teamspaces · 공유됨 · 개인 · 워크스페이스 · 7c-7).
  const sections = groupSidebarRoots(tree, teamspaces)

  return (
    <div className="flex min-h-screen">
      <Sidebar
        workspaceId={workspaceId}
        tree={sections.workspacePages.map(toSidebarNode)}
        privatePages={sections.privatePages.map(toSidebarNode)}
        shared={sections.shared.map(toSidebarNode)}
        teamspaces={sections.teamspaces.map(({ teamspace, pages }) => ({
          id: teamspace.id,
          name: teamspace.name,
          icon: teamspace.icon,
          canCreatePages: teamspace.canCreatePages,
          pages: pages.map(toSidebarNode),
        }))}
        canCreateTeamspace={canCreateTeamspace(ctx.role)}
        canBrowseTeamspaces={canBrowseTeamspaces(ctx.role)}
        canCreatePrivatePage={ctx.role !== 'guest'}
        trash={trash.map((e) => ({
          id: e.id,
          title: e.title,
          icon: e.icon,
          trashedAt: e.trashedAt.toISOString(),
          purgeAfter: e.purgeAfter?.toISOString() ?? null,
          descendantCount: e.descendantCount,
        }))}
        recent={recent.map((e) => ({ id: e.id, title: e.title, icon: e.icon }))}
        favorites={favorites.map((e) => ({ id: e.id, title: e.title, icon: e.icon }))}
        inboxUnread={inboxUnread}
      />
      <div className="min-w-0 flex-1">{children}</div>

      {/*
        검색 오버레이 — W7 / F-07-01. 레이아웃에 두는 이유가 사이드바와 같다:
        페이지마다 렌더하면 페이지를 옮길 때마다 다시 마운트되고, 단축키 리스너가
        라우트 전환 사이에 비는 구간이 생긴다.

        빈 상태의 데이터는 **이미 읽은 `recent` 를 그대로 쓴다**(F-07-01:
        "입력 0자 = 이동 모드(최근 방문)"). 같은 것을 두 번 질의하지 않는다.
      */}
      <SearchOverlay
        workspaceId={workspaceId}
        recent={recent.map((e) => ({ id: e.id, title: e.title, icon: e.icon }))}
      />
    </div>
  )
}
