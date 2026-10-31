/**
 * 파일 응답의 머리 — 같은 출처에서는 이미지만 그대로 열고 그 밖은 내려받기 (F-1a · 정본 §3.4 [보강 F-1] ③)
 *
 * 별도 도메인이 없으니 HTML · SVG 가 이 출처에서 **렌더되는 길을 아예 두지 않는다**: 저장된 MIME 이 받는 이미지 4종(매직 바이트로 가린 것)이면
 * 지금처럼 `inline`, 아니면 `application/octet-stream` + `attachment`. `nosniff` 는 늘 함께다. 앱의 파일 경로와 공개 파일 경로가 같은 함수를 쓴다.
 *
 * 순수 모듈이다 — 테스트가 머리만 본다.
 */

import { isAllowedMime, OCTET_STREAM } from './limits.ts'

export { OCTET_STREAM }

/** 같은 출처에서 그대로 열어도 되는 MIME — 받는 이미지 4종만. */
export function servesInline(mime: string): boolean {
  return isAllowedMime(mime)
}

/**
 * `Content-Disposition: attachment` — RFC 6266 · 5987. `filename*=UTF-8''…`(percent-encoding) 과 ASCII 폴백 `filename="…"` 을 함께 둔다.
 * 이름이 없으면 `file`. 따옴표 · 줄바꿈 · 제어 문자는 폴백에서 뺀다.
 */
export function attachmentDisposition(name: string | null | undefined): string {
  const raw = (name ?? '').trim()
  const safe = raw !== '' ? raw : 'file'
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

/** 파일 응답의 머리 셋 — content-type · content-disposition · nosniff. `content-length` · 캐시는 부르는 쪽이 더한다. */
export function fileResponseHeaders(file: { readonly mime: string; readonly originalName: string | null }): Record<string, string> {
  if (servesInline(file.mime)) {
    return { 'content-type': file.mime, 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' }
  }
  return { 'content-type': OCTET_STREAM, 'content-disposition': attachmentDisposition(file.originalName), 'x-content-type-options': 'nosniff' }
}
