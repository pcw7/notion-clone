/**
 * 지금 그 페이지를 보는 사람 — 협업 서버가 적고 알림 배달이 읽는다 (33번 트랙 AW-2 · F-05-03 · 정본 §3.7 presence [보강 AW-2] · §3.8 배달 3단 ③)
 *
 * 접속자 표시(AW-1)의 awareness 는 협업 서버의 메모리에 있다. 알림은 다른 곳(앱의 API · 협업 서버의 투영)이 만든다 — 그 사이를 Valkey 의
 * `presence:{page_id}` HASH 가 잇는다(정본 §3.7 런타임 구독 레지스트리 · DB 에 저장하지 않는다).
 *
 *   칸    user_id
 *   값    '1' — 그 사람의 탭 중 보이는 것이 있다 · '0' — 숨은 탭(다른 탭 · 최소화)뿐이다
 *   TTL   30초(키 전체) — 협업 서버가 awareness 를 받을 때마다(provider 는 15초마다 갱신한다) 통째로 다시 쓴다. 협업 서버가 죽으면 30초 안에 사라진다.
 *
 * 읽는 쪽은 실패하면 **아무도 보지 않는 것으로** 한다 — 알림 하나를 더 받는 쪽이 하나를 잃는 쪽보다 낫다.
 */
import { getValkey } from '../valkey.ts'

export const PRESENCE_TTL_SECONDS = 30

export const presenceKey = (pageId: string): string => `presence:${pageId}`

/** awareness 상태들에서 사람마다 보이는 탭이 있는지 — 순수. 서버가 채운 사람(`user.user_id`)이 없는 상태는 버린다. */
export function viewersOf(states: ReadonlyMap<number, unknown>): Map<string, boolean> {
  const viewers = new Map<string, boolean>()
  for (const raw of states.values()) {
    const state = raw as { user?: { user_id?: unknown }; visible?: unknown } | null
    const userId = state?.user?.user_id
    if (typeof userId !== 'string' || userId.length === 0) continue
    viewers.set(userId, viewers.get(userId) === true || state?.visible === true)
  }
  return viewers
}

/** 협업 서버가 한 페이지의 지금 접속자를 적는 곳. */
export type PresenceStore = {
  /** 한 페이지의 지금 상태를 통째로 적는다(빈 맵이면 지운다). 던지지 않는다 — 접속자 표시는 이것 없이도 돈다. */
  record(pageId: string, viewers: ReadonlyMap<string, boolean>): void
}

/**
 * Valkey 에 적는다 — 지우기 · 쓰기 · TTL 을 한 MULTI 로(읽는 쪽이 반쯤 쓴 상태를 보지 않는다). 부른 차례대로 간다(한 연결의 명령은
 * 차례를 지킨다 — 기다리지 않고 곧바로 보낸다).
 */
export function valkeyPresenceStore(): PresenceStore {
  return {
    record(pageId, viewers) {
      const key = presenceKey(pageId)
      const multi = getValkey().multi().del(key)
      if (viewers.size > 0) {
        multi.hset(key, Object.fromEntries([...viewers].map(([userId, visible]) => [userId, visible ? '1' : '0'])))
        multi.expire(key, PRESENCE_TTL_SECONDS)
      }
      multi.exec().catch((error: unknown) => {
        console.warn('[presence] Valkey 에 적지 못했다:', error instanceof Error ? error.message : error)
      })
    },
  }
}

/**
 * 받을 사람들 중 지금 그 페이지를 **보이는 탭으로** 보고 있는 사람들(배달 3단 ③). Valkey 가 없거나 느리면(1초) 빈 집합 — 억제하지 않는다.
 */
export async function activeViewersOf(pageId: string, userIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (userIds.length === 0) return new Set()
  try {
    const values = await getValkey().hmget(presenceKey(pageId), ...userIds)
    return new Set(userIds.filter((_, i) => values[i] === '1'))
  } catch (error) {
    console.warn('[presence] 지금 보는 사람을 읽지 못했다 — 억제하지 않는다:', error instanceof Error ? error.message : error)
    return new Set()
  }
}
