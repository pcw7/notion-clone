/**
 * 서버가 확인하지 않은 편집의 보존본 — IndexedDB (F-05-04 · CRDT 6d조각)
 *
 * 계약은 `collab-connection.ts` 의 `PendingEditStore` 다. 연결이 편집을 쌓고 지우는 규칙을 갖고, 여기는 **어디에 두는가**만 갖는다.
 *
 * 정본이 인용한 노션 원문: *"TransactionQueue stores transactions safely in IndexedDB or SQLite … until they're persisted by the
 * server or rejected."* 우리의 "persisted"는 서버의 확인 답이다(`collab-protocol.ts`).
 *
 *   - **열쇠에 사용자를 넣는다**(`pendingEditKey`) — 같은 브라우저에서 다른 사람이 로그인해 그 페이지를 열면, 앞사람이 못 보낸 편집을
 *     그 사람의 이름으로 보내게 된다. 지금까지의 저장 큐는 페이지 id 만 열쇠였다
 *   - **못 열면 메모리로 내려앉는다** — 시크릿 창 · 저장소 차단 · 할당량 초과에서 `indexedDB.open()` 은 던지거나 실패한다. 그렇다고
 *     편집기를 못 쓰게 하는 것은 과잉이다. 대신 `durable: false` 로 알려 화면이 "탭을 닫으면 사라진다"고 말할 수 있게 한다
 *   - **한 페이지에 항목 하나** — 연결이 합친 update 하나를 준다. 지우기는 그 행을 지운다
 */

import { memoryPendingEditStore, type PendingEditStore } from './collab-connection.ts'

export const DB_NAME = 'notion-clone-collab'
export const STORE_NAME = 'pending-edits'
const DB_VERSION = 1

/** 보존본의 열쇠 — 사람마다 따로. */
export function pendingEditKey(userId: string, pageId: string): string {
  return `${userId}:${pageId}`
}

type Row = { readonly key: string; readonly update: Uint8Array }

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
      open = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(e)
      return
    }
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('IndexedDB 를 열지 못했습니다'))
    // 다른 탭이 옛 버전을 붙들고 있다 — 기다리지 않고 메모리로 내려앉는다.
    open.onblocked = () => reject(new Error('IndexedDB 가 다른 탭에 잠겨 있습니다'))
  })
}

function indexedDbStore(db: IDBDatabase): PendingEditStore {
  const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    request(run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)))

  return {
    durable: true,
    async read(key) {
      const row = await tx<Row | undefined>('readonly', (s) => s.get(key))
      return row === undefined ? null : new Uint8Array(row.update)
    },
    async write(key, update) {
      if (update === null) await tx('readwrite', (s) => s.delete(key))
      else await tx('readwrite', (s) => s.put({ key, update } satisfies Row))
    },
  }
}

/** 이 브라우저에서 쓸 보존본 저장소. 못 열면 메모리다(`durable: false`). */
export async function openPendingEditStore(): Promise<PendingEditStore> {
  if (typeof indexedDB === 'undefined') return memoryPendingEditStore()
  try {
    return indexedDbStore(await openDatabase())
  } catch {
    return memoryPendingEditStore()
  }
}
