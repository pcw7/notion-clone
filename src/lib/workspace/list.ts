/**
 * 사용자가 속한 워크스페이스 목록.
 *
 * ⚠ 여기서 돌려주는 목록은 **스위처를 그리기 위한 것**이지 권한의 근거가 아니다.
 * 특정 워크스페이스에 들어갈 때는 반드시 `resolveSessionContext()` 를 거친다 —
 * 그 함수가 SSO 게이트(정본 §3.11 0단계)까지 통과시킨다.
 */

import type { SignedInAccount } from '../auth/accounts.ts'
import type { SessionContext, WorkspaceRole } from '../auth/session-context.ts'
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

/**
 * 스위처(8j-1 · F-14-09)가 그리는 것 — 이 계정의 이메일과 워크스페이스 목록(만든 순서 — 단축키의 자리). 목록은 **권한의 근거가 아니다**
 * — 고른 워크스페이스에 들어갈 때 그 워크스페이스의 게이트를 다시 거친다(위 머리말).
 */
export async function switcherOf(ctx: SessionContext): Promise<{ readonly email: string; readonly workspaces: WorkspaceSummary[] }> {
  const [rows, workspaces] = await Promise.all([
    query<{ email: string }>(
      `SELECT ue.email FROM "user" u JOIN user_email ue ON ue.id = u.primary_email_id WHERE u.id = $1`,
      [ctx.userId],
    ),
    listWorkspacesForUser(ctx.userId),
  ])
  return { email: rows[0]?.email ?? '', workspaces }
}

export type SwitcherAccount = SignedInAccount & {
  /** 들어와 있는(`signed_in`) 계정만 — 2단계 인증이 남았거나 끝난 세션의 워크스페이스는 보이지 않는다(빈 배열). */
  readonly workspaces: WorkspaceSummary[]
}

/**
 * 스위처의 다른 계정들(8j-3 · F-14-09) — 이 브라우저에 함께 로그인한 계정마다 그 워크스페이스. 계정 목록은 서버가 쿠키에서 읽은 것
 * (`signedInAccounts` — 정본 §3.2 [보강] 다중 계정 ⑤)이고, 워크스페이스는 **그 계정의 세션이 살아 있고 둘째 단계를 거쳤을 때만** 읽는다 —
 * 첫 단계만 거친 세션은 게이트가 아무 데도 들이지 않으므로 목록도 주지 않는다. 고르면 계정을 바꾼 뒤 그 워크스페이스의 게이트를 거친다.
 */
export async function withWorkspaces(accounts: readonly SignedInAccount[]): Promise<SwitcherAccount[]> {
  return Promise.all(
    accounts.map(async (account) => ({
      ...account,
      workspaces: account.state === 'signed_in' ? await listWorkspacesForUser(account.userId) : [],
    })),
  )
}

/**
 * 이 워크스페이스의 이름 — 사이드바 머리 · 홈의 제목(8g-1 — 설정에서 바꿀 수 있게 되면서 화면에 선다). `SessionContext` 가 들어온
 * 사람이라는 증명이다(게스트도 자기가 들어온 워크스페이스의 이름은 본다).
 */
export async function workspaceNameOf(ctx: SessionContext): Promise<string> {
  const rows = await query<{ name: string }>(`SELECT name FROM workspace WHERE id = $1`, [ctx.workspaceId])
  return rows[0]?.name ?? ''
}

export type WorkspaceMember = {
  readonly userId: string
  readonly name: string
  readonly email: string | null
  readonly role: string
  readonly status: string
}

/**
 * 워크스페이스 멤버 목록을 받을 수 있는 역할인가(7d-2) — 역할 **이름**으로 묻는다(CLAUDE.md). 게스트는 아니다 — F-06-09
 * *"게스트는 … 멤버 목록에 접근하지 못한다"*. 게스트는 워크스페이스에 들어온 사람이 아니라 페이지를 받은 사람이다.
 *
 * 게스트가 이름을 보는 사람은 **자기가 받은 페이지에 이미 나오는 사람**뿐이다 — 그 페이지의 공유 행 · 코멘트를 쓴 사람 ·
 * 본문의 멘션(`loadMentionLabels` 는 원래 id 로 이름을 찾는다). 그래서 목록을 주는 곳은 게스트에게 `onlyPeople` 로 좁힌다.
 */
export function canListMembers(role: WorkspaceRole): boolean {
  return role !== 'guest'
}

/** 멤버 목록을 이 사람들로 좁힌다 — 게스트에게 이름을 줄 때(위). 순서는 원래 목록을 따른다. */
export function onlyPeople<T extends { readonly userId: string }>(members: readonly T[], ids: Iterable<string>): T[] {
  const keep = new Set(ids)
  return members.filter((m) => keep.has(m.userId))
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
