/**
 * 본문 한 번에 보낼 수 있는 크기 — F-12-16
 *
 * 두 경로가 같은 자릿수를 쓴다: 본문 저장(PUT)이 받는 문서(`MAX_BODY_BYTES`)와 협업 경로의 update 하나
 * (`collab/doc-store.ts` `MAX_DOC_UPDATE_BYTES`). 넘으면 **받기 전에** 거부하고 사용자에게 이유를 말한다.
 *
 * 저장 큐(`src/lib/sync/`)에 있던 상수다 — 큐를 걷어내며(CRDT 6d) 여기로 옮겼다.
 */

export const MAX_BODY_BYTES = 1024 * 1024

export const TOO_LARGE_MESSAGE = `이 페이지가 한 번에 저장할 수 있는 크기(${Math.round(
  MAX_BODY_BYTES / 1024,
)}KB)를 넘었습니다. 일부를 잘라 하위 페이지로 옮겨 주세요.`
