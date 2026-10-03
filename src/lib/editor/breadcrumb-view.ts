/**
 * breadcrumb 블록의 노드 뷰 — 이 페이지의 경로 (잔여 묶음 8b-2 · F-01-16)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   nav.blk.blk-breadcrumb[data-block-type][aria-label=이동 경로]
 *     ol.blk-breadcrumb-list > li.blk-breadcrumb-item[data-kind] > a.blk-breadcrumb-link[href] | span(지금 페이지 · aria-current)
 *       (아이콘이 있으면 링크 · 글자 앞에 span.blk-breadcrumb-icon[aria-hidden] — 8c-1)
 *
 * 경로는 노드에 없다 — `breadcrumb-plugin.ts` 가 이 노드에 단 데코레이션의 `spec` 에서 읽는다(머리의 breadcrumb 과 같은
 * `block/breadcrumb.ts` 의 줄). 경로가 같으면(객체가 같다) 다시 그리지 않는다.
 *
 * 링크는 진짜 링크(`<a href>`)다 — 그냥 누르면 앱 안에서 옮겨 가고(`navigate` — 클라이언트 라우터), 보조 키를 누르거나 가운데
 * 단추로 누르면 브라우저에 맡긴다(새 탭). 문서를 바꾸지 않으니 읽기 전용에서도 된다. 탭 순서에는 **읽기 전용일 때만** 선다
 * (`data-readonly-tab` — 목차의 링크 · 코드의 복사 버튼과 같은 까닭). 링크 밖(빈 곳)을 누르면 PM 이 받아 블록을 고른다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view'

import type { BreadcrumbItem, BreadcrumbTrail } from '../block/breadcrumb.ts'
import { breadcrumbFrom } from './breadcrumb-plugin.ts'
import { pageIconElement } from './page-icon-dom.ts'

export type BreadcrumbViewDeps = {
  /** 앱 안의 주소로 옮겨 간다 — 클라이언트 라우터. */
  navigate: (href: string) => void
  /** 올린 이미지 아이콘의 주소를 만든다(8c-4 — 워크스페이스의 파일 경로). */
  workspaceId: string
}

/** 이벤트 대상이 경로의 링크 안이면 그 링크. */
function linkOf(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a.blk-breadcrumb-link') : null
}

/** 줄 하나의 글자 — 아이콘(있을 때만 — 글자 속의 경로 · 읽는 이에게는 숨긴다)과 이름. */
function fillItem(target: HTMLElement, item: BreadcrumbItem, workspaceId: string): void {
  const icon = pageIconElement(item.icon, { fallback: false, className: 'blk-breadcrumb-icon', workspaceId })
  if (icon !== null) target.append(icon)
  target.append(item.label)
}

export function breadcrumbNodeView(
  initial: PmNode,
  view: EditorView,
  decorations: readonly Decoration[],
  deps: BreadcrumbViewDeps,
): NodeView {
  let node = initial
  let shown: BreadcrumbTrail | null | undefined

  const dom = document.createElement('nav')
  dom.className = 'blk blk-breadcrumb'
  dom.dataset.blockType = 'breadcrumb'
  dom.setAttribute('aria-label', '이동 경로')
  dom.contentEditable = 'false'

  const render = (trail: BreadcrumbTrail | null): void => {
    if (trail === shown) return
    shown = trail
    const list = document.createElement('ol')
    list.className = 'blk-breadcrumb-list'
    for (const item of trail ?? []) {
      const li = document.createElement('li')
      li.className = 'blk-breadcrumb-item'
      li.dataset.kind = item.kind
      if (item.href === null) {
        const here = document.createElement('span')
        here.className = 'blk-breadcrumb-current'
        here.setAttribute('aria-current', 'page')
        fillItem(here, item, deps.workspaceId)
        li.append(here)
      } else {
        const link = document.createElement('a')
        link.className = 'blk-breadcrumb-link'
        link.href = item.href
        link.dataset.readonlyTab = ''
        link.tabIndex = view.editable ? -1 : 0
        fillItem(link, item, deps.workspaceId)
        li.append(link)
      }
      list.append(li)
    }
    dom.replaceChildren(list)
  }

  // 링크를 누르는 순간 포커스 · 캐럿을 옮기지 않는다 — 다른 노드 뷰와 같은 모양. ⚠ **증명하지 못한 방어** — 빼도 e2e 가 통과했다
  // (8b-2 반사실 s4 · 목차의 s6 와 같다 · 누른 뒤 다른 페이지로 옮겨 가 옛 캐럿이 보일 틈이 없다).
  dom.addEventListener('mousedown', (event) => {
    if (linkOf(event.target) !== null && event.button === 0) event.preventDefault()
  })
  dom.addEventListener('click', (event) => {
    const link = linkOf(event.target)
    if (link === null) return
    // 보조 키 · 가운데 단추는 브라우저의 것이다(새 탭 · 새 창).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const href = link.getAttribute('href')
    if (href !== null) deps.navigate(href)
  })

  render(breadcrumbFrom(decorations) ?? null)

  return {
    dom,
    update(updated, nextDecorations) {
      if (updated.type !== node.type) return false
      node = updated
      render(breadcrumbFrom(nextDecorations) ?? null)
      return true
    },
    stopEvent: (event) => linkOf(event.target) !== null,
    ignoreMutation: (mutation) => mutation.type !== 'selection',
  }
}
