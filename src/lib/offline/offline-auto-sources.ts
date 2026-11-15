/**
 * 자동 내려받기의 원천 — 이 사람의 이 워크스페이스 즐겨찾기 · 최근 10개 (OF-5 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑥)
 *
 * 기기가 다시 붙을 때마다 묻는다(`offline-sync.ts`) — 여기 있는 것은 받아 두고, 없는 것에서는 그 까닭을 뺀다(`offline-auto.ts`).
 *
 *   - **요금제 `offline.auto_download`** 가 허락하지 않으면 `plan_required`(Free — 노션과 같다). 직접 내려받기(스위치)는 요금제와 무관하다
 *   - 목록은 사이드바 · 홈과 같은 함수다(`listFavorites` · `listRecent` — 볼 수 있는 페이지만 · 조회 때 권한을 다시 건다 · 제목을 싣지 않는다).
 *     즐겨찾기 · 최근은 `type='page'` 블록이라 페이지만 든다(데이터베이스는 화면의 스위치로 내려받는다 · OF-4)
 *   - **내보내기 정책이 이 사람의 내려받기를 막으면 빈 목록**(OF-2 와 같은 게이트 — 받아도 거부될 것을 알리지 않는다 · 기기는 자동 까닭을 뺀다)
 */

import type { SessionContext } from '../auth/session-context.ts'
import { entitlement } from '../billing/entitlement.ts'
import { exportPolicyAllows } from '../export/download.ts'
import { listFavorites, listRecent } from '../nav/recent.ts'
import { AUTO_RECENT_LIMIT, NO_SOURCES, type AutoSources } from './offline-auto.ts'

export type AutoSourcesResult = { readonly ok: true; readonly value: AutoSources } | { readonly ok: false; readonly reason: 'plan_required' }

export async function offlineAutoSources(ctx: SessionContext): Promise<AutoSourcesResult> {
  if (!(await entitlement(ctx.workspaceId, 'offline.auto_download'))) return { ok: false, reason: 'plan_required' }
  if (!(await exportPolicyAllows(ctx))) return { ok: true, value: NO_SOURCES }
  const [favorites, recent] = await Promise.all([listFavorites(ctx), listRecent(ctx, AUTO_RECENT_LIMIT)])
  return { ok: true, value: { favorites: favorites.map((e) => e.id), recent: recent.map((e) => e.id) } }
}
