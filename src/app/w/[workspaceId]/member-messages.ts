/**
 * 멤버 관리의 문구 — 10o-2 (F-06-02 · DOM · DB 없음)
 *
 * 설정의 사람 절 멤버 목록(`member-panel.tsx`)이 쓴다. 판정은 서버가 한다(`lib/workspace/member.ts`) — 여기서 정하는 것은 무엇을
 * 보여 주고, 누르기 전에 무엇을 말하고, 거부를 어떻게 말할지뿐이다(정본 §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 ⑧).
 */

// 상대 경로 · `.ts` — 단위 검사(node)가 `@/` 별칭을 풀지 못한다(emoji-messages 와 같다)
import { roleLabel } from '../../../lib/settings/registry.ts'

export type MemberView = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly role: string
  readonly status: string
}

/** 줄의 역할 글 — 이름으로, 들어와 있지 않으면 그 상태를 붙인다. */
export function memberRoleText(member: MemberView): string {
  const state = member.status === 'invited' ? ' · 초대 수락 전' : member.status === 'suspended' ? ' · 멈춤' : ''
  return `${roleLabel(member.role)}${state}`
}

/** 내보내기 전에 한 줄 — 들어오지 못하고, 30일 안에 다시 초대하면 돌아온다(정본 ④ · M1). */
export const REMOVE_MEMBER_NOTICE =
  '내보내면 이 워크스페이스에 들어오지 못합니다. 30일 안에 다시 초대하면 받은 페이지 · 그룹 · 팀스페이스가 그대로 돌아옵니다.'

export function removedMemberNotice(name: string): string {
  return `${name} 님을 내보냈습니다.`
}

export function roleChangedNotice(name: string, to: string, teamspaces: number): string {
  const base = `${name} 님의 역할을 ${roleLabel(to)}(으)로 바꿨습니다.`
  return teamspaces > 0 ? `${base} 기본 팀스페이스 ${teamspaces}곳에도 들어갔습니다.` : base
}

/** 거부를 말한다(서버의 이유 코드 · `member-http.ts`). 팀스페이스의 마지막 소유자면 그 이름들을. */
export function memberManageFailureMessage(reason: unknown, teamspaces?: readonly string[]): string {
  switch (reason) {
    case 'forbidden':
      return '이 일은 할 수 없습니다 — 소유자 · 멤버 관리자의 역할은 소유자만 바꿉니다.'
    case 'not_found':
      return '이미 이 워크스페이스에 없는 사람입니다.'
    case 'last_owner':
      return '소유자가 한 명은 있어야 합니다. 먼저 다른 사람을 소유자로 만드세요.'
    case 'self':
      return '자기 자신은 내보낼 수 없습니다.'
    case 'teamspace_last_owner': {
      const names = (teamspaces ?? []).join(' · ')
      return `이 사람이 마지막 소유자인 팀스페이스가 있습니다${names === '' ? '' : `: ${names}`}. 먼저 그 팀스페이스의 소유자를 넘기세요.`
    }
    case 'invalid_role':
      return '바꿀 수 없는 역할입니다.'
    default:
      return '바꾸지 못했습니다.'
  }
}
