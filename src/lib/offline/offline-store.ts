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
 *   - **데이터베이스도 같은 `pages` 에**(OF-4 · ⑤) — `kind: 'database'` 인 기록 · 열쇠는 `{사용자}:{데이터베이스}`(블록 id 라 페이지와 겹치지
 *     않는다). 값은 첫 뷰의 이름 · 보이는 열 · 처음 50행의 보이는 글자(읽기만). `kind` 가 없는 기록은 페이지다(OF-2 · OF-3 이 쓴 기록 그대로)
 *   - **`meta`** — 마지막으로 앱을 연 사람의 id. 오프라인 껍데기는 세션이 없으므로 이것으로 그 사람의 목록만 보인다(앱의 화면이 열릴
 *     때마다 쓴다 — `offline-user-mark.tsx`). 로그아웃하면 모두 지우는 것은 ④(OF-3). 자동 내려받기 스위치(OF-5 · ⑥)도 여기 — 이 기기 ·
 *     이 사람마다(`auto-download:{사용자}`)
 *   - **못 보낸 편집이 남은 사본은 까닭이 비어도 남는다**(OF-5 · ⑥) — 자동 까닭을 빼거나 설정에서 지울 때(`withReasonChange`). 다시 붙어
 *     보낸 뒤에 지운다(`offline-auto.ts`). 페이지 메뉴의 스위치를 끄는 길(`release`)은 OF-2 그대로다
 *   - **못 열면 null** — 시크릿 창 · 저장소 차단에서 `indexedDB.open()` 은 던지거나 실패한다. 보존본과 달리 메모리로 내려앉지 않는다 —
 *     탭을 닫으면 사라지는 사본은 오프라인에 쓸모가 없다. 화면은 "이 브라우저에서는 오프라인으로 저장할 수 없다"고 말한다
 *
 * 순수 부분(기록 만들기 · 까닭 빼기 · 받은 JSON 읽기)은 DOM 없이 검사한다(`offline-store.test.ts` · 데이터베이스 기록과 옛 기록의 호환은
 * `offline-table.test.ts`).
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
export const OFFLINE_REASONS: readonly OfflineReason[] = ['toggled', 'favorited', 'recent']

/** 자동 내려받기 스위치(OF-5) — 이 기기 · 이 사람마다. 없으면 둘 다 꺼짐. */
export type AutoDownloadSettings = { readonly favorites: boolean; readonly recent: boolean }
export const AUTO_DOWNLOAD_OFF: AutoDownloadSettings = { favorites: false, recent: false }

/** `meta` 의 열쇠 — 그 사람의 자동 내려받기 스위치. */
export function autoDownloadKey(userId: string): string {
  return `auto-download:${userId}`
}

/** 저장된 스위치를 읽는다 — 모양이 아니면 꺼짐. */
export function readAutoDownload(row: unknown): AutoDownloadSettings {
  if (typeof row !== 'object' || row === null) return AUTO_DOWNLOAD_OFF
  const { favorites, recent } = row as { favorites?: unknown; recent?: unknown }
  return { favorites: favorites === true, recent: recent === true }
}

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
  /** 없으면 페이지다 — OF-2 · OF-3 이 쓴 기록에는 없다. */
  readonly kind?: 'page'
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
  /** 비면 기록이 없다 — 못 보낸 편집이 남은 사본만 빈 채로 남는다(보낸 뒤 지운다 · OF-5). */
  readonly reasons: readonly OfflineReason[]
  /** 받은 때(ms). */
  readonly savedAt: number
  /** `state` 의 바이트 수 — 설정의 목록(OF-5)이 크기를 보인다. */
  readonly bytes: number
}

/** 내려받은 데이터베이스의 열 — 첫 뷰의 보이는 열(뷰 순서). `type` 은 속성 타입(제목 열을 가른다). */
export type OfflineDatabaseColumn = { readonly id: string; readonly name: string; readonly type: string }

