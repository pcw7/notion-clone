/**
 * teamspace 화면의 문구 · 고르기 — 7c-2조각 (F-06-04 · DOM · DB 없음)
 *
 * 사이드바의 만들기 폼(`teamspace-create.tsx`)과 설정 화면(`teamspaces/[teamspaceId]/teamspace-members.tsx`)이 서버의
 * 거부 코드를 사람의 말로 바꾸고, 넣을 후보를 고른다. 판정은 서버가 한다(`lib/workspace/teamspace.ts`) — 여기서 정하는
 * 것은 **무엇을 보여 줄지**뿐이다. 버튼을 숨겨도 서버가 다시 묻고, 숨기지 않은 버튼을 서버가 거부하면 그 말을 세운다.
 */

import { addableMembers, type GroupCandidate } from './group-messages.ts'

export type TeamspaceRoleName = 'owner' | 'member'
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
