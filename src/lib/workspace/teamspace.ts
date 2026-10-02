/**
 * teamspace — Teamspace · 게스트 · 그룹 7c-1조각 (F-06-04 · F-02-12)
 *
 * 정본: 00-canonical-data-model.md §3.3 `teamspace` · `teamspace_member` · `acl_entry.node_kind='teamspace'`,
 *       §3.4 `parent_type='teamspace'`, §3.11 P(U) · `perm_scope_id`, 판결문 _canon/block-tree.md C-9/V-9
 *       06-permissions-sharing.md F-06-04 · 02-page-workspace.md F-02-12
 *
 * teamspace 는 **트리의 뿌리이자 권한의 원천**이다. 그 최상위 페이지의 부모가 teamspace 이고(`parent_type='teamspace'`),
 * 그 아래 페이지는 판정(`effective.ts`)이 조상 사슬 끝에 teamspace 노드를 붙여 그 노드의 부여를 물려받는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한은 teamspace 노드의 acl_entry 다
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · ('teamspace', T) → `MEMBER_DEFAULT_LEVEL` — 멤버 전원이 그 페이지들을 이 레벨로 받는다
 *   · owner 마다 ('user' | 'group', id) → full_access — F-06-04 *"owner 는 teamspace 의 모든 페이지에 기본 full access"*
 *
 * 이 행들을 쓰는 곳은 **이 파일 하나**다. 공유 명령(`acl.ts`)은 블록 노드만 받으므로 teamspace 노드에 손대지 못한다.
 * owner 행은 멤버의 역할과 같은 트랜잭션에서 맞춘다 — 역할이 owner 면 행이 있고, 아니면 없다.
 *
 * 멤버의 기본 레벨은 만들 때 **full_access** 다. 워크스페이스 직속 페이지가 모든 멤버에게 주던 것(`inheritFromWorkspace`)과
 * 같다 — teamspace 는 그 "모두"를 멤버로 좁힌 것이다. **owner 가 바꾼다**(7c-12 · `updateTeamspace` 의 `memberLevel`) — 값은
 * page 매트릭스의 넷(`TEAMSPACE_MEMBER_LEVELS` · DB 의 CHECK 0031)이고, 바꾸는 것은 `('teamspace', T)` 행 하나의 level 이다.
 * 낮춰도 owner 는 자기 행으로 full_access 이고, 상속을 끊은 페이지는 끊을 때 복사한 레벨을 지킨다(P2).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누가 무엇을 하는가 — 워크스페이스 역할과 teamspace 역할
 * ──────────────────────────────────────────────────────────────────────
 *
 *   · 만들기: 워크스페이스 owner · membership_admin · member. restricted_member · guest 는 못 한다(F-06-04 — 제한 멤버는
 *     초대받아야 teamspace 가 생긴다 · 게스트는 멤버가 될 수 없다). 만든 사람이 owner 다
 *   · 멤버 넣기: teamspace 의 멤버(`who_can_invite='all_members'`) 또는 owner(`'owners'`). **owner 로 넣는 것은 owner 만**
 *   · 역할 바꾸기: owner 만
 *   · 빼기: owner 는 누구든, 멤버는 **자기 자신만**(나가기)
 *   · **마지막 owner 는 내려가거나 빠질 수 없다**(`last_owner`) — F-06-04 가 적은 대로 워크스페이스 관리자의 역할은
 *     콘텐츠 접근을 주지 않으므로, owner 가 없는 teamspace 는 설정을 고칠 사람이 없는 고아가 된다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 공개 범위(visibility)는 **존재와 참여**만 정한다 — 판정에는 들어가지 않는다(7c-5)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   | visibility | 둘러보기에 보이는가 | 스스로 참여 | 멤버가 아닌 사람의 콘텐츠 |
 *   |---|---|---|---|
 *   | open    | 보인다   | O(`joinTeamspace`) | **본다(view · 7c-9)** — 고치려면 참여한다 |
 *   | closed  | 보인다   | X(초대 — `needs_invite`) | 못 본다 |
 *   | private | 안 보인다 | X(없는 것과 같다 — `not_found`) | 못 본다 |
 *
 * open 의 열람은 F-06-04 의 표(공식 문구 *"Anyone can join and view the content"*) 그대로다. 7c-5 는 이것을 "참여해야
 * 본다"로 좁혀 두었다 — 열람 행을 두면 그 페이지들이 전원의 사이드바로 쏟아지는데 설 자리가 없었기 때문이다. 공유됨
 * 섹션이 서고(7c-7) 사이드바가 뿌리를 가릴 수 있게 되어 7c-9 가 되돌렸다(§3.2-45 의 재검토 조건 그대로).
 *
 * 구현은 행 하나다 — open 인 teamspace 노드에 `('workspace_everyone') → 'view'`(`syncOpenGrant`). 판정 기계는 그대로다:
 * 게스트 · restricted_member 는 `workspace_everyone` 주체를 받지 않으므로(P(U)) 자동으로 빠지고, 보관되면 노드의 행을
 * 판정이 읽지 않으므로(7c-6) 열람도 함께 닫힌다. **사이드바에는 세우지 않는다** — 멤버가 아닌 open teamspace 의 뿌리는
 * `groupSidebarRoots` 가 가린다(참여하면 선다). 검색 · 링크로는 닿는다 — 스코프가 읽을 수 있는 곳이 됐기 때문이다.
 *
 * 그래서 **open ↔ closed·private 전환은 권한 변화다** — 그 변화는 `syncOpenGrant` 의 acl_entry 쓰기가 나르고, 0016 의
 * 노드 신호 트리거가 협업 서버에 알린다(0028 을 고칠 것이 없다). 참여는 전과 같이 멤버십 신호를 탄다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 보관(archive)은 지우기를 대신한다 — 아무도 못 보고, 소유자만 되살린다(7c-6)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-06-04: *"Teamspace는 삭제되지 않고 archive만 된다. archive 시 모든 멤버의 사이드바에서 제거된다."* 우리의 뜻은 이렇다.
 *
 *   · **아무도 못 본다.** 멤버는 `principalsFor` 가 보관된 teamspace 를 주체로 주지 않아 잃고, **owner 도 잃는다** —
 *     판정이 보관된 teamspace 노드의 행을 읽지 않는다(`effective.ts` `resolveChain`). 그렇지 않으면 목록(보관된 것을
 *     스코프 후보에서 뺀다)과 판정이 어긋나 owner 만 주소로 들어갈 수 있다
 *   · **행은 그대로 둔다.** `acl_entry` · `teamspace_member` 를 건드리지 않으므로 복원하면 정확히 되돌아온다.
 *     페이지에 따로 준 부여(블록 노드의 행)는 보관과 무관하게 살아 있다 — 그 페이지는 자기 자신이 경계다
 *   · **보관하고 되살리는 것은 owner 다.** F-06-04 은 복원을 *"workspace owner이면서 teamspace owner"* 로 적었는데,
 *     우리는 **teamspace owner** 로 둔다 — 워크스페이스 owner 가 아닌 사람이 만든 teamspace 를 보관하면 아무도 되살릴 수
 *     없게 되기 때문이다(워크스페이스 owner 는 멤버가 아닌 teamspace 에 손댈 길이 아직 없다 — §7 의 "관리 경로")
 *   · 보관된 teamspace 는 이름도 새 자리도 주지 않는다 — 만들기 · 넣기 · 옮기기 · 설정이 모두 `not_found` 다
 *     (`lockTeamspace` 가 보관된 행을 잠그지 않는다). 되살릴 사람만 `listArchivedTeamspaces` 로 그 존재를 본다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 기본 teamspace(`is_default`)는 **들여보내기만 한다**(7c-11)
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-06-04: *"켜면 기존 멤버 전원이 즉시 추가되고, 이후 가입자도 자동 추가"*. 판정의 입력이 아니다 — 멤버 행을 넣는 두
 * 순간(켤 때 `setDefaultTeamspace` · 워크스페이스에 들어올 때 `joinDefaultTeamspaces`)이 있을 뿐이고, 그 뒤는 보통 멤버다.
 *
 *   · 켜고 끄는 사람: 워크스페이스 owner **이면서** 그 teamspace 의 owner — 켜면 콘텐츠가 전원에게 열리므로 누구에게 여는지를
 *     정하는 teamspace owner 의 결정이기도 하다. 멤버가 아닌 워크스페이스 owner 는 먼저 드러나게 들어간다(7c-10)
 *   · 들어오는 사람: 활성 owner · membership_admin · member(`DEFAULT_TEAMSPACE_ROLES`) — 늘 `member` 로. 제한 멤버는 넣지
 *     않는다(초대받기 전에는 teamspace 가 없는 것과 같다는 것이 그 역할의 뜻이다)
 *   · 끄면 앞으로의 자동 추가만 멈춘다. 나가기도 막지 않는다
 *   · **기본 teamspace 는 보관하지 않는다**(`default_teamspace` · DB 의 CHECK 0030) — 먼저 끈다
 *
 * 둘러보기 · 참여를 할 수 있는 워크스페이스 역할은 `canBrowseTeamspaces` 다 — `restricted_member` 와 게스트는 멤버가 아닌
 * teamspace 를 **보지도 못한다**(F-06-04 *"추가 전에는 이 사람에게 teamspace 자체가 존재하지 않는 것과 같음"*).
 *
 * 역할은 사람으로도, 그룹을 거쳐서도 받는다(`teamspace_member.principal_type`). 둘 중 하나라도 owner 면 owner 다.
 * 게스트는 어느 쪽으로도 멤버가 아니다(`principalsOf` 와 같은 규칙).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { isSingleEmoji, MAX_EMOJI_CODE_POINTS } from '../contracts/emoji.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { teamspaceCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'

export const MAX_TEAMSPACE_NAME_LENGTH = 100
export const TEAMSPACE_VISIBILITIES = ['open', 'closed', 'private'] as const
export type TeamspaceVisibility = (typeof TEAMSPACE_VISIBILITIES)[number]
export type TeamspaceRole = 'owner' | 'member'

/**
 * 멤버 전원이 받는 레벨로 고를 수 있는 값(7c-12) — **page 매트릭스의 넷**이다. teamspace 노드의 행은 그 아래 페이지가
 * 물려받으므로 page 매트릭스로 읽힌다. `edit_content` · `create` 는 database 전용이라 뺀다(DB 의 CHECK 0031 이 같은 넷).
 * 넓은 것부터.
 */
