/**
 * 워크스페이스 삭제 · 되살리기 — AD-1 (F-14-13)
 *
 * 정본: 00-canonical-data-model.md §3.1 [보강 AD-1] ① ② ⑤ ⑥ · 마이그레이션 0129
 *
 *   · 지우기는 owner 만, 이름을 그대로 다시 쳐야 한다(대소문자 · 공백까지). `deleted_at` · `deleted_by` 만 쓴다 — 행 · 블록 · 파일은 그대로다.
 *   · 문을 닫는 일은 0단계 게이트(`session-context.ts`)와 공개·워커 길의 `deleted_at IS NULL` 이 한다 — 여기서는 표시만 한다.
 *   · 되살리기는 운영자 명령(`npm run workspace:restore`)의 몸이다 — HTTP 로 열지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { recordAuditIn } from '../audit/audit.ts'
import { withCommandTransaction, withTransaction, type Tx } from '../db/tx.ts'

export type DeleteWorkspaceFailure =
  /** owner 가 아니다(위임 컨텍스트도). */
  | 'forbidden'
  /** 확인으로 친 이름이 워크스페이스 이름과 다르다. */
  | 'name_mismatch'
  /** 이미 지웠거나 없다(동시에 두 번 지운 경우). */
  | 'not_found'

export type DeleteWorkspaceResult = { readonly ok: true } | { readonly ok: false; readonly reason: DeleteWorkspaceFailure }

/** 지울 수 있는 역할인가 — owner 만(위임 컨텍스트 아님). 설정의 위험 구역이 설지 정한다. 판정은 `deleteWorkspace` 가 다시 한다. */
export function canDeleteWorkspace(ctx: SessionContext): boolean {
  return ctx.role === 'owner' && ctx.delegation === undefined
}

export async function deleteWorkspace(ctx: SessionContext, input: { readonly confirmName: unknown }): Promise<DeleteWorkspaceResult> {
  if (!canDeleteWorkspace(ctx)) return { ok: false, reason: 'forbidden' }
  return withCommandTransaction<DeleteWorkspaceResult>(async (tx) => {
    // 역할 · 이름은 트랜잭션 안에서 다시 읽는다 — 세션의 값은 낡았을 수 있다.
    const row = await tx.queryMaybe<{ name: string; role: string | null; status: string | null }>(
      `SELECT w.name, m.role, m.status
         FROM workspace w
         LEFT JOIN workspace_member m ON m.workspace_id = w.id AND m.user_id = $2
        WHERE w.id = $1 AND w.deleted_at IS NULL
        FOR UPDATE OF w`,
      [ctx.workspaceId, ctx.userId],
    )
    if (row === null) return { ok: false, reason: 'not_found' }
    if (row.role !== 'owner' || row.status !== 'active') return { ok: false, reason: 'forbidden' }
    if (typeof input.confirmName !== 'string' || input.confirmName !== row.name) return { ok: false, reason: 'name_mismatch' }
    await markWorkspaceDeletedIn(tx, { workspaceId: ctx.workspaceId, userId: ctx.userId, sessionId: ctx.delegation === undefined ? ctx.sessionId : null }, row.name)
    return { ok: true }
  })
}

/** 지운 표시와 감사 — 워크스페이스 삭제와 계정 삭제(AD-2 ②)가 같은 몸을 쓴다. 부르는 쪽이 행을 잠그고 지울 수 있음을 확인했다. */
export async function markWorkspaceDeletedIn(
  tx: Tx,
  by: { readonly workspaceId: string; readonly userId: string; readonly sessionId: string | null },
  name: string,
): Promise<void> {
  await tx.query(`UPDATE workspace SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [by.workspaceId, by.userId])
  await recordAuditIn(tx, {
    type: 'workspace.deleted',
    workspaceId: by.workspaceId,
    actorUserId: by.userId,
    sessionId: by.sessionId,
    target: { type: 'workspace', id: by.workspaceId },
    metadata: { name },
  })
}

/** 운영자 명령 — 지운 워크스페이스를 되살린다(`deleted_at` · `deleted_by` 를 비운다). 지운 상태가 아니면 `not_deleted`. */
export async function restoreWorkspace(workspaceId: string): Promise<{ readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: 'not_found' | 'not_deleted' }> {
  return withTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ name: string; deleted_at: Date | null }>(
      `SELECT name, deleted_at FROM workspace WHERE id = $1 FOR UPDATE`,
      [workspaceId],
    )
    if (row === null) return { ok: false, reason: 'not_found' } as const
    if (row.deleted_at === null) return { ok: false, reason: 'not_deleted' } as const
    await tx.query(`UPDATE workspace SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [workspaceId])
    await recordAuditIn(tx, { type: 'workspace.restored', workspaceId, actorUserId: null, target: { type: 'workspace', id: workspaceId }, metadata: { name: row.name } })
    return { ok: true, name: row.name } as const
  })
}
