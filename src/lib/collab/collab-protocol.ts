/**
 * 협업 서버와 브라우저 연결(`collab-connection.ts`)의 약속 — 문서 이름 · 편집 확인 요청 (F-05-04 · CRDT 6c조각)
 *
 * 양쪽이 함께 읽는다. 서버 모듈(`collab-server.ts`)은 DB · Hocuspocus 서버를 끌어오므로 브라우저 코드가 그것을 불러오지 않게 여기에 둔다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 편집 확인 요청
 * ──────────────────────────────────────────────────────────────────────
 *
 * 브라우저는 서버가 확인하지 않은 편집을 보존본에 남긴다. 지울 때를 정하려면 "여기까지 보낸 것이 로그에 있다"를 알아야 한다.
 *
 * **provider 의 `unsyncedChanges` 로는 모른다**(HANDOFF §3.3-120). 다시 붙을 때 1 로 초기화되고, 끊긴 동안 큐에 쌓인 update 가
 * 동기화 응답보다 먼저 나가 그 확인이 먼저 온다 — 0 이 되었을 때 뒤의 update 는 아직 처리 중일 수 있다.
 *
 * 그래서 확인 요청을 보내고 답을 기다린다. 서버는 한 연결의 메시지를 받은 차례대로 처리하고, update 를 담은 메시지는
 * `beforeSync` 가 로그에 쌓고 메모리 문서에 적용할 때까지 기다린다(`collab-server.ts` 머리말) — 요청을 처리할 때에는 그 연결에서
 * 앞서 받은 update 가 전부 로그에 있다. 앞선 update 가 거부되면 그 연결이 닫혀 답이 오지 않는다.
 *
 * 읽기 전용 연결에는 확인하지 않는다고 답한다 — Hocuspocus 는 그 연결의 update 를 닫지 않고 버린다.
 */

/**
 * 서버 렌더가 실어 보낸 본문 상태(Y update)를 푼다 — 페이지를 그릴 때 받은 것(6d).
 *
 * 첫 동기화 전에도 본문이 보이게 하려고 base64 로 싣는다. 서버 쪽은 `Buffer.from(update).toString('base64')` 다 —
 * 브라우저에는 `Buffer` 가 없어 여기서 `atob` 로 푼다.
 */
export function decodeBodyState(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Hocuspocus 문서 이름 — 페이지 하나가 문서 하나다. 세션을 워크스페이스로 해석해야 권한을 물을 수 있어 둘 다 싣는다. */
export function collabDocumentName(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`
}

const REQUEST = 'edits:confirm:'
const CONFIRMED = 'edits:confirmed:'
const REFUSED = 'edits:refused:'

export function confirmationRequest(token: string): string {
  return `${REQUEST}${token}`
}

/** 확인 요청이면 그 표, 아니면 null. */
export function parseConfirmationRequest(payload: string): string | null {
  return payload.startsWith(REQUEST) ? payload.slice(REQUEST.length) : null
}

export function confirmationReply(token: string, readOnly: boolean): string {
  return `${readOnly ? REFUSED : CONFIRMED}${token}`
}

export type ConfirmationReply = { readonly token: string; readonly confirmed: boolean }

/** 확인 답이면 그 표와 확인 여부, 아니면 null. */
export function parseConfirmationReply(payload: string): ConfirmationReply | null {
  if (payload.startsWith(CONFIRMED)) return { token: payload.slice(CONFIRMED.length), confirmed: true }
  if (payload.startsWith(REFUSED)) return { token: payload.slice(REFUSED.length), confirmed: false }
  return null
}
