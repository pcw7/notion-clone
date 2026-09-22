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
 * 섹션 — 즐겨찾기 · Teamspaces · 워크스페이스 페이지 (7c-2)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-16: *"섹션 = 권한 상태의 **파생 뷰**이지 저장된 분류가 아니다."* 트리는
 * 서버가 한 벌로 엮고 레이아웃이 루트를 **내 teamspace 별로** 갈라 준다
 * (`groupRootsByTeamspace`). 여기서는 그 모양대로 그린다 — 가르는 규칙을 화면에
 * 두 벌 두지 않는다. teamspace 는 이름(→ 그 teamspace 의 화면) · `+`(그 최상위에
 * 새 페이지) · `▦`(새 데이터베이스 — 7c-4) · 그 아래 트리다. 나머지 루트는 "워크스페이스 페이지"다 — 워크스페이스
 * 직속, 그리고 멤버가 아닌 teamspace 에서 따로 공유받은 페이지(Shared 섹션은 아직
 * 없다 · §7). teamspace 를 만들 수도 가질 수도 없는 사람(게스트)의 사이드바는 전과
 * 같다 — 섹션 머리도 없다.
 *
 * 섹션 머리를 눌러 접는 것(F-07-16)은 아직 없다 — teamspace 는 늘 펼쳐져 있다.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { TeamspaceCreateForm } from './teamspace-create'
import { TrashPanel, type TrashRow } from './trash-panel'
import { getSidebarStore } from './sidebar-state'
import { openSearchOverlay } from './search-overlay'
import { requestDuplicate } from './duplicate-page'

export type SidebarNode = {
  id: string
  title: string
  /** 풀페이지 데이터베이스는 페이지 라우트로 열리지 않는다 — 링크를 고르는 근거다. */
  kind: 'page' | 'database'
  hasChildren: boolean
  children: SidebarNode[]
}

