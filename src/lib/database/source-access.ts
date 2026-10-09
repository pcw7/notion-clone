/**
 * 붙인 소스(linked · F-04-13)의 읽기 게이트 — 2l-1 · 2l-2
 *
 * 붙인 소스의 행 · 스키마는 **원본(소스의 주인 데이터베이스)** 의 것이다. 뷰는 붙인 데이터베이스(그릇)의 것이지만 그 뷰가 그리는 컬럼 ·
 * 행은 원본의 내용이라, 뷰를 여는 길은 그릇과 **원본을 둘 다** 볼 수 있어야 한다(`view.ts` `openView` · `group.ts` `openBoard`).
 * 소스 이름을 가리는 것(`data-source.ts` `readDataSources`)도 같은 질문이다.
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { Tx } from '../db/tx.ts'
import { can } from '../permissions/levels.ts'
import { effectiveCaps } from '../permissions/effective.ts'

/** 이 데이터베이스(소스의 주인)를 볼 수 있는가 — 살아 있고 이 워크스페이스의 것이어야 한다. */
export async function canViewOwnerDatabase(tx: Tx, ctx: SessionContext, databaseId: string): Promise<boolean> {
  const live = await tx.queryMaybe<{ one: number }>(
    `SELECT 1 AS one FROM block WHERE id = $1 AND workspace_id = $2 AND lifecycle = 'live'`,
    [databaseId, ctx.workspaceId],
  )
  return live !== null && can(await effectiveCaps(tx, ctx, databaseId), 'view')
}
