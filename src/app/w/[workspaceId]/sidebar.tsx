'use client'

/**
 * 사이드바 — F-02-03 / F-07-16
 *
 * ──────────────────────────────────────────────────────────────────────
 * 펼침 상태는 로컬에 둔다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-02-03 은 `sidebar_state(user_id, block_id, expanded)` 테이블을 제안하고,
 * 동시에 *"다른 기기에서 펼침 상태 변경 — 로컬 저장이면 기기별로 갈린다.
 * **어느 쪽인지 제품 결정 필요** `[확인필요]`"* 라고 남겼다.
 *
 * **정본(`00-canonical-data-model.md`)에는 그 테이블이 없다.** CLAUDE.md 절대
 * 제약 3 대로, 정본에 없는 테이블을 만들려면 정본을 먼저 고쳐야 한다. 펼침
 * 상태 하나 때문에 스키마 판결을 열 이유가 없으므로 **`localStorage`(기기별)**
 * 로 간다. 서버 동기화가 필요해지면 그때 정본에 테이블을 추가한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 섹션을 만들지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * Favorites / Teamspaces / Shared / Private 는 F-07-16 이 *"섹션 = 권한 상태의
 * **파생 뷰**이지 저장된 분류가 아니다"* 라고 못박는다. teamspace 도 `acl_entry`
 * 도 없는 지금은 **파생될 근거가 없다.** 하나의 페이지 트리로 둔다.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { TrashPanel, type TrashRow } from './trash-panel'
import { getSidebarStore } from './sidebar-state'

export type SidebarNode = {
  id: string
  title: string
  hasChildren: boolean
  children: SidebarNode[]
}

const UNTITLED = '제목 없음'

/** 트리에서 대상까지의 조상 id 들. 현재 페이지가 보이도록 자동으로 펼친다. */
function ancestorsOf(nodes: readonly SidebarNode[], targetId: string): string[] {
  const walk = (list: readonly SidebarNode[], path: string[]): string[] | null => {
    for (const node of list) {
      if (node.id === targetId) return path
      const found = walk(node.children, [...path, node.id])
      if (found) return found
    }
    return null
  }
  return walk(nodes, []) ?? []
}

export type NavRow = { id: string; title: string }

export function Sidebar({
  workspaceId,
  tree,
  trash,
  recent,
  favorites,
}: {
  workspaceId: string
  tree: SidebarNode[]
  trash: TrashRow[]
  /** 최근 방문(F-07-04). 서버가 권한으로 걸러서 준다. */
  recent: NavRow[]
  /** 즐겨찾기(F-07-16). 같은 규칙. */
  favorites: NavRow[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  /** `/w/{ws}/{pageId}` 에서 현재 페이지를 읽는다. 레이아웃은 자식 params 를 모른다. */
  const currentPageId = useMemo(() => {
    const match = pathname.match(/^\/w\/[^/]+\/([^/]+)/)
    return match ? match[1] : null
  }, [pathname])

  const [busy, setBusy] = useState(false)

  // 펼침·접힘은 React 밖(localStorage)에 산다. useSyncExternalStore 가 서버·
  // 클라이언트 스냅샷을 따로 주므로 하이드레이션 불일치도, effect 안 setState 도 없다.
  const store = useMemo(() => getSidebarStore(workspaceId), [workspaceId])
  const { expanded, collapsed } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  )

  // 현재 페이지가 접힌 가지 안에 있으면 보이지 않는다. 조상을 펼친다.
  // 스토어를 건드리는 것이라 effect 안의 setState 가 아니고, expandAll 은
  // 바뀐 게 없으면 알림을 보내지 않아 연쇄 렌더가 없다.
  useEffect(() => {
    if (currentPageId === null) return
    const path = ancestorsOf(tree, currentPageId)
    if (path.length > 0) store.expandAll(path)
  }, [currentPageId, tree, store])

  const toggle = useCallback((id: string) => store.toggleExpanded(id), [store])
  const toggleSidebar = useCallback(() => store.toggleCollapsed(), [store])

  // F-02-03 / F-07-16: `cmd/ctrl + \` 로 사이드바 토글.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '\\' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar])

  const addChild = useCallback(
    async (parentPageId: string | null) => {
      setBusy(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentPageId }),
        })
        const data = await res.json()
        if (!res.ok) return
        if (parentPageId !== null) store.expandAll([parentPageId])
        router.push(`/w/${workspaceId}/${data.page.id}`)
        router.refresh()
      } finally {
        setBusy(false)
      }
    },
    [workspaceId, router, store],
  )

  if (collapsed) {
    return (
      <div className="flex flex-none flex-col border-r border-neutral-200 p-2 dark:border-neutral-800">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="사이드바 열기"
          title="사이드바 열기 (Ctrl/Cmd + \)"
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          »
        </button>
      </div>
    )
  }

  return (
    <nav
      aria-label="페이지 트리"
      className="flex w-64 flex-none flex-col gap-2 border-r border-neutral-200 p-3 dark:border-neutral-800"
    >
      <div className="flex items-center justify-between">
        <Link
          href={`/w/${workspaceId}`}
          className="truncate text-sm font-medium hover:underline underline-offset-4"
        >
          워크스페이스
        </Link>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="사이드바 접기"
          title="사이드바 접기 (Ctrl/Cmd + \)"
          className="rounded px-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          «
        </button>
      </div>

      {/*
        F-07-16 의 사이드바는 트리 하나가 아니라 **섹션들**이다. 즐겨찾기는 위,
        최근 방문은 아래 — 둘 다 서버가 권한으로 걸러서 준다(`nav/recent.ts`).
        빈 섹션은 그리지 않는다. 아무것도 없는 제목만 남으면 공간만 먹는다.
      */}
      <NavSection label="즐겨찾기" rows={favorites} workspaceId={workspaceId} currentPageId={currentPageId} />

      <ul className="flex-1 overflow-auto">
        {tree.map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            workspaceId={workspaceId}
            currentPageId={currentPageId}
            expanded={expanded}
            busy={busy}
            onToggle={toggle}
            onAddChild={addChild}
          />
        ))}
        {tree.length === 0 && (
          <li className="px-2 py-3 text-sm text-neutral-400">페이지가 없습니다</li>
        )}
      </ul>

      <button
        type="button"
        disabled={busy}
        onClick={() => void addChild(null)}
        className="self-start rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
      >
        + 새 페이지
      </button>

      <NavSection label="최근" rows={recent} workspaceId={workspaceId} currentPageId={currentPageId} />

      <TrashPanel workspaceId={workspaceId} entries={trash} />
    </nav>
  )
}

