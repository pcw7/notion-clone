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
