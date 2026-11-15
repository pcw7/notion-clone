/**
 * 오프라인 내려받기의 서버 쪽 — 페이지 하나의 본문 상태를 기기로 넘긴다 (OF-2 · F-12-04 · 정본 §3.7 [보강 OF-1] ②)
 *
 * 받는 것은 그 페이지의 본문 상태(Y update) · 제목(평문) · 아이콘 · 커버 · 서버 판(`doc_update` 의 마지막 seq)뿐이다 — 하위 페이지는
 * 따라오지 않는다(노션과 같다). 마이그레이션이 없다 — 읽기 길 하나다.
 *
 *   - **권한은 본문 읽기와 같다** — `getPage`(볼 수 있는 살아 있는 페이지) 뒤에 `loadDocState`(같은 판정 · 아직 옮기지 않은 본문이면 옮긴다).
 *     없는 페이지 · 볼 수 없는 페이지 · 휴지통의 페이지는 가르지 않는다(`not_found`)
 *   - **내보내기 정책을 그대로 따른다** — 내용을 기기로 꺼내는 일이라 `allow_export` 를 끄면 소유자만(`exportPolicyAllows` — 내보내기와
 *     같은 함수). 페이지를 읽기 전에 막는다 — 정책은 워크스페이스의 것이라 페이지의 있고 없음을 알리지 않는다
 */

import * as Y from 'yjs'

import type { SessionContext } from '../auth/session-context.ts'
import { getPage } from '../block/page.ts'
import { loadDocState } from '../collab/doc-store.ts'
import { exportPolicyAllows } from '../export/download.ts'
import { asBlockId, isUuid } from '../ids.ts'
import type { OfflinePagePayload } from './offline-store.ts'

/**
 * 라우트의 답 — 모양은 기기의 저장소가 정한다(`OfflinePagePayload`). 제목은 평문(빈 제목이면 빈 문자열) · `seq` 는 이 상태에 반영된
 * 마지막 `doc_update` 의 seq(다시 붙을 때 — OF-3 — 서버 판과 견준다) · `state` 는 페이지 화면의 `initialState` 와 같은 base64 다.
 */
export type OfflinePageResult =
  | { readonly ok: true; readonly value: OfflinePagePayload }
  | { readonly ok: false; readonly reason: 'not_found' | 'policy_disabled' }

/** 이 사람이 이 워크스페이스에서 내려받을 수 있는가 — 화면은 스위치를 세울지 정하는 데만 쓴다(판정은 라우트가 다시 한다). */
export async function mayDownloadOffline(ctx: SessionContext): Promise<boolean> {
  return exportPolicyAllows(ctx)
}

export async function readOfflinePage(ctx: SessionContext, pageId: string): Promise<OfflinePageResult> {
  if (!(await mayDownloadOffline(ctx))) return { ok: false, reason: 'policy_disabled' }
  if (!isUuid(pageId)) return { ok: false, reason: 'not_found' }
  const page = await getPage(ctx, asBlockId(pageId))
  if (page === null) return { ok: false, reason: 'not_found' }
  const state = await loadDocState(ctx, page.id)
  // getPage 가 통과했으므로 여기서 실패하면 그 사이에 지워졌다
  if (!state.ok) return { ok: false, reason: 'not_found' }
  const bytes = Y.encodeStateAsUpdate(state.value.ydoc)
  state.value.ydoc.destroy()
  return {
    ok: true,
    value: {
      pageId: page.id,
      title: page.plainTitle,
      icon: page.icon,
      cover: page.cover,
      seq: state.value.seq,
      state: Buffer.from(bytes).toString('base64'),
    },
  }
}
