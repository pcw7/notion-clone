/**
 * 그룹 — Teamspace · 게스트 · 그룹 7a조각 (F-06-03)
 *
 * 정본: 00-canonical-data-model.md §3.3 `group` · `group_member` (불변식 G1~G3 · M1), §3.11 P(U)
 *       06-permissions-sharing.md F-06-03
 *
 * 그룹은 사람을 묶은 **권한의 주체**다. 페이지 공유에서 사람 대신 그룹에 레벨을 주면, 나중에 그룹에 들어온 사람이
 * 곧바로 그 페이지들을 본다(F-06-03 시나리오 4). 판정은 `permissions/effective.ts` 가 한다 — P(U) 에 그룹이 들어가고
 * 판정할 때마다 그 트랜잭션에서 읽는다. 이 파일은 그룹과 멤버를 고치는 명령만 갖는다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 누가 고치고 누가 보는가
 * ──────────────────────────────────────────────────────────────────────
 *
 * 고치기는 **owner 와 membership_admin 만**이다(F-06-03 원문 *"Workspace owners and membership admins can create and
 * edit groups"*). 워크스페이스 역할이 그 둘 중 하나인지를 묻는 것이지 레벨을 비교하는 것이 아니다(CLAUDE.md 권한
 * 코드 규칙). 보기는 게스트가 아닌 멤버 전원이다 — 공유 패널에서 그룹을 고르려면 이름을 알아야 한다. 게스트는
 * 워크스페이스의 사람 목록을 보지 않는다(F-06-09).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 멤버
 * ──────────────────────────────────────────────────────────────────────
 *
 *   - 게스트는 들어갈 수 없다(G2) — 여기서 거절하고, DB 트리거(0027)가 한 번 더 막고, 판정(`principalsOf`)은 게스트의
 *     그룹 행을 아예 보지 않는다
 *   - restricted_member 는 들어갈 수 있다(G3 — 그들의 유일한 대량 부여 수단이다)
 *   - 중첩 그룹은 없다(G1 — `group_member` 는 사용자만 담는다)
 *   - 빼기는 행을 지우지 않는다 — `removed_at`(M1 의 30일 복원 창). 다시 넣으면 그 행이 살아난다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 지우기는 그룹의 부여까지 지운다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 그룹 행은 `deleted_at` 으로 남기지만 **그 그룹이 받은 ACL 행은 지운다**(F-06-03 *"그룹 삭제 → 해당 group principal 의
 * ACL 전부 캐스케이드 삭제, 개인 직접 부여는 유지"*). 행을 남겨 두면 공유 패널 · 상속 복사(`stopInheriting`) · 관리자
 * 세기(`wouldOrphan`)가 전부 "죽은 그룹"을 걸러야 하고, 지운 그룹을 되살리는 길은 없다. 지우면 관리할 사람이 남지
 * 않는 페이지가 생기면 거부한다(`would_orphan` — `revokeAccess` 와 같은 규칙).
 */

import { randomUUID } from 'node:crypto'

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { dropGrantsOf } from '../permissions/acl.ts'

export const MAX_GROUP_NAME_LENGTH = 100

export type UserGroupFailure =
  /** 없는 그룹 · 지운 그룹 · 다른 워크스페이스의 그룹 — 셋을 구분해 주지 않는다. */
  | 'not_found'
  /** 그룹을 고칠 역할이 아니다(owner · membership_admin 만) · 게스트는 그룹을 보지도 않는다. */
  | 'forbidden'
  | 'invalid_name'
  /** 이 워크스페이스의 살아 있는 그룹 중 같은 이름(대소문자 무시)이 있다. */
  | 'duplicate_name'
  /** 게스트이거나(G2) 이 워크스페이스의 활성 멤버가 아니다. */
  | 'invalid_member'
  /** 지우면 관리할 사람이 아무도 남지 않는 페이지가 생긴다. `nodes` 가 그 수다. */
  | 'would_orphan'

export type UserGroupResult<T = void> =
  | ({ readonly ok: true } & (T extends void ? object : { readonly value: T }))
  | { readonly ok: false; readonly reason: UserGroupFailure; readonly nodes?: number }

export type UserGroupSummary = {
  readonly id: string
  readonly name: string
  readonly memberCount: number
}

export type UserGroupMember = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly role: WorkspaceRole
}

const fail = (reason: UserGroupFailure, nodes?: number) =>
  nodes === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, nodes } as const)

/**
 * 그룹을 만들고 고칠 수 있는 역할인가 — 화면이 버튼을 그릴지 정할 때도 이것을 부른다.
 *
 * 역할 **이름**을 묻는다. 역할에 순서를 매겨 비교하지 않는다(CLAUDE.md).
 */
