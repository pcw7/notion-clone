/**
 * 사본의 embed 연결 묶음 — 원본 페이지 하나에 연결 하나 (SB-2 · F-01-11 · 정본 [보강 SB-0] ⑧ · ㉯)
 *
 *   · 그 페이지를 가리키는 사본들이 한 연결(한 Y.Doc)을 나누고, 사본마다 자기 X 의 그룹에 묶는다
 *   · **화면에 들 때 붙는다** — 사본이 처음 보일 때 연다(보이지 않은 사본은 연결을 열지 않는다)
 *   · 붙은 원본 페이지가 상한(6)을 넘으면 **지금 보이는 사본이 없는 것 중 가장 오래 안 보인 것**부터 끊는다(01 *"구독 중인 클라이언트에만
 *     push"*). 끊긴 페이지의 사본은 `null` 을 받고(자리 "불러오는 중"), 다시 보이면 새로 연다. 모두 보이는 중이면 넘겨도 끊지 않는다
 *   · 마지막 사본이 떠나면 닫는다
 *
 * 연결은 `openCollabConnection({ embed: true })` 다(presence · 보존본 · 보내기가 없다). DOM 이 없다 — 단위 검사가 가짜 연결로 돈다.
 */

import type { CollabConnection, CollabSnapshot } from '../collab/collab-connection.ts'

/** 한 사본이 쥔 몫. */
export type EmbedLease = {
  /** 사본이 화면에 들었다 · 나갔다(IntersectionObserver). */
  setVisible(visible: boolean): void
  /** 사본이 떠난다(노드 뷰를 내린다 · 해석이 바뀌었다). */
  release(): void
}

export type EmbedPool = {
  /** `pageId` 의 연결을 나눠 쓴다 — 연결의 스냅숏이 바뀔 때마다 · 끊기면 null 을 받는다. */
  acquire(pageId: string, onChange: (snapshot: CollabSnapshot | null) => void): EmbedLease
  /** 지금 연(여는 중 포함) 원본 페이지 — 검사용. */
  openPages(): string[]
}

export type EmbedPoolOptions = {
  /** embed 연결을 연다 — 스냅숏이 바뀌면 `onChange`. */
  open(pageId: string, onChange: (snapshot: CollabSnapshot) => void): Promise<CollabConnection>
  /** 붙은 원본 페이지의 상한. 기본 6(정본 ⑧). */
  readonly cap?: number
  readonly now?: () => number
}

type Lease = EmbedLease & { visible: boolean; readonly onChange: (snapshot: CollabSnapshot | null) => void }

type Entry = {
  readonly pageId: string
  readonly leases: Set<Lease>
  /** 열린 연결(또는 여는 중) — 끊으면 null. */
  connection: Promise<CollabConnection> | null
  /** 마지막 스냅숏 — 늦게 온 사본에 곧바로 준다. */
  snapshot: CollabSnapshot | null
  /** 마지막으로 보였던 때 — 끊을 차례(오래 안 보인 것부터). */
  lastVisibleAt: number
}

export function createEmbedPool(options: EmbedPoolOptions): EmbedPool {
  const cap = options.cap ?? 6
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  const notify = (entry: Entry): void => {
    for (const lease of entry.leases) lease.onChange(entry.snapshot)
  }

  const disconnect = (entry: Entry): void => {
    const connection = entry.connection
    entry.connection = null
    entry.snapshot = null
    void connection?.then((c) => c.destroy()).catch(() => undefined)
  }

  const anyVisible = (entry: Entry): boolean => [...entry.leases].some((lease) => lease.visible)

  /** 상한을 넘으면 보이는 사본이 없는 것 중 가장 오래 안 보인 것부터 끊는다. */
  const enforceCap = (): void => {
    const connected = [...entries.values()].filter((entry) => entry.connection !== null)
    let over = connected.length - cap
    if (over <= 0) return
    const idle = connected.filter((entry) => !anyVisible(entry)).sort((a, b) => a.lastVisibleAt - b.lastVisibleAt)
    for (const entry of idle) {
      if (over <= 0) break
      disconnect(entry)
      notify(entry)
      over -= 1
    }
  }

  const connect = (entry: Entry): void => {
    if (entry.connection !== null) return
    const opening = options.open(entry.pageId, (snapshot) => {
      if (entry.connection !== opening) return // 끊은 뒤에 온 것
      entry.snapshot = snapshot
      notify(entry)
    })
    entry.connection = opening
    opening.catch(() => {
      if (entry.connection === opening) entry.connection = null
    })
    enforceCap()
  }

  return {
    acquire(pageId, onChange) {
      let entry = entries.get(pageId)
      if (entry === undefined) {
        entry = { pageId, leases: new Set(), connection: null, snapshot: null, lastVisibleAt: 0 }
        entries.set(pageId, entry)
      }
      const owner = entry
      const lease: Lease = {
        visible: false,
        onChange,
        setVisible(visible) {
          if (!owner.leases.has(lease)) return
          lease.visible = visible
          // 보였던 때를 적는다 — 나가는 순간도 "그때까지 보였다"
          owner.lastVisibleAt = now()
          if (visible) connect(owner)
        },
        release() {
          if (!owner.leases.delete(lease)) return
          if (owner.leases.size > 0) return
          disconnect(owner)
          entries.delete(pageId)
        },
      }
      entry.leases.add(lease)
      if (entry.snapshot !== null) onChange(entry.snapshot)
      return lease
    },
    openPages: () => [...entries.values()].filter((entry) => entry.connection !== null).map((entry) => entry.pageId),
  }
}
