/**
 * 멤버 내보내기 · 역할 바꾸기 — 멤버 관리 10o-1 (F-06-02)
 *
 * 정본: 00-canonical-data-model.md §3.3 [보강] 멤버 내보내기 · 역할 바꾸기 — owner 를 지키고, M1 을 지킨다
 *
 *   · 누가: owner · membership_admin(`canManageMembers`). **관리 역할(owner · membership_admin)을 주거나 가진 사람은 owner 만
 *     건드린다**(①) — membership_admin 은 member ↔ restricted_member 와 그 둘의 내보내기만. 초대에도 같은 규칙이다(`invite.ts`)
 *   · 대상: 이 워크스페이스의 **활성 · 게스트 아닌** 사람. 게스트는 게스트의 길이 있다(`guest.ts` — 빼면 부여를 거둔다)
 *   · 활성 owner 는 늘 하나 이상(②) — 활성 owner 행을 **모두 잠그고** 센다. 두 owner 가 서로를 동시에 내리면 둘 다 "다른 owner 가
 *     있다" 를 보고 0 이 되기 때문이다. 잠그는 순서는 user_id 순(두 명령이 서로를 기다리지 않게) — 대상 행은 그 뒤에 잠근다.
 *     행위자의 역할도 트랜잭션 안에서 **다시 읽는다**(`actorRole`) — 세션의 역할은 앞선 명령이 이미 내린 낡은 값일 수 있다
 *   · teamspace 의 마지막 행동할 수 있는 owner 는 내보내지 않는다(③ · `lastOwnedTeamspaces` — 그룹 지우기와 같은 셈)
 *   · 내보내기는 M1 — `status='removed'` · `removed_at` 만 쓴다. 부여 · 그룹 · teamspace 멤버십은 거두지 않는다(30일 복원 · ④)
 *   · 역할만 바꾼다 — restricted 로 내려도 명시 멤버십은 남고, 멤버급으로 올리면 기본 teamspace 에 들어간다(⑤)
 *   · 게스트로 내리기는 이 명령이 아니다(⑥ · 다음 조각)
 */

import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
import { recordForContextIn } from '../audit/audit.ts'
import { withCommandTransaction, type Tx } from '../db/tx.ts'
import { DEFAULT_TEAMSPACE_ROLES, joinDefaultTeamspaces, lastOwnedTeamspaces } from './teamspace.ts'
// 누가 누구를 무엇으로 — 화면과 같은 함수(DB 없는 순수 모듈 · 정본 ⑧)
import { canManageMembers, isMemberRole, mayManage, type MemberRole } from './member-rules.ts'

export type MemberManageFailure =
  /** 멤버를 다룰 역할이 아니거나, owner 만 할 수 있는 일이다(①). */
  | 'forbidden'
  /** 이 워크스페이스의 활성 · 게스트 아닌 사람이 아니다 — 떠난 · 초대만 받은 · 멈춘 사람 · 게스트 · 모르는 사람. */
  | 'not_found'
  /** 멤버급 넷이 아닌 역할(게스트로 내리기는 이 명령이 아니다 · ⑥). */
  | 'invalid_role'
  /** 남는 활성 owner 가 없다(②). */
  | 'last_owner'
  /** 자기 자신을 내보낸다(②) — 나가기는 다른 길이다. */
  | 'self'
  /** 그 사람이 마지막 owner 인 teamspace 가 있다(③) — `teamspaces` 가 그 이름들이다. */
  | 'teamspace_last_owner'

export type MemberManageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: MemberManageFailure; readonly teamspaces?: readonly string[] }

const refuse = (reason: MemberManageFailure, teamspaces?: readonly string[]) =>
  ({ ok: false, reason, ...(teamspaces === undefined ? {} : { teamspaces }) }) as const

/** 활성 owner 를 모두 잠그고 그 id 를 돌려준다(②) — user_id 순. */
async function lockOwners(tx: Tx, workspaceId: string): Promise<string[]> {
  const rows = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM workspace_member
      WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'
      ORDER BY user_id
      FOR UPDATE`,
    [workspaceId],
  )
  return rows.map((r) => r.user_id)
}

/**
 * 행위자의 **지금** 역할 — 세션의 역할(`ctx.role`)은 요청을 받을 때의 것이다. 바로 앞의 명령이 이 사람을 내렸다면 그 값은 낡았다 —
 * 두 owner 가 서로를 동시에 내리면 뒤의 것은 이미 owner 가 아닌 사람의 요청이다. 활성이 아니면 null.
 */
async function actorRole(tx: Tx, ctx: SessionContext): Promise<WorkspaceRole | null> {
  const row = await tx.queryMaybe<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' FOR SHARE`,
    [ctx.workspaceId, ctx.userId],
  )
  return row?.role ?? null
}

/** 대상의 행 — 활성 · 게스트 아닌 사람이면 그 역할, 아니면 null. 잠근다. */
async function lockTarget(tx: Tx, workspaceId: string, userId: string): Promise<MemberRole | null> {
  const row = await tx.queryMaybe<{ role: string }>(
    `SELECT role FROM workspace_member
      WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'
      FOR UPDATE`,
    [workspaceId, userId],
  )
  return row !== null && isMemberRole(row.role) ? row.role : null
}

/** 멤버십이 바뀌었다 — 그 사람의 권한 세대와 워크스페이스의 `acl_epoch` 를 올린다(게스트 명령과 같다 · ⑦). */
async function membershipChanged(tx: Tx, workspaceId: string, userId: string): Promise<void> {
  await tx.query(`UPDATE "user" SET perm_gen = perm_gen + 1 WHERE id = $1`, [userId])
  await tx.query(`UPDATE workspace SET acl_epoch = acl_epoch + 1 WHERE id = $1`, [workspaceId])
}

