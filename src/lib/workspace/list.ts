/**
 * 사용자가 속한 워크스페이스 목록.
 *
 * ⚠ 여기서 돌려주는 목록은 **스위처를 그리기 위한 것**이지 권한의 근거가 아니다.
 * 특정 워크스페이스에 들어갈 때는 반드시 `resolveSessionContext()` 를 거친다 —
 * 그 함수가 SSO 게이트(정본 §3.11 0단계)까지 통과시킨다.
 */

import { query } from '../db/pool.ts'

export type WorkspaceSummary = {
  readonly workspaceId: string
  readonly name: string
  readonly role: string
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await query<{ id: string; name: string; role: string }>(
    `SELECT w.id, w.name, m.role
       FROM workspace_member m
       JOIN workspace w ON w.id = m.workspace_id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND w.deleted_at IS NULL
      ORDER BY w.created_at`,
    [userId],
  )
  return rows.map((r) => ({ workspaceId: r.id, name: r.name, role: r.role }))
}

export type WorkspaceMember = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly role: string
  readonly status: string
}

/** People 설정 화면용. 호출 전에 SessionContext 로 접근을 확인해야 한다. */
export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await query<{
    user_id: string
    name: string
    email: string | null
    role: string
    status: string
  }>(
    `SELECT u.id AS user_id, u.name, ue.email::text AS email, m.role, m.status
       FROM workspace_member m
       JOIN "user" u ON u.id = m.user_id
       LEFT JOIN user_email ue ON ue.id = u.primary_email_id
      WHERE m.workspace_id = $1 AND m.status <> 'removed'
      ORDER BY m.accepted_at NULLS LAST, u.name`,
    [workspaceId],
  )
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
  }))
}

export type PendingInvite = {
  readonly inviteId: string
  readonly email: string
  readonly role: string
}

export async function listPendingInvites(workspaceId: string): Promise<PendingInvite[]> {
  const rows = await query<{ id: string; email: string; role: string }>(
    `SELECT id, email::text AS email, role
       FROM workspace_invite
      WHERE workspace_id = $1
        AND revoked_at IS NULL AND accepted_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [workspaceId],
  )
  return rows.map((r) => ({ inviteId: r.id, email: r.email, role: r.role }))
}
