/**
 * 페이지 아이콘의 표시 — 사이드바 · 목록 · 머리가 함께 쓴다 (잔여 묶음 8c-1 · 8c-4 · F-02-05)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 훅이 없어 서버 화면(목록)과 클라이언트 화면(사이드바)이 그대로 함께 쓴다. 이미지 아이콘(8c-4)만
 * 클라이언트 부품(`page-icon-image.tsx`)으로 넘긴다 — 주소에 워크스페이스가 필요하고 불러오기 실패를 알아야 한다.
 *
 * 아이콘은 이름 앞의 장식이다 — 읽는 이에게는 숨긴다(`aria-hidden`, 이름이 링크의 이름이다). 없을 때의 표시는 둘 중 하나다
 * (teamspace 의 `teamspaceIcon()` 처럼 한 곳에서 — 이 파일과 같은 모양을 DOM 으로 그리는 `editor/page-icon-dom.ts`):
 *   · `fallback` — **페이지로 가는 줄**(사이드바 · 페이지 목록 · 검색 결과 · 인박스 · 휴지통 · 옮기기 후보 · 본문의 하위 페이지 블록 ·
 *     멘션 칩): 회색 문서 글리프(F-02-05 *"아이콘 미지정 시 기본 문서 아이콘"* · `PAGE_GLYPH`). **글자가 아니라 그림(SVG)이다** —
 *     줄의 글자(`textContent`)에 섞이지 않아, 이름을 글자로 읽는 곳(검사 · 복사)이 아이콘이 없는 페이지에서 그대로다. 데이터베이스의
 *     줄(사이드바 · teamspace 화면)은 같은 규칙의 표 글리프다(`glyph` · `DATABASE_GLYPH` · 8c-3b — 전에는 글자 `▦` 였다)
 *   · 아니면 아무것도 그리지 않는다 — **글자 속의 경로**(머리의 경로 · 경로 블록 · 검색 결과의 조상 줄)
 * 이미지 아이콘을 불러오지 못하면 같은 규칙으로 바꾼다 — 깨진 그림을 그리지 않는다.
 */

import { PAGE_GLYPH, type IconGlyph, type PageIcon } from '@/lib/block/page-icon'
import { PageIconImage } from './page-icon-image'

export function PageIconView({
  icon,
  fallback = false,
  glyph = PAGE_GLYPH,
  className = '',
}: {
  /**
   * 없으면 null. `undefined` 도 없는 것으로 다룬다 — 서버 JSON 의 한 응답이 이 칸을 빠뜨려도(8c-3a 의 템플릿 POST 가 그랬다) 목록
   * 전체가 던지지 않게.
   */
  icon: PageIcon | null | undefined
  /** 없을 때 기본 문서 글리프를 세운다 — 줄의 자리를 맞추는 곳(사이드바). */
  fallback?: boolean
  /** 기본 글리프 — 데이터베이스의 줄은 표 글리프(`DATABASE_GLYPH` · 8c-3b). */
  glyph?: IconGlyph
  className?: string
}) {
  if (icon !== null && icon !== undefined) {
    if (icon.type !== 'emoji') {
      return <PageIconImage icon={icon} className={className} fallback={fallback ? <GlyphSvg glyph={glyph} className={className} /> : null} />
    }
    return (
      <span aria-hidden data-page-icon={icon.emoji} className={`inline-block flex-none leading-none ${className}`}>
        {icon.emoji}
      </span>
    )
  }
  if (!fallback) return null
  return <GlyphSvg glyph={glyph} className={className} />
}

function GlyphSvg({ glyph, className }: { glyph: IconGlyph; className: string }) {
  return (
    <svg
      aria-hidden
      data-page-icon=""
      viewBox={glyph.viewBox}
      width="1em"
      height="1em"
      className={`inline-block flex-none text-neutral-400 ${className}`}
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
