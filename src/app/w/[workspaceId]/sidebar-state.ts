/**
 * 사이드바 펼침·접힘 상태 — 기기별 로컬 저장.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 `useState` + `useEffect` 가 아닌가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 상태는 **React 밖에 산다**(`localStorage`). 그걸 `useEffect` 안에서 읽어
 * `setState` 하면 두 가지가 걸린다:
 *   - 서버 렌더에는 `window` 가 없어 첫 렌더가 "접힌 트리"가 되고, 마운트 직후
 *     한 번 더 렌더된다 — 화면이 깜빡인다
 *   - React Compiler 린트가 "effect 안의 동기 setState 는 연쇄 렌더를 유발한다"고
 *     막는다 (실제로 맞는 지적이다)
 *
 * `useSyncExternalStore` 가 정확히 이 모양을 위한 API 다. 서버 스냅샷과 클라이언트
 * 스냅샷을 따로 주므로 하이드레이션 불일치 없이 저장된 값을 쓴다.
 *
 * 스토어를 워크스페이스별로 **모듈 수준에 캐시**한다. 사이드바가 다시 마운트돼도
 * (라우트 이동 등) 같은 스토어를 보므로 펼침 상태가 살아 있다.
 */

export type SidebarState = {
  readonly expanded: ReadonlySet<string>
  readonly collapsed: boolean
}

export type SidebarStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): SidebarState
  getServerSnapshot(): SidebarState
  toggleExpanded(id: string): void
  expandAll(ids: readonly string[]): void
  toggleCollapsed(): void
}

/** 서버에는 저장된 값이 없다. 항상 같은 객체를 돌려줘야 무한 렌더가 안 난다. */
const SERVER_STATE: SidebarState = { expanded: new Set(), collapsed: false }

const stores = new Map<string, SidebarStore>()

function storageKey(workspaceId: string): string {
  return `nc:sidebar:${workspaceId}`
}

type Persisted = { expanded?: unknown; collapsed?: unknown }

function load(workspaceId: string): SidebarState {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId))
    if (!raw) return SERVER_STATE
    const parsed = JSON.parse(raw) as Persisted
    const expanded = Array.isArray(parsed.expanded)
      ? new Set(parsed.expanded.filter((v): v is string => typeof v === 'string'))
      : new Set<string>()
    return { expanded, collapsed: parsed.collapsed === true }
  } catch {
    // 사생활 보호 모드·용량 초과·손상된 값. 사이드바가 안 뜨는 것보다
    // 기본 상태로라도 뜨는 편이 낫다.
    return SERVER_STATE
  }
}

function save(workspaceId: string, state: SidebarState): void {
  try {
    window.localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify({ expanded: [...state.expanded], collapsed: state.collapsed }),
    )
  } catch {
    // 저장 실패가 조작을 막지는 않는다 — 이번 세션에서만 유지된다.
  }
}

export function getSidebarStore(workspaceId: string): SidebarStore {
  const existing = stores.get(workspaceId)
  if (existing) return existing

  let state: SidebarState | null = null
  const listeners = new Set<() => void>()

  const emit = (next: SidebarState): void => {
    state = next
    save(workspaceId, next)
    for (const listener of listeners) listener()
  }

  const store: SidebarStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      // 첫 호출에서만 읽는다. 매번 읽으면 새 객체가 나와 무한 렌더가 난다.
      if (state === null) state = load(workspaceId)
      return state
    },
    getServerSnapshot() {
      return SERVER_STATE
    },
    toggleExpanded(id) {
      const current = store.getSnapshot()
      const expanded = new Set(current.expanded)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      emit({ ...current, expanded })
    },
    expandAll(ids) {
      const current = store.getSnapshot()
      if (ids.every((id) => current.expanded.has(id))) return // 바뀐 게 없다
      const expanded = new Set(current.expanded)
      for (const id of ids) expanded.add(id)
      emit({ ...current, expanded })
    },
    toggleCollapsed() {
      const current = store.getSnapshot()
      emit({ ...current, collapsed: !current.collapsed })
    },
  }

  stores.set(workspaceId, store)
  return store
}
