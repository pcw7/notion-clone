/**
 * 주소의 id 정규화 — §7 정리 10n-58 (F-07-17)
 *
 * 정본: 07-search-navigation.md F-07-17 *"id 가 하이픈 없는 32자 hex 로 URL 에 실리므로 라우터는 양쪽을 모두 받아 정규화해야 한다. 빼먹으면
 * API 가 뱉은 id 를 URL 에 붙였을 때 404."* · 해석 키는 늘 뒤쪽 32자리 hex 이고 앞의 제목 slug 는 장식이다. HANDOFF §3.2-295.
 *
 * 우리의 정본 주소는 **하이픈 있는 uuid** 다(화면 · API 가 뱉는 모양). 32자리 hex · `제목-32자리 hex` 로 들어온 `/w/` 주소는 `src/proxy.ts`
 * 가 이 함수로 정본 주소를 만들어 보낸다(308). `/w/` 아래의 동적 조각은 모두 uuid(워크스페이스 · 페이지 · 데이터베이스 · 템플릿 ·
 * teamspace)이고 정적 조각(`db` · `settings` …)은 32자리 hex 가 될 수 없다.
 */

/** 조각의 끝이 32자리 hex 다 — 혼자거나 `-` 뒤에(제목 slug). 하이픈 있는 uuid 는 끝이 12자리라 걸리지 않는다. */
const TRAILING_HEX32 = /^(?:.*-)?([0-9a-f]{32})$/i

/** 주소 조각 하나 — 32자리 hex 거나 `제목-32자리 hex` 면 그 id 의 하이픈 있는 uuid(소문자). 아니면 null(그대로 둔다). */
export function canonicalIdSegment(segment: string): string | null {
  const hex = TRAILING_HEX32.exec(segment)?.[1]?.toLowerCase()
  if (hex === undefined) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** `/w/…` 주소의 정본 — 조각마다 `canonicalIdSegment`. `/w/` 밖이거나 바꿀 조각이 없으면 null(옮기지 않는다). */
export function canonicalWorkspacePath(pathname: string): string | null {
  if (!pathname.startsWith('/w/')) return null
  let changed = false
  const segments = pathname.split('/').map((segment) => {
    const id = canonicalIdSegment(segment)
    if (id === null) return segment
    changed = true
    return id
  })
  return changed ? segments.join('/') : null
}
