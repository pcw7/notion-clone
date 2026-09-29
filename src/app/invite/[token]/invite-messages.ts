/**
 * 초대 수락 화면의 문구 · 목적지 — F-14-10 · 7g-1(게스트의 대기 초대) · DOM · DB 없음
 *
 * 워크스페이스 초대와 게스트 초대가 같은 수락 화면을 쓴다. 게스트 초대는 **페이지 하나**를 받는다 — 받기 전에는 그 페이지를 볼 수
 * 없으므로 제목을 싣지 않고, 받아들이면 그 페이지로 간다(정본 §3.3 게스트 ⑨ (g)).
 */

/** 머리 아래의 한 줄 — 무엇으로 초대됐는가. */
export function inviteSummary(email: string, role: string): string {
  return role === 'guest'
    ? `${email} 로 페이지 하나에 게스트로 초대되었습니다 — 받아들이면 그 페이지와 그 아래만 봅니다.`
    : `${email} 로 초대되었습니다 · 역할 ${role}`
}

/** 수락 버튼의 글. */
export function acceptLabel(role: string, busy: boolean): string {
  if (busy) return role === 'guest' ? '받아들이는 중…' : '참여하는 중…'
  return role === 'guest' ? '초대 받아들이기' : '워크스페이스 참여'
}

/** 받아들인 뒤 갈 곳 — 게스트 초대면 받은 페이지, 아니면 워크스페이스 홈. */
export function acceptDestination(data: { workspaceId: string; pageId?: unknown }): string {
  return typeof data.pageId === 'string' ? `/w/${data.workspaceId}/${data.pageId}` : `/w/${data.workspaceId}`
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 "유효하지 않다". */
export function acceptFailureMessage(error: unknown): string {
  switch (error) {
    case 'already_member':
      return '이미 이 워크스페이스의 멤버입니다.'
    case 'email_mismatch':
      return '이 초대는 다른 이메일 앞으로 왔습니다.'
    case 'seat_limit':
      return '워크스페이스의 좌석이 가득 찼습니다.'
    case 'page_unavailable':
      return '초대받은 페이지를 이제 받을 수 없습니다. 페이지가 지워졌거나 초대한 사람이 더는 공유할 수 없습니다.'
    case 'unavailable':
      return '지금은 이 워크스페이스에 들어올 수 없습니다.'
    default:
      return '초대가 유효하지 않습니다.'
  }
}
