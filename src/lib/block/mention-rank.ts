/**
 * `@` 후보의 차례 — 사람 (§7 정리 10n-71 · F-07-08 · 순수)
 *
 * 정본: 07-search-navigation.md F-07-08 *"최근 항목이 기본 노출"* · *"`@` 는 사람 우선"* · HANDOFF §3.2-304
 *
 * 사람 후보는 **그 글자로 시작하는 이름이 먼저**, 그다음 이름순(한국어 정렬)이다. 멤버 목록의 순서(들어온 순)로는 찾는 사람이 아래로
 * 밀린다. 사람은 몇 명까지만 앞에 세운다 — 빈 `@` 는 5명, 글자가 있으면 10명. 멤버가 스물을 넘는 워크스페이스에서 사람이 상한 20을
 * 다 채우면 페이지(최근 연 페이지)가 하나도 안 보인다. 나머지 자리는 페이지 후보가 채운다(`mention-candidates.ts`).
 *
 * 페이지 후보의 차례는 SQL 이 정한다(내가 최근 연 순서 — `recent_visit` · 같은 모듈).
 */

/** 빈 `@` 에 앞세울 사람 수. */
export const MENTION_PEOPLE_EMPTY = 5
/** 글자가 있을 때 앞세울 사람 수. */
export const MENTION_PEOPLE_QUERY = 10

/** 앞세울 사람 수 — 빈 쿼리면 적게(최근 페이지가 보이게). */
export function mentionPeopleCap(query: string): number {
  return query === '' ? MENTION_PEOPLE_EMPTY : MENTION_PEOPLE_QUERY
}

const collator = new Intl.Collator('ko', { sensitivity: 'base', numeric: true })

/**
 * 사람 후보 — 이름 · 이메일 부분 일치로 거르고, 이름이 그 글자로 시작하는 사람을 먼저, 그다음 이름순. `query` 는 다듬고 소문자로 바꾼 것.
 */
export function rankMentionPeople<T extends { readonly name: string; readonly email: string | null }>(people: readonly T[], query: string): T[] {
  const matches = people.filter((p) => query === '' || p.name.toLowerCase().includes(query) || (p.email ?? '').toLowerCase().includes(query))
  const starts = (p: T): boolean => query !== '' && p.name.toLowerCase().startsWith(query)
  return [...matches].sort((a, b) => Number(starts(b)) - Number(starts(a)) || collator.compare(a.name, b.name))
}