export const TEAMSPACE_MEMBER_LEVELS = ['full_access', 'edit', 'comment', 'view'] as const
export type TeamspaceMemberLevel = (typeof TEAMSPACE_MEMBER_LEVELS)[number]

/** 만들 때 멤버 전원이 받는 레벨(머리말). owner 가 바꾼다. */
export const MEMBER_DEFAULT_LEVEL: TeamspaceMemberLevel = 'full_access'

export type TeamspacePrincipal = { readonly type: 'user' | 'group'; readonly id: string }

export type TeamspaceFailure =
  /** 없는 · 보관된 · 다른 워크스페이스의 teamspace, 또는 그 teamspace 의 멤버가 아니다 — 구분해 주지 않는다. */
  | 'not_found'
  /** 멤버이지만 그 일을 할 역할이 아니다. */
  | 'forbidden'
  | 'invalid_name'
  | 'invalid_visibility'
  | 'invalid_role'
  /** 게스트 · 이 워크스페이스의 활성 멤버가 아닌 사람 · 살아 있지 않은 그룹. */
  | 'invalid_member'
  /** 마지막 owner 를 내리거나 뺄 수 없다. */
  | 'last_owner'
  /** 존재는 보이지만(closed) 스스로 참여할 수 없다 — 멤버가 넣어 줘야 한다. */
  | 'needs_invite'
  /** 고칠 것을 하나도 주지 않았다. */
  | 'invalid_settings'
  /** 멤버 기본 레벨로 고를 수 없는 값이다(`TEAMSPACE_MEMBER_LEVELS` 밖 — 7c-12). */
  | 'invalid_level'
  /** 아이콘이 이모지 한 글자가 아니다(7c-14). */
  | 'invalid_icon'
  /** 기본 teamspace 는 보관할 수 없다 — 먼저 기본을 끈다(7c-11). */
  | 'default_teamspace'

export type TeamspaceResult<T = void> =
  | ({ readonly ok: true } & (T extends void ? object : { readonly value: T }))
  | { readonly ok: false; readonly reason: TeamspaceFailure }

export type TeamspaceSummary = {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly visibility: TeamspaceVisibility
  /** 내 역할 — 사람으로 받은 것과 그룹을 거쳐 받은 것 중 넓은 쪽. */
  readonly role: TeamspaceRole
  /**
   * 그 최상위에 페이지 · 데이터베이스를 둘 수 있는가 — `teamspaceCaps` 의 `create_child`(만들기 명령과 같은 판정 · 7c-12).
   * 멤버 기본 레벨이 comment · view 면 멤버는 못 둔다. 사이드바의 `+` · 옮기기 피커 · teamspace 화면이 이것을 본다.
   */
  readonly canCreatePages: boolean
}

export type TeamspaceWhoCanInvite = 'owners' | 'all_members'

/** teamspace 하나 — 설정 화면의 머리와 내 역할. 초대 규칙을 함께 싣는다(누구에게 "넣기"를 보일지). */
export type TeamspaceDetail = TeamspaceSummary & {
  readonly whoCanInvite: TeamspaceWhoCanInvite
  readonly isDefault: boolean
  /** 멤버 전원이 받는 레벨 — `('teamspace', T)` 행의 level(7c-12). */
  readonly memberLevel: TeamspaceMemberLevel
}

/**
 * 둘러보기 목록의 한 줄 — 내가 멤버가 아닌 것도 온다. 그래서 `role` 이 null 일 수 있다(`TeamspaceSummary` 와 다른 점).
 * `memberCount` 는 **사람 수**다(그룹으로 들어온 사람까지 센 distinct) — 주체 수가 아니다.
 */
export type BrowsableTeamspace = {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly visibility: TeamspaceVisibility
  readonly isDefault: boolean
  readonly memberCount: number
  readonly role: TeamspaceRole | null
}

/** 보관된 teamspace 한 줄 — 되살릴 수 있는 사람(그 teamspace 의 owner)만 본다. 콘텐츠는 주지 않는다. */
export type ArchivedTeamspace = {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly visibility: TeamspaceVisibility
  readonly archivedAt: string
}

/**
 * 워크스페이스 owner 의 관리 목록 한 줄(7c-10) — **비공개 · 보관된 것까지** 온다. 콘텐츠는 없다(이름 · 상태 · owner 수뿐).
 * `ownerCount` 는 **실제로 행동할 수 있는** owner 수다(활성 · 게스트 아닌 사람 · 지워지지 않은 그룹) — 0 이면 고아다.
 */
export type AdminTeamspaceRow = {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly visibility: TeamspaceVisibility
  readonly isDefault: boolean
  readonly archivedAt: string | null
  readonly ownerCount: number
  /** 내 역할 — 멤버가 아니면 null. 보관된 teamspace 에서도 `teamspace_member` 로 읽는다. */
  readonly role: TeamspaceRole | null
}

export type TeamspaceMemberRow = {
  readonly principal: TeamspacePrincipal
  readonly role: TeamspaceRole
  readonly name: string
  readonly email: string | null
}

const fail = (reason: TeamspaceFailure) => ({ ok: false, reason }) as const

/** teamspace 를 만들 수 있는 워크스페이스 역할인가 — 역할 **이름**을 묻는다(CLAUDE.md). */
export function canCreateTeamspace(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'membership_admin' || role === 'member'
}

/**
 * 멤버가 아닌 teamspace 를 둘러보고 참여할 수 있는 워크스페이스 역할인가 — 역할 **이름**을 묻는다(CLAUDE.md).
 *
 * 지금은 `canCreateTeamspace` 와 같은 집합이지만 묻는 것이 다르므로 함수를 따로 둔다(`canManageGroups` 와 같은 규칙).
 * `restricted_member` 와 게스트가 빠지는 까닭은 머리말에 있다 — 그들에게는 멤버가 아닌 teamspace 가 없는 것과 같다.
 */
