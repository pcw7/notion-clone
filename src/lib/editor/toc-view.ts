/**
 * 목차의 노드 뷰 — 헤딩의 목록 · 누르면 그 헤딩으로 (잔여 묶음 8b-1 · F-01-16)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   nav.blk.blk-table_of_contents[data-block-type][data-color][aria-label=목차]
 *     ul.blk-toc-list > li.blk-toc-item[style=--toc-depth] > a.blk-toc-link[href=#{blockId}]
 *     p.blk-toc-empty                                       ← 헤딩이 없을 때
 *
 * 목록은 노드에 없다 — `toc-plugin.ts` 가 이 노드에 단 데코레이션의 `spec` 에서 읽는다. 헤딩이 바뀌면 데코레이션이 달라져 PM 이
 * `update` 를 부르고, 같은 목록이면(객체가 같다) 다시 그리지 않는다.
 *
 * 항목은 **진짜 링크**(`<a href="#id">`)다 — 화면 읽기 프로그램이 링크로 읽고, 주소를 복사하면 그 블록으로 가는 주소다(F-01-08
 * 의 블록 링크와 같은 모양). 누르면 기본 동작(해시 이동)을 막고 `revealBlock` 이 접힌 조상을 펼쳐 그리로 굴리고 주소를 바꾼다 —
 * 같은 항목을 두 번 눌러도 간다(해시가 같으면 `hashchange` 가 나지 않는다).
 *
 * 누르는 것은 **문서를 바꾸지 않는다** — 읽기 전용에서도 된다(누르는 순간 `view.editable` 을 묻지 않는다 · 8a-2 의 규칙은
 * 문서를 쓰는 핸들러의 것이다). 탭 순서에는 **읽기 전용일 때만** 선다 — 편집 중의 Tab 은 들여쓰기이고, 들여쓸 수 없는 자리의
 * Tab 이 멀리 있는 링크로 포커스를 옮겨 그리로 굴렀다(코드 블록의 복사 버튼과 같은 까닭 · `syncReadOnlyTabStops`).
 * 링크 밖(빈 곳)을 누르면 PM 이 받는다 — 구분선처럼 블록을 고른다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view'

import type { TocEntry } from '../block/toc.ts'
import type { MentionKind } from './mention-label.ts'
import { tocEntriesFrom, tocEntryText } from './toc-plugin.ts'

export type TocViewDeps = {
  /** 목차 항목을 눌렀다 — 그 블록을 보여 준다(접힌 조상을 펼치고 그리로 굴리고 주소의 해시를 그 블록으로). */
  revealBlock: (blockId: string) => void
  mentionLabel: (kind: MentionKind, id: string) => string | null | undefined
}

/** 헤딩이 없을 때의 글자. */
export const TOC_EMPTY_TEXT = '페이지에 제목(헤딩)을 추가하면 여기에 목차가 생깁니다.'

const NO_ENTRIES: readonly TocEntry[] = []

/** 이벤트 대상이 목차 링크 안이면 그 링크. */
function linkOf(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a.blk-toc-link') : null
}

export function tocNodeView(initial: PmNode, view: EditorView, decorations: readonly Decoration[], deps: TocViewDeps): NodeView {
  let node = initial
  let shown: readonly TocEntry[] | null = null

  const dom = document.createElement('nav')
  dom.className = 'blk blk-table_of_contents'
  dom.dataset.blockType = 'table_of_contents'
  dom.setAttribute('aria-label', '목차')
  dom.contentEditable = 'false'

  /** 블록 색 — 노드 뷰가 그리는 블록은 스키마의 toDOM 이 다는 `data-color` 를 직접 단다(할 일 · 토글은 빠뜨렸다 · HANDOFF §7). */
  const paintColor = (current: PmNode): void => {
    const color = (current.attrs.format as { block_color?: unknown } | null | undefined)?.block_color
    if (typeof color === 'string' && color !== '') {
      if (dom.dataset.color !== color) dom.dataset.color = color
    } else if (dom.dataset.color !== undefined) {
      delete dom.dataset.color
    }
  }

  const render = (entries: readonly TocEntry[]): void => {
    if (entries === shown) return
    shown = entries
    if (entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'blk-toc-empty'
      empty.textContent = TOC_EMPTY_TEXT
      dom.replaceChildren(empty)
      return
    }
    const list = document.createElement('ul')
    list.className = 'blk-toc-list'
    for (const entry of entries) {
      const item = document.createElement('li')
      item.className = 'blk-toc-item'
      item.dataset.level = String(entry.level)
      item.style.setProperty('--toc-depth', String(entry.depth))
      const link = document.createElement('a')
      link.className = 'blk-toc-link'
      link.href = `#${entry.id}`
      link.dataset.tocTarget = entry.id
      // 읽기 전용에서만 탭 순서에 선다(머리말) — 편집 가능 여부가 바뀌면 편집기가 맞춘다(`syncReadOnlyTabStops`).
      link.dataset.readonlyTab = ''
      link.tabIndex = view.editable ? -1 : 0
      link.textContent = tocEntryText(entry.title, deps.mentionLabel)
      item.append(link)
      list.append(item)
    }
    dom.replaceChildren(list)
  }

  // 링크를 누르는 순간 포커스 · 캐럿을 옮기지 않는다 — 다른 노드 뷰(하위 페이지 · 멘션)와 같은 모양. ⚠ **증명하지 못한 방어** — 빼도
  // e2e 가 통과했다(8b-1 반사실 s6 · 누른 뒤의 이동이 화면을 그 헤딩으로 다시 굴려 옛 캐럿으로 튄 것이 보이지 않는다).
  dom.addEventListener('mousedown', (event) => {
    if (linkOf(event.target) !== null) event.preventDefault()
  })
  dom.addEventListener('click', (event) => {
    const link = linkOf(event.target)
    if (link === null) return
    event.preventDefault()
    const id = link.dataset.tocTarget
    if (id !== undefined && id !== '') deps.revealBlock(id)
  })

  paintColor(node)
  render(tocEntriesFrom(decorations) ?? NO_ENTRIES)

  return {
    dom,
    update(updated, nextDecorations) {
      if (updated.type !== node.type) return false
      node = updated
      paintColor(updated)
      render(tocEntriesFrom(nextDecorations) ?? NO_ENTRIES)
      return true
    },
    // 링크의 이벤트만 우리 것이다 — 나머지(빈 곳)는 PM 이 받아 블록을 고른다.
    stopEvent: (event) => linkOf(event.target) !== null,
    // 목록은 우리가 다시 그린다 — PM 이 문서로 읽지 않는다. 선택 기록은 PM 이 읽는다(원자 블록의 선택).
    ignoreMutation: (mutation) => mutation.type !== 'selection',
  }
}
