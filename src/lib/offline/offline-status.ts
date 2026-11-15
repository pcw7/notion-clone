/**
 * 다시 붙을 때의 서버 판 묻기 — 내려받은 페이지들의 지금 판을 한 번에 (OF-3 · F-12-04 · 정본 §3.7 [보강 OF-1] ④)
 *
 * 기기는 페이지마다 받은 서버 판(`seq`)을 갖고 있다(`offline-store.ts`). 다시 붙으면 그 id 들을 보내고, 여기는 페이지마다 **지금의 판**
 * 또는 **`gone`** 을 돌려준다 — 바뀐 것만 다시 받고(OF-2 의 길) 볼 수 없게 된 것은 기기가 곧바로 지운다. 마이그레이션이 없다 — 읽기 길 하나다.
 *
 *   - **`gone` 은 OF-2 의 라우트가 거부할 페이지다** — 볼 수 없다 · 없다 · 휴지통 · uuid 가 아니다 · 다른 워크스페이스의 것 · 내보내기 정책이
 *     이 사람의 내려받기를 막았다(`exportPolicyAllows` — 같은 게이트). **까닭을 가르지 않는다** — 가르면 id 를 찍어 있고 없음을 알아낸다
 *   - 볼 수 있는가는 목록과 같은 규칙으로 SQL 안에서 거른다(`perm_scope_id = ANY(readableScopes)` — `listChildPages` 와 같다). 페이지마다
 *     판정을 따로 돌리면 id 수만큼 질의가 는다
 *   - 판은 그 페이지 로그의 마지막 seq 다(`readOfflinePage` 가 싣는 것과 같다). 로그가 아직 없는 페이지(옮기기 전)는 `'0'` — 받은 적이 있는
 *     페이지는 옮겨졌으므로 기기의 판(1 이상)보다 작아 다시 받지 않는다
 *   - 한 번에 `MAX_STATUS_PAGES` 개까지 — 넘으면 묻지 않고 거부한다(`too_many` · 기기가 나눠 묻는다)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { withReadTransaction } from '../db/tx.ts'
import { exportPolicyAllows } from '../export/download.ts'
import { isUuid } from '../ids.ts'
import { readableScopes } from '../permissions/effective.ts'
import { MAX_STATUS_PAGES, type PageStatus } from './offline-resync.ts'

export { MAX_STATUS_PAGES }

/** 페이지 하나의 답 — 지금의 판, 또는 받을 수 없다(까닭은 가르지 않는다). 기기가 읽는 모양과 같다. */
export type OfflinePageStatus = PageStatus

export type OfflineStatusResult =
  | { readonly ok: true; readonly pages: Record<string, OfflinePageStatus> }
  | { readonly ok: false; readonly reason: 'too_many' }

/** 이 사람이 받아 둔 페이지들의 지금 판. 답에는 물은 id 가 모두 있다(겹친 id 는 하나로). 상한을 넘으면 묻지 않는다. */
export async function offlinePageStatus(ctx: SessionContext, pageIds: readonly string[]): Promise<OfflineStatusResult> {
  const ids = [...new Set(pageIds)]
  if (ids.length > MAX_STATUS_PAGES) return { ok: false, reason: 'too_many' }
  const out: Record<string, OfflinePageStatus> = Object.fromEntries(ids.map((id) => [id, 'gone' as const]))
  // 정책을 먼저 본다 — 정책은 워크스페이스의 것이라 페이지의 있고 없음을 알리지 않는다(OF-2 와 같은 차례)
  if (!(await exportPolicyAllows(ctx))) return { ok: true, pages: out }
  const candidates = ids.filter(isUuid)
  if (candidates.length === 0) return { ok: true, pages: out }
  const rows = await withReadTransaction(async (tx) => {
    const scopes = await readableScopes(tx, ctx)
    if (scopes.length === 0) return []
    return tx.query<{ id: string; seq: string | null }>(
      `SELECT b.id, (SELECT max(u.seq) FROM doc_update u WHERE u.page_id = b.id)::text AS seq
         FROM live_block b
        WHERE b.id = ANY($1::uuid[]) AND b.workspace_id = $2 AND b.type = 'page'
          AND b.perm_scope_id = ANY($3::uuid[])`,
      [candidates, ctx.workspaceId, scopes],
    )
  })
  for (const row of rows) if (row.id in out) out[row.id] = { seq: row.seq ?? '0' }
  return { ok: true, pages: out }
}