export function canBrowseTeamspaces(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'membership_admin' || role === 'member'
}

/**
 * 기본 teamspace 에 저절로 들어가는 워크스페이스 역할(7c-11) — 역할 **이름**의 목록이다(CLAUDE.md). 켤 때의 배치 삽입과
 * 워크스페이스에 들어올 때의 추가가 같은 목록을 SQL 에 넘긴다.
 *
 * `canBrowseTeamspaces` 와 지금 같은 집합이지만 묻는 것이 다르다 — 이것은 "초대 없이 넣어도 되는가"다. `restricted_member`
 * 가 빠지는 까닭은 머리말에 있다.
 */
export const DEFAULT_TEAMSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'membership_admin', 'member']

/** 아이콘의 코드포인트 상한 — DB 의 CHECK(0032)와 같은 값이다(페이지 아이콘과 한 규칙 — `contracts/emoji.ts`). */
export const MAX_TEAMSPACE_ICON_CODE_POINTS = MAX_EMOJI_CODE_POINTS

/**
 * 아이콘 — **이모지 한 글자**(grapheme 하나 · 7c-14). `null` · 빈 글은 "아이콘 없음"이다(화면은 기본 표시를 쓴다). 모양이
 * 아니면 `undefined`(→ `invalid_icon`).
 *
 * "한 글자 · 이모지"의 규칙은 페이지 아이콘(8c-1)과 같은 `isSingleEmoji` 다. DB 는 이 검사를 못 하므로 길이 · 공백만 CHECK 로
 * 막는다(0032).
 */
export function normalizeTeamspaceIcon(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'string') return undefined
  const icon = raw.trim()
  if (icon === '') return null
  return isSingleEmoji(icon) ? icon : undefined
}

export function normalizeTeamspaceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_TEAMSPACE_NAME_LENGTH) return null
  return name
}

function isVisibility(raw: unknown): raw is TeamspaceVisibility {
  return typeof raw === 'string' && (TEAMSPACE_VISIBILITIES as readonly string[]).includes(raw)
}

function isMemberLevel(raw: unknown): raw is TeamspaceMemberLevel {
  return typeof raw === 'string' && (TEAMSPACE_MEMBER_LEVELS as readonly string[]).includes(raw)
}

function isRole(raw: unknown): raw is TeamspaceRole {
  return raw === 'owner' || raw === 'member'
}

/**
 * 이 세션의 teamspace 역할 — 멤버가 아니면 null. 사람으로 받은 행과 **이 사람이 속한 살아 있는 그룹**으로 받은 행을 함께
 * 본다. 게스트는 늘 null 이다(`principalsOf` 가 게스트에게 그룹 · teamspace 주체를 주지 않는 것과 같은 규칙).
 */
async function roleIn(tx: Tx, ctx: SessionContext, teamspaceId: string): Promise<TeamspaceRole | null> {
  if (ctx.role === 'guest') return null
  const rows = await tx.query<{ role: TeamspaceRole }>(
    `SELECT tm.role
       FROM teamspace_member tm
      WHERE tm.teamspace_id = $1 AND tm.removed_at IS NULL
        AND ((tm.principal_type = 'user' AND tm.principal_id = $2)
          OR (tm.principal_type = 'group' AND tm.principal_id IN (
                SELECT g.id FROM group_member gm JOIN "group" g ON g.id = gm.group_id
                 WHERE gm.user_id = $2 AND gm.removed_at IS NULL AND g.deleted_at IS NULL AND g.workspace_id = $3)))`,
    [teamspaceId, ctx.userId, ctx.workspaceId],
  )
  if (rows.length === 0) return null
  return rows.some((r) => r.role === 'owner') ? 'owner' : 'member'
}

/** 고칠 teamspace 를 잠근다 — 이 워크스페이스의 보관되지 않은 것만. 멤버십 명령이 "마지막 owner" 를 세는 사이를 직렬화한다. */
async function lockTeamspace(
  tx: Tx,
  ctx: SessionContext,
  teamspaceId: string,
): Promise<{ id: string; who_can_invite: string; visibility: TeamspaceVisibility; is_default: boolean } | null> {
  return tx.queryMaybe<{ id: string; who_can_invite: string; visibility: TeamspaceVisibility; is_default: boolean }>(
    `SELECT id, who_can_invite, visibility, is_default FROM teamspace
      WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
      FOR UPDATE`,
    [teamspaceId, ctx.workspaceId],
  )
}

/**
 * open 의 열람 부여를 teamspace 노드에 맞춘다(7c-9) — open 이면 `('workspace_everyone') → 'view'` 행, 아니면 없다.
 *
 * 왜 view 인가: F-06-04 가 open 의 축을 "열람"으로 적었다. 고치고 싶으면 참여가 한 번 누르기다(멤버가 되면
 * `MEMBER_DEFAULT_LEVEL`). 레벨을 고르게 하는 설정(멤버 기본 레벨 · §7)이 생기면 이 값도 그 옆으로 간다.
 */
async function syncOpenGrant(tx: Tx, ctx: SessionContext, teamspaceId: string, open: boolean): Promise<void> {
  if (open) {
    await tx.query(
      `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
       VALUES ($1, 'teamspace', $2, 'workspace_everyone', NULL, 'view', $3)
       ON CONFLICT (node_kind, node_id, principal_type, principal_id)
       DO UPDATE SET level = EXCLUDED.level WHERE acl_entry.level <> EXCLUDED.level`,
      [randomUUID(), teamspaceId, ctx.userId],
    )
  } else {
    await tx.query(
      `DELETE FROM acl_entry
        WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'workspace_everyone'`,
      [teamspaceId],
    )
  }
}

/** owner 의 부여를 teamspace 노드에 맞춘다 — 역할이 owner 면 full_access 행, 아니면 없다. */
async function syncOwnerGrant(
  tx: Tx,
  ctx: SessionContext,
  teamspaceId: string,
  principal: TeamspacePrincipal,
  owner: boolean,
): Promise<void> {
  if (owner) {
    await tx.query(
      `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
       VALUES ($1, 'teamspace', $2, $3, $4, 'full_access', $5)
       ON CONFLICT (node_kind, node_id, principal_type, principal_id)
       DO UPDATE SET level = EXCLUDED.level WHERE acl_entry.level <> EXCLUDED.level`,
      [randomUUID(), teamspaceId, principal.type, principal.id, ctx.userId],
    )
  } else {
    await tx.query(
      `DELETE FROM acl_entry
        WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = $2 AND principal_id = $3`,
      [teamspaceId, principal.type, principal.id],
    )
  }
}

