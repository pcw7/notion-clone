/**
 * 오프라인으로 내려받은 페이지 — 이 기기의 IndexedDB (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ② ③)
 *
 * 데이터베이스는 `notion-clone-offline` — 보존본(`notion-clone-collab` · `collab/pending-store.ts`)과 따로 둔다. 보존본은 서버가 확인하지 않은
 * 편집이고 이것은 받아 둔 사본이다 — 지우는 규칙이 다르다.
 *
 *   - **`pages`** — 열쇠는 `{사용자}:{페이지}`(보존본과 같은 이유 — 같은 브라우저에서 다른 사람이 로그인해도 앞사람의 사본을 보이지 않는다).
 *     값은 본문 상태(Y update) · 제목 · 아이콘 · 커버 · 서버 판(seq) · 남기는 까닭 · 받은 때 · 크기. **남기는 까닭(`toggled` · `favorited` ·
 *     `recent`)의 집합이 비면 지운다**(F-12-04 의 GC 규칙) — 스위치를 끄는 것은 `toggled` 를 빼는 것이다(자동 내려받기 · OF-5 가 남긴
 *     까닭이 있으면 남는다)
 *   - **`meta`** — 마지막으로 앱을 연 사람의 id. 오프라인 껍데기는 세션이 없으므로 이것으로 그 사람의 목록만 보인다(앱의 화면이 열릴
 *     때마다 쓴다 — `offline-user-mark.tsx`). 로그아웃하면 모두 지우는 것은 ④(OF-3)
 *   - **못 열면 null** — 시크릿 창 · 저장소 차단에서 `indexedDB.open()` 은 던지거나 실패한다. 보존본과 달리 메모리로 내려앉지 않는다 —
 *     탭을 닫으면 사라지는 사본은 오프라인에 쓸모가 없다. 화면은 "이 브라우저에서는 오프라인으로 저장할 수 없다"고 말한다
 *
 * 순수 부분(기록 만들기 · 까닭 빼기 · 받은 JSON 읽기)은 DOM 없이 검사한다(`offline-store.test.ts`).
 */

import type { PageCover } from '../block/page-cover.ts'
import type { PageIcon } from '../block/page-icon.ts'

export const OFFLINE_DB_NAME = 'notion-clone-offline'
export const PAGES_STORE = 'pages'
export const META_STORE = 'meta'
const DB_VERSION = 1
/** `meta` 의 열쇠 — 마지막으로 앱을 연 사람. */
export const LAST_USER_KEY = 'last-user'

/** 남기는 까닭 — 스위치(`toggled`) · 자동 내려받기(OF-5 — 즐겨찾기 · 최근). */
export type OfflineReason = 'toggled' | 'favorited' | 'recent'

/** 서버가 내려 준 페이지 하나(`GET …/pages/{id}/offline` · `offline-page.ts`). */
export type OfflinePagePayload = {
  readonly pageId: string
  readonly title: string
  readonly icon: PageIcon | null
  readonly cover: PageCover | null
  readonly seq: string
  /** 본문 상태(Y update) — base64. */
  readonly state: string
}

export type OfflinePageRecord = {
  /** `{사용자}:{페이지}` — `offlinePageKey`. */
  readonly key: string
  readonly userId: string
  readonly workspaceId: string
  readonly pageId: string
  readonly title: string
  readonly icon: PageIcon | null
  readonly cover: PageCover | null
  /** 본문 상태(Y update) — 받은 상태에 오프라인에서 친 편집을 더한 것이다(`offline-editor.tsx`). */
  readonly state: Uint8Array
  /** 받은 서버 판(`doc_update` 의 마지막 seq). 오프라인 편집은 이것을 바꾸지 않는다 — 서버에 쌓인 것이 아니다. */
  readonly seq: string
  /** 비면 기록이 없다 — 빈 집합인 기록은 저장하지 않는다. */
  readonly reasons: readonly OfflineReason[]
  /** 받은 때(ms). */
  readonly savedAt: number
  /** `state` 의 바이트 수 — 설정의 목록(OF-5)이 크기를 보인다. */
  readonly bytes: number
}

