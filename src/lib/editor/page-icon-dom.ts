/**
 * 페이지 아이콘을 노드 뷰의 DOM 으로 — `page-icon-view.tsx`(React)와 같은 규칙 · 같은 모양 (잔여 묶음 8c-2 · F-02-05)
 *
 * ⚠ 이 파일은 브라우저에서만 쓴다(`document`). 노드 뷰(하위 페이지 블록 · 멘션 칩 · 경로 블록)는 React 밖이라 같은 표시를 DOM 으로
 * 그린다:
 *   · 아이콘이 있으면 이모지 `span[data-page-icon=이모지]`
 *   · 없고 `fallback` 이면(페이지로 가는 줄) 기본 문서 글리프 `svg[data-page-icon=""]` — 글자가 아니다(`PAGE_GLYPH`)
 *   · 없고 `fallback` 이 아니면(글자 속의 경로) null
 * 읽는 이에게는 숨긴다(`aria-hidden`) — 이름이 링크의 이름이다.
 */

import { PAGE_GLYPH, type PageIcon } from '../block/page-icon.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function pageIconElement(icon: PageIcon | null, options: { readonly fallback: boolean; readonly className: string }): Element | null {
  if (icon !== null) {
    const span = document.createElement('span')
    span.className = options.className
    span.setAttribute('aria-hidden', 'true')
    span.dataset.pageIcon = icon.emoji
    span.textContent = icon.emoji
    return span
  }
  if (!options.fallback) return null
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', `${options.className} page-glyph`)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('data-page-icon', '')
  svg.setAttribute('viewBox', PAGE_GLYPH.viewBox)
  svg.setAttribute('width', '1em')
  svg.setAttribute('height', '1em')
  for (const d of PAGE_GLYPH.paths) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.2')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
  }
  return svg
}