/** 내려받은 행 — 칸은 **보이는 글자**다(CSV 내보내기와 같은 글자 · id · 파일 주소가 없다). 열 id → 글자. */
export type OfflineDatabaseRow = { readonly id: string; readonly title: string; readonly cells: Readonly<Record<string, string>> }

/** 서버가 내려 준 데이터베이스 하나(`GET …/databases/{id}/offline` · `offline-database.ts` · OF-4). */
export type OfflineDatabasePayload = {
  readonly databaseId: string
  readonly name: string
  readonly icon: PageIcon | null
  /** 행을 그리는 첫 뷰의 이름 — 그런 뷰가 없으면 빈 글(열 · 행도 비었다). */
  readonly viewName: string
  readonly columns: readonly OfflineDatabaseColumn[]
  /** 그 뷰의 차례 · 필터대로 처음 50행까지. */
  readonly rows: readonly OfflineDatabaseRow[]
  /** 50행 뒤에 더 있다. */
  readonly truncated: boolean
  /** 서버가 읽은 때(ISO) — 다시 붙으면(OF-3) 견주지 않고 늘 다시 받는다(작다). */
  readonly savedVersion: string
}

/** 내려받은 데이터베이스(OF-4) — 읽기만. 열쇠 · 까닭 · 받은 때 · 크기는 페이지와 같은 뜻이다. */
export type OfflineDatabaseRecord = Omit<OfflineDatabasePayload, 'databaseId'> & {
  readonly kind: 'database'
  /** `{사용자}:{데이터베이스}` — `offlinePageKey`. */
  readonly key: string
  readonly userId: string
  readonly workspaceId: string
  /** 데이터베이스 id — 블록 id 라 페이지와 같은 이름으로 찾는다(까닭 빼기 · 지우기 · 다시 붙기). */
  readonly pageId: string
  readonly reasons: readonly OfflineReason[]
  readonly savedAt: number
  /** 열 · 행을 JSON 으로 쓴 바이트 수(설정의 목록 · OF-5). */
  readonly bytes: number
}

export type OfflineRecord = OfflinePageRecord | OfflineDatabaseRecord

export function isDatabaseRecord(record: OfflineRecord): record is OfflineDatabaseRecord {
  return record.kind === 'database'
}

