/**
 * teamspace 화면의 문구 · 고르기 — 7c-2 · 7c-5조각 (F-06-04 · DOM · DB 없음)
 *
 * 사이드바의 만들기 폼(`teamspace-create.tsx`) · 설정 화면(`teamspaces/[teamspaceId]/`) · 둘러보기(`teamspaces/`)가 서버의
 * 거부 코드를 사람의 말로 바꾸고, 넣을 후보를 고르고, 공개 범위를 이름과 한 줄 설명으로 그린다.
 *
 * 판정은 서버가 한다(`lib/workspace/teamspace.ts`) — 여기서 정하는 것은 **무엇을 보여 줄지**뿐이다. 버튼을 숨겨도 서버가 다시 묻고, 숨기지 않은 버튼을 서버가 거부하면 그 말을 세운다.
 */

import { addableMembers, type GroupCandidate } from './group-messages.ts'

export type TeamspaceRoleName = 'owner' | 'member'
export type TeamspaceVisibilityName = 'open' | 'closed' | 'private'

/**
 * 공개 범위를 고르개에 세우는 **순서** — 넓은 것부터. `lib/workspace/teamspace.ts` 의 `TEAMSPACE_VISIBILITIES` 를 여기에
 * 또 적는 까닭은 이 모듈이 클라이언트 컴포넌트에서 import 되기 때문이다(그 모듈은 DB 를 끌어온다 · §3.3-163). 두 목록이
 * 어긋나는 것은 `teamspace-messages.test.ts` 가 막는다 — 검사만 서버 모듈을 함께 읽는다(`levels.db.test.ts` 와 같은 규칙).
 */
export const TEAMSPACE_VISIBILITY_ORDER: readonly TeamspaceVisibilityName[] = ['open', 'closed', 'private']

export function teamspaceVisibilityLabel(visibility: TeamspaceVisibilityName): string {
  switch (visibility) {
    case 'open':
      return '공개'
    case 'closed':
      return '초대'
    case 'private':
      return '비공개'
  }
}

/**
 * 고를 수 있는 아이콘 — 이모지 한 글자씩(7c-14). 서버(`normalizeTeamspaceIcon`)가 모두 받는지는 `teamspace-messages.test.ts` 가
 * 본다. API 로는 목록 밖의 이모지도 둘 수 있다 — 화면은 그 값도 그대로 그린다.
 */
export const TEAMSPACE_ICON_CHOICES: readonly string[] = [
  '🚀', '📚', '💡', '🎨', '🛠️', '📈', '🧪', '🏠', '🌱', '🎯', '📣', '🤝', '💼', '🧭', '🔒', '⭐',
]

/** 아이콘이 없을 때의 표시 — 7c-2 부터 사이드바가 쓰던 그 글자. */
export const DEFAULT_TEAMSPACE_ICON = '▣'

export function teamspaceIcon(icon: string | null | undefined): string {
  return icon ?? DEFAULT_TEAMSPACE_ICON
}

export type TeamspaceMemberLevelName = 'full_access' | 'edit' | 'comment' | 'view'

/**
 * 멤버 기본 레벨을 고르개에 세우는 순서 — 넓은 것부터(7c-12). 서버의 `TEAMSPACE_MEMBER_LEVELS` 와 어긋나지 않는 것은
 * `teamspace-messages.test.ts` 가 막는다(공개 범위와 같은 규칙 — 이 모듈은 클라이언트에서 import 된다).
 */
export const TEAMSPACE_MEMBER_LEVEL_ORDER: readonly TeamspaceMemberLevelName[] = ['full_access', 'edit', 'comment', 'view']

/** 이름은 공유 패널(`share-panel.tsx` 의 `PAGE_LEVELS`)과 같다 — 같은 레벨을 두 이름으로 부르지 않는다. */
export function memberLevelLabel(level: TeamspaceMemberLevelName): string {
  switch (level) {
    case 'full_access':
      return '전체 권한'
    case 'edit':
      return '편집'
    case 'comment':
      return '댓글'
    case 'view':
      return '읽기'
  }
}

/** 고르개 옆의 한 줄 — 멤버가 이 teamspace 에서 무엇을 할 수 있게 되는지. */
export function memberLevelHint(level: TeamspaceMemberLevelName): string {
  switch (level) {
    case 'full_access':
      return '멤버가 페이지를 만들고 고치고, 공유와 이동까지 합니다.'
    case 'edit':
      return '멤버가 페이지를 만들고 고칩니다. 공유와 다른 곳으로의 이동은 소유자만 합니다.'
    case 'comment':
      return '멤버는 읽고 댓글만 답니다. 페이지를 만들 수 없습니다.'
    case 'view':
      return '멤버는 읽기만 합니다. 페이지를 만들 수 없습니다.'
  }
}

/** 보관한 때를 사람이 읽는 말로 — 목록의 한 줄에 쓴다. 날짜만(시각은 되살릴 때 도움이 되지 않는다). */
export function archivedAtLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '보관됨'
  const days = Math.floor((now.getTime() - at.getTime()) / 86400000)
  if (days <= 0) return '오늘 보관'
  if (days === 1) return '어제 보관'
  if (days < 30) return `${days}일 전 보관`
  return `${at.getFullYear()}. ${at.getMonth() + 1}. ${at.getDate()}. 보관`
}

