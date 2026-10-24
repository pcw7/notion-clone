/**
 * 사이드바 섹션의 표시 개수 — §7 정리 10n-68 (F-07-16 · F-07-04 *"표시 개수는 사용자 설정값"*)
 *
 * 정본: 07-search-navigation.md F-07-04 · F-07-16 · HANDOFF §3.2-301
 *
 * 즐겨찾기 · 최근 섹션 머리의 "···" 에서 5 · 10 · 20 · 모두를 고른다. **기기별**이다(사이드바의 펼침 상태와 같은 `localStorage` —
 * 정본에 `sidebar_section_pref` 표가 없다 · 07 미해결 20 *"서버 vs 디바이스"*). 고르지 않았으면 지금 그대로다 — 즐겨찾기는 모두 · 최근은 7.
 * 최근은 서버가 `RECENT_FETCH_LIMIT` 까지 보내고 화면이 자른다("모두" 는 그만큼).
 */

export type NavSectionKey = 'favorites' | 'recent'

/** 고를 수 있는 개수 — null 은 모두. */
export const SECTION_COUNT_OPTIONS: readonly (number | null)[] = [5, 10, 20, null]

/** 고르지 않았을 때 — 이 조각 전의 그리기 그대로. */
export const DEFAULT_SECTION_COUNT: Readonly<Record<NavSectionKey, number | null>> = { favorites: null, recent: 7 }

/** 최근을 서버가 보내는 개수 — 고를 수 있는 가장 큰 수. 최근의 "모두" 는 이만큼이다. */
export const RECENT_FETCH_LIMIT = 20

export type SectionCounts = Readonly<Partial<Record<NavSectionKey, number | null>>>

const KEYS: readonly NavSectionKey[] = ['favorites', 'recent']

/** 저장된 값을 읽는다 — 아는 섹션 · 고를 수 있는 개수만(망가진 값은 고르지 않은 것으로). */
export function readSectionCounts(raw: unknown): SectionCounts {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Partial<Record<NavSectionKey, number | null>> = {}
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (value === null || (typeof value === 'number' && SECTION_COUNT_OPTIONS.includes(value))) out[key] = value
  }
  return out
}

/** 그 섹션의 개수 — 고른 것 · 없으면 기본. null 은 모두. */
export function sectionCount(counts: SectionCounts, key: NavSectionKey): number | null {
  const chosen = counts[key]
  return chosen === undefined ? DEFAULT_SECTION_COUNT[key] : chosen
}

/** 그릴 줄 수 — 모두면 전부 · 아니면 그 수까지. */
export function visibleRowCount(total: number, count: number | null): number {
  return count === null ? total : Math.min(total, count)
}

/** 고르개의 말. */
export function sectionCountLabel(count: number | null): string {
  return count === null ? '모두' : `${count}개`
}
