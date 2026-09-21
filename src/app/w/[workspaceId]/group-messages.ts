/**
 * 그룹 화면의 문구 · 넣을 사람 고르기 — 7b조각 (F-06-03 · DOM · DB 없음)
 *
 * 화면(`group-panel.tsx`)이 서버의 거부 코드를 사람의 말로 바꾸고, 그룹에 넣을 수 있는 사람을 고른다. 판정은 서버가
 * 한다(`lib/workspace/group.ts`) — 여기서 고르는 것은 **고르개에 무엇을 늘어놓을지**뿐이고, 늘어놓지 않은 사람을 서버가
 * 받아 주는지와는 상관없다.
 *
 * 지우기의 `would_orphan` 은 **몇 페이지인지 함께 말한다.** "지울 수 없습니다"만 말하면 사용자는 무엇을 먼저 해야
 * 하는지 모른다 — 그 페이지들에 다른 관리자를 주거나 그룹에 관리자를 남겨야 한다. 개수는 복제 버튼처럼 `> 0` 으로
 * 묻는다(`NaN` · 음수가 "NaN개"로 새지 않는다).
 */

export type GroupCandidate = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly role: string
  readonly status: string
}

/** 서버의 거부 코드 → 문구. 모르는 코드면 일반 문구. */
export function groupFailureMessage(error: unknown, nodes?: unknown): string {
  switch (error) {
    case 'duplicate_name':
      return '같은 이름의 그룹이 이미 있습니다.'
    case 'invalid_name':
      return '그룹 이름은 1~100자로 적어 주세요.'
    case 'invalid_member':
      return '그룹에는 이 워크스페이스의 멤버만 넣을 수 있습니다. 게스트는 넣을 수 없습니다.'
    case 'forbidden':
      return '그룹은 소유자와 멤버십 관리자만 고칠 수 있습니다.'
    case 'not_found':
      return '그룹을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.'
    case 'would_orphan': {
      const count = typeof nodes === 'number' && nodes > 0 ? `${nodes}개` : ''
      return `이 그룹을 지우면 관리할 수 있는 사람이 아무도 남지 않는 페이지${count ? ` ${count}` : ''}가 생깁니다. 그 페이지에 다른 사람의 전체 권한을 먼저 주세요.`
    }
    default:
      return '바꾸지 못했습니다.'
  }
}

/** 지운 뒤의 알림. 거둔 공유가 있으면 그 수를 말한다 — 지운 그룹으로 보던 사람이 못 보게 됐다는 뜻이다. */
export function deletedNotice(name: string, nodes: unknown): string {
  return typeof nodes === 'number' && nodes > 0
    ? `"${name}" 그룹을 지웠습니다. 이 그룹이 받은 공유 ${nodes}개도 함께 거뒀습니다.`
    : `"${name}" 그룹을 지웠습니다.`
}

/**
 * 그룹에 넣을 수 있는 사람 — 활성 멤버 중 게스트가 아니고(G2) 아직 그룹에 없는 사람. 이름순은 서버가 준 순서를 따른다.
 *
 * 초대만 받은 사람(`invited`)은 넣지 않는다 — 서버도 받지 않는다(수락하기 전부터 그룹의 페이지가 그 사람 몫으로 잡힌다).
 */
export function addableMembers(
  members: readonly GroupCandidate[],
  inGroup: readonly { readonly userId: string }[],
): GroupCandidate[] {
  const already = new Set(inGroup.map((m) => m.userId))
  return members.filter((m) => m.status === 'active' && m.role !== 'guest' && !already.has(m.userId))
}
