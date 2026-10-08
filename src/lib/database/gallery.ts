/**
 * 갤러리 레이아웃 — 카드 미리보기 · 크기 · 맞춤 (DB 심화 2f-2조각 · F-04-05 · DB 를 모르는 모듈)
 *
 * 정본: 00-canonical-data-model.md §3.6 [보강] 갤러리 ④ · 04-database-views.md F-04-05
 *
 * 04: *"`view.configuration = { cover: {type, property_id?}, cover_size, cover_aspect, card_layout, properties[] }`"* — 그중 우리에게 있는
 * 소스와 키만. 저장은 `view.configuration.gallery` 한 키다(04 의 동시편집 엣지 *"configuration 전체를 LWW 로 덮으면 상대 변경이
 * 사라지므로 JSON 전체 교체 금지"* — 다른 뷰 종류의 키와 섞이지 않게 한 칸 아래에 둔다). 그 안은 **세 키 모두** 늘 쓴다 — 읽는 쪽이
 * 빠진 키를 짐작하지 않게. 모양은 CHECK(`ck_view_gallery_layout` · 0057)이 막는다.
 *
 *   cover         'page_content' — 본문의 첫 이미지(최상위 블록 중 처음) · 'none' — 미리보기 없음
 *   cover_size    카드 폭 — small · medium · large
 *   cover_aspect  'cover' — 잘라서 채운다 · 'contain' — 전체를 보인다(여백)
 *
 * 노션의 새 갤러리는 미리보기가 "페이지 내용"이다 — 기본값도 그렇다. 페이지 커버(F-02-06) · 파일 속성이 생기면 `cover` 에 더한다.
 */

import type { ValidationIssue } from '../contracts/rich-text.ts'

export const GALLERY_COVERS = ['page_content', 'none'] as const
export const GALLERY_SIZES = ['small', 'medium', 'large'] as const
export const GALLERY_ASPECTS = ['cover', 'contain'] as const

export type GalleryCover = (typeof GALLERY_COVERS)[number]
export type GallerySize = (typeof GALLERY_SIZES)[number]
export type GalleryAspect = (typeof GALLERY_ASPECTS)[number]

export type GalleryLayout = {
  readonly cover: GalleryCover
  readonly cover_size: GallerySize
  readonly cover_aspect: GalleryAspect
}

export const DEFAULT_GALLERY_LAYOUT: GalleryLayout = { cover: 'page_content', cover_size: 'medium', cover_aspect: 'cover' }

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/** 저장된 `configuration` 에서 갤러리 레이아웃을 읽는다 — 없거나 모르는 값이면 기본값(읽기 경로는 너그럽다). */
export function readGalleryLayout(configuration: unknown): GalleryLayout {
  const g = (configuration as { gallery?: unknown } | null | undefined)?.gallery as Record<string, unknown> | undefined
  if (typeof g !== 'object' || g === null) return DEFAULT_GALLERY_LAYOUT
  return {
    cover: isOneOf(GALLERY_COVERS, g.cover) ? g.cover : DEFAULT_GALLERY_LAYOUT.cover,
    cover_size: isOneOf(GALLERY_SIZES, g.cover_size) ? g.cover_size : DEFAULT_GALLERY_LAYOUT.cover_size,
    cover_aspect: isOneOf(GALLERY_ASPECTS, g.cover_aspect) ? g.cover_aspect : DEFAULT_GALLERY_LAYOUT.cover_aspect,
  }
}

/** 바꾸려는 키만 보낸다(부분) — 모르는 키 · 모르는 값은 거부한다. 빈 객체도 거부한다(바꿀 것이 없다). */
export function validateGalleryPatch(raw: unknown): ValidationIssue[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [{ path: 'gallery', message: '객체여야 합니다' }]
  const g = raw as Record<string, unknown>
  const keys = Object.keys(g)
  if (keys.length === 0) return [{ path: 'gallery', message: '바꿀 것이 없습니다' }]
  const issues: ValidationIssue[] = []
  for (const key of keys) {
    if (key === 'cover') {
      if (!isOneOf(GALLERY_COVERS, g.cover)) issues.push({ path: 'gallery.cover', message: `${GALLERY_COVERS.join(' · ')} 중 하나여야 합니다` })
    } else if (key === 'cover_size') {
      if (!isOneOf(GALLERY_SIZES, g.cover_size)) issues.push({ path: 'gallery.cover_size', message: `${GALLERY_SIZES.join(' · ')} 중 하나여야 합니다` })
    } else if (key === 'cover_aspect') {
      if (!isOneOf(GALLERY_ASPECTS, g.cover_aspect)) issues.push({ path: 'gallery.cover_aspect', message: `${GALLERY_ASPECTS.join(' · ')} 중 하나여야 합니다` })
    } else {
      issues.push({ path: `gallery.${key}`, message: '모르는 키입니다' })
    }
  }
  return issues
}

/** 지금 레이아웃 위에 바꾸려는 키만 얹는다. `validateGalleryPatch` 를 지난 값만. */
export function mergeGalleryLayout(current: GalleryLayout, patch: Partial<GalleryLayout>): GalleryLayout {
  return {
    cover: patch.cover ?? current.cover,
    cover_size: patch.cover_size ?? current.cover_size,
    cover_aspect: patch.cover_aspect ?? current.cover_aspect,
  }
}
