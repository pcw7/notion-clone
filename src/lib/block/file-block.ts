/**
 * 파일 블록 — F-01-15 P1 (32번 트랙 F-1a · 정본 §3.4 [보강 F-1])
 *
 * 저장 모양은 **이미지와 같다** — `properties.source` 는 `{type:'file', file_id}` 또는 `{type:'external', url}`(http/https) ·
 * `properties.caption`. 그래서 읽기 · 검증은 이미지의 함수를 그대로 쓴다(두 벌을 두면 어긋난다). 이름 · 크기 · MIME 은 블록에 적지
 * 않는다 — `file` 행의 것이고 화면 · 공개 · 내보내기가 읽을 때 합친다(정본 ①).
 *
 * 순수 모듈이다 — 편집기(클라이언트) · 공개 화면 · 내보내기가 함께 읽는다.
 */

import { readImageSource, validateImageProperties, type ImageSource } from './image.ts'

export const FILE_TYPE = 'file' as const

/** 파일의 출처 — 이미지와 같은 모양(정본 [보강 F-1] ①). */
export type FileSource = ImageSource

/** `properties.source` 를 읽는다 — 모양이 틀리면 null(빈 블록). */
export const readFileSource: (properties: unknown) => FileSource | null = readImageSource

/** Y.Doc 계약의 검증 — source · caption(이미지와 같은 검사 · 정본 ⑦). */
export function validateFileProperties(properties: unknown, path: string): { path: string; message: string }[] {
  return validateImageProperties(properties, path)
}

/** 이름이 없을 때의 말. */
export const UNTITLED_FILE = '파일'

/** 바깥 주소의 이름 — 마지막 경로 조각(디코드) · 없으면 호스트 · 그것도 없으면 "파일". */
export function externalFileName(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter((part) => part !== '').at(-1) ?? ''
    let decoded = last
    try {
      decoded = decodeURIComponent(last)
    } catch {
      decoded = last
    }
    const name = decoded.trim()
    return name !== '' ? name : parsed.hostname || UNTITLED_FILE
  } catch {
    return UNTITLED_FILE
  }
}

/** 화면 · 공개 · 내보내기가 보이는 이름 — 올린 파일은 원본 이름(없으면 "파일") · 바깥 주소는 주소의 이름. */
export function fileDisplayName(source: FileSource | null, originalName: string | null | undefined): string {
  if (source?.kind === 'external') return externalFileName(source.url)
  const name = originalName?.trim() ?? ''
  return name !== '' ? name : UNTITLED_FILE
}

/** 크기 글자 — `512 B` · `1.5 KB` · `2.0 MB` · `1.2 GB`. 음수 · 수가 아닌 것은 빈 글. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.floor(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * 내보내기 ZIP 안의 확장자 — 원본 이름의 확장자(영숫자 1~10자 · 소문자) · 없으면 `bin`(정본 ⑥). 저장소의 키가 아니라 받는 사람이
 * 제 파일을 돌려받는 이름이다. 이미지는 MIME 의 확장자를 쓴다 — 부르는 쪽이 가른다.
 */
export function attachmentExtensionOf(originalName: string | null | undefined): string {
  const name = originalName?.trim() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'bin'
  const ext = name.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin'
}
