/**
 * 대기 중인 초대의 문구 — 7g-3조각 (F-14-10 · DOM · DB 없음)
 *
 * 홈의 "멤버 초대" 절 아래 목록(`pending-invite-list.tsx`)이 쓴다. 판정 · 취소는 서버가 한다(`lib/workspace/invite.ts`
 * `revokeInvite`).
 */

/**
 * 목록 줄의 역할 — 게스트의 대기 초대(7g-1)는 페이지 하나를 받는다. **제목은 싣지 않는다** — 목록을 보는 사람이 그 페이지를 볼
 * 수 없을 수 있다(정본 §3.3 [보강] 게스트 ⑨ (g)).
 */
export function inviteRoleLabel(role: string): string {
  return role === 'guest' ? '게스트 · 페이지 하나' : role
}

/** 취소한 뒤 — 보낸 링크가 이제 열리지 않는다는 것까지. */
export function revokedNotice(email: string | null): string {
  const who = email ?? '그 사람'
  return `${who} 의 초대를 취소했습니다 — 보낸 링크는 이제 열리지 않습니다.`
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 일반 문구. */
export function revokeFailureMessage(error: unknown): string {
  switch (error) {
    case 'forbidden':
      return '초대를 다룰 수 있는 사람(owner · membership_admin)만 취소합니다.'
    case 'not_found':
      return '이미 받아들였거나 취소된 초대입니다.'
    default:
      return '취소하지 못했습니다.'
  }
}
