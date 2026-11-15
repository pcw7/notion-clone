/**
 * 자동 내려받기 — 즐겨찾기 · 최근 10개를 이 기기에 둔다 (OF-5 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑥ · 순수)
 *
 * 다시 붙는 일(④ · `offline-sync.ts`)이 한 번 돌 때마다 맞춘다. 여기는 **정하기만** 한다 — DOM · 네트워크 없이 검사한다
 * (`offline-auto.test.ts`). 서버(`offline-auto-sources.ts`)도 상한을 여기서 읽는다.
 *
 *   - **원천은 이 워크스페이스의 즐겨찾기 · 최근**(`GET …/offline/auto` — 사이드바와 같은 목록 · 볼 수 있는 페이지만 · 요금제
 *     `offline.auto_download`). 원천에 있고 사본이 없으면 받는다(그 까닭으로) · 사본이 있으면 까닭을 더한다 · 이 워크스페이스의 사본인데
 *     원천에 없으면 그 까닭을 뺀다. 다른 워크스페이스의 사본은 그곳을 열 때 맞춘다(원천이 워크스페이스마다다)
 *   - **끈 스위치는 그 까닭을 모든 곳에서 뺀다**(워크스페이스를 가리지 않는다)
 *   - 원천을 받지 못했으면(끊김 · 로그인) 켠 까닭은 손대지 않는다 — 다음에 다시
 *   - **까닭이 비면 지운다 — 못 보낸 편집이 있으면 빈 채로 남긴다**(`withReasonChange`). 이미 빈 사본도 계획에 든다 — 다음 돌기가 보낸 뒤
 *     여기서 지운다(정본 ⑥ "보낸 뒤에")
 */

import type { AutoDownloadSettings, OfflineReason, OfflineRecord, ReasonChange } from './offline-store.ts'

/** 최근 페이지를 몇 개까지 — 노션과 같다. */
export const AUTO_RECENT_LIMIT = 10

/** 서버의 답 — 이 워크스페이스의 즐겨찾기 · 최근(페이지 id · 화면의 차례). */
export type AutoSources = { readonly favorites: readonly string[]; readonly recent: readonly string[] }

/** 요금제가 막았거나 워크스페이스에 들어올 수 없다 — 원하는 것이 없다(자동 까닭을 뺀다). */
export const NO_SOURCES: AutoSources = { favorites: [], recent: [] }

const ids = (value: unknown): string[] | null => (Array.isArray(value) && value.every((v) => typeof v === 'string') ? [...value] : null)

/** 서버의 답을 읽는다 — 모양이 아니면 null(받지 못한 것으로 — 손대지 않는다). 최근은 상한까지. */
export function parseAutoSources(raw: unknown): AutoSources | null {
  if (typeof raw !== 'object' || raw === null) return null
  const favorites = ids((raw as { favorites?: unknown }).favorites)
  const recent = ids((raw as { recent?: unknown }).recent)
  return favorites === null || recent === null ? null : { favorites, recent: recent.slice(0, AUTO_RECENT_LIMIT) }
}

/** 스위치 ⇔ 까닭 ⇔ 원천의 목록. */
const AUTO = [
  { reason: 'favorited', on: (s: AutoDownloadSettings) => s.favorites, ids: (src: AutoSources) => src.favorites },
  { reason: 'recent', on: (s: AutoDownloadSettings) => s.recent, ids: (src: AutoSources) => src.recent.slice(0, AUTO_RECENT_LIMIT) },
] as const satisfies readonly { readonly reason: OfflineReason; readonly on: unknown; readonly ids: unknown }[]

export type AutoChange = { readonly pageId: string } & ReasonChange

export type AutoPlan = {
  /** 사본마다 더하고 뺄 까닭 — 바뀌는 것 · 이미 빈 것만. 비면 지우는 것은 저장소가 못 보낸 편집을 보고 정한다. */
  readonly changes: readonly AutoChange[]
  /** 사본이 없어 받을 것 — 붙일 까닭과 함께(즐겨찾기 · 최근의 차례로). */
  readonly downloads: readonly { readonly pageId: string; readonly reasons: readonly OfflineReason[] }[]
}

/** 머리말의 규칙 — 이 사람의 사본 · 스위치 · 이 워크스페이스의 원천(받지 못했으면 null). */
export function planAutoDownload(input: {
  readonly records: readonly Pick<OfflineRecord, 'pageId' | 'workspaceId' | 'reasons'>[]
  readonly settings: AutoDownloadSettings
  readonly workspaceId: string | null
  readonly sources: AutoSources | null
}): AutoPlan {
  const { records, settings, workspaceId, sources } = input
  const wanted = AUTO.map((a) => ({
    reason: a.reason,
    on: a.on(settings),
    ids: a.on(settings) && sources !== null && workspaceId !== null ? new Set(a.ids(sources)) : null,
  }))

  const changes: AutoChange[] = []
  for (const record of records) {
    const add: OfflineReason[] = []
    const drop: OfflineReason[] = []
    for (const w of wanted) {
      const has = record.reasons.includes(w.reason)
      if (!w.on) {
        if (has) drop.push(w.reason)
        continue
      }
      if (w.ids === null || record.workspaceId !== workspaceId) continue
      if (w.ids.has(record.pageId)) {
        if (!has) add.push(w.reason)
      } else if (has) drop.push(w.reason)
    }
    if (add.length > 0 || drop.length > 0 || record.reasons.length === 0) changes.push({ pageId: record.pageId, add, drop })
  }

  const have = new Set(records.map((r) => r.pageId))
  const downloads = new Map<string, OfflineReason[]>()
  for (const w of wanted) {
    if (w.ids === null) continue
    for (const id of w.ids) {
      if (have.has(id)) continue
      downloads.set(id, [...(downloads.get(id) ?? []), w.reason])
    }
  }
  return { changes, downloads: [...downloads].map(([pageId, reasons]) => ({ pageId, reasons })) }
}

/** 켠 스위치가 있는가 — 사본이 없어도 다시 맞추기를 돌릴 까닭이다. */
export function anyAutoOn(settings: AutoDownloadSettings): boolean {
  return settings.favorites || settings.recent
}

/**
 * 지금 연 워크스페이스 — 앱 주소(`/w/{id}/…`)에서 읽는다. 레이아웃의 알림(`offline-resync.tsx`)은 그것을 넘기지 않는다 — 모든 화면의 첫 JS 에
 * 있는 컴포넌트라 바이트를 늘리지 않으려고(페이지 화면 443.7KB). 앱 주소가 아니면 없다.
 */
export function workspaceFromPath(pathname: string): string | undefined {
  const match = /^\/w\/([^/?#]+)/.exec(pathname)
  return match === null ? undefined : decodeURIComponent(match[1]!)
}