export function isPageRecord(record: OfflineRecord): record is OfflinePageRecord {
  return record.kind !== 'database'
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
export function withoutReason<R extends OfflineRecord>(record: R, reason: OfflineReason): R | null {
  const reasons = record.reasons.filter((r) => r !== reason)
  return reasons.length === 0 ? null : { ...record, reasons }
}

/** 까닭을 더하고 뺀다(OF-5) — 고칠 것이 무엇이었든 지금 기록 위에서. */
export type ReasonChange = { readonly add: readonly OfflineReason[]; readonly drop: readonly OfflineReason[] }

/**
 * 까닭을 바꾼 기록 — 비면 null(지운다 · F-12-04 의 GC). **못 보낸 편집이 있으면(`unsent`) 빈 채로 남긴다** — 다시 붙어 보낸 뒤 지운다
 * (정본 ⑥ · ④ 의 로그아웃 규칙과 같다). 바뀐 것이 없으면 그 기록 그대로.
 */
export function withReasonChange<R extends OfflineRecord>(record: R, change: ReasonChange, unsent: boolean): R | null {
  const kept = record.reasons.filter((r) => !change.drop.includes(r))
  const reasons = [...kept, ...change.add.filter((r, i) => !kept.includes(r) && change.add.indexOf(r) === i)]
  if (reasons.length === 0) return unsent ? (record.reasons.length === 0 ? record : { ...record, reasons }) : null
  const same = reasons.length === record.reasons.length && reasons.every((r, i) => r === record.reasons[i])
  return same ? record : { ...record, reasons }
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string')

/** 데이터베이스 라우트의 답을 읽는다(OF-4) — 모양이 아니면 null(저장하지 않는다). */
export function parseOfflineDatabasePayload(raw: unknown): OfflineDatabasePayload | null {
  if (!isRecord(raw)) return null
  const { databaseId, name, icon, viewName, columns, rows, truncated, savedVersion } = raw
  if (typeof databaseId !== 'string' || typeof name !== 'string' || typeof viewName !== 'string' || typeof savedVersion !== 'string') return null
  if (typeof truncated !== 'boolean' || !Array.isArray(columns) || !Array.isArray(rows)) return null
  const okColumns = columns.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.type === 'string')
  const okRows = rows.every((r) => isRecord(r) && typeof r.id === 'string' && typeof r.title === 'string' && isStringRecord(r.cells))
  if (!okColumns || !okRows) return null
  return {
    databaseId,
    name,
    icon: isRecord(icon) ? (icon as PageIcon) : null,
    viewName,
    columns: (columns as OfflineDatabaseColumn[]).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    rows: (rows as OfflineDatabaseRow[]).map((r) => ({ id: r.id, title: r.title, cells: { ...r.cells } })),
    truncated,
    savedVersion,
  }
}

/** 받은 데이터베이스로 기록을 만든다 — 이미 있으면 남기는 까닭을 더한다(페이지의 `offlineRecord` 와 같은 규칙). */
export function offlineDatabaseRecord(
  payload: OfflineDatabasePayload,
  options: { readonly userId: string; readonly workspaceId: string; readonly reason: OfflineReason; readonly now: number; readonly previous: OfflineRecord | null },
): OfflineDatabaseRecord {
  const reasons = options.previous?.reasons ?? []
  const { databaseId, ...content } = payload
  return {
    ...content,
    kind: 'database',
    key: offlinePageKey(options.userId, databaseId),
    userId: options.userId,
    workspaceId: options.workspaceId,
    pageId: databaseId,
    reasons: reasons.includes(options.reason) ? reasons : [...reasons, options.reason],
    savedAt: options.now,
    bytes: new TextEncoder().encode(JSON.stringify({ columns: payload.columns, rows: payload.rows })).byteLength,
  }
}

/** 다시 받은 것으로 바꾼 데이터베이스(OF-3 의 다시 붙기) — 열쇠 · 사람 · 워크스페이스 · 남기는 까닭은 그대로, 내용 · 받은 때는 새것. */
export function refreshedDatabaseRecord(previous: OfflineDatabaseRecord, payload: OfflineDatabasePayload, now: number): OfflineDatabaseRecord {
  const next = offlineDatabaseRecord(payload, { userId: previous.userId, workspaceId: previous.workspaceId, reason: 'toggled', now, previous: null })
  return { ...next, key: previous.key, pageId: previous.pageId, reasons: previous.reasons }
}

/**
 * 저장된 행을 기록으로 — 바이트는 `Uint8Array` 로 맞춘다(구조화 복제가 다른 뷰로 돌려줄 수 있다). `kind` 가 없으면 페이지다(OF-2 · OF-3 의
 * 기록). 모양이 아니면 null(목록에서 빠진다).
 */
export function readStoredRecord(row: unknown): OfflineRecord | null {
  if (!isRecord(row)) return null
  if (row.kind === 'database') {
    return typeof row.pageId === 'string' && Array.isArray(row.columns) && Array.isArray(row.rows) && Array.isArray(row.reasons) ? (row as OfflineDatabaseRecord) : null
  }
  if (row.kind !== undefined && row.kind !== 'page') return null
  if (!(row.state instanceof Uint8Array || row.state instanceof ArrayBuffer)) return null
  return { ...(row as OfflinePageRecord), state: new Uint8Array(row.state) }
}

/** 오프라인에서 친 편집을 더한 상태로 바꾼다 — 서버 판(`seq`) · 받은 때는 그대로다. */
export function withState(record: OfflinePageRecord, state: Uint8Array): OfflinePageRecord {
  return { ...record, state, bytes: state.byteLength }
}

// ── IndexedDB ─────────────────────────────────────────────────────────

export type OfflineStore = {
  /** 페이지의 사본 — 그 열쇠가 데이터베이스면 null. */
  get(userId: string, pageId: string): Promise<OfflinePageRecord | null>
  /** 데이터베이스의 사본(OF-4) — 그 열쇠가 페이지면 null. */
  getDatabase(userId: string, databaseId: string): Promise<OfflineDatabaseRecord | null>
  put(record: OfflineRecord): Promise<void>
  /** 까닭 하나를 뺀다 — 비면 지운다. 남은 기록(없으면 null)을 돌려준다. 페이지 · 데이터베이스 모두. */
  release(userId: string, pageId: string, reason: OfflineReason): Promise<OfflineRecord | null>
  /** 까닭을 더하고 뺀다(OF-5 · `withReasonChange`) — 한 트랜잭션. 남은 기록(지웠거나 없으면 null)을 돌려준다. */
  changeReasons(userId: string, pageId: string, change: ReasonChange, unsent: boolean): Promise<OfflineRecord | null>
  /** 오프라인 편집을 더한 상태로 바꾼다 — 그 사이 지운 기록(또는 데이터베이스)이면 아무것도 하지 않는다. */
  updateState(userId: string, pageId: string, state: Uint8Array): Promise<void>
  /**
   * 다시 받은 것으로 바꾼다(OF-3) — 한 트랜잭션 안에서 지금 기록을 읽어 `change` 에 넘긴다. 그 사이 지운 기록이면 되살리지 않는다(null).
   */
  replace(userId: string, pageId: string, change: (current: OfflinePageRecord) => OfflinePageRecord): Promise<OfflinePageRecord | null>
  /** `replace` 의 데이터베이스판(OF-4). */
  replaceDatabase(userId: string, databaseId: string, change: (current: OfflineDatabaseRecord) => OfflineDatabaseRecord): Promise<OfflineDatabaseRecord | null>
  /** 사본 하나를 지운다(볼 수 없게 된 페이지 · 데이터베이스 · OF-3). 남기는 까닭과 상관없이. */
  remove(userId: string, pageId: string): Promise<void>
  /** 이 사람의 사본을 모두 지운다(로그아웃 · OF-3). 마지막 사용자 표시도 그 사람이면 지운다 · 자동 내려받기 스위치도(OF-5). 지운 수를 돌려준다. */
  clear(userId: string): Promise<number>
  /** 이 사람의 사본(페이지 · 데이터베이스) — 받은 때의 역순. */
  list(userId: string): Promise<OfflineRecord[]>
  /** 이 사람의 사본 수 — 본문을 읽지 않는다(다시 붙기가 할 일이 있는지만 볼 때 · OF-3). */
  count(userId: string): Promise<number>
  lastUser(): Promise<string | null>
  markUser(userId: string): Promise<void>
  /** 이 사람의 자동 내려받기 스위치(OF-5) — 없으면 둘 다 꺼짐. */
  autoDownload(userId: string): Promise<AutoDownloadSettings>
  setAutoDownload(userId: string, settings: AutoDownloadSettings): Promise<void>
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

/** 열쇠가 `{사용자}:` 로 시작하는 범위 — 그 사람의 기록만. */
function userRange(userId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${userId}:`, `${userId}:￿`)
}

function indexedDbStore(db: IDBDatabase): OfflineStore {
  const pages = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(PAGES_STORE, mode).objectStore(PAGES_STORE)
  const meta = (mode: IDBTransactionMode): IDBObjectStore => db.transaction(META_STORE, mode).objectStore(META_STORE)

  /**
   * 한 트랜잭션 안에서 읽고 고쳐 쓴다 — 두 탭이 함께 고쳐도 하나가 다른 하나를 덮지 않는다. `change` 가 `undefined` 를 주면 손대지 않는다
   * (종류가 다른 기록 — null 을 돌려준다).
   */
  const modify = async (key: string, change: (current: OfflineRecord) => OfflineRecord | null | undefined): Promise<OfflineRecord | null> => {
    const store = pages('readwrite')
    const current = readStoredRecord(await request(store.get(key)))
    if (current === null) return null
    const next = change(current)
    if (next === undefined) return null
    if (next === null) await request(store.delete(key))
    else await request(store.put(next))
    return next
  }
  const read = async (userId: string, id: string): Promise<OfflineRecord | null> =>
    readStoredRecord(await request(pages('readonly').get(offlinePageKey(userId, id))))

  return {
    async get(userId, pageId) {
      const record = await read(userId, pageId)
      return record !== null && isPageRecord(record) ? record : null
    },
    async getDatabase(userId, databaseId) {
      const record = await read(userId, databaseId)
      return record !== null && isDatabaseRecord(record) ? record : null
    },
    async put(record) {
      await request(pages('readwrite').put(record))
    },
    release(userId, pageId, reason) {
      return modify(offlinePageKey(userId, pageId), (current) => withoutReason(current, reason))
    },
    async changeReasons(userId, pageId, change, unsent) {
      let unchanged: OfflineRecord | null = null
      const next = await modify(offlinePageKey(userId, pageId), (current) => {
        const changed = withReasonChange(current, change, unsent)
        if (changed !== current) return changed
        // 바뀐 것이 없으면 쓰지 않는다
        unchanged = current
        return undefined
      })
      return next ?? unchanged
    },
    async updateState(userId, pageId, state) {
      await modify(offlinePageKey(userId, pageId), (current) => (isPageRecord(current) ? withState(current, state) : undefined))
    },
    async replace(userId, pageId, change) {
      const next = await modify(offlinePageKey(userId, pageId), (current) => (isPageRecord(current) ? change(current) : undefined))
      return next !== null && isPageRecord(next) ? next : null
    },
    async replaceDatabase(userId, databaseId, change) {
      const next = await modify(offlinePageKey(userId, databaseId), (current) => (isDatabaseRecord(current) ? change(current) : undefined))
      return next !== null && isDatabaseRecord(next) ? next : null
    },
    async remove(userId, pageId) {
      await request(pages('readwrite').delete(offlinePageKey(userId, pageId)))
    },
    async clear(userId) {
      const store = pages('readwrite')
      const count = await request(store.count(userRange(userId)))
      await request(store.delete(userRange(userId)))
      const marks = meta('readwrite')
      const row: unknown = await request(marks.get(LAST_USER_KEY))
      if (isRecord(row) && row.userId === userId) await request(marks.delete(LAST_USER_KEY))
      await request(marks.delete(autoDownloadKey(userId)))
      return count
    },
    async list(userId) {
      // 열쇠가 `{사용자}:` 로 시작하는 것만 — 다른 사람의 사본은 읽지도 않는다
      const rows = await request(pages('readonly').getAll(userRange(userId)))
      return rows
        .map(readStoredRecord)
        .filter((r): r is OfflineRecord => r !== null && r.userId === userId)
        .sort((a, b) => b.savedAt - a.savedAt)
    },
    count(userId) {
      return request(pages('readonly').count(userRange(userId)))
    },
    async lastUser() {
      const row: unknown = await request(meta('readonly').get(LAST_USER_KEY))
      return isRecord(row) && typeof row.userId === 'string' ? row.userId : null
    },
    async markUser(userId) {
      await request(meta('readwrite').put({ key: LAST_USER_KEY, userId }))
    },
    async autoDownload(userId) {
      return readAutoDownload(await request(meta('readonly').get(autoDownloadKey(userId))))
    },
    async setAutoDownload(userId, settings) {
      await request(meta('readwrite').put({ key: autoDownloadKey(userId), userId, favorites: settings.favorites, recent: settings.recent }))
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