/** 넣을 수 있는 주체인가 — 사람은 이 워크스페이스의 활성 · 게스트 아닌 멤버, 그룹은 살아 있는 이 워크스페이스의 그룹. */
async function isAdmissible(tx: Tx, ctx: SessionContext, principal: TeamspacePrincipal): Promise<boolean> {
  if (principal.type === 'user') {
    const member = await tx.queryMaybe<{ role: string; status: string }>(
      `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [ctx.workspaceId, principal.id],
    )
    return member !== null && member.status === 'active' && member.role !== 'guest'
  }
  const group = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM "group" WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR SHARE`,
    [principal.id, ctx.workspaceId],
  )
  return group !== null
}

/** 이 주체를 빼거나 내리면 owner 가 하나도 안 남는가. */
async function wouldLoseLastOwner(tx: Tx, teamspaceId: string, principal: TeamspacePrincipal): Promise<boolean> {
  const others = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM teamspace_member
      WHERE teamspace_id = $1 AND role = 'owner' AND removed_at IS NULL
        AND NOT (principal_type = $2 AND principal_id = $3)`,
    [teamspaceId, principal.type, principal.id],
  )
  return others.n === 0
}

/**
 * 멤버 전원이 받는 레벨 — `('teamspace', T)` 행. 만들기가 세우고 지우는 길이 없으므로(`dropGroupFromTeamspaces` 등은 다른 주체의
 * 행만 지운다) 없으면 불변식이 깨진 것이다 — 조용히 기본값으로 보이면 화면이 거짓을 말하므로 던진다.
 */
async function memberLevelOf(tx: Tx, teamspaceId: string): Promise<TeamspaceMemberLevel> {
  const row = await tx.queryMaybe<{ level: TeamspaceMemberLevel }>(
    `SELECT level FROM acl_entry
      WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'teamspace' AND principal_id = $1`,
    [teamspaceId],
  )
  if (row === null) throw new Error(`teamspace ${teamspaceId} 에 멤버 전원의 행이 없다`)
  return row.level
}

// ── 만들기 · 조회 ─────────────────────────────────────────────────────

export async function createTeamspace(
  ctx: SessionContext,
  input: { readonly name: unknown; readonly visibility?: unknown; readonly icon?: unknown },
): Promise<TeamspaceResult<TeamspaceSummary>> {
  if (!canCreateTeamspace(ctx.role)) return fail('forbidden')
  const name = normalizeTeamspaceName(input.name)
  if (name === null) return fail('invalid_name')
  const icon = input.icon === undefined ? null : normalizeTeamspaceIcon(input.icon)
  if (icon === undefined) return fail('invalid_icon')
  // 둘러보기 · 참여가 아직 없어 보이는 범위는 저장만 한다(§7). 기본은 closed — 존재는 보이되 초대로만 들어온다.
  const visibility = input.visibility === undefined ? 'closed' : input.visibility
  if (!isVisibility(visibility)) return fail('invalid_visibility')

  return withCommandTransaction(async (tx) => {
    const id = randomUUID()
    await tx.query(`INSERT INTO teamspace (id, workspace_id, name, visibility, icon) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      ctx.workspaceId,
      name,
      visibility,
      icon,
    ])
    await tx.query(
      `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role) VALUES ($1, 'user', $2, 'owner')`,
      [id, ctx.userId],
    )
    await tx.query(
      `INSERT INTO acl_entry (id, node_kind, node_id, principal_type, principal_id, level, granted_by)
       VALUES ($1, 'teamspace', $2, 'teamspace', $2, $3, $4)`,
      [randomUUID(), id, MEMBER_DEFAULT_LEVEL, ctx.userId],
    )
    await syncOwnerGrant(tx, ctx, id, { type: 'user', id: ctx.userId }, true)
    await syncOpenGrant(tx, ctx, id, visibility === 'open')
    return { ok: true, value: { id, name, icon, visibility, role: 'owner' as const, canCreatePages: true } } as const
  })
}

/** 내가 멤버인 teamspace(보관되지 않은 것) — 이름순. 게스트는 빈 목록이다. */
export async function listMyTeamspaces(ctx: SessionContext): Promise<TeamspaceSummary[]> {
  if (ctx.role === 'guest') return []
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{ id: string; name: string; icon: string | null; visibility: TeamspaceVisibility; is_owner: boolean }>(
      `SELECT t.id, t.name, t.icon, t.visibility, bool_or(tm.role = 'owner') AS is_owner
         FROM teamspace t
         JOIN teamspace_member tm ON tm.teamspace_id = t.id AND tm.removed_at IS NULL
        WHERE t.workspace_id = $2 AND t.archived_at IS NULL
          AND ((tm.principal_type = 'user' AND tm.principal_id = $1)
            OR (tm.principal_type = 'group' AND tm.principal_id IN (
                  SELECT g.id FROM group_member gm JOIN "group" g ON g.id = gm.group_id
                   WHERE gm.user_id = $1 AND gm.removed_at IS NULL AND g.deleted_at IS NULL AND g.workspace_id = $2)))
        GROUP BY t.id
        ORDER BY lower(t.name), t.id`,
      [ctx.userId, ctx.workspaceId],
    )
    // 만들 수 있는가는 만들기 명령과 **같은 판정**으로 묻는다(`teamspaceCaps`) — 역할이나 레벨을 여기서 다시 해석하지 않는다.
    const out: TeamspaceSummary[] = []
    for (const r of rows) {
      out.push({
        id: r.id,
        name: r.name,
        icon: r.icon,
        visibility: r.visibility,
        role: r.is_owner ? ('owner' as const) : ('member' as const),
        canCreatePages: can(await teamspaceCaps(tx, ctx, r.id), 'create_child'),
      })
    }
    return out
  })
}

/**
 * 둘러보기 — 내가 볼 수 있는 이 워크스페이스의 teamspace 전부(이름순). 멤버인 것도 함께 온다(줄마다 `role`) — 목록에서
 * 빠지면 "내 teamspace 는 어디 갔나"가 된다.
 *
 * 보이는 것은 **open · closed, 그리고 내가 멤버인 것**이다. private 는 멤버가 아니면 목록에 없다 — 존재를 숨기는 것이
 * private 의 뜻이다(머리말). 둘러볼 수 없는 역할(`restricted_member` · 게스트)에게는 빈 목록이다.
 */
export async function listBrowsableTeamspaces(ctx: SessionContext): Promise<BrowsableTeamspace[]> {
  if (!canBrowseTeamspaces(ctx.role)) return []
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{
      id: string
      name: string
      icon: string | null
      visibility: TeamspaceVisibility
      is_default: boolean
      member_count: number
      role: TeamspaceRole | null
    }>(
      `WITH mine AS (
           SELECT tm.teamspace_id, bool_or(tm.role = 'owner') AS is_owner
             FROM teamspace_member tm
             JOIN teamspace t ON t.id = tm.teamspace_id AND t.workspace_id = $2
            WHERE tm.removed_at IS NULL
              AND ((tm.principal_type = 'user' AND tm.principal_id = $1)
                OR (tm.principal_type = 'group' AND tm.principal_id IN (
                      SELECT g.id FROM group_member gm JOIN "group" g ON g.id = gm.group_id
                       WHERE gm.user_id = $1 AND gm.removed_at IS NULL AND g.deleted_at IS NULL AND g.workspace_id = $2)))
            GROUP BY tm.teamspace_id
         ),
         -- 사람 수 — 사람으로 들어온 멤버와 그룹을 거쳐 들어온 사람을 합쳐 distinct. 워크스페이스를 떠난 사람은 빼고
         -- 센다(listTeamspaceMembers 가 목록에서 빼는 것과 같은 규칙).
         people AS (
           SELECT teamspace_id, count(DISTINCT user_id)::int AS n FROM (
             SELECT tm.teamspace_id, tm.principal_id AS user_id
               FROM teamspace_member tm
               JOIN teamspace t ON t.id = tm.teamspace_id AND t.workspace_id = $2
               JOIN workspace_member m ON m.workspace_id = $2 AND m.user_id = tm.principal_id AND m.status = 'active'
              WHERE tm.removed_at IS NULL AND tm.principal_type = 'user'
             UNION
             SELECT tm.teamspace_id, gm.user_id
               FROM teamspace_member tm
               JOIN teamspace t ON t.id = tm.teamspace_id AND t.workspace_id = $2
               JOIN "group" g ON g.id = tm.principal_id AND g.deleted_at IS NULL
               JOIN group_member gm ON gm.group_id = g.id AND gm.removed_at IS NULL
               JOIN workspace_member m ON m.workspace_id = $2 AND m.user_id = gm.user_id AND m.status = 'active'
              WHERE tm.removed_at IS NULL AND tm.principal_type = 'group'
           ) s GROUP BY teamspace_id
         )
       SELECT t.id, t.name, t.icon, t.visibility, t.is_default,
              coalesce(p.n, 0) AS member_count,
              CASE WHEN mine.teamspace_id IS NULL THEN NULL
                   WHEN mine.is_owner THEN 'owner' ELSE 'member' END AS role
         FROM teamspace t
         LEFT JOIN mine ON mine.teamspace_id = t.id
         LEFT JOIN people p ON p.teamspace_id = t.id
        WHERE t.workspace_id = $2 AND t.archived_at IS NULL
          AND (t.visibility <> 'private' OR mine.teamspace_id IS NOT NULL)
        ORDER BY lower(t.name), t.id`,
      [ctx.userId, ctx.workspaceId],
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      visibility: r.visibility,
      isDefault: r.is_default,
      memberCount: r.member_count,
      role: r.role,
    }))
  })
}