export function canManageGroups(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'membership_admin'
}

/** 그룹 목록 · 이름을 볼 수 있는 역할인가. 게스트는 워크스페이스의 사람 목록을 보지 않는다(F-06-09). */
export function canSeeGroups(role: WorkspaceRole): boolean {
  return role !== 'guest'
}

/** 개행 · 연속 공백을 접고 양끝을 자른다. 비었거나 길면 null. */
export function normalizeGroupName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_GROUP_NAME_LENGTH) return null
  return name
}

/** pg 의 unique_violation — 살아 있는 그룹의 이름이 겹쳤다(`ux_group_workspace_name`). */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === '23505'
}

/**
 * 고칠 그룹을 잠근다 — 이 워크스페이스의 살아 있는 그룹만. 공유 부여(`grantAccess`)가 같은 행을 `FOR SHARE` 로
 * 잡으므로, 지우기와 부여가 겹쳐도 지운 그룹에 부여가 남지 않는다.
 */
async function lockGroup(tx: Tx, ctx: SessionContext, groupId: string): Promise<{ id: string; name: string } | null> {
  return tx.queryMaybe<{ id: string; name: string }>(
    `SELECT id, name FROM "group"
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [groupId, ctx.workspaceId],
  )
}

// ── 조회 ──────────────────────────────────────────────────────────────

/** 살아 있는 그룹과 각 그룹의 멤버 수(`listGroupMembers` 가 돌려줄 수와 같다). 이름순. */
export async function listGroups(ctx: SessionContext): Promise<UserGroupResult<UserGroupSummary[]>> {
  if (!canSeeGroups(ctx.role)) return fail('forbidden')
  return withReadTransaction(async (tx) => {
    const rows = await tx.query<{ id: string; name: string; member_count: number }>(
      `SELECT g.id, g.name,
              (SELECT count(*) FROM group_member gm
                 JOIN workspace_member m ON m.workspace_id = g.workspace_id AND m.user_id = gm.user_id
                WHERE gm.group_id = g.id AND gm.removed_at IS NULL AND m.status = 'active')::int AS member_count
         FROM "group" g
        WHERE g.workspace_id = $1 AND g.deleted_at IS NULL
        ORDER BY lower(g.name), g.id`,
      [ctx.workspaceId],
    )
    return {
      ok: true,
      value: rows.map((r) => ({ id: r.id, name: r.name, memberCount: r.member_count })),
    } as const
  })
}

/**
 * 그룹의 멤버. 멤버 행이 살아 있어도 **워크스페이스를 떠난 사람**(`status <> 'active'`)은 보이지 않는다 — M1 이 행을
 * 남겨 두는 것은 돌아올 때 복원하기 위해서이지, 떠난 사람을 그룹에 있는 것처럼 보이려는 것이 아니다.
 */
export async function listGroupMembers(ctx: SessionContext, groupId: string): Promise<UserGroupResult<UserGroupMember[]>> {
  if (!canSeeGroups(ctx.role)) return fail('forbidden')
  return withReadTransaction(async (tx) => {
    const group = await tx.queryMaybe<{ id: string }>(
      `SELECT id FROM "group" WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [groupId, ctx.workspaceId],
    )
    if (group === null) return fail('not_found')
    const rows = await tx.query<{ user_id: string; name: string; email: string | null; role: WorkspaceRole }>(
      `SELECT u.id AS user_id, u.name, ue.email::text AS email, m.role
         FROM group_member gm
         JOIN "user" u ON u.id = gm.user_id
         JOIN workspace_member m ON m.workspace_id = $2 AND m.user_id = gm.user_id
         LEFT JOIN user_email ue ON ue.id = u.primary_email_id
        WHERE gm.group_id = $1 AND gm.removed_at IS NULL AND m.status = 'active'
        ORDER BY u.name, u.id`,
      [groupId, ctx.workspaceId],
    )
    return {
      ok: true,
      value: rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role })),
    } as const
  })
}

// ── 그룹 ──────────────────────────────────────────────────────────────

export async function createGroup(
  ctx: SessionContext,
  rawName: unknown,
): Promise<UserGroupResult<{ id: string; name: string }>> {
  if (!canManageGroups(ctx.role)) return fail('forbidden')
  const name = normalizeGroupName(rawName)
  if (name === null) return fail('invalid_name')

  return withCommandTransaction(async (tx) => {
    // 부분 UNIQUE(0027)를 충돌 대상으로 쓴다 — 확인하고 넣는 사이에 같은 이름이 끼어들어도 던지지 않고 비어 돌아온다.
    const row = await tx.queryMaybe<{ id: string }>(
      `INSERT INTO "group" (id, workspace_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, lower(name)) WHERE deleted_at IS NULL DO NOTHING
       RETURNING id`,
      [randomUUID(), ctx.workspaceId, name],
    )
    if (row === null) return fail('duplicate_name')
    return { ok: true, value: { id: row.id, name } } as const
  })
}

