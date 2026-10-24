/**
 * 최근 목록에 이 탭의 방문을 덧댄다 — 지금 연 페이지가 곧바로 맨 앞에 (§7 정리 10n-72 · F-07-16 · 순수)
 *
 * 정본: 07-search-navigation.md F-07-16 *"Recents — 최근 방문"* · HANDOFF §3.2-305
 *
 * 사이드바의 최근은 레이아웃이 서버에서 읽는다. 레이아웃과 페이지는 **나란히** 그려지고(§3.3-146 — 처음 연 페이지의 방문이 아직 없다)
 * 앱 안에서 다른 페이지로 옮겨 가도 레이아웃은 다시 그려지지 않는다 — 최근 목록이 새로 읽을 때까지 낡는다. 노션은 지금 페이지가 최근에
 * 곧바로 보인다.
 *
 * 그래서 화면이 이 탭에서 연 차례(새 것이 앞)를 기억해 서버의 목록 위에 덧댄다 — 연 페이지를 맨 앞으로 옮기고, 목록에 없으면
 * 사이드바가 이미 아는 줄(트리 · 즐겨찾기 · 최근 — 모두 서버가 권한으로 거른 것)에서 제목 · 아이콘을 빌려 넣는다. 사이드바가 모르는
 * 페이지(데이터베이스의 행 등)는 넣지 않는다 — 다음에 서버가 읽을 때 선다. 서버의 기록(`recordVisit`)은 그대로 정본이다.
 */

/** 기억할 방문 수 — 최근 목록이 보일 수 있는 수보다 넉넉히. */
export const VISIT_MEMORY = 50

/** 방문을 하나 더한다 — 새 것이 앞 · 같은 페이지는 한 번만. 바뀐 것이 없으면 같은 배열을 돌려준다(스토어가 알림을 아낀다). */
export function pushVisit(visits: readonly string[], id: string, cap = VISIT_MEMORY): readonly string[] {
  if (visits[0] === id) return visits
  return [id, ...visits.filter((v) => v !== id)].slice(0, cap)
}

/**
 * 서버의 최근 위에 이 탭의 방문을 덧댄다 — 방문한 차례(새 것이 맨 앞)로 앞에 세우고, 서버 목록에 없으면 `find` 가 아는 줄을 넣는다.
 * 모르는 것은 건너뛴다. 길이는 `limit` 까지.
 */
export function overlayVisits<T extends { readonly id: string }>(
  server: readonly T[],
  visits: readonly string[],
  find: (id: string) => T | null,
  limit: number,
): T[] {
  if (visits.length === 0) return server.slice(0, limit)
  const front: T[] = []
  const taken = new Set<string>()
  for (const id of visits) {
    if (taken.has(id)) continue
    const row = server.find((r) => r.id === id) ?? find(id)
    if (row === null || row === undefined) continue
    front.push(row)
    taken.add(id)
  }
  return [...front, ...server.filter((r) => !taken.has(r.id))].slice(0, limit)
}
