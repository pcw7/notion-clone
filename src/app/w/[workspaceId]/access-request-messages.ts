/**
 * 접근 요청의 문구 — 7e-1조각 (F-06-15 · DOM · DB 없음)
 *
 * 세 화면이 쓴다: 볼 수 없는 페이지의 화면(`[pageId]/no-access.tsx`) · 공유 패널의 "접근 요청" 절(`[pageId]/share-panel.tsx`) ·
 * 인박스 줄(`inbox/inbox-list.tsx`). 판정은 서버가 한다(`lib/permissions/access-request.ts`) — 여기서 정하는 것은 무엇을 보여 주고
 * 무엇을 말할지뿐이다.
 */

export const NO_ACCESS_TITLE = '이 페이지를 볼 권한이 없습니다'
export const NO_ACCESS_HINT = '이 페이지를 공유할 수 있는 사람에게 접근을 요청할 수 있습니다.'
/** 요청을 보낸 뒤 — 무시된 요청도 요청한 사람에게는 이렇게 보인다(무시를 알리지 않는다 · 정본 [보강] 접근 요청 ③). */
export const REQUEST_SENT = '접근을 요청했습니다. 허락되면 인박스로 알려 드립니다.'

const LEVEL_LABEL: Readonly<Record<string, string>> = {
  view: '읽기',
  comment: '댓글',
  edit: '편집',
  full_access: '전체 권한',
}

export type ApproveLevelOption = { readonly value: string; readonly label: string }

/**
 * 허락할 때 고를 레벨 — 좁은 것부터(첫째가 기본이다 · 요청한 사람은 레벨을 고르지 않았다). **게스트에게는 전체 권한이 없다** —
 * 서버도 거부하지만(`guest_level`) 고를 수 없는 것을 보여 주지 않는다.
 */
export function approveLevelOptions(guest: boolean): ApproveLevelOption[] {
  const values = guest ? ['view', 'comment', 'edit'] : ['view', 'comment', 'edit', 'full_access']
  return values.map((value) => ({ value, label: LEVEL_LABEL[value] as string }))
}

/** 요청 줄의 사람 — 이름 · 이메일 · 게스트면 그렇게. */
export function requesterLabel(r: { readonly name: string; readonly email: string | null; readonly guest: boolean }): string {
  const who = r.email ? `${r.name} (${r.email})` : r.name
  return r.guest ? `${who} · 게스트` : who
}

export function approvedNotice(name: string, level: string): string {
  return `${name} 님에게 ${LEVEL_LABEL[level] ?? level} 권한을 줬습니다.`
}

export function ignoredNotice(name: string): string {
  return `${name} 님의 요청을 무시했습니다 — 요청한 사람에게는 알리지 않습니다.`
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 일반 문구. */
export function accessRequestFailureMessage(error: unknown): string {
  switch (error) {
    case 'not_found':
      return '요청을 찾을 수 없습니다. 페이지가 지워졌거나 권한이 바뀌었을 수 있습니다.'
    case 'forbidden':
      return '이 페이지를 공유할 수 있는 사람만 요청을 처리합니다.'
    case 'decided':
      return '이미 처리된 요청입니다.'
    case 'invalid_level':
      return '줄 권한을 고르세요.'
    case 'guest_level':
      return '게스트에게는 전체 권한을 줄 수 없습니다 — 편집까지 줄 수 있습니다.'
    case 'invalid_principal':
      return '요청한 사람이 이제 이 워크스페이스에 없습니다.'
    case 'has_access':
      return '이미 이 페이지를 볼 수 있습니다.'
    default:
      return '처리하지 못했습니다.'
  }
}

/**
 * 인박스 줄의 글 — 요청은 누가 요청했고 지금 어떤지(알림은 요청을 복제하지 않는다 — 서버가 지금 행을 읽어 준다), 허락은 한 줄.
 * 접근 요청이 아닌 알림이면 null(부르는 쪽이 원래 미리보기를 쓴다).
 */
export function accessInboxLine(
  kind: string,
  access: { readonly requesterName: string | null; readonly status: string } | null,
): string | null {
  if (kind === 'access_granted') return '이 페이지를 볼 수 있게 됐습니다.'
  if (kind !== 'access_requested') return null
  const who = access?.requesterName ? `${access.requesterName} 님이 접근을 요청했습니다` : '접근 요청이 왔습니다'
  switch (access?.status) {
    case 'approved':
      return `${who} — 허락됨`
    case 'ignored':
      return `${who} — 무시함`
    default:
      return `${who} — 공유에서 처리하세요`
  }
}

/** 인박스에서 그 줄을 누르면 갈 곳 — 요청은 공유 패널을 연 채로(`?share=1`), 나머지는 페이지. */
export function inboxHref(workspaceId: string, pageId: string, kind: string): string {
  return kind === 'access_requested' ? `/w/${workspaceId}/${pageId}?share=1` : `/w/${workspaceId}/${pageId}`
}
