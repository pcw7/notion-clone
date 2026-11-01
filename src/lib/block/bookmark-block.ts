/**
 * 북마크 블록 — F-01-15 P1 (32번 트랙 F-3 · 정본 §3.4 [보강 F-3])
 *
 * 저장은 **주소 하나와 캡션**이다 — `properties.url`(http · https · 2,048자 이하) · `properties.caption`(RichText). 카드의 제목 · 설명 · 그림은
 * 블록의 내용이 아니라 서버가 가져온 메타다(F-4 의 전역 캐시) — 이 모듈은 그것을 모른다. 메타가 없으면 주소가 제목이다(정본 ②).
 *
 * 순수 모듈이다 — 편집기 · 공개 화면 · 내보내기가 함께 읽는다.
 */

import { validateRichText } from '../contracts/rich-text.ts'

export const BOOKMARK_TYPE = 'bookmark' as const

/** 주소의 길이 상한 — 바깥 요청의 것과 같다(정본 §3.8 [보강] 페이지 웹훅 ② · F-4 가 그 주소로 메타를 가져온다). */
export const MAX_BOOKMARK_URL_LENGTH = 2048

/** 북마크로 받는 주소 — http · https 만 · 상한 안 · URL 로 읽힌다. */
export function isBookmarkUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_BOOKMARK_URL_LENGTH) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** `properties.url` — 받을 수 있는 주소가 아니면 null(빈 블록). */
export function readBookmarkUrl(properties: unknown): string | null {
  const url = (properties as { url?: unknown } | null | undefined)?.url
  return isBookmarkUrl(url) ? url : null
}

/** 주소를 쓴 properties — null 이면 주소를 지운다(빈 상태로 · 캡션은 남는다). 모르는 키는 그대로. */
export function withBookmarkUrl(properties: Readonly<Record<string, unknown>> | null | undefined, url: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(properties ?? {}) }
  if (url === null) delete next.url
  else next.url = url
  return next
}

/** 메타 캐시의 열쇠가 되는 주소(F-4 · 정본 §3.4 [보강 F-4] ①) — 북마크 주소가 아니면 null · 해시(`#…`)는 뗀다(같은 문서다). */
export function bookmarkCacheUrl(url: string): string | null {
  if (!isBookmarkUrl(url)) return null
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

/** 카드의 호스트 — `www.` 는 뗀다. 읽지 못하면 빈 글. */
export function bookmarkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 카드의 제목 — 메타의 제목(F-4)이 있으면 그것 · 없으면 주소 그대로(정본 ② · 01 *"OG 태그 없는 사이트 → URL 자체를 제목으로"*). */
export function bookmarkTitle(url: string, metaTitle?: string | null): string {
  const title = metaTitle?.trim() ?? ''
  return title !== '' ? title : url
}

/** Y.Doc 계약의 검증 — 주소(있으면 받을 수 있는 것) · 캡션(RichText). 주소는 화면의 `<a href>` 에 그대로 들어간다. */
export function validateBookmarkProperties(properties: unknown, path: string): { path: string; message: string }[] {
  const raw = (properties as { url?: unknown; caption?: unknown } | null | undefined) ?? {}
  const issues: { path: string; message: string }[] = []
  if (raw.url !== undefined && raw.url !== null && !isBookmarkUrl(raw.url)) {
    issues.push({ path: `${path}.url`, message: `http 또는 https 주소(${MAX_BOOKMARK_URL_LENGTH}자 이하)여야 합니다` })
  }
  if (raw.caption !== undefined) issues.push(...validateRichText(raw.caption, `${path}.caption`))
  return issues
}
