/**
 * 북마크 카드의 메타를 주소로 읽고 기억한다 — 편집기 노드 뷰(F-4b · 정본 §3.4 [보강 F-4] ⑤)
 *
 * 블록에는 주소만 있다([보강 F-3] ①). 노드 뷰는 그릴 때마다 묻지 않고 한 번 읽은 답을 주소(해시를 뗀 것)로 기억한다 — 서버의 전역 캐시가
 * 7일을 살리므로 화면이 한 번 읽은 것을 그 편집기가 사는 동안 쓰는 것으로 충분하다. 못 읽은 것(429 · 연결)은 기억하지 않는다. 같은 주소의
 * 동시 요청은 하나를 나눈다(`file-meta.ts` 와 같은 꼴).
 *
 * 순수 모듈이다 — 읽는 함수를 밖에서 받는다(화면은 `GET /link-preview?url=` · 검사는 가짜).
 */

import { bookmarkCacheUrl } from '../block/bookmark-block.ts'

export type BookmarkMeta = {
  readonly status: 'ok' | 'failed' | 'skipped'
  readonly title: string | null
  readonly description: string | null
  readonly imageUrl: string | null
  readonly siteName: string | null
}

export type BookmarkMetaSource = {
  readonly get: (url: string) => Promise<BookmarkMeta | null>
  readonly peek: (url: string) => BookmarkMeta | null
}

export function bookmarkMetaSource(load: (url: string) => Promise<BookmarkMeta | null>): BookmarkMetaSource {
  const known = new Map<string, BookmarkMeta>()
  const pending = new Map<string, Promise<BookmarkMeta | null>>()
  return {
    peek: (url) => {
      const key = bookmarkCacheUrl(url)
      return key === null ? null : (known.get(key) ?? null)
    },
    get: (url) => {
      const key = bookmarkCacheUrl(url)
      if (key === null) return Promise.resolve(null)
      const have = known.get(key)
      if (have !== undefined) return Promise.resolve(have)
      const inflight = pending.get(key)
      if (inflight !== undefined) return inflight
      const request = load(key)
        .then((meta) => {
          if (meta !== null) known.set(key, meta)
          return meta
        })
        .catch(() => null)
        .finally(() => {
          pending.delete(key)
        })
      pending.set(key, request)
      return request
    },
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

/** `GET /link-preview` 의 답을 메타로 — 모양이 틀리면 null. 그림 주소는 http(s) 만 다시 확인한다(화면의 `<img src>` 에 들어간다). */
export function bookmarkMetaOfResponse(payload: unknown): BookmarkMeta | null {
  const preview = (payload as { preview?: unknown } | null | undefined)?.preview
  if (typeof preview !== 'object' || preview === null) return null
  const p = preview as Record<string, unknown>
  if (p.status !== 'ok' && p.status !== 'failed' && p.status !== 'skipped') return null
  const image = textOrNull(p.imageUrl)
  return {
    status: p.status,
    title: textOrNull(p.title),
    description: textOrNull(p.description),
    imageUrl: image !== null && /^https?:\/\//i.test(image) ? image : null,
    siteName: textOrNull(p.siteName),
  }
}
