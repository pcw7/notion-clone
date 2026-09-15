/**
 * 페이지를 휴지통으로 보내는 행 쓰기와 그 권한 — 휴지통 명령(`trashPage`)과 프로젝터(참여자가 참조 노드를 지웠을 때)가
 * 같이 쓴다 (F-11-05 · 판결 X-3 · CRDT 5b조각)
 *
 * 정본: §3.4 상태 전이표 `live → trashed` — *"page 타입 자손 전체에 전파. 자손 trash_root_id=대상 id.
 *       purge_after=now+trash_days"*, §3.4 프로젝터 의사코드 — *"type='page' 인데 doc 에 없으면 lifecycle='trashed' 로 전이"*
 *
 * 두 벌이면 한쪽만 고쳐져 "명령으로 버린 페이지"와 "본문에서 지워 버려진 페이지"가 다르게 복원된다. 부모 본문의 참조 노드는
 * 여기서 건드리지 않는다 — 명령은 따로 빼고(`page-refs.ts`), 프로젝터는 이미 빠진 문서를 투영하는 중이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { effectiveCaps } from '../permissions/effective.ts'
import { can } from '../permissions/levels.ts'

/**
 * 이 페이지를 버리거나 되살리거나 옮길 수 있는가 — HANDOFF §3.2-18.
 *
 * 볼 수 없으면 `not_found`(존재를 알리지 않는다), 볼 수만 있으면 `forbidden`. 바꾸는 capability 는 `edit_content` 다 — 본문
 * 저장 · DB 행 삭제와 같다. 휴지통에 있는 페이지도 권한은 그대로다(ACL 을 지우지 않는다).
 */
export async function pageChangeAccess(
  tx: Tx,
  ctx: SessionContext,
  pageId: string,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const caps = await effectiveCaps(tx, ctx, pageId)
  if (!can(caps, 'view')) return 'not_found'
  return can(caps, 'edit_content') ? 'ok' : 'forbidden'
}

export type TrashedRows = {
  /** 이 시각이 지나면 GC 가 purged 로 옮긴다. */
  readonly purgeAfter: Date
  /** 함께 휴지통에 들어간 자손 페이지 수. */
  readonly trashedDescendants: number
}

/**
 * 살아 있는 페이지와 그 자손 페이지를 휴지통으로 — **행만 쓴다.** 호출자가 대상 행을 잠갔고 권한을 봤다.
 *
 * **이미 따로 버려져 있던 자손은 건드리지 않는다**(B3: "먼저 독립적으로 버려진 자손은 `trashed` 유지") — `lifecycle =
 * 'live'` 조건이 그 역할이다. 덮으면 그 자손의 `trash_root_id` 가 바뀌어 원래 묶음으로 복원할 수 없다. `parent_id` ·
 * `order_key` 는 그대로다(B2 — 복원이 공짜다). 전파는 페이지에만 한다(B5 · X-3) — 비페이지 블록은 CHECK 이 막는다.
 */
export async function trashSubtreeRows(tx: Tx, ctx: SessionContext, pageId: string): Promise<TrashedRows> {
  // 보존 기간은 워크스페이스 설정이다(§3.1 `workspace.trash_days`, 1~3650).
  const ws = await tx.queryOne<{ trash_days: number }>(
    `SELECT trash_days FROM workspace WHERE id = $1`,
    [ctx.workspaceId],
  )

  const moved = await tx.queryOne<{ purge_after: Date }>(
    `UPDATE block
        SET lifecycle = 'trashed',
            trashed_at = now(), trashed_by = $3, trash_root_id = id,
            purge_after = now() + ($4 || ' days')::interval,
            last_edited_by = $3, last_edited_at = now(), version = version + 1
      WHERE id = $1 AND workspace_id = $2
      RETURNING purge_after`,
    [pageId, ctx.workspaceId, ctx.userId, String(ws.trash_days)],
  )

  const descendants = await tx.query<{ id: string }>(
    `UPDATE block
        SET lifecycle = 'trashed',
            trashed_at = now(), trashed_by = $3, trash_root_id = $1,
            purge_after = now() + ($4 || ' days')::interval,
            version = version + 1
      WHERE ancestor_path @> ARRAY[$1::uuid] AND workspace_id = $2
        AND type = 'page' AND lifecycle = 'live'
      RETURNING id`,
    [pageId, ctx.workspaceId, ctx.userId, String(ws.trash_days)],
  )

  return { purgeAfter: moved.purge_after, trashedDescendants: descendants.length }
}
