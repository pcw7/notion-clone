/**
 * 다시 붙기 · 로그아웃의 일을 하는 숨은 틀 — 앱의 화면과 껍데기가 주고받는 말 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④)
 *
 * 일(`offline-sync.ts` — 협업 연결 · yjs)은 **껍데기(`/offline`) 안에서, 오프라인 편집기의 청크로** 돈다. 앱의 화면은 껍데기를 숨은
 * 틀(`/offline#sync`)로 열고 말을 넘긴다(`offline-sync-client.ts`). 받아 두기 틀(`offline-warm.ts` · `#warm`)과 같은 길이다.
 *
 * ⚠ 그 모듈을 **새 지연 청크로** 부르면(레이아웃의 `import()` · 워커 · 껍데기의 따로 된 `import()` 모두) 페이지 화면의 첫 JS 가 3.5KB
 * 커졌다(잰 것 — 442.7 → 447.2KB). 번들러는 모듈을 "어느 청크 묶음들이 쓰는가"로 묶어 청크를 자르는데, 새 묶음이 페이지 화면의 첫
 * 모듈(협업 연결 · yjs · 본문 읽기)을 함께 쓰면 그 조합이 늘어 첫 청크가 잘게 쪼개진다(21 → 23개 파일 · 합쳐 두던 yjs 가 풀린다). 그래서
 * 그것들을 이미 싣는 편집기 청크(`offline-editor.tsx`)에 얹는다 — 새 묶음이 없다(443.7KB · 늘어난 1.0KB 는 알림 · 로그아웃 물음).
 *
 * 말은 같은 출처끼리만 — 틀은 부모가 보낸 것만 받고, 부모는 그 틀이 보낸 것만 받는다. 껍데기가 이 모듈을 첫 JS 에 싣는다 — 작게 둔다.
 */

/** 껍데기를 일하는 틀로 여는 표시(주소의 해시). */
export const SYNC_HASH = '#sync'
/** 틀 → 앱: 받을 준비가 됐다. */
export const SYNC_READY = 'nc-offline-sync-ready'
/** 앱 → 틀: 일 하나(`SyncRequest`). */
export const SYNC_REQUEST = 'nc-offline-sync'
/** 틀 → 앱: 그 일의 답(`SyncReply`). */
export const SYNC_REPLY = 'nc-offline-sync-reply'

/** 이 껍데기가 일하는 틀인가 — 해시가 맞고 다른 화면 안에 열렸다. */
export function isSyncFrame(hash: string, framed: boolean): boolean {
  return framed && hash === SYNC_HASH
}

/** 정해진 종류의 말인가 — 몸(`body`)의 모양은 받는 쪽이 본다. */
export function isFrameMessage(data: unknown, type: string): data is { readonly type: string; readonly body?: unknown } {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === type
}