/**
 * 역할을 바꾼다(정본 ① ② ⑤). 같은 역할이면 아무것도 쓰지 않는다. `teamspaces` 는 멤버급으로 올라 들어간 기본 teamspace 수다.
 */
export async function changeMemberRole(
  ctx: SessionContext,
  userId: string,
  role: unknown,
): Promise<MemberManageResult<{ readonly from: MemberRole; readonly to: MemberRole; readonly teamspaces: number }>> {
  if (!isMemberRole(role)) return refuse('invalid_role')
  if (!canManageMembers(ctx.role)) return refuse('forbidden')
  return withCommandTransaction(async (tx) => {
    const owners = await lockOwners(tx, ctx.workspaceId)
    const actor = await actorRole(tx, ctx)
    const from = await lockTarget(tx, ctx.workspaceId, userId)
    if (from === null) return refuse('not_found')
    if (actor === null || !mayManage(actor, from, role)) return refuse('forbidden')
    if (from === role) return { ok: true, value: { from, to: role, teamspaces: 0 } } as const
    if (from === 'owner' && owners.filter((id) => id !== userId).length === 0) return refuse('last_owner')

    await tx.query(`UPDATE workspace_member SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [ctx.workspaceId, userId, role])
    // ⑤ — 기본 teamspace 에 들지 않는 역할(restricted_member)에서 드는 역할로 오르면 들어간다. 내려갈 때는 멤버십을 그대로 둔다
    const joins = !DEFAULT_TEAMSPACE_ROLES.includes(from) && DEFAULT_TEAMSPACE_ROLES.includes(role)
    const teamspaces = joins ? await joinDefaultTeamspaces(tx, ctx.workspaceId, userId, role) : 0
    await membershipChanged(tx, ctx.workspaceId, userId)
    await recordForContextIn(tx, ctx, 'workspace.member_role_changed', { target: { type: 'user', id: userId }, metadata: { from, to: role } })
    return { ok: true, value: { from, to: role, teamspaces } } as const
  })
}

/**
 * 워크스페이스에서 내보낸다(정본 ① ② ③ ④) — M1: `status='removed'` · `removed_at` 만. 부여 · 그룹 · teamspace 멤버십은 남아 30일 안에
 * 다시 들어오면 돌아오고, 그동안은 0단계 게이트가 쓰지 못하게 한다. 열어 둔 편집기는 멤버십 행의 트리거(0016)가 협업 서버에 알려 닫힌다.
 */
export async function removeMember(
  ctx: SessionContext,
  userId: string,
): Promise<MemberManageResult<{ readonly role: MemberRole }>> {
  if (!canManageMembers(ctx.role)) return refuse('forbidden')
  if (userId === ctx.userId) return refuse('self')
  return withCommandTransaction(async (tx) => {
    const owners = await lockOwners(tx, ctx.workspaceId)
    const actor = await actorRole(tx, ctx)
    const role = await lockTarget(tx, ctx.workspaceId, userId)
    if (role === null) return refuse('not_found')
    if (actor === null || !mayManage(actor, role)) return refuse('forbidden')
    return retireIn(tx, ctx, userId, role, owners, {})
  })
}

/**
 * 스스로 나간다(정본 ⑨ · 14 F-14-10 *"Leave workspace"*) — 내보내기와 같은 몸(`retireIn`)이다: 마지막 활성 owner · teamspace 의 마지막
 * 행동할 수 있는 owner 는 나가지 못하고, M1 이다. 활성 · 게스트 아닌 사람만(게스트 · 이미 나간 사람은 `not_found`). 감사 로그에
 * `left: true`.
 */
export async function leaveWorkspace(ctx: SessionContext): Promise<MemberManageResult<{ readonly role: MemberRole }>> {
  return withCommandTransaction(async (tx) => {
    const owners = await lockOwners(tx, ctx.workspaceId)
    const role = await lockTarget(tx, ctx.workspaceId, ctx.userId)
    if (role === null) return refuse('not_found')
    return retireIn(tx, ctx, ctx.userId, role, owners, { left: true })
  })
}

/**
 * 내보내기와 나가기의 몸(정본 ② ③ ④ ⑦ ⑨) — 남는 활성 owner · teamspace 의 마지막 owner 를 묻고, M1(`status='removed'` · `removed_at` 만)
 * 으로 쓰고, 권한 세대 · `acl_epoch` · 감사 로그. `owners` 는 부르는 쪽이 잠근 활성 owner 다.
 */
async function retireIn(
  tx: Tx,
  ctx: SessionContext,
  userId: string,
  role: MemberRole,
  owners: readonly string[],
  extra: { readonly left?: true },
): Promise<MemberManageResult<{ readonly role: MemberRole }>> {
  if (role === 'owner' && owners.filter((id) => id !== userId).length === 0) return refuse('last_owner')
  const orphaned = await lastOwnedTeamspaces(tx, ctx.workspaceId, { type: 'user', id: userId })
  if (orphaned.length > 0) return refuse('teamspace_last_owner', orphaned.map((t) => t.name))

  await tx.query(
    `UPDATE workspace_member SET status = 'removed', removed_at = now() WHERE workspace_id = $1 AND user_id = $2`,
    [ctx.workspaceId, userId],
  )
  await membershipChanged(tx, ctx.workspaceId, userId)
  await recordForContextIn(tx, ctx, 'workspace.member_removed', { target: { type: 'user', id: userId }, metadata: { role, ...extra } })
  return { ok: true, value: { role } } as const
}