function TreeItem({
  node,
  depth,
  workspaceId,
  currentPageId,
  expanded,
  busy,
  onToggle,
  onAddChild,
}: {
  node: SidebarNode
  depth: number
  workspaceId: string
  currentPageId: string | null
  expanded: ReadonlySet<string>
  busy: boolean
  onToggle: (id: string) => void
  onAddChild: (parentPageId: string) => void
}) {
  const isOpen = expanded.has(node.id)
  const isCurrent = node.id === currentPageId

  return (
    <li>
      <div
        className={`group flex items-center gap-0.5 rounded px-1 ${
          isCurrent ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {node.hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? '접기' : '펼치기'}
            aria-expanded={isOpen}
            className="w-4 flex-none text-xs text-neutral-400"
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 flex-none" aria-hidden />
        )}

        <Link
          href={`/w/${workspaceId}/${node.id}`}
          aria-current={isCurrent ? 'page' : undefined}
          className="min-w-0 flex-1 truncate py-1 text-sm"
        >
          {node.title || UNTITLED}
        </Link>

        <button
          type="button"
          disabled={busy}
          onClick={() => onAddChild(node.id)}
          aria-label={`${node.title || UNTITLED} 아래에 페이지 추가`}
          title="하위 페이지 추가"
          className="flex-none px-1 text-sm text-neutral-400 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
        >
          +
        </button>
      </div>

      {isOpen && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              currentPageId={currentPageId}
              expanded={expanded}
              busy={busy}
              onToggle={onToggle}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * 사이드바의 한 섹션(즐겨찾기 · 최근).
 *
 * 트리가 아니라 **평평한 목록**이다 — 정본 F-07-16 이 상단 진입점과 트리 섹션을
 * 성격이 다른 두 층으로 나눈 그대로다. 여기에 펼침/접힘을 넣으면 트리와 같은
 * 상태를 두 벌 관리하게 된다.
 */
function NavSection({
  label,
  rows,
  workspaceId,
  currentPageId,
}: {
  label: string
  rows: NavRow[]
  workspaceId: string
  currentPageId: string | null
}) {
  if (rows.length === 0) return null

  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <h2 className="px-2 text-xs font-medium text-neutral-400">{label}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/w/${workspaceId}/${row.id}`}
              aria-current={row.id === currentPageId ? 'page' : undefined}
              className={`block truncate rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                row.id === currentPageId ? 'bg-neutral-100 dark:bg-neutral-800' : ''
              }`}
            >
              {row.title || UNTITLED}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