/** 고르개 옆의 한 줄 — 무엇이 달라지는지 말한다. 셋의 차이는 **존재와 참여**뿐이다(콘텐츠는 멤버만 본다 · 7c-5). */
export function teamspaceVisibilityHint(visibility: TeamspaceVisibilityName): string {
  switch (visibility) {
    case 'open':
      return '워크스페이스 멤버 누구나 둘러보고 스스로 참여할 수 있습니다.'
    case 'closed':
      return '존재는 모두에게 보이지만, 멤버가 넣어 줘야 들어옵니다.'
    case 'private':
      return '멤버가 아닌 사람에게는 이 teamspace 가 보이지 않습니다.'
  }
}

/**
 * 둘러보기의 한 줄에 무엇을 둘지 — **표시 전용**. 서버(`joinTeamspace`)와 같은 규칙이다.
 *
 *   member       이미 멤버다(공개 범위와 무관하다 — 내 것은 private 여도 목록에 있다)
 *   join         open — 참여 버튼
 *   needs_invite closed — 초대가 필요하다고 말한다
 *   hidden       private 인데 멤버가 아니다. 서버가 목록에서 빼므로 오지 않는다 — 와도 그리지 않는다
 */
export function teamspaceJoinAction(row: {
  readonly visibility: TeamspaceVisibilityName
  readonly role: TeamspaceRoleName | null
}): 'member' | 'join' | 'needs_invite' | 'hidden' {
  if (row.role !== null) return 'member'
  if (row.visibility === 'open') return 'join'
  if (row.visibility === 'closed') return 'needs_invite'
  return 'hidden'
}

export type TeamspaceMemberView = {
  readonly principal: { readonly type: 'user' | 'group'; readonly id: string }
  readonly role: TeamspaceRoleName
  readonly name: string
  readonly email: string | null
}
export type TeamspaceGroupCandidate = { readonly id: string; readonly name: string; readonly memberCount: number }

export function teamspaceRoleLabel(role: TeamspaceRoleName): string {
  return role === 'owner' ? '소유자' : '멤버'
}

/**
 * 기본 teamspace 를 켠 뒤의 한 줄(7c-11) — 몇 명이 들어왔는지와 앞으로 무엇이 달라지는지. 0 명이면 이미 모두 멤버였다.
 */
export function defaultTeamspaceAddedMessage(added: number): string {
  const future = '이제 워크스페이스에 새로 들어오는 멤버도 저절로 들어옵니다.'
  return added > 0 ? `워크스페이스 멤버 ${added}명이 들어왔습니다. ${future}` : `이미 모두 멤버입니다. ${future}`
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 일반 문구. */
export function teamspaceFailureMessage(error: unknown): string {
  switch (error) {
    case 'not_found':
      return 'teamspace 를 찾을 수 없습니다. 멤버에서 빠졌거나 보관됐을 수 있습니다.'
    case 'forbidden':
      return '그 일은 이 teamspace 의 소유자만 할 수 있습니다.'
    case 'invalid_name':
      return 'teamspace 이름은 1~100자로 적어 주세요.'
    case 'invalid_role':
      return '역할을 다시 고르세요.'
    case 'invalid_member':
      return '넣을 수 없는 사람이나 그룹입니다. 게스트는 teamspace 에 넣을 수 없습니다.'
    case 'last_owner':
      return '마지막 소유자는 내려가거나 나갈 수 없습니다. 다른 사람을 소유자로 만든 뒤에 하세요.'
    case 'needs_invite':
      return '이 teamspace 는 초대가 필요합니다. 멤버에게 넣어 달라고 하세요.'
    case 'invalid_visibility':
      return '공개 범위를 다시 고르세요.'
    case 'invalid_settings':
      return '고칠 것을 하나는 골라 주세요.'
    case 'default_teamspace':
      return '기본 teamspace 는 보관할 수 없습니다. 먼저 기본을 끄세요.'
    case 'invalid_level':
      return '멤버 기본 권한을 다시 고르세요.'
    case 'invalid_icon':
      return '아이콘은 이모지 한 글자만 고를 수 있습니다.'
    case 'plan_required':
      return '지금 요금제에서는 private teamspace 를 만들 수 없습니다. 요금제를 올리면 쓸 수 있습니다.'
    default:
      return '처리하지 못했습니다.'
  }
}

/**
 * "넣기" 칸을 보일지 — **표시 전용**. 서버(`addTeamspaceMember`)와 같은 규칙이다: 소유자는 늘, 멤버는 초대 규칙이
 * `all_members` 일 때만. 소유자로 넣는 것은 소유자만이다(`canInviteAsOwner`).
 */
export function canInviteHere(myRole: TeamspaceRoleName, whoCanInvite: string): boolean {
  return myRole === 'owner' || whoCanInvite === 'all_members'
}

export function canInviteAsOwner(myRole: TeamspaceRoleName): boolean {
  return myRole === 'owner'
}

/**
 * 넣을 후보 — 사람은 활성 · 게스트 아님 · 아직 **사람으로** 멤버가 아닌 사람(그룹 고르개와 같은 규칙 — `addableMembers`),
 * 그룹은 아직 멤버가 아닌 그룹. 그룹을 거쳐 이미 멤버인 사람도 사람으로 넣을 수 있다 — 그룹에서 빠져도 남게 하려는 것이다.
 */
export function teamspaceCandidates(
  people: readonly GroupCandidate[],
  groups: readonly TeamspaceGroupCandidate[],
  members: readonly TeamspaceMemberView[],
): { people: GroupCandidate[]; groups: TeamspaceGroupCandidate[] } {
  const users = members.filter((m) => m.principal.type === 'user').map((m) => ({ userId: m.principal.id }))
  const inGroups = new Set(members.filter((m) => m.principal.type === 'group').map((m) => m.principal.id))
  return { people: addableMembers(people, users), groups: groups.filter((g) => !inGroups.has(g.id)) }
}
