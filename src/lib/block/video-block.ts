/**
 * 비디오 블록 — F-01-15 P1 (32번 트랙 F-2 · 정본 §3.4 [보강 F-2])
 *
 * 저장 모양은 **이미지 · 파일과 같다** — `properties.source`(`{type:'file', file_id}` · `{type:'external', url}` http/https) · `caption`. 폭 · 정렬은
 * 이미지의 `format.block_width` · `block_align` 을 그대로 쓴다([보강 10n-63] — `readImageLayout` · `withImageLayout`). 대체 텍스트는 없다.
 *
 * 순수 모듈이다 — 편집기 · 공개 화면 · 내보내기가 함께 읽는다.
 */

import { isSafeImageUrl, readImageSource, validateImageProperties, type ImageSource } from './image.ts'

export const VIDEO_TYPE = 'video' as const

/** 비디오의 출처 — 이미지 · 파일과 같은 모양. */
export type VideoSource = ImageSource

export const readVideoSource: (properties: unknown) => VideoSource | null = readImageSource

/** 바깥 주소로 받는 것 — http · https 만(이미지와 같은 검사). 직접 파일 주소여야 그려진다(임베드는 P2). */
export const isSafeVideoUrl: (value: unknown) => value is string = isSafeImageUrl

/** Y.Doc 계약의 검증 — source · caption(이미지와 같은 검사). 폭 · 정렬은 `validateImageFormat` 이 본다. */
export function validateVideoProperties(properties: unknown, path: string): { path: string; message: string }[] {
  return validateImageProperties(properties, path)
}
