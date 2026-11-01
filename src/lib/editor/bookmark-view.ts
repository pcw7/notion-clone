/**
 * 북마크 블록 노드 뷰 — F-01-15 P1 (32번 트랙 F-3 · 정본 §3.4 [보강 F-3] ③)
 *
 * 빈 상태는 주소 입력칸 하나 · 주소가 있으면 카드(제목 · 호스트 · 주소 — 누르면 새 탭) · 카드 아래에 캡션 단추와 "주소 고치기". 메타(제목 · 설명 ·
 * 그림)는 F-4 가 `deps.bookmarkMeta` 로 줄 자리다 — 이 조각에서는 없으므로 주소가 제목이다. DOM 은 우리 것이다(`ignoreMutation`).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { readCaption } from '../block/image.ts'
import { BOOKMARK_TYPE, MAX_BOOKMARK_URL_LENGTH, bookmarkHost, bookmarkTitle, isBookmarkUrl, readBookmarkUrl, withBookmarkUrl } from '../block/bookmark-block.ts'

export type BookmarkViewDeps = {
  /** 캡션 입력을 연다 — 편집기 밖의 입력칸. 읽기 전용 편집기는 아무것도 하지 않는다. */
  readonly openBookmarkCaption: (blockId: string) => void
}

function containerIdAt(view: EditorView, getPos: () => number | undefined): string {
  const pos = getPos()
  if (pos === undefined) return ''
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockContainer') return String(node.attrs.blockId ?? '')
  }
  return ''
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

export function bookmarkNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined, deps: BookmarkViewDeps): NodeView {
  const dom = element('figure', 'blk blk-bookmark')
  dom.contentEditable = 'false'
  const controls = element('div', 'blk-bookmark-controls')
  let current = node
  let failure = ''

  const setUrl = (url: string | null): boolean => {
    if (!view.editable) return false
    const pos = getPos()
    if (pos === undefined) return false
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== BOOKMARK_TYPE) return false
    const props = withBookmarkUrl(node.attrs.props as Record<string, unknown>, url)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }))
    return true
  }

  const renderEmpty = (): void => {
    const form = element('form', 'blk-bookmark-url')
    // 브라우저의 `type="url"` 검사 대신 우리가 말한다 — http · https 만 받는다는 이유를 보여 줘야 한다
    form.noValidate = true
    const input = element('input', 'blk-bookmark-url-input')
    input.type = 'url'
    input.placeholder = '웹 주소 붙여넣기'
    input.setAttribute('aria-label', '북마크 주소')
    input.maxLength = MAX_BOOKMARK_URL_LENGTH
    const add = element('button', 'blk-bookmark-url-add', '추가')
    add.type = 'submit'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = input.value.trim()
      if (!isBookmarkUrl(url)) {
        failure = `http 또는 https 로 시작하는 주소(${MAX_BOOKMARK_URL_LENGTH}자 이하)만 넣을 수 있습니다.`
        render()
        return
      }
      if (!setUrl(url)) {
        failure = view.editable ? '북마크를 넣지 못했습니다 — 블록이 바뀌었습니다.' : '읽기 전용이라 북마크를 넣지 못했습니다.'
        render()
      }
    })
    form.append(input, add)
    controls.append(form)
  }

  const renderCard = (url: string): void => {
    const card = element('a', 'blk-bookmark-card')
    card.setAttribute('data-testid', 'bookmark-card')
    card.href = url
    card.target = '_blank'
    card.rel = 'noopener noreferrer'
    const title = element('span', 'blk-bookmark-title', bookmarkTitle(url))
    const host = element('span', 'blk-bookmark-host', bookmarkHost(url))
    const link = element('span', 'blk-bookmark-link', url)
    card.append(title, host, link)
    dom.prepend(card)
  }

  const render = (): void => {
    dom.replaceChildren()
    controls.replaceChildren()
    const props = current.attrs.props as Record<string, unknown>
    const url = readBookmarkUrl(props)
    if (url !== null) {
      dom.dataset.state = 'ready'
      renderCard(url)
      const caption = readCaption(props)
      if (caption !== '') dom.append(element('figcaption', 'blk-bookmark-caption', caption))
      const captionButton = element('button', 'blk-bookmark-caption-open', caption === '' ? '캡션 추가' : '캡션 고치기')
      captionButton.type = 'button'
      captionButton.setAttribute('data-testid', 'bookmark-caption-open')
      captionButton.setAttribute('data-code-ui', 'bookmark_caption')
      captionButton.addEventListener('mousedown', (event) => event.preventDefault())
      captionButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openBookmarkCaption(id)
      })
      const edit = element('button', 'blk-bookmark-edit', '주소 고치기')
      edit.type = 'button'
      edit.setAttribute('data-testid', 'bookmark-edit')
      edit.addEventListener('mousedown', (event) => event.preventDefault())
      // 빈 상태로 되돌린다 — 캡션은 남는다(정본 ③)
      edit.addEventListener('click', () => void setUrl(null))
      controls.append(captionButton, edit)
    } else {
      dom.dataset.state = 'empty'
      renderEmpty()
    }
    if (failure !== '') {
      const box = element('div', 'blk-bookmark-failure', failure)
      box.setAttribute('role', 'alert')
      controls.append(box)
    }
    if (controls.childElementCount > 0) dom.append(controls)
  }

  render()

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== BOOKMARK_TYPE) return false
      current = updated
      if (readBookmarkUrl(updated.attrs.props) !== null) failure = ''
      render()
      return true
    },
    stopEvent: (event) => {
      const target = event.target
      return target instanceof Node && (controls.contains(target) || (target instanceof Element && target.closest('.blk-bookmark-card') !== null))
    },
    ignoreMutation: () => true,
  }
}
