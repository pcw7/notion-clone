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
 */

import { requirePageSession } from '@/lib/auth/page-session'
import { listPageTree } from '@/lib/block/page-tree'
import { listTrash } from '@/lib/block/trash'
import { listFavorites, listRecent } from '@/lib/nav/recent'
import { Sidebar, type SidebarNode } from './sidebar'
import { SearchOverlay } from './search-overlay'

/** 서버 타입에서 클라이언트로 넘길 최소 모양만 남긴다. */
function toSidebarNode(node: Awaited<ReturnType<typeof listPageTree>>[number]): SidebarNode {
  return {
    id: node.id,
    title: node.title,
    hasChildren: node.hasChildren,
    children: node.children.map(toSidebarNode),
  }
}

export default async function WorkspaceLayout({
  params,
  children,
}: LayoutProps<'/w/[workspaceId]'>) {
  const { workspaceId } = await params
  const ctx = await requirePageSession(workspaceId)

  const [tree, trash, recent, favorites] = await Promise.all([
    listPageTree(ctx),
    listTrash(ctx),
    listRecent(ctx),
    listFavorites(ctx),
  ])

  return (
    <div className="flex min-h-screen">
      <Sidebar
        workspaceId={workspaceId}
        tree={tree.map(toSidebarNode)}
        trash={trash.map((e) => ({
          id: e.id,
          title: e.title,
          trashedAt: e.trashedAt.toISOString(),
          purgeAfter: e.purgeAfter?.toISOString() ?? null,
          descendantCount: e.descendantCount,
        }))}
        recent={recent.map((e) => ({ id: e.id, title: e.title }))}
        favorites={favorites.map((e) => ({ id: e.id, title: e.title }))}
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
        recent={recent.map((e) => ({ id: e.id, title: e.title }))}
      />
    </div>
  )
}
