/**
 * ZIP 안의 상대 주소 → ZIP 안의 경로 — 잔여 묶음 8m-2b (F-09-12 · 순수)
 *
 * 정본: 09-api-integrations.md F-09-12 *"내보낸 ZIP 을 다시 가져오면 … 페이지 간 링크가 끊긴다"*(그것을 막는다) · §3.4 [보강] 가져오기 ⑨
 *
 * 본문의 `[제목](폴더/하위.md)` · `![](폴더/그림.png)` 는 **그 md 가 있는 폴더**에서 출발한다. 우리 내보내기(`export/names.ts`
 * `encodeHrefSegment` · `linkDestination`)와 노션 내보내기가 모두 퍼센트 인코딩(`%20` …)으로 쓴다.
 *
 *   · 스킴(`https:` · `mailto:` · `C:`) · 절대 경로(`/…`) · 앵커만(`#…`) 은 ZIP 안이 아니다 — null
 *   · `?…` · `#…` 꼬리는 뗀다(같은 페이지의 다른 자리 — 페이지는 같다)
 *   · 퍼센트 인코딩을 푼다 — 깨진 인코딩은 그대로 쓴다(그런 이름의 파일일 수 있다)
 *   · `.` · `..` 를 접는다 — 맨 위 밖으로 나가면 null(ZIP 밖이다). 역슬래시도 구분자다
 *   · 이름 맞추기(대소문자 · NFC)는 여기서 하지 않는다 — 찾는 쪽이 나무와 같은 열쇠(`collisionKey`)로 찾는다
 */

/** `from`(ZIP 안 파일의 경로)에서 본 `href` 의 ZIP 안 경로. ZIP 안을 가리키지 않으면 null. */
export function resolveZipHref(from: string, href: string): string | null {
  const raw = href.trim()
  if (raw === '' || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  const bare = raw.replace(/[?#][\s\S]*$/, '')
  let decoded: string
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    decoded = bare
  }
  const parts = from.split('/').slice(0, -1)
  for (const segment of decoded.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.length === 0 ? null : parts.join('/')
}
