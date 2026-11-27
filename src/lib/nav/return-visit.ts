/**
 * 되돌아간 열기의 방문 기록 (59번 트랙 NV-2 · F-07-04 · F-07-12)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑨ [NV-2]
 *
 * 뒤로 · 앞으로는 라우터가 받아 둔 화면(bfcache)을 다시 써서 페이지 화면의 서버 렌더가 돌지 않는다 — 거기 있던 `recordVisit` 도 돌지 않는다.
 * 화면이 받아 둔 렌더를 다시 그렸다고 알리면(`POST …/pages/{id}/visit`) 여기서 **서버 렌더와 같은 규칙으로** 남긴다: `getPage` 를 지난 뒤에만.
 * 볼 수 없는 페이지를 열어 본 흔적이 남으면 그 자체가 존재를 알리는 신호다(`page-content-base.tsx` 의 그 자리와 같은 까닭).
 *
 * 기록 규칙은 그대로다 — `recordVisit`(사람 · 페이지마다 한 행 upsert · 실패해도 던지지 않는다).
 */

import type { SessionContext } from '../auth/session-context.ts'
import type { BlockId } from '../ids.ts'
import { getPage } from '../block/page.ts'
import { recordVisit } from './recent.ts'

/** 볼 수 있으면 방문을 남기고 true · 없거나 볼 수 없으면 아무것도 쓰지 않고 false(둘을 가르지 않는다). */
export async function recordVisitIfViewable(ctx: SessionContext, pageId: BlockId): Promise<boolean> {
  const page = await getPage(ctx, pageId)
  if (page === null) return false
  await recordVisit(ctx, page.id)
  return true
}
