/**
 * 접속자 표시(Presence) — awareness 상태의 모양 · 다듬기 · 동료 목록 (33번 트랙 AW-1 · F-05-03 · 정본 §3.7 presence(U-9) [보강 AW-1])
 *
 * 문서 CRDT 와 따로 도는 Yjs awareness 로 보낸다(DB 에 저장하지 않는다 · 연결이 끊기면 사라진다 · 30초 넘게 소식이 없으면 오프라인).
 * 한 연결의 상태:
 *
 *   user             { user_id, name }      — **서버가 채운다**(인증된 연결의 사람 · 클라이언트가 보낸 것은 버린다 — 사칭을 막는다)
 *   cursor           { block_id } | null    — 지금 캐럿이 있는 블록(글자 단위 원격 캐럿은 v2)
 *   block_selection  uuid[]                 — 고른 블록들(블록 선택) · 불변식 S7: cursor 와 동시에 서지 않는다
 *   mode             'view' | 'edit'
 *   ts               epoch ms               — 위치가 바뀐 때(같은 사람의 여러 탭은 가장 최근 것)
 *
 * 순수 모듈이다 — 서버(다듬기)와 화면(동료 목록 · 색)이 함께 쓴다.
 */

export type PresenceUser = { readonly user_id: string; readonly name: string }

export type PresenceState = {
  readonly user: PresenceUser
  readonly cursor: { readonly block_id: string } | null
  readonly block_selection: readonly string[]
  readonly mode: 'view' | 'edit'
  readonly ts: number
}

/** 화면이 보내는 몫 — 사람은 서버가 채운다. */
export type LocalPresence = {
  readonly cursor: { readonly block_id: string } | null
  readonly block_selection: readonly string[]
  readonly mode: 'view' | 'edit'
}

/** 한 번에 싣는 고른 블록의 상한 — 넘으면 앞의 것만(방송 크기를 묶는다). */
export const MAX_PRESENCE_SELECTION = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/**
 * 서버가 받은 상태를 다듬는다(정본 [보강 AW-1] ①) — 정해진 칸만 남기고(모르는 칸은 버린다 · 방송 크기를 묶는다) `user` 는 인증된 연결의
 * 사람으로 덮어쓴다. 모양이 틀린 칸은 빈 값으로. 커서와 고른 블록이 함께 오면 커서를 남긴다(불변식 S7).
 */
export function sanitizePresence(raw: unknown, user: PresenceUser, now: number = Date.now()): PresenceState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const cursorRaw = r.cursor as { block_id?: unknown } | null | undefined
  const cursor = cursorRaw !== null && typeof cursorRaw === 'object' && isUuid(cursorRaw.block_id) ? { block_id: cursorRaw.block_id.toLowerCase() } : null
  const selection = Array.isArray(r.block_selection) ? r.block_selection.filter(isUuid).map((id) => id.toLowerCase()).slice(0, MAX_PRESENCE_SELECTION) : []
  const ts = typeof r.ts === 'number' && Number.isFinite(r.ts) && r.ts > 0 && r.ts <= now + 60_000 ? r.ts : now
  return {
    user,
    cursor,
    block_selection: cursor === null ? selection : [],
    mode: r.mode === 'edit' ? 'edit' : 'view',
    ts,
  }
}

export type PresencePeer = {
  readonly userId: string
  readonly name: string
  readonly color: string
  /** 지금 있는 블록 — 커서의 블록 · 아니면 고른 블록의 첫째 · 없으면 null. */
  readonly blockId: string | null
  readonly mode: 'view' | 'edit'
}

/** 사람마다 정해진 색(user_id 의 해시) — 모두의 화면에서 같은 사람은 같은 색. 흰 글자가 읽히는 진한 색들. */
const PALETTE = ['#e03e3e', '#d9730d', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a', '#2e7d32'] as const

export function presenceColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length] as string
}

/** 아바타의 글자 — 이름의 첫 글자(한글이면 그 한 글자 · 영문이면 대문자). 없으면 "?". */
export function presenceInitial(name: string): string {
  const first = [...name.trim()][0]
  return first === undefined ? '?' : first.toUpperCase()
}

/**
 * awareness 의 상태들에서 **다른 사람들**을 뽑는다 — 자기 연결과 자기 사람(같은 사람의 다른 탭)은 빼고, 같은 사람의 여러 연결은 위치가
 * 가장 최근인 하나로(F-05-03 *"아바타는 user_id 기준 1개로 dedupe"*). 사람이 없는(서버가 채우지 않은) 상태는 버린다. 이름 차례.
 */
export function presencePeers(states: ReadonlyMap<number, unknown>, selfClientId: number, selfUserId: string | null): PresencePeer[] {
  const latest = new Map<string, { state: PresenceState; ts: number }>()
  for (const [clientId, raw] of states) {
    if (clientId === selfClientId) continue
    const state = raw as Partial<PresenceState> | null
    const user = state?.user
    if (!user || typeof user.user_id !== 'string' || typeof user.name !== 'string') continue
    if (selfUserId !== null && user.user_id === selfUserId) continue
    const ts = typeof state.ts === 'number' ? state.ts : 0
    const have = latest.get(user.user_id)
    if (have === undefined || ts > have.ts) latest.set(user.user_id, { state: state as PresenceState, ts })
  }
  return [...latest.values()]
    .map(({ state }) => ({
      userId: state.user.user_id,
      name: state.user.name,
      color: presenceColor(state.user.user_id),
      blockId: state.cursor?.block_id ?? state.block_selection?.[0] ?? null,
      mode: state.mode === 'edit' ? ('edit' as const) : ('view' as const),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.userId.localeCompare(b.userId))
}

/** 같은 지역 상태인가 — 바뀌지 않았으면 다시 보내지 않는다(커서가 같은 블록 안에서 움직일 때마다 방송하지 않게). */
export function sameLocalPresence(a: LocalPresence | null, b: LocalPresence | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.mode === b.mode &&
    (a.cursor?.block_id ?? null) === (b.cursor?.block_id ?? null) &&
    a.block_selection.length === b.block_selection.length &&
    a.block_selection.every((id, i) => id === b.block_selection[i])
  )
}
