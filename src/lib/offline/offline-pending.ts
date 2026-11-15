/**
 * 사람 하나의 보존본 — 다시 붙기 · 로그아웃이 다룬다 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④ · CRDT 6d)
 *
 * 보존본(`collab/pending-store.ts` — `notion-clone-collab`)은 연결 하나가 페이지 하나의 것을 읽고 쓴다. 여기는 **사람 하나**의 것을 다룬다 —
 * 남은 편집이 있는 페이지 · 지우기(볼 수 없게 된 페이지 · 로그아웃) · 읽었던 그대로일 때만 바꾸기. 한 번 열고 닫는다. 못 열면 남은 것이
 * 없는 것이다(메모리 보존본은 그 탭의 연결 안에만 있다).
 *
 * 보존본 모듈과 따로 둔다 — 그 모듈은 페이지 화면이 늘 싣는다(편집기의 연결). 이것은 지연 로드한 쪽(`offline-sync.ts`)만 부른다.
 */

import { openPendingDatabase, pendingEditKey, STORE_NAME } from '../collab/pending-store.ts'

type Row = { readonly key: string; readonly update: Uint8Array }

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
  })
}

/** 열쇠가 `{사용자}:` 로 시작하는 범위. */
function userRange(userId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${userId}:`, `${userId}:￿`)
}

async function withDatabase<T>(fallback: T, run: (store: (mode: IDBTransactionMode) => IDBObjectStore) => Promise<T>): Promise<T> {
  if (typeof indexedDB === 'undefined') return fallback
  let db: IDBDatabase
  try {
    db = await openPendingDatabase()
  } catch {
    return fallback
  }
  try {
    return await run((mode) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
  } finally {
    db.close()
  }
}

/** 이 사람의 보존본에 편집이 남은 페이지들. */
export async function listPendingEdits(userId: string): Promise<string[]> {
  return withDatabase<string[]>([], async (store) => {
    const rows = (await request(store('readonly').getAll(userRange(userId)))) as Row[]
    return rows.filter((row) => row.update !== undefined && new Uint8Array(row.update).byteLength > 0).map((row) => row.key.slice(userId.length + 1))
  })
}

/** 보존본 하나를 읽는다(열고 닫는다) — 없으면 null. */
export async function readPendingEdit(key: string): Promise<Uint8Array | null> {
  return withDatabase<Uint8Array | null>(null, async (store) => {
    const row = (await request(store('readonly').get(key))) as Row | undefined
    return row === undefined ? null : new Uint8Array(row.update)
  })
}

/** 이 사람의 보존본을 지운다 — 페이지들(`pageIds`)만, 또는 그 사람의 것 전부(`'all'`). */
export async function deletePendingEdits(userId: string, pageIds: readonly string[] | 'all'): Promise<void> {
  await withDatabase(undefined, async (store) => {
    const s = store('readwrite')
    if (pageIds === 'all') await request(s.delete(userRange(userId)))
    else for (const pageId of pageIds) await request(s.delete(pendingEditKey(userId, pageId)))
  })
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null): boolean =>
  a === null || b === null ? a === b : a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])

/**
 * 읽었던 그대로일 때만 바꾼다(한 트랜잭션) — 뒤에서 보내는 연결(OF-3)이 확인을 받고 지울 때, 그 사이 같은 페이지를 연 편집기가 더한
 * 편집을 지우지 않는다. 바꿨으면 true.
 */
export async function replacePendingIf(key: string, expected: Uint8Array | null, next: Uint8Array | null): Promise<boolean> {
  return withDatabase(false, async (store) => {
    const s = store('readwrite')
    const row = (await request(s.get(key))) as Row | undefined
    if (!sameBytes(row === undefined ? null : new Uint8Array(row.update), expected)) return false
    if (next === null) await request(s.delete(key))
    else await request(s.put({ key, update: next } satisfies Row))
    return true
  })
}