/** 사본의 열쇠 — 사람마다 따로(보존본의 `pendingEditKey` 와 같은 모양). */
export function offlinePageKey(userId: string, pageId: string): string {
  return `${userId}:${pageId}`
}

/**
 * 서버 렌더 · 라우트가 실은 base64 를 바이트로 — 서버 쪽은 `Buffer.from(update).toString('base64')` 다. 브라우저에는 `Buffer` 가 없어
 * `atob` 로 푼다(`collab-protocol.ts` `decodeBodyState` 와 같은 일 — 그 모듈을 껍데기에 끌어오지 않으려고 따로 둔다).
 */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 라우트의 답을 읽는다 — 모양이 아니면 null(저장하지 않는다). 아이콘 · 커버는 서버가 읽은 그대로 싣는다(모양은 서버가 봤다). */
export function parseOfflinePayload(raw: unknown): OfflinePagePayload | null {
  if (!isRecord(raw)) return null
  const { pageId, title, icon, cover, seq, state } = raw
  if (typeof pageId !== 'string' || typeof title !== 'string' || typeof seq !== 'string' || typeof state !== 'string') return null
  if (!/^\d+$/.test(seq) || !/^[A-Za-z0-9+/]*={0,2}$/.test(state)) return null
  return {
    pageId,
    title,
    icon: isRecord(icon) ? (icon as PageIcon) : null,
    cover: isRecord(cover) ? (cover as PageCover) : null,
    seq,
    state,
  }
}

/** 받은 페이지로 기록을 만든다 — 이미 있으면 남기는 까닭을 더한다(같은 까닭은 한 번 · 받은 것으로 내용을 바꾼다). */
export function offlineRecord(
  payload: OfflinePagePayload,
  options: { readonly userId: string; readonly workspaceId: string; readonly reason: OfflineReason; readonly now: number; readonly previous: OfflinePageRecord | null },
): OfflinePageRecord {
  const state = decodeBase64(payload.state)
  const reasons = options.previous?.reasons ?? []
  return {
    key: offlinePageKey(options.userId, payload.pageId),
    userId: options.userId,
    workspaceId: options.workspaceId,
    pageId: payload.pageId,
    title: payload.title,
    icon: payload.icon,
    cover: payload.cover,
    state,
    seq: payload.seq,
    reasons: reasons.includes(options.reason) ? reasons : [...reasons, options.reason],
    savedAt: options.now,
    bytes: state.byteLength,
  }
}

/** 까닭 하나를 뺀다 — 비면 null(지운다 · F-12-04 의 GC). */
export function withoutReason(record: OfflinePageRecord, reason: OfflineReason): OfflinePageRecord | null {
  const reasons = record.reasons.filter((r) => r !== reason)
  return reasons.length === 0 ? null : { ...record, reasons }
}

/** 오프라인에서 친 편집을 더한 상태로 바꾼다 — 서버 판(`seq`) · 받은 때는 그대로다. */
export function withState(record: OfflinePageRecord, state: Uint8Array): OfflinePageRecord {
  return { ...record, state, bytes: state.byteLength }
}

// ── IndexedDB ─────────────────────────────────────────────────────────

export type OfflineStore = {
  get(userId: string, pageId: string): Promise<OfflinePageRecord | null>
  put(record: OfflinePageRecord): Promise<void>
  /** 까닭 하나를 뺀다 — 비면 지운다. 남은 기록(없으면 null)을 돌려준다. */
  release(userId: string, pageId: string, reason: OfflineReason): Promise<OfflinePageRecord | null>
  /** 오프라인 편집을 더한 상태로 바꾼다 — 그 사이 지운 기록이면 아무것도 하지 않는다. */
  updateState(userId: string, pageId: string, state: Uint8Array): Promise<void>
  /** 이 사람의 사본 — 받은 때의 역순. */
  list(userId: string): Promise<OfflinePageRecord[]>
  lastUser(): Promise<string | null>
  markUser(userId: string): Promise<void>
  close(): void
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest
    try {
      open = indexedDB.open(OFFLINE_DB_NAME, DB_VERSION)
    } catch (e) {
      reject(e)
      return
    }
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(PAGES_STORE)) db.createObjectStore(PAGES_STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    open.onsuccess = () => {
      const db = open.result
      // 다른 탭이 새 판으로 올리려 하면 놓아 준다 — 붙들고 있으면 그 탭이 막힌다
      db.onversionchange = () => db.close()
      resolve(db)
    }
    open.onerror = () => reject(open.error ?? new Error('IndexedDB 를 열지 못했습니다'))
    open.onblocked = () => reject(new Error('IndexedDB 가 다른 탭에 잠겨 있습니다'))
  })
}

