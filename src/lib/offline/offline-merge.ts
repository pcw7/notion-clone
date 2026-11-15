/**
 * 다시 받은 사본 = 서버 상태 + 아직 못 보낸 편집 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④ · 순수)
 *
 * 오프라인에서 친 글을 잃지 않는다. 서버가 거부해 버린 편집은 보존본에 없으므로 사본에서도 빠진다(서버가 받지 않은 글이 사본에 남아 다음에
 * 또 보내지지 않는다). `yjs` 를 쓰므로 계획(`offline-resync.ts`)과 따로 둔다 — 그쪽은 앱의 화면이 지연 로드하는 가벼운 모듈이 부른다.
 */

import * as Y from 'yjs'

import { decodeBase64, type OfflinePagePayload, type OfflinePageRecord } from './offline-store.ts'

/** 다시 받은 서버 상태 위에 아직 보내지 못한 편집을 얹은 상태 — 새 사본의 본문. */
export function withPendingEdits(serverState: Uint8Array, pending: Uint8Array | null): Uint8Array {
  if (pending === null || pending.byteLength === 0) return serverState
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, serverState)
    Y.applyUpdate(doc, pending)
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

/** 다시 받은 것으로 바꾼 사본 — 열쇠 · 사람 · 워크스페이스 · 남기는 까닭은 그대로, 내용 · 판 · 받은 때는 새것. */
export function refreshedRecord(previous: OfflinePageRecord, payload: OfflinePagePayload, pending: Uint8Array | null, now: number): OfflinePageRecord {
  const state = withPendingEdits(decodeBase64(payload.state), pending)
  return {
    ...previous,
    title: payload.title,
    icon: payload.icon,
    cover: payload.cover,
    state,
    seq: payload.seq,
    savedAt: now,
    bytes: state.byteLength,
  }
}
