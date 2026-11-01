/**
 * 페이지 커버 — 저장 모양 · 읽기 · 받기 · 내장 커버 (34번 트랙 PC-1 · F-02-06 · 순수 · DOM · DB 없음)
 *
 * 정본: 00-canonical-data-model.md §3.4 [보강 PC-1] 페이지 커버
 *
 * **자리는 페이지 행의 `block.format.page_cover` 다** — 아이콘(`format.page_icon`)과 같은 까닭이다: 제목과 달리 페이지의 **모습**이고,
 * 복제가 이미 `format` 을 통째로 사본에 옮긴다. 값은 셋 중 하나다:
 *
 *   { "type": "gallery", "gallery": "gradient_1" }   내장 커버 — 그라디언트 · 단색(그림은 이 파일의 표 `COVER_GALLERY` 가 안다)
 *   { "type": "external", "url": "https://…" }       외부 이미지 — 값 자체가 주소다(아이콘과 같은 규칙 · http · https · 2048자 · 공백 없음)
 *   { "type": "file", "file_id": "…uuid…" }          올린 이미지(PC-2) — 이 워크스페이스의 이미지 · 그 파일의 참조다(`file.ref_count` —
 *                                                    `icon-reference.ts` 의 장부를 아이콘과 함께 쓴다) · 주소는 파생값이다(FS2)
 *
 * ⚠ **본문(Y.Doc)은 커버를 싣지 않는다** — 아이콘과 같은 까닭(볼 수 없는 하위 페이지의 모습이 부모 본문을 타고 퍼진다). 본문의 `format`
 * 을 거르는 `normalizeFormat` · 하위 페이지 참조를 거르는 `sanitizeBlockAttrs` 가 이 키를 늘 버린다.
 */

import { isUuid } from '../ids.ts'
import { isSafeImageUrl } from './image.ts'

/** `block.format` 의 키. 본문(Y.Doc)의 `format` 에는 없다(머리말). */
export const PAGE_COVER_KEY = 'page_cover'

/** 외부 이미지 주소의 상한 — 아이콘과 같다(DB 의 CHECK(0123)과 같은 값). */
export const MAX_COVER_URL_LENGTH = 2048

export type GalleryCover = { readonly type: 'gallery'; readonly gallery: string }
export type ExternalCover = { readonly type: 'external'; readonly url: string }
export type FileCover = { readonly type: 'file'; readonly file_id: string }
export type PageCover = GalleryCover | ExternalCover | FileCover

export type GalleryEntry = {
  readonly id: string
  /** 고르개의 이름(스크린 리더 · 툴팁). */
  readonly label: string
  /** CSS `background` 값 — 단색이나 그라디언트. */
  readonly background: string
}

/**
 * 내장 커버 12종(02 클론 대안 *"미리 준비한 그라디언트/단색 커버 세트 8~12종"*) — 단색 넷 · 그라디언트 여덟. id 는 저장되는 값이라 바꾸지
 * 않는다(빼면 그 커버는 회색 판으로 그린다 — `coverBackground`).
 */