/** 저장된 행을 기록으로 — 바이트는 `Uint8Array` 로 맞춘다(구조화 복제가 다른 뷰로 돌려줄 수 있다). */
function toRecord(row: unknown): OfflinePageRecord | null {
  if (!isRecord(row) || !(row.state instanceof Uint8Array || row.state instanceof ArrayBuffer)) return null
  return { ...(row as OfflinePageRecord), state: new Uint8Array(row.state) }
}

function indexedDbStore(db: IDBDatabase): OfflineStore {
  const pages = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(PAGES_STORE, mode).objectStore(PAGES_STORE)
  const meta = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(META_STORE, mode).objectStore(META_STORE)

  /** 한 트랜잭션 안에서 읽고 고쳐 쓴다 — 두 탭이 함께 고쳐도 하나가 다른 하나를 덮지 않는다. */
  const modify = async (key: string, change: (current: OfflinePageRecord) => OfflinePageRecord | null): Promise<OfflinePageRecord | null> => {
    const store = pages('readwrite')
    const current = toRecord(await request(store.get(key)))
    if (current === null) return null
    const next = change(current)
    if (next === null) await request(store.delete(key))
    else await request(store.put(next))
    return next
  }

  return {
    async get(userId, pageId) {
      return toRecord(await request(pages('readonly').get(offlinePageKey(userId, pageId))))
    },
    async put(record) {
      await request(pages('readwrite').put(record))
    },
    release(userId, pageId, reason) {
      return modify(offlinePageKey(userId, pageId), (current) => withoutReason(current, reason))
    },
    async updateState(userId, pageId, state) {
      await modify(offlinePageKey(userId, pageId), (current) => withState(current, state))
    },
    async list(userId) {
      // 열쇠가 `{사용자}:` 로 시작하는 것만 — 다른 사람의 사본은 읽지도 않는다
      const range = IDBKeyRange.bound(`${userId}:`, `${userId}:￿`)
      const rows = await request(pages('readonly').getAll(range))
      return rows
        .map(toRecord)
        .filter((r): r is OfflinePageRecord => r !== null && r.userId === userId)
        .sort((a, b) => b.savedAt - a.savedAt)
    },
    async lastUser() {
      const row: unknown = await request(meta('readonly').get(LAST_USER_KEY))
      return isRecord(row) && typeof row.userId === 'string' ? row.userId : null
    },
    async markUser(userId) {
      await request(meta('readwrite').put({ key: LAST_USER_KEY, userId }))
    },
    close() {
      db.close()
    },
  }
}

/** 이 브라우저의 오프라인 저장소. 못 열면 null — 화면이 "저장할 수 없다"고 말한다. */
export async function openOfflineStore(): Promise<OfflineStore | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    return indexedDbStore(await openDatabase())
  } catch {
    return null
  }
}

/** 앱의 화면이 열릴 때 — 마지막으로 연 사람을 적는다(껍데기가 그 사람의 목록만 보인다). 실패는 조용히. */
export async function markSignedInUser(userId: string): Promise<void> {
  const store = await openOfflineStore()
  if (store === null) return
  try {
    await store.markUser(userId)
  } catch {
    // 적지 못하면 껍데기가 앞사람의 목록을 보이거나 비어 있다 — 앱은 그대로다
  } finally {
    store.close()
  }
}
