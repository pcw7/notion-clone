/**
 * 공유 패널의 주체 — ACL 행을 요청의 주체로, 이름으로 (7a조각 · F-06-03 · DOM 없음)
 *
 * 패널은 서버가 준 행(`principalType` · `principalId`)을 받아 두 가지를 한다 — 이름을 그리고, 레벨 바꾸기 · 제거를
 * 누르면 **그 행의 주체**를 요청에 실어 보낸다. 두 번째가 틀리면 엉뚱한 주체의 권한이 바뀐다.
 *
 * ⚠ 그룹이 오기 전에는 "사용자가 아니면 워크스페이스 모든 멤버"로 읽었다(주체가 둘뿐이었다). 그 규칙이 남아 있으면
 *   **그룹 행의 "제거"가 모든 멤버의 행을 지운다.** 그래서 종류마다 이름으로 가르고, 모르는 종류(public — 아직 없다)는
 *   `null` 이다 — 패널은 그 행을 읽기 전용으로 그린다. 모르는 것을 아는 것으로 바꿔 보내지 않는다. teamspace(7c-1)는
 *   이제 아는 종류다 — teamspace 페이지의 상속을 끊으면 "그 teamspace 멤버 전원" 행이 복사되어 이 페이지의 것이 된다.
 */

export type SharePrincipal =
  | { readonly type: 'user'; readonly id: string }
  | { readonly type: 'group'; readonly id: string }
  | { readonly type: 'teamspace'; readonly id: string }
  | { readonly type: 'workspace_everyone' }

export type ShareEntry = {
  readonly principalType: string
  readonly principalId: string | null
}

export type ShareMember = { readonly userId: string; readonly name: string; readonly email: string | null }
export type ShareGroup = { readonly groupId: string; readonly name: string; readonly memberCount: number }
export type ShareTeamspace = { readonly teamspaceId: string; readonly name: string }

export const EVERYONE_LABEL = '워크스페이스 모든 멤버'

/** 이 행을 요청에 실을 주체. 모르는 종류 · id 가 없는 행이면 null — 고치지 못하게 한다. */
export function principalOfEntry(entry: ShareEntry): SharePrincipal | null {
  switch (entry.principalType) {
    case 'workspace_everyone':
      return { type: 'workspace_everyone' }
    case 'user':
    case 'group':
    case 'teamspace':
      return entry.principalId === null ? null : { type: entry.principalType, id: entry.principalId }
    default:
      return null
  }
}

export function memberLabel(member: ShareMember): string {
  return member.email ? `${member.name} (${member.email})` : member.name
}

export function groupLabel(group: ShareGroup): string {
  return `그룹 · ${group.name} (${group.memberCount}명)`
}

/** 행의 이름. 이름을 모르면(목록에 없다 — 게스트는 그룹 목록을 받지 않는다) 종류만 말한다. */
export function entryLabel(
  entry: ShareEntry,
  members: readonly ShareMember[],
  groups: readonly ShareGroup[],
  teamspaces: readonly ShareTeamspace[] = [],
): string {
  switch (entry.principalType) {
    case 'workspace_everyone':
      return EVERYONE_LABEL
    case 'user': {
      const member = members.find((m) => m.userId === entry.principalId)
      return member ? memberLabel(member) : '알 수 없는 사용자'
    }
    case 'group': {
      const group = groups.find((g) => g.groupId === entry.principalId)
      return group ? groupLabel(group) : '그룹'
    }
    case 'teamspace': {
      // teamspace 의 부여(7c-1) — teamspace 페이지가 물려받는 "멤버 전원" 행이 대부분 이것이다.
      const teamspace = teamspaces.find((t) => t.teamspaceId === entry.principalId)
      return teamspace ? `teamspace · ${teamspace.name} 멤버` : 'teamspace 멤버'
    }
    default:
      return '알 수 없는 주체'
  }
}

/**
 * "추가" 고르개의 값. 사람과 그룹이 한 목록에 있으므로 종류를 값에 싣는다 — id 만 실으면 받는 쪽이 사람인지 그룹인지
 * 모른다.
 */
export function choiceValue(principal: { readonly type: 'user' | 'group' | 'teamspace'; readonly id: string }): string {
  return `${principal.type}:${principal.id}`
}

export function parseChoice(value: string): { readonly type: 'user' | 'group'; readonly id: string } | null {
  const at = value.indexOf(':')
  if (at <= 0) return null
  const type = value.slice(0, at)
  const id = value.slice(at + 1)
  if ((type !== 'user' && type !== 'group') || id === '') return null
  return { type, id }
}
