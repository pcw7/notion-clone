/**
 * 계정 삭제 — AD-2 (F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-2] ① ~ ⑤
 *
 *   · 미리보기 — 내가 든 (지우지 않은) 워크스페이스마다 `delete`(나 말고 활성 멤버가 없다) · `leave` · `blocked`
 *     (유일한 owner 인데 다른 멤버가 있다 · 내가 마지막 owner 인 teamspace). 나가기 판정은 `leaveWorkspace` 와 **같은 함수**
 *     (`leaveBlocker`)다 — 규칙이 둘이 되지 않게.
 *   · 실행 — 확인으로 기본 이메일을 그대로 친다. 한 트랜잭션: 워크스페이스를 지우거나(AD-1 의 같은 몸) 나가고, 사람 행은 tombstone
 *     (`status='deleted'` · 이름 "삭제된 사용자")으로 남기고, 세션 · 자격 증명 · 2단계 인증 · 이메일 행을 지운다.
 *   · 계정 명령이다 — `SessionContext` 가 아니라 로그인한 사람의 id 로 부른다(워크스페이스와 무관 · A9 의 권한 판정이 아니다).
 */

import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { markWorkspaceDeletedIn } from '../workspace/delete.ts'
import { leaveBlocker, leaveWorkspaceForAccountIn } from '../workspace/member.ts'

export const DELETED_USER_NAME = '삭제된 사용자'

export type DeletionOutcome = {
  readonly id: string
  readonly name: string
  readonly outcome: 'delete' | 'leave' | 'blocked'
  readonly reason?: 'sole_owner' | 'teamspace_last_owner'
  /** `teamspace_last_owner` 일 때 내가 마지막 owner 인 teamspace 이름들. */
  readonly teamspaces?: readonly string[]
}

export type AccountDeletionPreview = { readonly email: string | null; readonly workspaces: readonly DeletionOutcome[] }

export type DeleteAccountResult =
  | { readonly ok: true; readonly workspaces: readonly DeletionOutcome[] }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'email_mismatch' }
  | { readonly ok: false; readonly reason: 'blocked'; readonly preview: AccountDeletionPreview }

type MembershipRow = { id: string; name: string; role: string }

async function outcomesIn(tx: Tx, userId: string): Promise<DeletionOutcome[]> {
  const rows = await tx.query<MembershipRow>(
    `SELECT w.id, w.name, m.role
       FROM workspace_member m
       JOIN workspace w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY lower(w.name), w.id`,
    [userId],
  )
  const result: DeletionOutcome[] = []
  for (const w of rows) {
    const others = await tx.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM workspace_member WHERE workspace_id = $1 AND status = 'active' AND user_id <> $2`,
      [w.id, userId],
    )
    if (Number(others.n) === 0) {
      result.push({ id: w.id, name: w.name, outcome: 'delete' })
      continue
    }
    const owners = (
      await tx.query<{ user_id: string }>(`SELECT user_id FROM workspace_member WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'`, [w.id])
    ).map((r) => r.user_id)
    const blocker = await leaveBlocker(tx, w.id, userId, w.role, owners)
    if (blocker === null) result.push({ id: w.id, name: w.name, outcome: 'leave' })
    else if (blocker.reason === 'last_owner') result.push({ id: w.id, name: w.name, outcome: 'blocked', reason: 'sole_owner' })
    else result.push({ id: w.id, name: w.name, outcome: 'blocked', reason: 'teamspace_last_owner', teamspaces: blocker.teamspaces })
  }
  return result
}

async function primaryEmailIn(tx: Tx, userId: string): Promise<string | null> {
  const row = await tx.queryMaybe<{ email: string }>(
    `SELECT ue.email::text AS email FROM "user" u JOIN user_email ue ON ue.id = u.primary_email_id WHERE u.id = $1 AND u.status = 'active'`,
    [userId],
  )
  return row?.email ?? null
}

/** 삭제 미리보기(①) — 아무것도 쓰지 않는다. 활성 사람이 아니면 null. */
export async function previewAccountDeletion(userId: string): Promise<AccountDeletionPreview | null> {
  return withReadTransaction(async (tx) => {
    const email = await primaryEmailIn(tx, userId)
    if (email === null) return null
    return { email, workspaces: await outcomesIn(tx, userId) }
  })
}

/** 계정을 지운다(②) — 하나라도 `blocked` 면 아무것도 바꾸지 않고 `blocked` + 미리보기를 돌려준다. */
export async function deleteAccount(userId: string, input: { readonly confirmEmail: unknown }): Promise<DeleteAccountResult> {
  return withCommandTransaction<DeleteAccountResult>(async (tx) => {
    const locked = await tx.queryMaybe<{ id: string }>(`SELECT id FROM "user" WHERE id = $1 AND status = 'active' AND type = 'person' FOR UPDATE`, [userId])
    if (locked === null) return { ok: false, reason: 'not_found' }
    const email = await primaryEmailIn(tx, userId)
    if (email === null) return { ok: false, reason: 'not_found' }
    if (typeof input.confirmEmail !== 'string' || input.confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      return { ok: false, reason: 'email_mismatch' }
    }

    // 내 워크스페이스 행을 잠근 뒤(id 순) 센다 — 그 사이에 멤버가 들어와 "혼자" 가 깨지지 않게
    await tx.query(
      `SELECT w.id FROM workspace w JOIN workspace_member m ON m.workspace_id = w.id AND m.user_id = $1 AND m.status = 'active'
        WHERE w.deleted_at IS NULL ORDER BY w.id FOR UPDATE OF w`,
      [userId],
    )
    const workspaces = await outcomesIn(tx, userId)
    if (workspaces.some((w) => w.outcome === 'blocked')) {
      return { ok: false, reason: 'blocked', preview: { email, workspaces } }
    }

    for (const w of workspaces) {
      if (w.outcome === 'delete') {
        await markWorkspaceDeletedIn(tx, { workspaceId: w.id, userId, sessionId: null }, w.name)
      } else {
        const left = await leaveWorkspaceForAccountIn(tx, w.id, userId)
        if (!left.ok) return { ok: false, reason: 'blocked', preview: { email, workspaces } }
      }
    }

    // tombstone(R-3) — 행은 지우지 않는다. 이름만 "삭제된 사용자" 라 편집 이력 · 코멘트 · 사람 칸이 그대로 그린다
    await tx.query(
      `UPDATE "user" SET status = 'deleted', deleted_at = now(), name = $2, preferred_name = NULL, avatar_url = NULL,
                         primary_email_id = NULL, perm_gen = perm_gen + 1
        WHERE id = $1`,
      [userId, DELETED_USER_NAME],
    )
    await tx.query(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'account_deleted' WHERE user_id = $1 AND revoked_at IS NULL`, [userId])
    await tx.query(`DELETE FROM otp_challenge WHERE user_id = $1`, [userId])
    await tx.query(`DELETE FROM credential WHERE user_id = $1`, [userId])
    await tx.query(`DELETE FROM mfa_backup_code WHERE user_id = $1`, [userId])
    await tx.query(`DELETE FROM mfa_method WHERE user_id = $1`, [userId])
    await tx.query(`DELETE FROM user_email WHERE user_id = $1`, [userId])
    return { ok: true, workspaces }
  })
}