/**
 * teamspace 하나 — 멤버만 본다(아니면 not_found — 없는 teamspace 와 같은 답이다). 내 역할은 `roleIn` 이 사람 행과 그룹을
 * 거친 행을 함께 보고 정한다(`listMyTeamspaces` 와 같은 규칙).
 */
export async function getTeamspace(ctx: SessionContext, teamspaceId: string): Promise<TeamspaceResult<TeamspaceDetail>> {
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{
      id: string
      name: string
      icon: string | null
      visibility: TeamspaceVisibility
      who_can_invite: TeamspaceWhoCanInvite
      is_default: boolean
    }>(
      `SELECT id, name, icon, visibility, who_can_invite, is_default FROM teamspace
        WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
      [teamspaceId, ctx.workspaceId],
    )
    if (row === null) return fail('not_found')
    const role = await roleIn(tx, ctx, teamspaceId)
    if (role === null) return fail('not_found')
    return {
      ok: true,
      value: {
        id: row.id,
        name: row.name,
        icon: row.icon,
        visibility: row.visibility,
        role,
        canCreatePages: can(await teamspaceCaps(tx, ctx, teamspaceId), 'create_child'),
        whoCanInvite: row.who_can_invite,
        isDefault: row.is_default,
        memberLevel: await memberLevelOf(tx, teamspaceId),
      },
    } as const
  })
}

/** teamspace 의 멤버 — 멤버만 본다(아니면 not_found). 워크스페이스를 떠난 사람 · 지운 그룹은 빠진다. */
export async function listTeamspaceMembers(
  ctx: SessionContext,
  teamspaceId: string,
): Promise<TeamspaceResult<TeamspaceMemberRow[]>> {
  return withReadTransaction(async (tx) => {
    const exists = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM teamspace WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
      [teamspaceId, ctx.workspaceId],
    )
    if (exists === null || (await roleIn(tx, ctx, teamspaceId)) === null) return fail('not_found')
    const rows = await tx.query<{
      principal_type: 'user' | 'group'
      principal_id: string
      role: TeamspaceRole
      name: string
      email: string | null
    }>(
      `SELECT tm.principal_type, tm.principal_id, tm.role, u.name, ue.email::text AS email
         FROM teamspace_member tm
         JOIN "user" u ON u.id = tm.principal_id
         JOIN workspace_member m ON m.workspace_id = $2 AND m.user_id = u.id AND m.status = 'active'
         LEFT JOIN user_email ue ON ue.id = u.primary_email_id
        WHERE tm.teamspace_id = $1 AND tm.removed_at IS NULL AND tm.principal_type = 'user'
       UNION ALL
       SELECT tm.principal_type, tm.principal_id, tm.role, g.name, NULL
         FROM teamspace_member tm
         JOIN "group" g ON g.id = tm.principal_id AND g.deleted_at IS NULL
        WHERE tm.teamspace_id = $1 AND tm.removed_at IS NULL AND tm.principal_type = 'group'
        ORDER BY 3 DESC, 4`,
      [teamspaceId, ctx.workspaceId],
    )
    return {
      ok: true,
      value: rows.map((r) => ({
        principal: { type: r.principal_type, id: r.principal_id },
        role: r.role,
        name: r.name,
        email: r.email,
      })),
    } as const
  })
}

// ── 설정 ──────────────────────────────────────────────────────────────

/**
 * 설정을 고친다 — 이름 · 아이콘 · 공개 범위 · 초대 규칙 · 멤버 기본 레벨. **owner 만**(멤버는 `forbidden` · 멤버가 아니면 `not_found`).
 *
 * 주지 않은 칸은 건드리지 않는다. 알아볼 수 있는 칸이 하나도 없으면 `invalid_settings` 다 — 오타 난 요청이 "고쳤다"로
 * 보이면 안 된다. 이름의 중복은 막지 않는다(정본에 UNIQUE 가 없다 · §7).
 *
 * 공개 범위를 좁혀도(open → closed · private) **이미 들어온 멤버는 그대로다** — F-06-04 의 권고다. 좁히는 것이 막는 것은
 * 앞으로의 참여뿐이다. 공개 범위는 판정에 들어가지 않으므로 이 명령은 권한 신호를 보내지 않는다(머리말).
 *
 * 멤버 기본 레벨(7c-12)은 `('teamspace', T)` 행의 level 을 바꾼다 — **권한 변화다.** 0016 의 노드 신호가 협업 서버에 알린다.
 * 같은 값이면 쓰지 않는다(폼이 저장마다 모든 칸을 보내므로, 쓰면 이름만 고쳐도 신호가 간다). 넷 밖의 값은 `invalid_level`.
 */
export async function updateTeamspace(
  ctx: SessionContext,
  teamspaceId: string,
  input: {
    readonly name?: unknown
    readonly visibility?: unknown
    readonly whoCanInvite?: unknown
    readonly memberLevel?: unknown
    readonly icon?: unknown
  },
): Promise<TeamspaceResult> {
  const set: string[] = []
  const values: unknown[] = []
  const column = (sql: string, value: unknown): void => {
    values.push(value)
    set.push(`${sql} = $${values.length + 2}`)
  }
  if (input.name !== undefined) {
    const name = normalizeTeamspaceName(input.name)
    if (name === null) return fail('invalid_name')
    column('name', name)
  }
  if (input.visibility !== undefined) {
    if (!isVisibility(input.visibility)) return fail('invalid_visibility')
    column('visibility', input.visibility)
  }
  if (input.whoCanInvite !== undefined) {
    if (input.whoCanInvite !== 'owners' && input.whoCanInvite !== 'all_members') return fail('invalid_settings')
    column('who_can_invite', input.whoCanInvite)
  }
  if (input.icon !== undefined) {
    // null · 빈 글은 아이콘을 지운다(7c-14).
    const icon = normalizeTeamspaceIcon(input.icon)
    if (icon === undefined) return fail('invalid_icon')
    column('icon', icon)
  }
  if (input.memberLevel !== undefined && !isMemberLevel(input.memberLevel)) return fail('invalid_level')
  const memberLevel = input.memberLevel
  if (set.length === 0 && memberLevel === undefined) return fail('invalid_settings')

  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner') return fail('forbidden')

    if (set.length > 0) {
      await tx.query(`UPDATE teamspace SET ${set.join(', ')} WHERE id = $1 AND workspace_id = $2`, [
        teamspaceId,
        ctx.workspaceId,
        ...values,
      ])
    }
    if (memberLevel !== undefined) {
      await tx.query(
        `UPDATE acl_entry SET level = $2
          WHERE node_kind = 'teamspace' AND node_id = $1 AND principal_type = 'teamspace' AND principal_id = $1
            AND level <> $2`,
        [teamspaceId, memberLevel],
      )
    }
    // open ↔ closed·private 전환은 열람 행을 나른다(7c-9 · 머리말). 좁힐 때 이미 들어온 **멤버**는 그대로지만(§3.2-45 의
    // 규칙 그대로 — 멤버십은 행과 무관하다), 참여하지 않고 읽던 사람은 잃는다 — 그것이 좁힘의 뜻이다.
    if (input.visibility !== undefined && input.visibility !== teamspace.visibility) {
      await syncOpenGrant(tx, ctx, teamspaceId, input.visibility === 'open')
    }
    return { ok: true } as const
  })
}

/**
 * 보관한다 — **owner 만**. 지우기가 없는 대신이다(F-06-04).
 *
 * 행을 건드리지 않는다 — `archived_at` 하나로 아무도 못 보게 된다(머리말). 0028 의 트리거가 이 갱신을 보고 협업 서버에
 * 알리므로 열어 둔 편집기는 서버가 먼저 닫는다.
 *
 * 이미 보관된 것은 `not_found` 다 — `lockTeamspace` 가 살아 있는 것만 잠근다(다른 명령과 같은 답).
 *
 * 기본 teamspace 는 `default_teamspace` 다(7c-11) — 먼저 끈다. DB 의 CHECK(0030)도 막지만 그 전에 까닭을 말해 준다.
 */
export async function archiveTeamspace(ctx: SessionContext, teamspaceId: string): Promise<TeamspaceResult> {
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner') return fail('forbidden')
    if (teamspace.is_default) return fail('default_teamspace')

    await tx.query(`UPDATE teamspace SET archived_at = now() WHERE id = $1 AND workspace_id = $2`, [
      teamspaceId,
      ctx.workspaceId,
    ])
    return { ok: true } as const
  })
}

/**
 * 되살린다 — 보관된 것을 **그 teamspace 의 owner** 가. 살아 있는 것을 되살리려 하면 `not_found` 다(보관된 것들 중에
 * 없다).
 *
 * `roleIn` 은 `teamspace_member` 만 읽으므로 보관된 teamspace 에서도 역할을 말해 준다 — 보관이 행을 건드리지 않는
 * 까닭이다. 그래서 여기서만 보관된 행을 일부러 잠근다(`lockTeamspace` 는 살아 있는 것만 잠근다).
 */
export async function restoreTeamspace(ctx: SessionContext, teamspaceId: string): Promise<TeamspaceResult> {
  return withCommandTransaction(async (tx) => {
    const archived = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM teamspace
        WHERE id = $1 AND workspace_id = $2 AND archived_at IS NOT NULL
        FOR UPDATE`,
      [teamspaceId, ctx.workspaceId],
    )
    if (archived === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner') return fail('forbidden')

    await tx.query(`UPDATE teamspace SET archived_at = NULL WHERE id = $1 AND workspace_id = $2`, [
      teamspaceId,
      ctx.workspaceId,
    ])
    return { ok: true } as const
  })
}

