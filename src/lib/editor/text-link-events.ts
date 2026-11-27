/**
 * 글 속 링크의 새 탭 (59번 트랙 NV-3 · F-07-12) — 편집 중인 글 속 링크(link 서식)의 `Ctrl/Cmd + 클릭` · 가운데 클릭
 *
 * 정본: 00-canonical-data-model.md §3.9 [보강 NV-0] ⑪ [NV-3 고침] ⓑ
 *
 * 브라우저는 편집 가능한 글 속의 링크를 열지 않는다(`Ctrl+클릭` 도) — 그래서 편집기가 받아 새 탭으로 연다(`noopener` · 보조 키에 따른 앞 · 뒤
 * 탭은 브라우저가 지금 사건을 보고 정한다). 그냥 누르기 · `Shift` 는 편집기의 것(캐럿 · 선택 늘리기)이라 건드리지 않는다 — 고르기는
 * `nav/link-click.ts` 의 `textLinkClick`. 노드 뷰의 링크(멘션 칩 · 하위 페이지 · 경로 블록)는 편집되지 않는 섬 안이라 스스로 받는다 — 여기서
 * 거른다. 읽기 전용이면 살아 있는 링크라 브라우저가 한다(여기서는 아무것도 하지 않는다).
 *
 * ⚠ 이 파일은 브라우저에서만 돈다(`window.open`).
 */

import type { EditorView } from '@tiptap/pm/view'

import { textLinkClick } from '../nav/link-click.ts'

/** 사건이 글 속 링크에서 났으면 그 링크 — 노드 뷰의 섬(`contenteditable=false`) 안의 링크는 뺀다. */
function textLinkOf(view: EditorView, target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (link === null || !view.dom.contains(link)) return null
  const island = link.closest('[contenteditable="false"]')
  return island !== null && view.dom.contains(island) ? null : link
}

function openInNewTab(view: EditorView, event: MouseEvent): boolean {
  if (textLinkClick(event, view.editable) !== 'new-tab') return false
  const link = textLinkOf(view, event.target)
  if (link === null) return false
  event.preventDefault()
  window.open(link.href, '_blank', 'noopener')
  return true
}

/** 편집기의 `handleDOMEvents` — `createEditor` 가 단다. */
export const textLinkEvents = {
  // 여는 누르기는 캐럿 · 선택을 옮기지 않는다(편집기의 mousedown 을 건너뛴다) · 가운데 단추의 자동 스크롤도 막는다
  mousedown: (view: EditorView, event: MouseEvent): boolean => {
    if (textLinkClick(event, view.editable) !== 'new-tab' || textLinkOf(view, event.target) === null) return false
    event.preventDefault()
    return true
  },
  click: openInNewTab,
  // 가운데 단추는 `click` 이 아니라 `auxclick` 으로 온다
  auxclick: openInNewTab,
}
