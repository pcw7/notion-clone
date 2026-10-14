/**
 * 검색 필터 — 값 다듬기 (플랫폼 잔여 10a-1 · F-07-03 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강] 검색 필터
 *
 * 제목만 · 만든 사람 · 최종 편집자(10a-3a) · 최근 편집 기간 · 이 페이지 아래 · 팀스페이스(10a-3a). 틀린 값은 버린다(필터 없음 — 400 을 내지
 * 않는다 · 정렬과 같은 태도). 검색 명령과 덮개(10a-2)가 함께 쓴다 — DB · 서버 모듈을 가져오지 않는다.
 */

/** 최근 편집 기간 — 날수는 고정 표(질의에 그대로 들어간다 · 사용자 값이 아니다). */
export const SEARCH_EDITED_RANGES = ['day', 'week', 'month', 'year'] as const
export type SearchEditedRange = (typeof SEARCH_EDITED_RANGES)[number]
export const EDITED_RANGE_DAYS: Readonly<Record<SearchEditedRange, number>> = { day: 1, week: 7, month: 30, year: 365 }

/** 사람 필터의 "나" — 명령이 그 세션의 사람으로 바꾼다. */
export const SEARCH_ME = 'me'

export type SearchFilters = {
  /** 제목에서만 찾는다(검색어가 있을 때만 뜻이 있다). */
  readonly titleOnly: boolean
  /** 만든 사람 — `'me'` 또는 사람 id(소문자 uuid · 워크스페이스를 떠난 사람이어도 — 07 *"필터는 계속 동작"*). */
  readonly createdBy: string | null
  /** 최종 편집자(10a-3a · 07 MCP 의 `editor` 축) — `createdBy` 와 같은 모양. */
  readonly editedBy: string | null
  /** 최근 편집 기간. */
  readonly edited: SearchEditedRange | null
  /** 이 페이지 아래(그 페이지 자신은 빼고). */
  readonly within: string | null
  /** 팀스페이스(10a-3a) — 그 팀스페이스의 페이지만(루트 블록의 부모). 요금제 게이트는 명령이 묻는다. */
  readonly teamspace: string | null
}

export const NO_SEARCH_FILTERS: SearchFilters = {
  titleOnly: false,
  createdBy: null,
  editedBy: null,
  edited: null,
  within: null,
  teamspace: null,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** uuid 모양이면 소문자로, 아니면 null. */
function uuidOf(raw: unknown): string | null {
  return typeof raw === 'string' && UUID.test(raw) ? raw.toLowerCase() : null
}

/** 사람 필터 — `'me'` 또는 사람 id. */
function personOf(raw: unknown): string | null {
  return raw === SEARCH_ME ? SEARCH_ME : uuidOf(raw)
}

/** 받은 값 → 필터. 모르는 값 · 모양이 틀린 값은 그 필터가 없는 것으로. */
export function normalizeSearchFilters(raw: {
  readonly titleOnly?: unknown
  readonly createdBy?: unknown
  readonly editedBy?: unknown
  readonly edited?: unknown
  readonly within?: unknown
  readonly teamspace?: unknown
}): SearchFilters {
  const edited = typeof raw.edited === 'string' && (SEARCH_EDITED_RANGES as readonly string[]).includes(raw.edited) ? (raw.edited as SearchEditedRange) : null
  return {
    titleOnly: raw.titleOnly === true || raw.titleOnly === '1' || raw.titleOnly === 'true',
    createdBy: personOf(raw.createdBy),
    editedBy: personOf(raw.editedBy),
    edited,
    within: uuidOf(raw.within),
    teamspace: uuidOf(raw.teamspace),
  }
}

/**
 * 결과를 좁히는 필터가 있는가 — 검색어 없이도 찾을 수 있는가(정본 ③ — 07 *"match_all + filter"*). 제목만은 검색어가 있어야 뜻이 있으므로
 * 세지 않는다.
 */
export function narrowsWithoutQuery(filters: SearchFilters): boolean {
  return filters.createdBy !== null || filters.editedBy !== null || filters.edited !== null || filters.within !== null || filters.teamspace !== null
}

/** 걸린 필터의 수 — 0건일 때 "필터가 걸려 있다" 와 "필터 풀기" 를 세운다(10a-2). */
export function activeFilterCount(filters: SearchFilters): number {
  return [
    filters.titleOnly,
    filters.createdBy !== null,
    filters.editedBy !== null,
    filters.edited !== null,
    filters.within !== null,
    filters.teamspace !== null,
  ].filter(Boolean).length
}

/** 검색 라우트의 쿼리 — 걸린 필터만(라우트가 같은 다듬기를 다시 한다 · 10a-2). */
export function searchFilterParams(filters: SearchFilters): [string, string][] {
  const params: [string, string][] = []
  if (filters.titleOnly) params.push(['titleOnly', '1'])
  if (filters.createdBy !== null) params.push(['createdBy', filters.createdBy])
  if (filters.editedBy !== null) params.push(['editedBy', filters.editedBy])
  if (filters.edited !== null) params.push(['edited', filters.edited])
  if (filters.within !== null) params.push(['within', filters.within])
  if (filters.teamspace !== null) params.push(['teamspace', filters.teamspace])
  return params
}

/** 이 화면이 페이지 화면이면 그 페이지 id(`/w/{ws}/{page}`) — "이 페이지 안에서" 의 페이지. 아니면 null. */
export function pageIdInPath(pathname: string | null): string | null {
  const match = /^\/w\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(pathname ?? '')
  return match === null ? null : match[1]!.toLowerCase()
}
