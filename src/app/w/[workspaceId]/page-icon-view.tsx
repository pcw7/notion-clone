/**
 * 페이지 아이콘의 표시 — 사이드바 · 목록 · 머리가 함께 쓴다 (잔여 묶음 8c-1 · F-02-05)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 훅이 없어 서버 화면(목록)과 클라이언트 화면(사이드바)이 그대로 함께 쓴다.
 *
 * 아이콘은 이름 앞의 장식이다 — 읽는 이에게는 숨긴다(`aria-hidden`, 이름이 링크의 이름이다). 없을 때의 표시는 둘 중 하나다
 * (teamspace 의 `teamspaceIcon()` 처럼 한 곳에서 — 이 파일과 같은 모양을 DOM 으로 그리는 `editor/page-icon-dom.ts`):
 *   · `fallback` — **페이지로 가는 줄**(사이드바 · 페이지 목록 · 검색 결과 · 인박스 · 휴지통 · 옮기기 후보 · 본문의 하위 페이지 블록 ·
 *     멘션 칩): 회색 문서 글리프(F-02-05 *"아이콘 미지정 시 기본 문서 아이콘"* · `PAGE_GLYPH`). **글자가 아니라 그림(SVG)이다** —
 *     줄의 글자(`textContent`)에 섞이지 않아, 이름을 글자로 읽는 곳(검사 · 복사)이 아이콘이 없는 페이지에서 그대로다
 *   · 아니면 아무것도 그리지 않는다 — **글자 속의 경로**(머리의 경로 · 경로 블록 · 검색 결과의 조상 줄)
 */

import { PAGE_GLYPH, type PageIcon } from '@/lib/block/page-icon'

export function PageIconView({
  icon,
  fallback = false,
  className = '',
}: {
  icon: PageIcon | null
  /** 없을 때 기본 문서 글리프를 세운다 — 줄의 자리를 맞추는 곳(사이드바). */
  fallback?: boolean
  className?: string
}) {
  if (icon !== null) {
    return (
      <span aria-hidden data-page-icon={icon.emoji} className={`inline-block flex-none leading-none ${className}`}>
        {icon.emoji}
      </span>
    )
  }
  if (!fallback) return null
  return (
    <svg
      aria-hidden
      data-page-icon=""
      viewBox={PAGE_GLYPH.viewBox}
      width="1em"
      height="1em"
      className={`inline-block flex-none text-neutral-400 ${className}`}
    >
      {PAGE_GLYPH.paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