/**
 * 보관된 teamspace — **내가 owner 인 것만**(되살릴 수 있는 사람만 그 존재를 본다). 이름순이 아니라 **보관한 순서의
 * 역순**이다 — 방금 보관한 것을 되살리는 일이 흔하다.
 *
 * 다른 목록 함수(`listMyTeamspaces` · `listBrowsableTeamspaces` · `roleIn`)가 보관된 것을 빼는 것과 **일부러** 반대다.
 */
export async function listArchivedTeamspaces(ctx: SessionContext): Promise<ArchivedTeamspace[]> {
  if (ctx.role === 'guest') return []
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{
      id: string
      name: string
      icon: string | null
      visibility: TeamspaceVisibility
      archived_at: string
    }>(
      `SELECT DISTINCT t.id, t.name, t.icon, t.visibility, t.archived_at
         FROM teamspace t
         JOIN teamspace_member tm ON tm.teamspace_id = t.id AND tm.removed_at IS NULL AND tm.role = 'owner'
        WHERE t.workspace_id = $2 AND t.archived_at IS NOT NULL
          AND ((tm.principal_type = 'user' AND tm.principal_id = $1)
            OR (tm.principal_type = 'group' AND tm.principal_id IN (
                  SELECT g.id FROM group_member gm JOIN "group" g ON g.id = gm.group_id
                   WHERE gm.user_id = $1 AND gm.removed_at IS NULL AND g.deleted_at IS NULL AND g.workspace_id = $2)))
        ORDER BY t.archived_at DESC, t.id`,
      [ctx.userId, ctx.workspaceId],
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      visibility: r.visibility,
      archivedAt: new Date(r.archived_at).toISOString(),
    }))
  })
}

// ── 멤버십 ────────────────────────────────────────────────────────────

/**
 * 멤버를 넣는다(빠졌던 주체면 그 행이 살아난다 — M1). 이미 있는 멤버면 역할을 건드리지 않는다 — 역할은
 * `setTeamspaceMemberRole` 이 바꾼다.
 */
export async function addTeamspaceMember(
  ctx: SessionContext,
  teamspaceId: string,
  principal: TeamspacePrincipal,
  role: unknown = 'member',
): Promise<TeamspaceResult> {
  if (!isRole(role)) return fail('invalid_role')
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner' && (teamspace.who_can_invite === 'owners' || role === 'owner')) return fail('forbidden')
    if (!(await isAdmissible(tx, ctx, principal))) return fail('invalid_member')

    const inserted = await tx.queryMaybe<{ role: TeamspaceRole }>(
      `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (teamspace_id, principal_type, principal_id)
       DO UPDATE SET removed_at = NULL, role = EXCLUDED.role
        WHERE teamspace_member.removed_at IS NOT NULL
       RETURNING role`,
      [teamspaceId, principal.type, principal.id, role],
    )
    // 이미 살아 있는 멤버면 아무것도 바뀌지 않았다(RETURNING 이 비었다).
    if (inserted !== null) await syncOwnerGrant(tx, ctx, teamspaceId, principal, inserted.role === 'owner')
    return { ok: true } as const
  })
}

export async function setTeamspaceMemberRole(
  ctx: SessionContext,
  teamspaceId: string,
  principal: TeamspacePrincipal,
  role: unknown,
): Promise<TeamspaceResult> {
  if (!isRole(role)) return fail('invalid_role')
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner') return fail('forbidden')

    const current = await tx.queryMaybe<{ role: TeamspaceRole }>(
      `SELECT role FROM teamspace_member
        WHERE teamspace_id = $1 AND principal_type = $2 AND principal_id = $3 AND removed_at IS NULL`,
      [teamspaceId, principal.type, principal.id],
    )
    if (current === null) return fail('invalid_member')
    if (current.role === role) return { ok: true } as const
    if (current.role === 'owner' && (await wouldLoseLastOwner(tx, teamspaceId, principal))) return fail('last_owner')

    await tx.query(
      `UPDATE teamspace_member SET role = $4 WHERE teamspace_id = $1 AND principal_type = $2 AND principal_id = $3`,
      [teamspaceId, principal.type, principal.id, role],
    )
    await syncOwnerGrant(tx, ctx, teamspaceId, principal, role === 'owner')
    return { ok: true } as const
  })
}

/** 빼기 — owner 는 누구든, 멤버는 자기 자신만(나가기). 행은 남긴다(`removed_at` — M1). 멤버가 아니면 아무것도 바꾸지 않는다. */
export async function removeTeamspaceMember(
  ctx: SessionContext,
  teamspaceId: string,
  principal: TeamspacePrincipal,
): Promise<TeamspaceResult> {
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    const self = principal.type === 'user' && principal.id === ctx.userId
    if (mine !== 'owner' && !self) return fail('forbidden')

    const current = await tx.queryMaybe<{ role: TeamspaceRole }>(
      `SELECT role FROM teamspace_member
        WHERE teamspace_id = $1 AND principal_type = $2 AND principal_id = $3 AND removed_at IS NULL`,
      [teamspaceId, principal.type, principal.id],
    )
    if (current === null) return { ok: true } as const
    if (current.role === 'owner' && (await wouldLoseLastOwner(tx, teamspaceId, principal))) return fail('last_owner')

    await tx.query(
      `UPDATE teamspace_member SET removed_at = now()
        WHERE teamspace_id = $1 AND principal_type = $2 AND principal_id = $3`,
      [teamspaceId, principal.type, principal.id],
    )
    await syncOwnerGrant(tx, ctx, teamspaceId, principal, false)
    return { ok: true } as const
  })
}

/**
 * 스스로 참여한다 — **open 만**. 초대(`addTeamspaceMember`)와 갈라 둔 까닭은 묻는 것이 다르기 때문이다: 초대는 "넣는
 * 사람이 그럴 역할인가", 참여는 "이 teamspace 가 나를 받는가"다. 역할은 늘 `member` 다(참여로 owner 가 되지 않는다).
 *
 *   · 둘러볼 수 없는 역할(`restricted_member` · 게스트) → `not_found`(목록에도 없으니 답이 같아야 한다)
 *   · private → `not_found` — 존재를 숨긴다
 *   · closed → `needs_invite` — 존재는 이미 둘러보기에 보이므로 까닭을 말해 준다
 *   · 이미 멤버 → 아무것도 바꾸지 않고 성공(두 번 눌렸을 뿐이다)
 */
