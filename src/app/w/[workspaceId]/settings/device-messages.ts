/**
 * 로그인한 기기 패널의 문구 — AC-3 (F-14-08 · DOM · DB 없음)
 *
 * 거부 코드의 말 · 해낸 뒤의 말 · 상대 시각을 한 곳에 둔다. 판정은 서버다(`auth/devices.ts`). 상대 시각은 서버가 준 "지금"으로 센다 —
 * 서버 렌더와 하이드레이션이 같은 글을 그린다(브라우저의 시계로 세면 둘이 어긋난다).
 */

export function deviceFailureMessage(reason: unknown): string {
  switch (reason) {
    case 'not_found':
      return '이미 로그아웃된 기기입니다. 목록을 새로 고쳤습니다.'
    case 'current_session':
      return '이 기기는 여기서 로그아웃하지 않습니다. 화면의 로그아웃을 쓰세요.'
    case 'session_required':
      return '이 연결로는 기기를 관리할 수 없습니다.'
    case 'unauthenticated':
      return '이 기기의 로그인이 풀렸습니다. 다시 로그인해 주세요.'
  }
  return '로그아웃시키지 못했습니다. 잠시 뒤 다시 해 주세요.'
}

export const DEVICE_OFFLINE = '연결에 실패했습니다. 아무 기기도 로그아웃되지 않았습니다.'

export type DeviceDone = { readonly kind: 'one'; readonly label: string } | { readonly kind: 'others'; readonly revokedSessions: number }

export function deviceDoneMessage(done: DeviceDone): string {
  if (done.kind === 'one') return `${done.label} 에서 로그아웃시켰습니다.`
  return done.revokedSessions > 0
    ? `다른 기기 ${done.revokedSessions}곳에서 로그아웃시켰습니다. API 토큰은 그대로입니다.`
    : '로그아웃시킬 다른 기기가 없습니다.'
}

/** 상대 시각 — "방금" · "N분 전" · "N시간 전" · "N일 전". `now` 는 서버가 준 시각(ISO). 앞날이면 "방금". */
export function relativeTime(iso: string, now: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / 1000))
  if (!Number.isFinite(seconds) || seconds < 60) return '방금'
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}분 전`
  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / 3600)}시간 전`
  return `${Math.floor(seconds / 86400)}일 전`
}