export async function renameGroup(ctx: SessionContext, groupId: string, rawName: unknown): Promise<UserGroupResult> {
  if (!canManageGroups(ctx.role)) return fail('forbidden')
  const name = normalizeGroupName(rawName)
  if (name === null) return fail('invalid_name')

  // 겹치는 이름은 부분 UNIQUE(0027)가 막는다 — UPDATE 에는 `ON CONFLICT` 가 없어 던진 것을 받는다. 미리 SELECT 로
  // 확인하지 않는다: 확인과 쓰기 사이에 끼어든 이름은 어차피 이 길로 온다.
  try {
    return await withCommandTransaction(async (tx) => {
      const group = await lockGroup(tx, ctx, groupId)
      if (group === null) return fail('not_found')
      if (group.name === name) return { ok: true } as const

      await tx.query(`UPDATE "group" SET name = $2 WHERE id = $1`, [groupId, name])
      return { ok: true } as const
    })
  } catch (e) {
    if (isUniqueViolation(e)) return fail('duplicate_name')
    throw e
  }
}

/**
 * 그룹을 지운다 — 행은 `deleted_at` 으로 남기고 **그 그룹의 부여는 지운다**(머리말).
 *
 * @returns 부여를 거둔 페이지 · 데이터베이스의 수. 볼 수 없는 페이지도 센다 — 지우는 사람은 워크스페이스 관리자다.
 */
export async function deleteGroup(ctx: SessionContext, groupId: string): Promise<UserGroupResult<{ nodes: number }>> {
  if (!canManageGroups(ctx.role)) return fail('forbidden')

  return withCommandTransaction(async (tx) => {
    const group = await lockGroup(tx, ctx, groupId)
    if (group === null) return fail('not_found')

    const dropped = await dropGrantsOf(tx, ctx, { type: 'group', id: groupId })
    if (!dropped.ok) return fail('would_orphan', dropped.nodes)

    await tx.query(`UPDATE "group" SET deleted_at = now() WHERE id = $1`, [groupId])
    return { ok: true, value: { nodes: dropped.nodes } } as const
  })
}

// ── 멤버 ──────────────────────────────────────────────────────────────

/**
 * 그룹에 사람을 넣는다. 이미 있으면 아무것도 바꾸지 않는다(세대 · 신호도 가지 않는다 — 0027 의 WHEN).
 * 빠졌던 사람이면 그 행이 살아난다(M1).
 */
export async function addGroupMember(ctx: SessionContext, groupId: string, userId: string): Promise<UserGroupResult> {
  if (!canManageGroups(ctx.role)) return fail('forbidden')

  return withCommandTransaction(async (tx) => {
    const group = await lockGroup(tx, ctx, groupId)
    if (group === null) return fail('not_found')

    const member = await tx.queryMaybe<{ role: WorkspaceRole; status: string }>(
      `SELECT role, status FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
      [ctx.workspaceId, userId],
    )
    // G2 · 활성 멤버만. 초대만 받은 사람(invited)을 넣으면 수락하기 전부터 그룹의 페이지가 그 사람 몫으로 잡힌다.
    if (member === null || member.status !== 'active' || member.role === 'guest') return fail('invalid_member')

    await tx.query(
      `INSERT INTO group_member (group_id, user_id, added_at, removed_at)
       VALUES ($1, $2, now(), NULL)
       ON CONFLICT (group_id, user_id)
       DO UPDATE SET removed_at = NULL, added_at = now()
        WHERE group_member.removed_at IS NOT NULL`,
      [groupId, userId],
    )
    return { ok: true } as const
  })
}

/** 그룹에서 뺀다 — 행은 남긴다(`removed_at`). 그룹에 없는 사람이면 아무것도 바꾸지 않는다. */
export async function removeGroupMember(ctx: SessionContext, groupId: string, userId: string): Promise<UserGroupResult> {
  if (!canManageGroups(ctx.role)) return fail('forbidden')

  return withCommandTransaction(async (tx) => {
    const group = await lockGroup(tx, ctx, groupId)
    if (group === null) return fail('not_found')

    await tx.query(
      `UPDATE group_member SET removed_at = now()
        WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, userId],
    )
    return { ok: true } as const
  })
}