export async function joinTeamspace(ctx: SessionContext, teamspaceId: string): Promise<TeamspaceResult> {
  if (!canBrowseTeamspaces(ctx.role)) return fail('not_found')
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    if ((await roleIn(tx, ctx, teamspaceId)) !== null) return { ok: true } as const
    if (teamspace.visibility === 'private') return fail('not_found')
    if (teamspace.visibility !== 'open') return fail('needs_invite')

    await tx.query(
      `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, 'member')
       ON CONFLICT (teamspace_id, principal_type, principal_id)
       DO UPDATE SET removed_at = NULL, role = 'member'
        WHERE teamspace_member.removed_at IS NOT NULL`,
      [teamspaceId, ctx.userId],
    )
    return { ok: true } as const
  })
}

// ── 워크스페이스 owner 의 관리 경로 (7c-10) ─────────────────────────

/**
 * 워크스페이스 owner 인가 — 관리 경로를 여는 유일한 역할이다(역할 **이름**으로 묻는다 · CLAUDE.md).
 *
 * membership_admin 을 넣지 않은 까닭: 이 경로는 비공개 teamspace 의 존재를 보여 주고 그 안으로 들어가게 한다 — 가장 넓은
 * 문을 가장 좁은 역할에 둔다. 넓힐 까닭이 생기면 여기 하나를 고친다.
 */
export function canAdministerTeamspaces(role: WorkspaceRole): boolean {
  return role === 'owner'
}

/**
 * 이 워크스페이스의 **모든** teamspace — 비공개 · 보관된 것까지(7c-10). 워크스페이스 owner 에게만(다른 역할은 빈 목록).
 *
 * F-06-04: *"클론은 '마지막 owner 이탈 차단' 또는 'workspace owner 의 강제 owner 지정' 중 하나를 필수 구현"*. 7c-1 이
 * 앞의 것을 했지만 owner 가 워크스페이스를 떠나거나 게스트가 되는 길(아직 명령은 없다)로는 막을 수 없다. 이 목록이 그
 * 고아(`ownerCount === 0`)를 보여 주고, `claimTeamspaceOwnership` 이 되살린다.
 *
 * **콘텐츠는 주지 않는다** — 이름 · 공개 범위 · 보관 여부 · owner 수뿐이다. 워크스페이스 owner 의 역할 자체는 무엇을 볼 수
 * 있는지 바꾸지 않는다(F-06-02 *"Admin roles don't change what someone can see"*). 보려면 들어가야 한다(아래).
 */
export async function listAllTeamspaces(ctx: SessionContext): Promise<AdminTeamspaceRow[]> {
  if (!canAdministerTeamspaces(ctx.role)) return []
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{
      id: string
      name: string
      icon: string | null
      visibility: TeamspaceVisibility
      is_default: boolean
      archived_at: Date | null
      owner_count: number
    }>(
      `SELECT t.id, t.name, t.icon, t.visibility, t.is_default, t.archived_at,
              (SELECT count(*)::int FROM teamspace_member o
                WHERE o.teamspace_id = t.id AND o.role = 'owner' AND o.removed_at IS NULL
                  AND ((o.principal_type = 'user' AND EXISTS (
                          SELECT 1 FROM workspace_member m
                           WHERE m.workspace_id = $1 AND m.user_id = o.principal_id
                             AND m.status = 'active' AND m.role <> 'guest'))
                    OR (o.principal_type = 'group' AND EXISTS (
                          SELECT 1 FROM "group" g WHERE g.id = o.principal_id AND g.deleted_at IS NULL)))
              ) AS owner_count
         FROM teamspace t
        WHERE t.workspace_id = $1
        ORDER BY (t.archived_at IS NOT NULL), lower(t.name), t.id`,
      [ctx.workspaceId],
    )
    const out: AdminTeamspaceRow[] = []
    for (const r of rows) {
      out.push({
        id: r.id,
        name: r.name,
        icon: r.icon,
        visibility: r.visibility,
        isDefault: r.is_default,
        archivedAt: r.archived_at === null ? null : new Date(r.archived_at).toISOString(),
        ownerCount: r.owner_count,
        role: await roleIn(tx, ctx, r.id),
      })
    }
    return out
  })
}

/**
 * 워크스페이스 owner 가 스스로 그 teamspace 의 **owner 로 들어간다**(7c-10 · F-06-04 의 "강제 owner 지정").
 *
 * 몰래 여는 문이 아니다 — 멤버 행을 넣으므로 **멤버 목록에 이름이 선다.** 그 teamspace 의 사람들은 누가 들어왔는지 본다.
 * 워크스페이스 owner 의 역할이 볼 수 있는 것을 바꾸지 않는다는 원칙(F-06-02)을 지키는 방법이 이것이다 — 역할이 아니라
 * **드러나는 멤버십**이 접근을 준다.
 *
 * 보관된 teamspace 에도 들어간다 — 그래야 되살릴 수 있다(§3.2-46 ③ 이 예고한 "워크스페이스 owner 도 되살릴 수 있다"가
 * 이 두 걸음이다: 들어가고, 되살린다). 이미 owner 면 아무것도 바꾸지 않는다. member 면 owner 로 올린다.
 */
export async function claimTeamspaceOwnership(ctx: SessionContext, teamspaceId: string): Promise<TeamspaceResult> {
  if (!canAdministerTeamspaces(ctx.role)) return fail('not_found')
  return withCommandTransaction(async (tx) => {
    // 보관된 것도 잠근다 — lockTeamspace 는 살아 있는 것만 잠그므로 여기서만 일부러 넓다(restoreTeamspace 와 같은 결).
    const teamspace = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM teamspace WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [teamspaceId, ctx.workspaceId],
    )
    if (teamspace === null) return fail('not_found')

    const me = { type: 'user' as const, id: ctx.userId }
    await tx.query(
      `INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role)
       VALUES ($1, 'user', $2, 'owner')
       ON CONFLICT (teamspace_id, principal_type, principal_id)
       DO UPDATE SET removed_at = NULL, role = 'owner'
        WHERE teamspace_member.removed_at IS NOT NULL OR teamspace_member.role <> 'owner'`,
      [teamspaceId, ctx.userId],
    )
    await syncOwnerGrant(tx, ctx, teamspaceId, me, true)
    return { ok: true } as const
  })
}

// ── 기본 teamspace (7c-11) ───────────────────────────────────────────

/**
 * 기본 teamspace 를 켜고 끈다 — **워크스페이스 owner 이면서 그 teamspace 의 owner** 만(멤버가 아니면 `not_found`, 둘 중
 * 하나라도 아니면 `forbidden`).
 *
 * 켜면 이 워크스페이스의 활성 owner · membership_admin · member 전원이 `member` 로 들어온다 — **한 문장**의 배치 삽입이다
 * (F-06-04 *"동기 처리 금지 · 배치 삽입"* — 한 사람씩 명령을 부르지 않는다). 이미 살아 있는 행은 그대로(owner 도), 빠졌던
 * 행은 `member` 로 되살린다. 행마다 0028 의 트리거가 세대와 협업 신호를 나른다. 사람 id 순으로 넣는다 — 트리거가 사람 행을
 * 잠그는 순서를 정해 두면 같은 사람들을 건드리는 다른 명령과 교착하지 않는다.
 *
 * 끄면 앞으로의 자동 추가만 멈춘다 — 이미 들어온 멤버는 그대로다. 같은 값이면 아무것도 바꾸지 않는다.
 *
 * `added` 는 이번에 들어온(되살아난) 사람 수다 — 화면이 "N명이 들어왔습니다"로 말한다.
 */
