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
 * 멤버의 기본 레벨은 **full_access** 다. 워크스페이스 직속 페이지가 모든 멤버에게 주던 것(`inheritFromWorkspace`)과
 * 같다 — teamspace 는 그 "모두"를 멤버로 좁힌 것이다. 바꾸는 설정은 뒤의 조각이다(§7).
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
 * 역할은 사람으로도, 그룹을 거쳐서도 받는다(`teamspace_member.principal_type`). 둘 중 하나라도 owner 면 owner 다.
 * 게스트는 어느 쪽으로도 멤버가 아니다(`principalsOf` 와 같은 규칙).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import type { Level } from '../permissions/levels.ts'

export const MAX_TEAMSPACE_NAME_LENGTH = 100
export const TEAMSPACE_VISIBILITIES = ['open', 'closed', 'private'] as const
export type TeamspaceVisibility = (typeof TEAMSPACE_VISIBILITIES)[number]
export type TeamspaceRole = 'owner' | 'member'

/** 멤버 전원이 teamspace 의 페이지를 받는 레벨(머리말). */
export const MEMBER_DEFAULT_LEVEL: Level = 'full_access'

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

export function normalizeTeamspaceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_TEAMSPACE_NAME_LENGTH) return null
  return name
}

function isVisibility(raw: unknown): raw is TeamspaceVisibility {
  return typeof raw === 'string' && (TEAMSPACE_VISIBILITIES as readonly string[]).includes(raw)
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
): Promise<{ id: string; who_can_invite: string } | null> {
  return tx.queryMaybe<{ id: string; who_can_invite: string }>(
    `SELECT id, who_can_invite FROM teamspace
      WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
      FOR UPDATE`,
    [teamspaceId, ctx.workspaceId],
  )
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

// ── 만들기 · 조회 ─────────────────────────────────────────────────────

export async function createTeamspace(
  ctx: SessionContext,
  input: { readonly name: unknown; readonly visibility?: unknown },
): Promise<TeamspaceResult<TeamspaceSummary>> {
  if (!canCreateTeamspace(ctx.role)) return fail('forbidden')
  const name = normalizeTeamspaceName(input.name)
  if (name === null) return fail('invalid_name')
  // 둘러보기 · 참여가 아직 없어 보이는 범위는 저장만 한다(§7). 기본은 closed — 존재는 보이되 초대로만 들어온다.
  const visibility = input.visibility === undefined ? 'closed' : input.visibility
  if (!isVisibility(visibility)) return fail('invalid_visibility')

  return withCommandTransaction(async (tx) => {
    const id = randomUUID()
    await tx.query(`INSERT INTO teamspace (id, workspace_id, name, visibility) VALUES ($1, $2, $3, $4)`, [
      id,
      ctx.workspaceId,
      name,
      visibility,
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
    return { ok: true, value: { id, name, icon: null, visibility, role: 'owner' as const } } as const
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
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      visibility: r.visibility,
      role: r.is_owner ? ('owner' as const) : ('member' as const),
    }))
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
