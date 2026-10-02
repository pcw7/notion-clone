/**
 * 페이지 아이콘의 표시 — 사이드바 · 목록 · 머리가 함께 쓴다 (잔여 묶음 8c-1 · F-02-05)
 *
 * ⚠ `'use client'` 를 달지 않는다 — 훅이 없어 서버 화면(목록)과 클라이언트 화면(사이드바)이 그대로 함께 쓴다.
 *
 * 아이콘은 이름 앞의 장식이다 — 읽는 이에게는 숨긴다(`aria-hidden`, 이름이 링크의 이름이다). 없을 때의 표시는 **이 파일 한 곳**에서
 * 정한다(teamspace 의 `teamspaceIcon()` 과 같은 규칙):
 *   · `fallback` — 회색 문서 글리프(F-02-05 *"아이콘 미지정 시 기본 문서 아이콘"*). **글자가 아니라 그림(SVG)이다** — 줄의 글자
 *     (`textContent`)에 섞이지 않아, 이름을 글자로 읽는 곳(검사 · 복사)이 아이콘이 없는 페이지에서 그대로다
 *   · 아니면 아무것도 그리지 않는다(경로 · 목록 — 글자의 줄)
 * 브라우저 노드 뷰(경로 블록 — `breadcrumb-view.ts`)는 React 밖이라 같은 규칙을 DOM 으로 따로 그린다(있을 때만).
 */

import type { PageIcon } from '@/lib/block/page-icon'

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
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      className={`inline-block flex-none text-neutral-400 ${className}`}
    >
      <path d="M4 1.75h5.25L12.5 5v9.25H4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.25 1.75V5h3.25" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