export const COVER_GALLERY: readonly GalleryEntry[] = [
  { id: 'solid_red', label: '빨강', background: '#e16259' },
  { id: 'solid_yellow', label: '노랑', background: '#dfab01' },
  { id: 'solid_blue', label: '파랑', background: '#0b6e99' },
  { id: 'solid_beige', label: '베이지', background: '#d9cbb1' },
  { id: 'gradient_1', label: '노을', background: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { id: 'gradient_2', label: '하늘', background: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
  { id: 'gradient_3', label: '바다', background: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
  { id: 'gradient_4', label: '라벤더', background: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' },
  { id: 'gradient_5', label: '저녁', background: 'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)' },
  { id: 'gradient_6', label: '숲', background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'gradient_7', label: '밤', background: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' },
  { id: 'gradient_8', label: '먹', background: 'linear-gradient(135deg, #434343 0%, #000000 100%)' },
]

/** 표에서 빠진 내장 커버 · 불러오지 못한 그림의 판. */
export const COVER_FALLBACK_BACKGROUND = '#e9e9e7'

/** 내장 커버 id 의 모양 — DB 의 CHECK(0123)과 같다. 지금 표에 있는지는 받을 때만 본다. */
const GALLERY_ID = /^[a-z0-9_]{1,40}$/

const isCoverUrl = (url: unknown): url is string => isSafeImageUrl(url) && url.length <= MAX_COVER_URL_LENGTH && !/\s/.test(url)

export function galleryEntry(id: string): GalleryEntry | null {
  return COVER_GALLERY.find((entry) => entry.id === id) ?? null
}

/**
 * 저장된 값을 읽는다 — **관대하게.** 모양이 아니면 없는 것(null)이다(커버 하나 때문에 페이지가 500 이 되면 안 된다 — 아이콘과 같은
 * 규칙). 내장 커버는 모양만 본다 — 표에서 빠진 id 도 커버다(회색 판으로 그린다).
 */
export function readPageCover(raw: unknown): PageCover | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as { type?: unknown; gallery?: unknown; url?: unknown; file_id?: unknown }
  if (r.type === 'gallery') return typeof r.gallery === 'string' && GALLERY_ID.test(r.gallery) ? { type: 'gallery', gallery: r.gallery } : null
  if (r.type === 'external') return isCoverUrl(r.url) ? { type: 'external', url: r.url } : null
  if (r.type === 'file') return typeof r.file_id === 'string' && isUuid(r.file_id) ? { type: 'file', file_id: r.file_id.toLowerCase() } : null
  return null
}

/** 페이지 행의 `format` 에서 커버를 읽는다. */
export function pageCoverOfFormat(format: unknown): PageCover | null {
  if (typeof format !== 'object' || format === null || Array.isArray(format)) return null
  return readPageCover((format as Record<string, unknown>)[PAGE_COVER_KEY])
}

/**
 * 받은 값을 검사한다 — 라우트와 명령이 같은 함수로. `null` 은 지우기다. 그 밖은 `undefined`(→ `invalid_cover`).
 *
 *   · `{ type: 'gallery', gallery }` — **지금 표에 있는** id
 *   · `{ type: 'external', url }` — 앞뒤 공백을 벗긴 http · https 의 절대 주소 · 공백 없음 · 2048자 이하
 *   · `{ type: 'file', file_id }` — uuid(소문자로). 이 워크스페이스의 이미지인지는 명령이 본다(PC-2)
 */
export function parsePageCoverInput(raw: unknown): PageCover | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as { type?: unknown; gallery?: unknown; url?: unknown; file_id?: unknown }
  if (r.type === 'gallery') {
    return typeof r.gallery === 'string' && galleryEntry(r.gallery) !== null ? { type: 'gallery', gallery: r.gallery } : undefined
  }
  if (r.type === 'external') {
    if (typeof r.url !== 'string') return undefined
    const url = r.url.trim()
    return isCoverUrl(url) ? { type: 'external', url } : undefined
  }
  if (r.type === 'file') {
    if (typeof r.file_id !== 'string') return undefined
    const fileId = r.file_id.trim()
    return isUuid(fileId) ? { type: 'file', file_id: fileId.toLowerCase() } : undefined
  }
  return undefined
}

/** 커버 하나를 가리키는 글자 — 같은가를 견주고 화면의 `data-page-cover` 에 싣는다(검사가 읽는다). */
export function pageCoverKey(cover: PageCover): string {
  switch (cover.type) {
    case 'gallery':
      return `gallery:${cover.gallery}`
    case 'external':
      return `external:${cover.url}`
    case 'file':
      return `file:${cover.file_id}`
  }
}

export function samePageCover(a: PageCover | null, b: PageCover | null): boolean {
  if (a === null || b === null) return a === b
  return pageCoverKey(a) === pageCoverKey(b)
}

/** 저장할 JSON — 정해진 키만(받은 객체의 다른 키를 옮기지 않는다). */
export function pageCoverJson(cover: PageCover): Record<string, unknown> {
  switch (cover.type) {
    case 'gallery':
      return { type: 'gallery', gallery: cover.gallery }
    case 'external':
      return { type: 'external', url: cover.url }
    case 'file':
      return { type: 'file', file_id: cover.file_id }
  }
}

/** 무작위 내장 커버 — "커버 추가"(노션의 Add cover). `except` 는 고르지 않는다(지금 커버). */
export function randomGalleryCover(except: string | null = null, random: () => number = Math.random): GalleryCover {
  const pool = COVER_GALLERY.filter((entry) => entry.id !== except)
  const entry = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? COVER_GALLERY[0]
  return { type: 'gallery', gallery: (entry as GalleryEntry).id }
}

/** 올린 이미지 커버의 파일 — 참조 장부가 센다(PC-2). 다른 종류는 null. */
export function coverFileId(cover: PageCover | null): string | null {
  return cover !== null && cover.type === 'file' ? cover.file_id : null
}

/** 내장 커버의 CSS `background` — 표에서 빠진 id 는 회색 판. */
export function coverBackground(cover: GalleryCover): string {
  return galleryEntry(cover.gallery)?.background ?? COVER_FALLBACK_BACKGROUND
}
