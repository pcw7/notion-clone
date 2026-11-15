/**
 * 오프라인 편집기의 문서 — 받아 둔 본문 상태 위에 보존본을 얹고, 친 편집을 보존본에 쌓는다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ③ · CRDT 6d)
 *
 * 서버가 없다 — 협업 연결(`collab-connection.ts`)을 열지 않는다. 대신 **연결이 쓰는 것과 같은 보존본**(`notion-clone-collab` ·
 * `pendingEditKey(사용자, 페이지)`)에 합친 update 하나를 쓴다. 다음에 연결된 채 그 페이지를 열면 연결이 보존본을 서버가 준 상태 위에
 * 얹고 보내며, 서버의 확인 답을 받은 뒤에 지운다(6c · 6d — 이미 있는 길이다). CRDT 라 그 사이 서버에 쌓인 남의 편집과 그대로 합쳐진다.
 *
 *   - 문서 = 받은 상태 + 보존본(확인받지 못한 편집 — 온라인에서 남은 것이든 오프라인에서 친 것이든). 둘 다 "가져온 것"이라 다시 쓰지 않는다
 *   - 친 편집(바인딩 · 되돌리기가 만든 update)은 **보존본과 합쳐 하나로** 쓴다 — 연결의 `persist` 와 같은 모양(페이지 · 사용자마다 하나)
 *   - 함께 **문서 전체 상태**를 넘긴다 — 사본(`offline-store.ts`)도 친 것을 담는다. 연결이 보존본을 보내고 지운 뒤에 다시 오프라인에서
 *     열어도 친 것이 사본에 남아 있다(다시 받기 · OF-3 전에도)
 *   - 쓰기는 한 번에 하나 — 도는 동안 바뀐 것은 끝난 뒤 한 번 더 쓴다(그때의 것으로). 실패는 콘솔에만(연결의 보존본과 같다)
 */

import * as Y from 'yjs'

/** 받은 상태 · 보존본을 얹을 때의 origin — 친 편집으로 세지 않는다. */
const STORED = Symbol('offline-doc:stored')

/** 받은 본문 상태 위에 보존본(없으면 null)을 얹은 문서. */
export function openOfflineDoc(state: Uint8Array, pending: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state, STORED)
  if (pending !== null) Y.applyUpdate(doc, pending, STORED)
  return doc
}

/** 쓰는 곳 — `pending` 은 보존본에 쓸 합친 update, `state` 는 사본에 쓸 문서 전체 상태. */
export type OfflineEditSink = (pending: Uint8Array, state: Uint8Array) => Promise<void>

export type OfflineEditTracker = {
  /** 밀린 쓰기가 끝나기를 기다린다. */
  flushed(): Promise<void>
  /** 듣기를 멈추고 밀린 쓰기를 기다린다 — 그 뒤에 문서를 내린다. */
  stop(): Promise<void>
}

/**
 * 이 문서에 친 편집을 쌓는다. `pending` 은 문서를 열 때 얹은 보존본이다 — 합쳐 쓰므로 그것을 잃지 않는다(쓰는 값은 늘 보존본 전부다).
 */
export function trackOfflineEdits(doc: Y.Doc, pending: Uint8Array | null, sink: OfflineEditSink): OfflineEditTracker {
  let parts: Uint8Array[] = pending === null ? [] : [pending]
  let writing: Promise<void> = Promise.resolve()
  let queued = false

  const persist = (): void => {
    if (queued) return
    queued = true
    writing = writing.then(async () => {
      queued = false
      const merged = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts)
      parts = [merged]
      try {
        await sink(merged, Y.encodeStateAsUpdate(doc))
      } catch (error) {
        console.warn('[offline] 오프라인 편집을 쓰지 못했다:', error)
      }
    })
  }

  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === STORED) return
    parts.push(update)
    persist()
  }
  doc.on('update', onUpdate)

  return {
    flushed: () => writing,
    async stop() {
      doc.off('update', onUpdate)
      await writing
    },
  }
}
