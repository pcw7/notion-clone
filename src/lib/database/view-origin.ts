/**
 * 개인 설정을 바꾼 탭 — 신호가 그 탭으로 돌아오지 않게 (DB 실시간 동기화 RT-3조각 · F-05-16)
 *
 * 정본: 00-canonical-data-model.md §3.6 `view_user_override` [보강 RT-3] ① · 마이그레이션 0154
 *
 * 탭마다 한 번 만든 id 를 개인 설정 요청의 머리(`x-view-origin`)에 싣는다. 명령이 트랜잭션에 묻어 두면(`notion.view_origin`) 트리거가 신호에
 * 싣고, 받는 탭이 자기 것이면 버린다 — 바꾼 탭은 저장 뒤 스스로 다시 그렸다. 판정에 쓰지 않는다(없거나 틀리면 모든 탭이 다시 그릴 뿐).
 */

export const VIEW_ORIGIN_HEADER = 'x-view-origin'

/** 신호의 구분자(`:`)가 들 수 없는 모양만 — 아니면 없는 것으로 본다. */
export function readViewOrigin(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null
}

let origin: string | null = null

/** 이 탭의 id — 처음 부를 때 만든다(서버 렌더에서는 부르지 않는다). */
export function viewOrigin(): string {
  if (origin === null) {
    origin =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
  return origin
}
