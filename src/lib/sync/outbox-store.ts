/**
 * 저장 큐의 저장소 — F-05-04
 *
 * 정본이 인용한 노션 원문: *"TransactionQueue stores transactions safely in
 * **IndexedDB or SQLite** (depending on platform) until they're persisted by the
 * server or rejected."*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 메모리가 아니라 디스크인가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 정본 엣지 케이스: *"전송 중 브라우저 종료 → outbox 를 IndexedDB 에 영속화 →
 * 다음 실행 시 재전송."* 메모리에 두면 탭을 닫는 순간 사라지고, **사용자는
 * 자기가 친 글이 저장된 줄 안다.** 이 기능이 존재하는 이유가 그 경우다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * IndexedDB 를 못 쓰는 곳이 있다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 시크릿 창 · 저장소 차단 · 할당량 초과에서 `indexedDB.open()` 은 던지거나
 * `onerror` 로 끝난다. 그때 **에디터가 죽으면 안 된다.** 메모리 저장소로 내려앉고
 * 그 사실을 `durable` 로 알린다 — 화면이 "이 브라우저에서는 탭을 닫으면 미전송
 * 변경이 사라집니다"라고 말할 수 있어야 하기 때문이다. 조용히 내려앉으면
 * 디스크에 있다고 믿게 만든다.
 */

import type { OutboxEntry } from './outbox.ts'

export type OutboxStore = {
  /** 진단·표시용. false 면 탭을 닫을 때 대기 항목이 사라진다. */
  readonly durable: boolean
  read(pageId: string): Promise<OutboxEntry | null>
  write(entry: OutboxEntry): Promise<void>
  clear(pageId: string): Promise<void>
  /** 이 브라우저에 남아 있는 모든 대기 항목. 다른 페이지의 것까지 본다. */
  list(): Promise<OutboxEntry[]>
}

export const DB_NAME = 'notion-clone-outbox'
export const STORE_NAME = 'saves'
const DB_VERSION = 1

/** 테스트와 폴백용. 같은 계약을 지키되 탭을 닫으면 사라진다. */
export function memoryOutboxStore(): OutboxStore {
  const map = new Map<string, OutboxEntry>()
  return {
    durable: false,
    async read(pageId) {
      return map.get(pageId) ?? null
    },
    async write(entry) {
      map.set(entry.pageId, entry)
    },
    async clear(pageId) {
      map.delete(pageId)
    },
    async list() {
      return [...map.values()]
    },
  }
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
      open = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      // 시크릿 창 등에서 `open` 자체가 던진다.
      reject(e)
      return
    }
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // 페이지 하나에 대기 항목 하나 — 그래서 키가 `pageId` 다(합쳐지는 규칙은
        // `coalesce`). 인덱스는 두지 않는다. 항목 수가 열린 페이지 수만큼이다.
        db.createObjectStore(STORE_NAME, { keyPath: 'pageId' })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('IndexedDB 를 열지 못했습니다'))
    // 다른 탭이 옛 버전을 붙들고 있다. 기다리지 않고 폴백한다 —
    // 저장을 무한정 미루는 것보다 메모리에라도 두는 편이 낫다.
    open.onblocked = () => reject(new Error('IndexedDB 가 다른 탭에 잠겨 있습니다'))
  })
}

function indexedDbStore(db: IDBDatabase): OutboxStore {
  const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    request(run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)))

  return {
    durable: true,
    async read(pageId) {
      return (await tx<OutboxEntry | undefined>('readonly', (s) => s.get(pageId))) ?? null
    },
    async write(entry) {
      await tx('readwrite', (s) => s.put(entry))
    },
    async clear(pageId) {
      await tx('readwrite', (s) => s.delete(pageId))
    },
    async list() {
      return (await tx<OutboxEntry[]>('readonly', (s) => s.getAll())) ?? []
    },
  }
}

/**
 * 이 브라우저에서 쓸 저장소.
 *
 * 실패하면 던지지 않고 메모리로 내려앉는다 — 저장 큐를 못 만들었다고 에디터를
 * 못 쓰게 하는 것은 과잉이다. 대신 `durable: false` 로 알린다.
 */
export async function openOutboxStore(): Promise<OutboxStore> {
  if (typeof indexedDB === 'undefined') return memoryOutboxStore()
  try {
    return indexedDbStore(await openDatabase())
  } catch {
    return memoryOutboxStore()
  }
}

/**
 * 아직 열리지 않은 저장소를 지금 쓰게 해 준다.
 *
 * `openOutboxStore()` 는 비동기인데 에디터는 동기적으로 만들어진다. 열릴 때까지
 * 기다렸다가 조립하면 그 사이의 편집이 갈 곳을 잃으므로, 먼저 이것을 끼워 두고
 * 각 호출이 열림을 기다린다. 여는 일은 한 번만 한다.
 *
 * ⚠ `durable` 은 열리기 전에는 **예측**이다(IndexedDB 가 있는 환경인가).
 * 실제 값은 열린 뒤에 바뀐다 — 진단·표시용으로만 쓰고 판단에 쓰지 않는다.
 */
export function deferredOutboxStore(open: () => Promise<OutboxStore>): OutboxStore {
  let opening: Promise<OutboxStore> | null = null
  let opened: OutboxStore | null = null
  const get = (): Promise<OutboxStore> => {
    opening ??= open().then((store) => {
      opened = store
      return store
    })
    return opening
  }

  return {
    get durable() {
      return opened?.durable ?? typeof indexedDB !== 'undefined'
    },
    async read(pageId) {
      return (await get()).read(pageId)
    },
    async write(entry) {
      return (await get()).write(entry)
    },
    async clear(pageId) {
      return (await get()).clear(pageId)
    },
    async list() {
      return (await get()).list()
    },
  }
}
