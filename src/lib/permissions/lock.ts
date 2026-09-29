/**
 * 잠금 — Teamspace · 게스트 · 그룹 7f-1조각 (F-06-16)
 *
 * 정본: 00-canonical-data-model.md §3.3 `node_lock` · [보강] 잠금이 막는 것 ①~⑧ · 판결 X-9 · §3.11 "2단계: 잠금 게이트"
 *       06-permissions-sharing.md F-06-16 *"권한이 아니라 실수 방지 장치"*
 *
 * ──────────────────────────────────────────────────────────────────────
 * 판정이 아니라 게이트다
 * ──────────────────────────────────────────────────────────────────────
 *
 * `effective()` 는 잠금을 모른다 — 잠긴 페이지의 편집자도 `edit_content` 를 가진다. 쓰기 명령이 capability 를 확인한 **뒤에**
 * `isLocked` 를 묻는다. 잠금을 capability 에 섞으면 공유 패널 · 이동 · 잠금 풀기처럼 "고칠 수 있는 사람인가"를 묻는 다른 판단이
 * 함께 흔들린다(잠근 사람이 풀 수 없게 된다).
 *
 * 페이지 잠금이 막는 것은 **본문과 제목**이다 — 본문은 협업 접속 판정(`collab/doc-store.ts` `accessOf`)과 참여자 update
 * (`block/body-write.ts` `appendDocUpdate`)가, 제목은 `renamePage` 가 묻는다. 코멘트 · 트리 연산 · 공유 설정은 묻지 않는다
 * (정본 [보강] ③).
 *
 * 잠금은 상속되지 않는다(정본 §6.1-8) — 노드 자기 행만 본다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withCommandTransaction, withReadTransaction, type Tx } from '../db/tx.ts'
import { effectiveCaps } from './effective.ts'
import { can } from './levels.ts'

/** 이 노드가 잠겼는가 — 자기 행만(상속되지 않는다). */
export async function isLocked(tx: Tx, nodeId: string): Promise<boolean> {
  const row = await tx.queryMaybe<{ one: number }>(`SELECT 1 AS one FROM node_lock WHERE node_id = $1`, [nodeId])
  return row !== null
}

export type PageLockState = {
  readonly locked: boolean
  /** 잠그고 풀 수 있는가 — 그 페이지를 고칠 수 있는 사람(`edit_content` · 잠금과 무관하게). */
  readonly canToggle: boolean
}

/** 페이지 화면의 잠금 상태. 볼 수 없거나 살아 있는 페이지가 아니면 null. */
export async function pageLockState(ctx: SessionContext, pageId: string): Promise<PageLockState | null> {
  return withReadTransaction(async (tx) => {
    if (!(await livePage(tx, ctx, pageId, false))) return null
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return null
    return { locked: await isLocked(tx, pageId), canToggle: can(caps, 'edit_content') }
  })
}

export type LockFailure =
  /** 볼 수 없거나 없는 페이지다(없는 것과 같다). */
  | 'not_found'
  /** 볼 수는 있지만 고칠 수 없다 — 잠그고 푸는 것은 고칠 수 있는 사람이다. */
  | 'forbidden'

export type LockResult =
  | { readonly ok: true; readonly value: { readonly changed: boolean } }
  | { readonly ok: false; readonly reason: LockFailure }

/**
 * 페이지를 잠그거나 푼다. 이미 그 상태면 쓰지 않는다(`changed: false` — 신호도 없다).
 *
 * 누가: 그 페이지를 고칠 수 있는 사람(`edit_content` — 06 *"full or edit access"*). 잠금은 capability 를 바꾸지 않으므로 잠근
 * 사람이 잠긴 채로 풀 수 있다. 행이 생기고 지워지는 것이 협업 신호다(0034 — 열린 편집 연결이 곧바로 읽기 전용이 된다).
 */
export async function setPageLock(ctx: SessionContext, pageId: string, locked: boolean): Promise<LockResult> {
  return withCommandTransaction(async (tx) => {
    if (!(await livePage(tx, ctx, pageId, true))) return { ok: false, reason: 'not_found' } as const
    const caps = await effectiveCaps(tx, ctx, pageId)
    if (!can(caps, 'view')) return { ok: false, reason: 'not_found' } as const
    if (!can(caps, 'edit_content')) return { ok: false, reason: 'forbidden' } as const

    const rows = locked
      ? await tx.query<{ node_id: string }>(
          `INSERT INTO node_lock (node_id, kind, locked_by, locked_at) VALUES ($1, 'page', $2, now())
           ON CONFLICT (node_id) DO NOTHING
           RETURNING node_id`,
          [pageId, ctx.userId],
        )
      : await tx.query<{ node_id: string }>(`DELETE FROM node_lock WHERE node_id = $1 RETURNING node_id`, [pageId])
    return { ok: true, value: { changed: rows.length > 0 } } as const
  })
}

/** 이 워크스페이스의 살아 있는 페이지인가 — 잠그는 명령은 행을 잠가 같은 페이지의 다른 쓰기와 줄을 세운다. */
async function livePage(tx: Tx, ctx: SessionContext, pageId: string, forUpdate: boolean): Promise<boolean> {
  const row = await tx.queryMaybe<{ id: string }>(
    `SELECT id FROM block WHERE id = $1 AND workspace_id = $2 AND type = 'page' AND lifecycle = 'live'${forUpdate ? ' FOR UPDATE' : ''}`,
    [pageId, ctx.workspaceId],
  )
  return row !== null
}
