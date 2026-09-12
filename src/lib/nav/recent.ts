/**
 * 최근 방문 · 즐겨찾기 — W6-a (F-07-04 / F-07-16)
 *
 * 정본: 00-canonical-data-model.md §3.9 "[추가] 내비게이션 상태",
 *       07-search-navigation.md F-07-04 · F-07-16
 *
 * ──────────────────────────────────────────────────────────────────────
 * 권한은 **조회 시점에** 다시 건다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 이 표들은 권한의 저장 지점이 아니다(C-7). 정본 F-07-04 의 엣지 케이스:
 * *"최근 방문한 페이지의 권한이 회수됨 → 목록에서 즉시 제거(권한 필터를 조회
 * 시점에 재적용)."*
 *
 * 그래서 기록을 지우는 정리 작업이 없다. 지우는 설계였다면 권한이 바뀔 때마다
 * 모든 사용자의 목록을 손봐야 하고, 한 번 놓치면 **볼 수 없는 페이지의 제목이
 * 사이드바에 남는다.**
 *
 * 거르는 방법은 사이드바·휴지통과 같다 — 볼 수 있는 `perm_scope_id` 목록으로
 * 한 번에(`readableScopes`).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 제목을 복사해 두지 않는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * F-07-04: *"페이지 제목 변경 → 목록은 현재 제목을 보여줘야 함 → 제목을 복사
 * 저장하지 말고 조인."* 목록이 짧아서(최근 N개) 조인이 문제되지 않는다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction, withTransaction } from '../db/tx.ts'
import { readableScopes } from '../permissions/effective.ts'
import { toPlainText, type RichTextRun } from '../contracts/rich-text.ts'
import { orderKeyBetween } from '../block/order-key.ts'

/** 목록 기본 길이. 정본은 "사용자 설정값"이라고 했다 — 설정 표가 생기면 여기서 읽는다. */
export const DEFAULT_RECENT_LIMIT = 7

export type NavEntry = {
  readonly id: string
  readonly title: string
  readonly visitedAt?: Date
}

type NavRow = { id: string; properties: { title?: unknown } | null; last_visited_at?: Date }

function toEntry(row: NavRow): NavEntry {
  const raw = row.properties?.title
  return {
    id: row.id,
    // 읽기는 관대하게 — 제목 하나가 망가졌다고 사이드바 전체가 500 이 되면
    // 사용자가 어디로도 이동할 수 없다.
    title: Array.isArray(raw) ? toPlainText(raw as RichTextRun[]) : '',
    ...(row.last_visited_at ? { visitedAt: row.last_visited_at } : {}),
  }
}

/**
 * 방문을 기록한다.
 *
 * 실패해도 던지지 않는다 — **페이지를 못 여는 것보다 기록이 빠지는 편이 낫다.**
 * 페이지 렌더의 곁가지이므로, 이 쓰기 때문에 화면이 500 이 되면 안 된다.
 *
 * 권한 검사를 하지 않는다. 부르는 쪽(`getPage` 를 통과한 페이지 화면)이 이미
 * 볼 수 있음을 확인했고, 기록 자체는 접근을 만들지 않는다(조회 때 다시 거른다).
 */
export async function recordVisit(ctx: SessionContext, pageId: string): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO recent_visit (user_id, workspace_id, block_id, last_visited_at, visit_count)
         VALUES ($1, $2, $3, now(), 1)
         ON CONFLICT (user_id, block_id)
         DO UPDATE SET last_visited_at = now(),
                       visit_count = recent_visit.visit_count + 1,
                       -- 워크스페이스가 바뀔 일은 없지만, 페이지가 옮겨졌다면 따라간다.
                       workspace_id = EXCLUDED.workspace_id`,
        [ctx.userId, ctx.workspaceId, pageId],
      )
    })
  } catch {
    // 조용히 넘긴다. 이 기록은 편의 기능이고 페이지 열람의 전제가 아니다.
  }
}

/** 최근 방문. 볼 수 없게 된 페이지는 여기서 사라진다. */
export async function listRecent(
  ctx: SessionContext,
  limit = DEFAULT_RECENT_LIMIT,
): Promise<NavEntry[]> {
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []

    const rows = await tx.query<NavRow>(
      `SELECT b.id, b.properties, r.last_visited_at
         FROM recent_visit r
         JOIN live_block b ON b.id = r.block_id
        WHERE r.user_id = $1 AND r.workspace_id = $2
          AND b.type = 'page' AND b.perm_scope_id = ANY($3::uuid[])
        ORDER BY r.last_visited_at DESC
        LIMIT $4`,
      [ctx.userId, ctx.workspaceId, scopes, limit],
    )
    return rows.map(toEntry)
  })
}

// ── 즐겨찾기 ──────────────────────────────────────────────────────────

export async function listFavorites(ctx: SessionContext): Promise<NavEntry[]> {
  return withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []

    const rows = await tx.query<NavRow>(
      `SELECT b.id, b.properties
         FROM favorite f
         JOIN live_block b ON b.id = f.block_id
        WHERE f.user_id = $1 AND f.workspace_id = $2
          AND b.type = 'page' AND b.perm_scope_id = ANY($3::uuid[])
        ORDER BY f.order_key, b.id`,
      [ctx.userId, ctx.workspaceId, scopes],
    )
    return rows.map(toEntry)
  })
}

export async function isFavorite(ctx: SessionContext, pageId: string): Promise<boolean> {
  return withReadTransaction(async (tx) => {
    const row = await tx.queryMaybe<{ one: number }>(
      `SELECT 1 AS one FROM favorite WHERE user_id = $1 AND block_id = $2`,
      [ctx.userId, pageId],
    )
    return row !== null
  })
}

/**
 * 즐겨찾기에 넣는다(이미 있으면 그대로).
 *
 * 새 항목은 **맨 뒤**다. 앞에 넣으면 별을 누를 때마다 기존 목록이 밀려 내려가고,
 * 사용자가 익힌 위치가 매번 바뀐다.
 */
export async function addFavorite(ctx: SessionContext, pageId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const last = await tx.queryMaybe<{ order_key: string }>(
      `SELECT order_key FROM favorite
        WHERE user_id = $1 AND workspace_id = $2
        ORDER BY order_key DESC LIMIT 1`,
      [ctx.userId, ctx.workspaceId],
    )
    await tx.query(
      `INSERT INTO favorite (user_id, workspace_id, block_id, order_key, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, block_id) DO NOTHING`,
      [ctx.userId, ctx.workspaceId, pageId, orderKeyBetween(last?.order_key ?? null, null)],
    )
  })
}

export async function removeFavorite(ctx: SessionContext, pageId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM favorite WHERE user_id = $1 AND block_id = $2`, [
      ctx.userId,
      pageId,
    ])
  })
}
