/**
 * 표 · 목록의 그룹 덩이 접기 — 보는 사람의 이 기기에 산다 (그룹 트랙 G-2a · 정본 §3.6 [보강 G-1] ⑥)
 *
 * 접은 그룹 키를 뷰마다 `localStorage` 에 둔다(사이드바의 펼침과 같은 자리 · `sidebar-state.ts`). 보기 설정(서버)이 아니다 — 한 사람이
 * 접었다고 같은 보기를 보는 다른 사람의 덩이가 접히지 않는다. 서버가 그린 첫 화면에는 접힌 것이 없다(`getServerSnapshot`) — 읽는 쪽이
 * `useSyncExternalStore` 로 읽어 하이드레이션이 어긋나지 않는다.
 */

export type GroupCollapseStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReadonlySet<string>
  getServerSnapshot(): ReadonlySet<string>
  toggle(key: string): void
}

/** 서버에는 저장된 값이 없다. 같은 객체를 돌려줘야 무한 렌더가 안 난다. */
const NONE: ReadonlySet<string> = new Set()

const stores = new Map<string, GroupCollapseStore>()

const storageKey = (viewId: string) => `nc:group-collapsed:${viewId}`

function load(viewId: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(viewId))
    if (!raw) return NONE
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : NONE
  } catch {
    // 사생활 보호 모드 · 손상된 값 — 접힌 것 없이 그린다
    return NONE
  }
}

function save(viewId: string, keys: ReadonlySet<string>): void {
  try {
    if (keys.size === 0) window.localStorage.removeItem(storageKey(viewId))
    else window.localStorage.setItem(storageKey(viewId), JSON.stringify([...keys]))
  } catch {
    // 저장 실패가 조작을 막지는 않는다 — 이번 화면에서만 유지된다
  }
}

export function getGroupCollapseStore(viewId: string): GroupCollapseStore {
  const existing = stores.get(viewId)
  if (existing) return existing
  const listeners = new Set<() => void>()
  let current: ReadonlySet<string> | null = null
  const store: GroupCollapseStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      if (current === null) current = load(viewId)
      return current
    },
    getServerSnapshot: () => NONE,
    toggle(key) {
      const next = new Set(store.getSnapshot())
      if (next.has(key)) next.delete(key)
      else next.add(key)
      current = next
      save(viewId, next)
      for (const listener of listeners) listener()
    },
  }
  stores.set(viewId, store)
  return store
}
