/**
 * 페이지 아이콘을 노드 뷰의 DOM 으로 — `page-icon-view.tsx`(React)와 같은 규칙 · 같은 모양 (잔여 묶음 8c-2 · 8c-4 · F-02-05)
 *
 * ⚠ 이 파일은 브라우저에서만 쓴다(`document`). 노드 뷰(하위 페이지 블록 · 멘션 칩 · 경로 블록)는 React 밖이라 같은 표시를 DOM 으로
 * 그린다:
 *   · 이모지면 `span[data-page-icon=이모지]`
 *   · 이미지면(8c-4) `img[data-page-icon=file:…|external:…]` — 올린 파일은 워크스페이스의 파일 경로(`workspaceId` 를 받는다),
 *     외부 주소는 그대로 · `referrerpolicy=no-referrer`. 불러오지 못하면 아래 규칙으로 바꾼다(깨진 그림을 그리지 않는다)
 *   · 없고 `fallback` 이면(페이지로 가는 줄) 기본 문서 글리프 `svg[data-page-icon=""]` — 글자가 아니다(`PAGE_GLYPH`)
 *   · 없고 `fallback` 이 아니면(글자 속의 경로) null
 * 읽는 이에게는 숨긴다(`aria-hidden`) — 이름이 링크의 이름이다.
 */

import { PAGE_GLYPH, pageIconKey, pageIconSrc, type PageIcon } from '../block/page-icon.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function pageIconElement(
  icon: PageIcon | null | undefined,
  options: { readonly fallback: boolean; readonly className: string; readonly workspaceId: string },
): Element | null {
  // `undefined` 도 없는 것이다(`page-icon-view.tsx` 와 같은 규칙).
  if (icon !== null && icon !== undefined) {
    if (icon.type === 'emoji') {
      const span = document.createElement('span')
      span.className = options.className
      span.setAttribute('aria-hidden', 'true')
      span.dataset.pageIcon = icon.emoji
      span.textContent = icon.emoji
      return span
    }
    const src = pageIconSrc(icon, options.workspaceId)
    if (src !== null) {
      const img = document.createElement('img')
      img.className = `${options.className} page-icon-image`
      img.setAttribute('aria-hidden', 'true')
      img.alt = ''
      img.draggable = false
      img.referrerPolicy = 'no-referrer'
      img.dataset.pageIcon = pageIconKey(icon)
      img.addEventListener('error', () => {
        const instead = glyphElement(options)
        if (instead === null) img.remove()
        else img.replaceWith(instead)
      })
      img.src = src
      return img
    }
  }
  return glyphElement(options)
}

function glyphElement(options: { readonly fallback: boolean; readonly className: string }): Element | null {
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
