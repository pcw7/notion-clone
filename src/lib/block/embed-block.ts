/**
 * 임베드 블록 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1])
 *
 * 저장은 북마크와 같다 — `properties.url`(http · https · 2,048자 이하) · `properties.caption`(RichText). iframe 주소 · 서비스 이름은 블록에 적지
 * 않는다 — 읽을 때 `embedSourceOf` 가 만든다. 순수 모듈이다.
 */

import { MAX_BOOKMARK_URL_LENGTH, isBookmarkUrl } from './bookmark-block.ts'
import { validateRichText } from '../contracts/rich-text.ts'

export const EMBED_TYPE = 'embed' as const

export const MAX_EMBED_URL_LENGTH = MAX_BOOKMARK_URL_LENGTH

/** 임베드로 받는 주소 — 북마크와 같은 계약(http · https · 상한 안). */
export const isEmbedUrl = isBookmarkUrl

/** `properties.url` — 받을 수 있는 주소가 아니면 null(빈 블록). */
export function readEmbedUrl(properties: unknown): string | null {
  const url = (properties as { url?: unknown } | null | undefined)?.url
  return isEmbedUrl(url) ? url : null
}

/** 주소를 쓴 properties — null 이면 주소를 지운다(빈 상태로 · 캡션은 남는다). 모르는 키는 그대로. */
export function withEmbedUrl(properties: Readonly<Record<string, unknown>> | null | undefined, url: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(properties ?? {}) }
  if (url === null) delete next.url
  else next.url = url
  return next
}

/** Y.Doc 계약의 검증 — 주소(있으면 받을 수 있는 것) · 캡션(RichText). */
export function validateEmbedProperties(properties: unknown, path: string): { path: string; message: string }[] {
  const raw = (properties as { url?: unknown; caption?: unknown } | null | undefined) ?? {}
  const issues: { path: string; message: string }[] = []
  if (raw.url !== undefined && raw.url !== null && !isEmbedUrl(raw.url)) {
    issues.push({ path: `${path}.url`, message: `http 또는 https 주소(${MAX_EMBED_URL_LENGTH}자 이하)여야 합니다` })
  }
  if (raw.caption !== undefined) issues.push(...validateRichText(raw.caption, `${path}.caption`))
  return issues
}
