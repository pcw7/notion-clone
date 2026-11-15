/**
 * 설정 → 오프라인의 목록 — 이 기기에 내려받은 것 (OF-5 · F-12-04 · 정본 §3.7 [보강 OF-1] ⑥ · 순수)
 *
 * 화면(`settings/offline-panel.tsx`)이 IndexedDB 의 기록을 이 모양으로 바꿔 그린다 — 종류 · 크기(기록의 `bytes`) · 받은 때 · 까닭(직접 ·
 * 즐겨찾기 · 최근) · 찾기 · 지운 결과의 말. DOM 없이 검사한다(`offline-list.test.ts`).
 */

import type { PageIcon } from '../block/page-icon.ts'
import { isDatabaseRecord, OFFLINE_REASONS, type OfflineReason, type OfflineRecord } from './offline-store.ts'

export type OfflineListItem = {
  readonly pageId: string
  readonly workspaceId: string
  readonly kind: 'page' | 'database'
  /** 페이지의 제목 · 데이터베이스의 이름 — 비었으면 빈 글(화면이 "제목 없음"). */
  readonly title: string
  readonly icon: PageIcon | null
  readonly bytes: number
  readonly savedAt: number
  /** 정해진 차례(직접 · 즐겨찾기 · 최근)로 — 저장된 차례와 상관없이. 비었으면 못 보낸 편집 때문에 남은 사본이다. */
  readonly reasons: readonly OfflineReason[]
}

const REASON_LABEL: Readonly<Record<OfflineReason, string>> = { toggled: '직접', favorited: '즐겨찾기', recent: '최근' }

export function reasonLabel(reason: OfflineReason): string {
  return REASON_LABEL[reason]
}

export const UNTITLED = '제목 없음'

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** 기록 → 목록의 줄. 받은 때의 역순 · 같으면 제목 · id 의 차례. */
export function offlineListItems(records: readonly OfflineRecord[]): OfflineListItem[] {
  return records
    .map((record): OfflineListItem => {
      const database = isDatabaseRecord(record)
      return {
        pageId: record.pageId,
        workspaceId: record.workspaceId,
        kind: database ? 'database' : 'page',
        title: (database ? record.name : record.title) ?? '',
        icon: record.icon ?? null,
        bytes: count(record.bytes),
        savedAt: count(record.savedAt),
        reasons: OFFLINE_REASONS.filter((r) => record.reasons.includes(r)),
      }
    })
    .sort((a, b) => b.savedAt - a.savedAt || a.title.localeCompare(b.title, 'ko') || (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0))
}

const fold = (text: string): string => text.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim()

/** 찾기 — 제목에 낱말이 모두 들어 있는 줄(대소문자 · 공백을 가리지 않는다). 빈 찾기는 모두. 제목이 없으면 "제목 없음"으로 찾는다. */
export function filterOfflineItems(items: readonly OfflineListItem[], query: string): OfflineListItem[] {
  const words = fold(query).split(' ').filter((w) => w.length > 0)
  if (words.length === 0) return [...items]
  return items.filter((item) => {
    const title = fold(item.title || UNTITLED)
    return words.every((w) => title.includes(w))
  })
}

export function totalBytes(items: readonly OfflineListItem[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0)
}

/** 크기 — B · KB · MB(1024 단위 · 10 미만은 소수 한 자리). */
export function formatBytes(bytes: number): string {
  const n = count(bytes)
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB'] as const
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown = value < 10 ? Number(value.toFixed(1)) : Math.round(value)
  return `${shown} ${units[unit]}`
}

/** 받은 때 — 설정 · 껍데기의 목록과 같은 모양. */
export function savedAtLabel(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 지우기의 결과(`offline-sync.ts` `removeOfflineCopies`) — 못 보낸 편집이 있어 남긴 사본은 그렇다고 말한다(편집을 버리지 않는다). */
export type RemoveReport = { readonly removed: number; readonly kept: number }

export function removedMessage(report: RemoveReport): string {
  const parts: string[] = []
  if (report.removed > 0) parts.push(`${report.removed}개를 이 기기에서 지웠습니다.`)
  if (report.kept > 0) parts.push(`보내지 못한 편집이 있는 ${report.kept}개는 남겨 두었습니다 — 다시 연결되면 편집을 보낸 뒤 지웁니다.`)
  return parts.length === 0 ? '지울 것이 없습니다.' : parts.join(' ')
}

/** 자동 내려받기는 요금제가 정한다(정본 ⑥ — 노션과 같다). */
export const AUTO_PLAN_NOTE = '자동 내려받기는 Plus 요금제부터 쓸 수 있습니다.'
