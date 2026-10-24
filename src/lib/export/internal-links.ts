/**
 * 본문 글자에 건 앱 링크를 ZIP 안의 상대 경로로 — §7 정리 10n-66 (F-09-14 *"내부 링크는 상대 경로로 재작성"*)
 *
 * 정본: 09-api-integrations.md F-09-14 · HANDOFF §3.2-299
 *
 * 하위 페이지 참조 블록은 #61 부터 상대 링크였다. 글자에 건 링크 마크가 이 앱의 주소(`/w/{ws}/{id}` · 블록 링크 `…#{blockId}` ·
 * `/w/{ws}/db/{id}`)면 풀린 ZIP 에서 열리지 않았다. 여기 두 함수는 DB 를 모른다 — 주소에서 노드 id 를 뽑고(`internalTargetOf`), 두 ZIP 경로
 * 사이의 상대 링크를 만든다(`relativeHref`). 어느 노드가 ZIP 의 어디에 있는지는 계획(`plan.ts`)이 안다.
 */

import { isUuid } from '../ids.ts'
import { canonicalIdSegment } from '../nav/id-url.ts'
import { encodeHrefSegment } from './names.ts'

/**
 * 이 앱의 주소가 가리키는 페이지 · 데이터베이스의 id — `/w/{ws}/{id}` · `/w/{ws}/db/{id}`(쿼리 · 해시는 본다 · 32자리 hex · `제목-hex` 도 ·
 * 10n-58). 상대 주소도 절대 주소도 받는다(호스트는 보지 않는다 — 그 id 가 이 내보내기에 있을 때만 바꾸므로 다른 사이트의 같은 모양 주소는
 * 바뀌지 않는다). 아니면 null.
 */
export function internalTargetOf(url: string): string | null {
  let pathname: string
  try {
    pathname = new URL(url, 'http://local.invalid').pathname
  } catch {
    return null
  }
  const match = /^\/w\/[^/]+\/(?:db\/)?([^/]+)\/?$/.exec(pathname)
  if (match === null) return null
  let segment: string
  try {
    segment = decodeURIComponent(match[1]!)
  } catch {
    return null
  }
  if (isUuid(segment)) return segment.toLowerCase()
  return canonicalIdSegment(segment)
}

/**
 * ZIP 안의 두 자리 사이의 상대 링크 — `fromDir`(링크를 담은 파일이 있는 폴더 · 루트는 '')에서 `target`(파일의 ZIP 경로)으로. 조각마다
 * `encodeHrefSegment`(하위 페이지 참조의 링크와 같은 인코딩).
 */
export function relativeHref(fromDir: string, target: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/')
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1
  const ups = from.length - common
  return [...Array<string>(ups).fill('..'), ...to.slice(common).map(encodeHrefSegment)].join('/')
}