/** 사이드바의 teamspace 하나 — 내가 멤버인 것만 온다. `pages` 는 그 최상위부터의 트리다. */
export type SidebarTeamspace = { id: string; name: string; pages: SidebarNode[] }

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
  teamspaces,
  canCreateTeamspace,
  trash,
  recent,
  favorites,
  inboxUnread,
}: {
  workspaceId: string
  /** teamspace 에 들지 않은 루트 — 워크스페이스 직속 · 멤버가 아닌 teamspace 에서 공유받은 페이지. */
  tree: SidebarNode[]
  /** 내가 멤버인 teamspace 와 그 트리(7c-2). 서버가 갈라 준다. */
  teamspaces: SidebarTeamspace[]
  /** teamspace 를 만들 수 있는 역할인가 — 표시 전용(서버가 다시 묻는다). */
  canCreateTeamspace: boolean
  trash: TrashRow[]
  /** 안 읽은 알림 수(F-11-07). 서버가 권한으로 걸러서 센다 — 볼 수 없게 된 페이지의 알림은 빠진다(§3.3-131). */
  inboxUnread: number
  /** 최근 방문(F-07-04). 서버가 권한으로 걸러서 준다. */
  recent: NavRow[]
  /** 즐겨찾기(F-07-16). 같은 규칙. */
  favorites: NavRow[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  /**
   * `/w/{ws}/{pageId}` · `/w/{ws}/db/{databaseId}` 에서 현재 노드를 읽는다. 레이아웃은
   * 자식 params 를 모른다. `db/` 를 건너뛰지 않으면 데이터베이스 화면에서 현재 노드가
   * 문자열 `'db'` 가 되어 아무 줄도 강조되지 않는다.
   */
  const currentPageId = useMemo(() => {
    const match = pathname.match(/^\/w\/[^/]+\/(?:db\/)?([^/]+)/)
    return match ? match[1] : null
  }, [pathname])

  /** `/w/{ws}/teamspaces/{id}` — 그 teamspace 의 줄을 강조한다. */
  const currentTeamspaceId = useMemo(() => pathname.match(/^\/w\/[^/]+\/teamspaces\/([^/]+)/)?.[1] ?? null, [pathname])

  /** 펼칠 조상을 찾을 트리 — 섹션이 갈라져 있어도 현재 페이지는 어느 섹션에든 있다. */
  const allNodes = useMemo(() => [...tree, ...teamspaces.flatMap((t) => t.pages)], [tree, teamspaces])
  const [creatingTeamspace, setCreatingTeamspace] = useState(false)

  const [busy, setBusy] = useState(false)
  /** 복제가 할 말 한 줄 — 빠진 하위 페이지 · 실패. 트리 아래에 선다. */
  const [note, setNote] = useState<{ readonly text: string; readonly tone: 'status' | 'error' } | null>(null)

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
    const path = ancestorsOf(allNodes, currentPageId)
    if (path.length > 0) store.expandAll(path)
  }, [currentPageId, allNodes, store])

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

  /** 새 페이지를 만들고 연다 — 자리는 부모 페이지 · 워크스페이스 직속(`parentPageId: null`) · teamspace 의 최상위 중 하나다. */
  const openNewPage = useCallback(
    async (at: { parentPageId: string | null } | { teamspaceId: string }) => {
      setBusy(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/pages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(at),
        })
        const data = await res.json()
        if (!res.ok) return
        if ('parentPageId' in at && at.parentPageId !== null) store.expandAll([at.parentPageId])
        router.push(`/w/${workspaceId}/${data.page.id}`)
        router.refresh()
      } finally {
        setBusy(false)
      }
    },
    [workspaceId, router, store],
  )
  const addChild = useCallback((parentPageId: string | null) => openNewPage({ parentPageId }), [openNewPage])
  const addTeamspacePage = useCallback((teamspaceId: string) => openNewPage({ teamspaceId }), [openNewPage])

  /**
   * 페이지를 복제한다 — 6b. 빠진 것이 없으면 사본으로 옮겨 가고, 있으면 **멈춰서 말한다**(`duplicate-page.ts`).
   *
   * 트리는 어느 쪽이든 새로 받는다 — 사본이 원본 바로 뒤에 서야 한다.
   */
  const duplicate = useCallback(
    async (pageId: string) => {
      setBusy(true)
      setNote(null)
      try {
        const result = await requestDuplicate(workspaceId, pageId)
        router.refresh()
        if (!result.ok) {
          setNote({ text: result.message, tone: 'error' })
          return
        }
        if (result.note.navigate) router.push(`/w/${workspaceId}/${result.pageId}`)
        else if (result.note.text !== null) setNote({ text: result.note.text, tone: 'status' })
      } finally {
        setBusy(false)
      }
    },
    [workspaceId, router],
  )

  // 풀페이지 데이터베이스를 만들고 연다(F-04-14). "새 페이지"와 같은 규칙 — 이름을
  // 먼저 묻지 않고 빈 표를 연다. 표·제목 컬럼·기본 뷰는 서버가 한 트랜잭션에서 만든다.
  // teamspace 를 주면 그 최상위에 만든다(7c-4) — 워크스페이스 최상위 "+ 새 데이터베이스"는 teamspace 없이 부른다.
  const addDatabase = useCallback(async (teamspaceId: string | null = null) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/databases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(teamspaceId === null ? {} : { teamspaceId }),
      })
      const data = await res.json()
      if (!res.ok) return
      router.push(`/w/${workspaceId}/db/${data.database.id}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }, [workspaceId, router])

  // teamspace 를 가졌거나 만들 수 있으면 섹션을 세운다. 둘 다 아니면(게스트) 사이드바는 전과 같다.
  const showTeamspaces = teamspaces.length > 0 || canCreateTeamspace

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
        검색 진입점 — W7 / F-07-01. 단축키(`cmd/ctrl + K` · `cmd/ctrl + P`)만
        두면 아무도 모르는 기능이 된다. 오버레이 자체는 레이아웃이 그리고
        여기서는 여는 신호만 보낸다 — 사이드바 안에 모달을 두면 `<nav>` 안에
        `role="dialog"` 가 들어가고, 사이드바를 접으면 검색도 같이 사라진다.
      */}
      <button
        type="button"
        onClick={openSearchOverlay}
        title="검색 (Ctrl/Cmd + K)"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span aria-hidden>🔍</span>
        <span>검색</span>
      </button>

      {/* 인박스 — F-11-07. 배지는 "지금 안 읽은 수"이고 서버가 권한으로 걸러 센다. */}
      <Link
        href={`/w/${workspaceId}/inbox`}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span aria-hidden>📥</span>
        <span>인박스</span>
        {inboxUnread > 0 && (
          <span
            aria-label={`안 읽은 알림 ${inboxUnread}개`}
            className="ml-auto rounded-full bg-neutral-900 px-1.5 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {inboxUnread}
          </span>
        )}
      </Link>

      {/*
        F-07-16 의 사이드바는 트리 하나가 아니라 **섹션들**이다. 즐겨찾기는 위,
        최근 방문은 아래 — 둘 다 서버가 권한으로 걸러서 준다(`nav/recent.ts`).
        빈 섹션은 그리지 않는다. 아무것도 없는 제목만 남으면 공간만 먹는다.
      */}
      <NavSection label="즐겨찾기" rows={favorites} workspaceId={workspaceId} currentPageId={currentPageId} />

      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {showTeamspaces && (
          <section aria-label="Teamspaces" data-testid="sidebar-teamspaces" className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xs font-medium text-neutral-400">Teamspaces</h2>
              {canCreateTeamspace && (
                <button
                  type="button"
                  data-testid="teamspace-create-open"
                  aria-label="teamspace 만들기"
                  aria-expanded={creatingTeamspace}
                  title="teamspace 만들기"
                  onClick={() => setCreatingTeamspace((open) => !open)}
                  className="rounded px-1 text-sm text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  +
                </button>
              )}
            </div>
            {creatingTeamspace && (
              <TeamspaceCreateForm workspaceId={workspaceId} onClose={() => setCreatingTeamspace(false)} />
            )}
            <ul>
              {teamspaces.map((teamspace) => (
                <li key={teamspace.id} data-testid="sidebar-teamspace" data-teamspace-id={teamspace.id}>
                  <div
                    className={`group flex items-center gap-0.5 rounded px-1 ${
                      teamspace.id === currentTeamspaceId
                        ? 'bg-neutral-100 dark:bg-neutral-800'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span aria-hidden className="w-4 flex-none text-xs text-neutral-400">
                      ▣
                    </span>
                    <Link
                      href={`/w/${workspaceId}/teamspaces/${teamspace.id}`}
                      data-testid="sidebar-teamspace-link"
                      aria-current={teamspace.id === currentTeamspaceId ? 'page' : undefined}
                      className="min-w-0 flex-1 truncate py-1 text-sm font-medium"
                    >
                      {teamspace.name}
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="sidebar-teamspace-add"
                      onClick={() => void addTeamspacePage(teamspace.id)}
                      aria-label={`${teamspace.name}에 페이지 추가`}
                      title="이 teamspace 에 페이지 추가"
                      className="flex-none px-1 text-sm text-neutral-400 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="sidebar-teamspace-add-database"
                      onClick={() => void addDatabase(teamspace.id)}
                      aria-label={`${teamspace.name}에 데이터베이스 추가`}
                      title="이 teamspace 에 데이터베이스 추가"
                      className="flex-none px-1 text-xs text-neutral-400 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                    >
                      ▦
                    </button>
                  </div>
                  {teamspace.pages.length > 0 ? (
                    <ul>
                      {teamspace.pages.map((node) => (
                        <TreeItem
                          key={node.id}
                          node={node}
                          depth={1}
                          workspaceId={workspaceId}
                          currentPageId={currentPageId}
                          expanded={expanded}
                          busy={busy}
                          onToggle={toggle}
                          onAddChild={addChild}
                          onDuplicate={duplicate}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="py-0.5 pl-9 text-xs text-neutral-400">페이지 없음</p>
                  )}
                </li>
              ))}
            </ul>
            {teamspaces.length === 0 && !creatingTeamspace && (
              <p className="px-2 text-xs text-neutral-400">아직 teamspace 가 없습니다</p>
            )}
          </section>
        )}

        <section aria-label="워크스페이스 페이지" className="flex flex-col gap-0.5">
          {showTeamspaces && <h2 className="px-2 text-xs font-medium text-neutral-400">워크스페이스 페이지</h2>}
          <ul>
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
                onDuplicate={duplicate}
              />
            ))}
            {tree.length === 0 && (
              <li className="px-2 py-3 text-sm text-neutral-400">페이지가 없습니다</li>
            )}
          </ul>
        </section>
      </div>

      {note && (
        <p
          role={note.tone === 'error' ? 'alert' : 'status'}
          data-testid="sidebar-note"
          className={`px-2 text-xs ${note.tone === 'error' ? 'text-red-600' : 'text-neutral-500'}`}
        >
          {note.text}
        </p>
      )}

      <div className="flex flex-col">
        <button
          type="button"
          disabled={busy}
          onClick={() => void addChild(null)}
          className="self-start rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          + 새 페이지
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void addDatabase()}
          className="self-start rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          + 새 데이터베이스
        </button>
      </div>

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
  onDuplicate,
}: {
  node: SidebarNode
  depth: number
  workspaceId: string
  currentPageId: string | null
  expanded: ReadonlySet<string>
  busy: boolean
  onToggle: (id: string) => void
  onAddChild: (parentPageId: string) => void
  onDuplicate: (pageId: string) => void
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
          href={node.kind === 'database' ? `/w/${workspaceId}/db/${node.id}` : `/w/${workspaceId}/${node.id}`}
          aria-current={isCurrent ? 'page' : undefined}
          className="min-w-0 flex-1 truncate py-1 text-sm"
        >
          {node.kind === 'database' && (
            <span aria-hidden className="mr-1 text-neutral-400">
              ▦
            </span>
          )}
          {node.title || UNTITLED}
        </Link>

        {/* 데이터베이스 아래에는 하위 페이지를 만들지 않는다 — 그 자리는 표의 행이다. */}
        {node.kind === 'page' && (
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
        )}

        {/* 데이터베이스는 이 엔진이 복제하지 못한다 — 표의 스키마 · 행 · 엣지는 다른 조각이다(§7). */}
        {node.kind === 'page' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDuplicate(node.id)}
            aria-label={`${node.title || UNTITLED} 복제`}
            title="복제"
            data-testid="sidebar-duplicate"
            className="flex-none px-1 text-xs text-neutral-400 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
          >
            ⧉
          </button>
        )}
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
              onDuplicate={onDuplicate}
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