export async function setDefaultTeamspace(
  ctx: SessionContext,
  teamspaceId: string,
  on: unknown,
): Promise<TeamspaceResult<{ readonly added: number }>> {
  if (typeof on !== 'boolean') return fail('invalid_settings')
  return withCommandTransaction(async (tx) => {
    const teamspace = await lockTeamspace(tx, ctx, teamspaceId)
    if (teamspace === null) return fail('not_found')
    const mine = await roleIn(tx, ctx, teamspaceId)
    if (mine === null) return fail('not_found')
    if (mine !== 'owner' || !canAdministerTeamspaces(ctx.role)) return fail('forbidden')
    if (teamspace.is_default === on) return { ok: true, value: { added: 0 } } as const

    await tx.query(`UPDATE teamspace SET is_default = $3 WHERE id = $1 AND workspace_id = $2`, [
      teamspaceId,
      ctx.workspaceId,
      on,
    ])
    if (!on) return { ok: true, value: { added: 0 } } as const

    const added = await tx.queryOne<{ n: number }>(
      `WITH added AS (
         INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role)
         SELECT $1, 'user', m.user_id, 'member'
           FROM workspace_member m
          WHERE m.workspace_id = $2 AND m.status = 'active' AND m.role = ANY($3::text[])
          ORDER BY m.user_id
         ON CONFLICT (teamspace_id, principal_type, principal_id)
         DO UPDATE SET removed_at = NULL, role = 'member'
          WHERE teamspace_member.removed_at IS NOT NULL
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM added`,
      [teamspaceId, ctx.workspaceId, DEFAULT_TEAMSPACE_ROLES],
    )
    return { ok: true, value: { added: added.n } } as const
  })
}

/**
 * 워크스페이스에 들어온 사람을 기본 teamspace 에 넣는다 — 초대 수락(`acceptInvite`)이 멤버 행을 세운 **같은 트랜잭션**에서
 * 부른다(7c-11). 권한을 묻는 함수가 아니다 — 방금 들어온 사람에게는 아직 세션이 없고, 묻는 것은 "이 역할이 저절로
 * 들어가는가"뿐이다(`DEFAULT_TEAMSPACE_ROLES`). 넣은 teamspace 수를 돌려준다.
 *
 * **이 워크스페이스의 teamspace 를 전부 `FOR SHARE` 로 잠그고 그 뒤에 `is_default` 를 읽는다.** 기본을 켜는 명령
 * (`setDefaultTeamspace`)과 엇갈리면 둘 다 상대의 쓰기를 못 봐 이 사람이 빠진다 — 켜는 쪽의 배치 삽입은 아직 커밋되지
 * 않은 이 멤버 행을 못 보고, 이쪽은 아직 커밋되지 않은 `is_default` 를 못 본다. 잠그면 순서가 선다: 켜는 쪽이 먼저면
 * 이쪽은 그 커밋을 기다려 켜진 값을 읽고, 이쪽이 먼저면 켜는 쪽이 이 커밋을 기다린 뒤의 문장에서 이 사람을 본다.
 * `is_default` 로 거르고 잠그면 안 된다 — 아직 꺼져 있는 행은 기다리지 않고 건너뛴다.
 *
 * 보관된 teamspace 는 기본일 수 없다(CHECK 0030) — 따로 거르지 않는다.
 */
export async function joinDefaultTeamspaces(tx: Tx, workspaceId: string, userId: string, role: string): Promise<number> {
  if (!(DEFAULT_TEAMSPACE_ROLES as readonly string[]).includes(role)) return 0
  const locked = await tx.query<{ id: string; is_default: boolean }>(
    `SELECT id, is_default FROM teamspace WHERE workspace_id = $1 ORDER BY id FOR SHARE`,
    [workspaceId],
  )
  const defaults = locked.filter((t) => t.is_default).map((t) => t.id)
  if (defaults.length === 0) return 0
  const added = await tx.queryOne<{ n: number }>(
    `WITH added AS (
       INSERT INTO teamspace_member (teamspace_id, principal_type, principal_id, role)
       SELECT t, 'user', $2, 'member' FROM unnest($1::uuid[]) AS t
       ON CONFLICT (teamspace_id, principal_type, principal_id)
       DO UPDATE SET removed_at = NULL, role = 'member'
        WHERE teamspace_member.removed_at IS NOT NULL
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM added`,
    [defaults, userId],
  )
  return added.n
}

// ── 그룹이 사라질 때 ──────────────────────────────────────────────────

/**
 * 지워지는 그룹을 모든 teamspace 에서 뺀다 — `deleteGroup` 이 같은 트랜잭션에서 부른다(7c-10).
 *
 * 전에는 그룹 삭제가 블록 노드의 부여만 거뒀다(`dropGrantsOf`). teamspace 멤버 행과 teamspace 노드의 owner 부여는
 * 남았고, **그 그룹이 유일한 owner 면 teamspace 는 고아가 됐다** — 행은 "owner 가 있다"고 세는데 그 그룹은 지워져
 * P(U) 가 무시하므로 아무도 설정을 고치지 못한다. F-06-04 가 필수로 적은 "마지막 owner 이탈 차단"이 이 길로 샜다.
 *
 * 그래서 먼저 묻는다 — 이 그룹이 **마지막 owner** 인 teamspace 가 하나라도 있으면(보관된 것 포함 — 되살릴 사람이
 * 사라진다) 아무것도 바꾸지 않고 그 수를 돌려준다. 없으면 그 그룹의 멤버 행을 빼고(`removed_at` — 트리거가 세대와
 * 협업 신호를 나른다) teamspace 노드의 owner 부여를 거둔다.
 *
 * "다른 owner" 는 **실제로 행동할 수 있는** 주체만 센다 — 이 워크스페이스의 활성 · 게스트 아닌 사람, 또는 지워지지 않은
 * 그룹. 지워진 그룹 · 떠난 사람의 헛 행을 owner 로 세면 같은 고아가 다른 모양으로 남는다.
 */
export async function dropGroupFromTeamspaces(
  tx: Tx,
  ctx: SessionContext,
  groupId: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly teamspaces: number }> {
  const orphaned = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM teamspace_member mine
       JOIN teamspace t ON t.id = mine.teamspace_id AND t.workspace_id = $2
      WHERE mine.principal_type = 'group' AND mine.principal_id = $1
        AND mine.role = 'owner' AND mine.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM teamspace_member other
           WHERE other.teamspace_id = mine.teamspace_id AND other.role = 'owner' AND other.removed_at IS NULL
             AND NOT (other.principal_type = 'group' AND other.principal_id = $1)
             AND (
               (other.principal_type = 'user' AND EXISTS (
                  SELECT 1 FROM workspace_member m
                   WHERE m.workspace_id = $2 AND m.user_id = other.principal_id
                     AND m.status = 'active' AND m.role <> 'guest'))
               OR (other.principal_type = 'group' AND EXISTS (
                  SELECT 1 FROM "group" g WHERE g.id = other.principal_id AND g.deleted_at IS NULL))
             )
        )`,
    [groupId, ctx.workspaceId],
  )
  if (orphaned.n > 0) return { ok: false, teamspaces: orphaned.n }

  await tx.query(
    `UPDATE teamspace_member tm SET removed_at = now()
       FROM teamspace t
      WHERE t.id = tm.teamspace_id AND t.workspace_id = $2
        AND tm.principal_type = 'group' AND tm.principal_id = $1 AND tm.removed_at IS NULL`,
    [groupId, ctx.workspaceId],
  )
  await tx.query(
    `DELETE FROM acl_entry a
      USING teamspace t
      WHERE a.node_kind = 'teamspace' AND a.node_id = t.id AND t.workspace_id = $2
        AND a.principal_type = 'group' AND a.principal_id = $1`,
    [groupId, ctx.workspaceId],
  )
  return { ok: true }
}

// ── 이름 ──────────────────────────────────────────────────────────────

/**
 * teamspace 이름 — 공유 패널이 `('teamspace', T)` 행을 이름으로 그리려고 묻는다. 부른 쪽이 그 행을 볼 수 있어야 한다
 * (공유 목록은 페이지를 볼 수 있는 사람에게만 간다). 이 워크스페이스의 것만 돌려준다 — 보관된 것도(행은 남아 있다).
 */
export async function teamspaceNames(
  ctx: SessionContext,
  ids: readonly string[],
): Promise<{ teamspaceId: string; name: string }[]> {
  if (ids.length === 0) return []
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM teamspace WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.workspaceId, ids],
    )
    return rows.map((r) => ({ teamspaceId: r.id, name: r.name }))
  })
}
