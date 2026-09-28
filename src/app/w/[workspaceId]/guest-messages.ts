/**
 * 게스트 관리의 문구 — 7d-3조각 (F-06-09 · DOM · DB 없음)
 *
 * 워크스페이스 홈의 "게스트" 절(`guest-panel.tsx`)이 쓴다. 판정은 서버가 한다(`lib/workspace/guest.ts`) — 여기서 정하는 것은
 * 무엇을 보여 주고, 누르기 전에 무엇을 말할지뿐이다.
 */

export type GuestView = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly pages: number
}

/** 게스트가 받은 페이지 수 — 0 이면 그렇게 말한다(정리할 사람을 찾는 줄이다 · F-06-09 "접근 페이지 0개 게스트"). */
export function guestPagesLabel(pages: number): string {
  return pages === 0 ? '받은 페이지 없음' : `페이지 ${pages}개`
}

/** 올리기 전에 한 줄 — 무엇이 달라지는가(워크스페이스 전체 · 좌석). 받은 공유는 그대로라는 것도. */
export const PROMOTE_NOTICE = '멤버가 되면 워크스페이스 전체를 보고 좌석을 씁니다. 받은 공유는 그대로입니다.'

/** 빼기 전에 한 줄 — 받은 공유가 모두 걷히고, 다시 초대해도 옛 페이지는 돌아오지 않는다. */
export const REMOVE_NOTICE = '빼면 이 사람이 받은 공유가 모두 걷힙니다. 다시 초대해도 예전 페이지는 돌아오지 않습니다.'

export function promotedNotice(name: string, teamspaces: number): string {
  return teamspaces > 0
    ? `${name} 님을 멤버로 올렸습니다 — 기본 teamspace ${teamspaces}곳에도 들어갔습니다.`
    : `${name} 님을 멤버로 올렸습니다.`
}

export function removedNotice(name: string, pages: number): string {
  return `${name} 님을 뺐습니다 — 공유 ${pages}건을 걷었습니다.`
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 일반 문구. */
export function guestManageFailureMessage(error: unknown): string {
  switch (error) {
    case 'forbidden':
      return '게스트는 워크스페이스 소유자와 멤버십 관리자만 다룹니다.'
    case 'not_found':
      return '그 게스트를 찾을 수 없습니다. 이미 멤버가 됐거나 빠졌을 수 있습니다.'
    case 'would_orphan':
      return '빼면 관리할 사람이 남지 않는 페이지가 생깁니다. 그 페이지에 다른 사람의 전체 권한을 먼저 주세요.'
    default:
      return '처리하지 못했습니다.'
  }
}
