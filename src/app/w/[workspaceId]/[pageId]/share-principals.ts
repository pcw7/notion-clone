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

/** 공유 패널의 사람 — `guest` 면 이름 뒤에 "게스트"를 붙인다(7d-1 · 게스트는 편집까지만 받는다). */
export type ShareMember = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly guest?: boolean
}
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
  const base = member.email ? `${member.name} (${member.email})` : member.name
  return member.guest ? `${base} · 게스트` : base
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

// ── 레벨 고르개 (6f-1) ────────────────────────────────────────────────

type LevelOption = { readonly value: string; readonly label: string }

/** 레벨의 이름 — 여섯 모두(정본 §3.3). 표시만 한다 — 판정은 서버의 능력 집합이다. */
const LEVEL_LABELS: Readonly<Record<string, string>> = {
  view: '읽기',
  comment: '댓글',
  edit_content: '내용 편집',
  create: '만들기만',
  edit: '편집',
  full_access: '전체 권한',
}

/** 페이지에 줄 수 있는 레벨 — 넷. `edit_content` · `create` 는 데이터베이스 전용이다(서버 `isGrantableLevel` — 테스트가 대조한다). */
const PAGE_LEVELS = ['view', 'comment', 'edit', 'full_access'] as const

/**
 * 데이터베이스에 줄 수 있는 레벨(정본 §3.3 [보강] 데이터베이스의 레벨 ④) — "내용 편집"은 행 · 값을 고치고 구조(속성 · 뷰 · 템플릿)는 못 고친다.
 * "만들기만"(`create`)은 행 단위 규칙과 함께(6f-2) — 아직 고를 수 없다.
 */
const DATABASE_LEVELS = ['view', 'comment', 'edit_content', 'edit', 'full_access'] as const

/** 레벨의 이름. 모르는 값은 그대로(`constructor` 같은 프로토타입 이름에 함수를 내주지 않는다). */
export function levelLabel(level: string): string {
  return Object.hasOwn(LEVEL_LABELS, level) ? LEVEL_LABELS[level] : level
}

/** 추가 고르개의 레벨 — 노드의 종류가 정한다. */
export function shareLevelOptions(kind: 'page' | 'database'): readonly LevelOption[] {
  return (kind === 'database' ? DATABASE_LEVELS : PAGE_LEVELS).map((value) => ({ value, label: levelLabel(value) }))
}

/**
 * 이미 있는 줄의 고르개 — 종류의 목록에 **지금 레벨이 없으면 그 줄에만 덧붙인다.** 데이터베이스에 API 로 준 "만들기만"(고르개에는 6f-2 전까지
 * 없다)이 그렇다 — 목록에 없는 값의 select 는 첫 옵션("읽기")으로 보여, 그 사람이 다른 것을 가진 것처럼 속인다. 덧붙인 값은 고를 수 있는 다른
 * 레벨로 바꾸는 출발점일 뿐이다(그 값으로 다시 부여하지 않는다).
 */
export function entryLevelOptions(kind: 'page' | 'database', current: string): readonly LevelOption[] {
  const options = shareLevelOptions(kind)
  return options.some((o) => o.value === current) ? options : [...options, { value: current, label: levelLabel(current) }]
}

// ── 이메일로 초대 · 게스트 (7d-1) ─────────────────────────────────────

/**
 * 게스트에게 줄 수 있는 레벨 — 편집까지(전체 권한은 공유를 품는다). 서버의 `GUEST_LEVELS` 와 같은 값이어야 한다 —
 * `share-principals.test.ts` 가 두 목록을 대조한다(이 모듈은 클라이언트에서 import 되므로 서버 모듈을 끌어오지 않는다).
 */
export const GUEST_LEVEL_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'view', label: '읽기' },
  { value: 'comment', label: '댓글' },
  { value: 'edit', label: '편집' },
]

/** 이메일로 초대한 뒤의 한 줄 — 멤버에게 공유했는지, 게스트로 들였는지, 계정이 없어 초대 메일을 보냈는지(7g-1). */
export function guestInvitedNotice(as: unknown, email: string): string {
  if (as === 'member') return `${email} 은(는) 이미 이 워크스페이스의 멤버라 멤버로 공유했습니다.`
  if (as === 'pending') return `${email} 에게 초대 메일을 보냈습니다 — 가입해 받아들이면 이 페이지와 그 아래를 봅니다.`
  return `${email} 을(를) 게스트로 초대했습니다 — 이 페이지와 그 아래만 봅니다.`
}

/** 요금제의 게스트 한도(8k-2) — 이메일 초대 · 접근 요청의 허락이 같은 말을 한다. */
export const GUEST_LIMIT_MESSAGE = '이 요금제의 게스트 한도에 닿았습니다. 게스트를 정리하거나 요금제를 올리면 더 들일 수 있습니다.'

/** 이메일 초대의 거부 코드 → 문구. */
export function guestInviteMessage(error: unknown): string {
  switch (error) {
    case 'invalid_email':
      return '이메일 주소를 다시 확인하세요.'
    case 'invalid_level':
    case 'guest_level':
      return '게스트에게는 편집까지 줄 수 있습니다.'
    case 'unavailable':
      return '그 사람은 지금 이 워크스페이스에 들어올 수 없습니다.'
    case 'guest_limit':
      return GUEST_LIMIT_MESSAGE
    case 'policy_disabled':
      return '워크스페이스 정책이 멤버의 게스트 초대를 막았습니다 — 소유자나 멤버 관리자에게 부탁하세요.'
    case 'forbidden':
      return '이 페이지의 공유 설정을 바꿀 권한이 없습니다.'
    case 'not_found':
      return '페이지를 찾을 수 없습니다.'
    default:
      return '초대하지 못했습니다.'
  }
}
