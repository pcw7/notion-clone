/**
 * 이 탭에서 연 페이지의 차례 — 사이드바의 최근에 덧댄다 (10n-72 · F-07-16 · HANDOFF §3.2-305)
 *
 * 레이아웃은 앱 안 이동에서 다시 그려지지 않아 서버가 준 최근 목록이 낡는다(`lib/nav/recent-overlay.ts` 머리말). 화면이 연 차례를 여기
 * 기억하고 사이드바가 그 위에 덧댄다. **메모리에만** 산다 — 새로 읽으면 서버의 기록(`recordVisit`)이 같은 차례를 준다. 사이드바의
 * 펼침 상태(`sidebar-state.ts`)와 같은 모양의 바깥 스토어다(`useSyncExternalStore` — effect 안의 setState 가 없다).
 */

import { pushVisit } from '@/lib/nav/recent-overlay'

export type VisitHistory = {
  subscribe(listener: () => void): () => void
  getSnapshot(): readonly string[]
  getServerSnapshot(): readonly string[]
  /** 연 페이지 — 새 것이 앞. 맨 앞이 그대로면 알리지 않는다. */
  visit(id: string): void
}

/** 서버에는 방문이 없다. 늘 같은 배열을 돌려줘야 무한 렌더가 안 난다. */
const NONE: readonly string[] = []

const histories = new Map<string, VisitHistory>()

export function getVisitHistory(workspaceId: string): VisitHistory {
  const existing = histories.get(workspaceId)
  if (existing !== undefined) return existing
  let visits: readonly string[] = NONE
  const listeners = new Set<() => void>()
  const history: VisitHistory = {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => visits,
    getServerSnapshot: () => NONE,
    visit(id) {
      const next = pushVisit(visits, id)
      if (next === visits) return
      visits = next
      for (const listener of listeners) listener()
    },
  }
  histories.set(workspaceId, history)
  return history
}
