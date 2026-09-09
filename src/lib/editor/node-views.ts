/**
 * 노드 뷰 — 체크박스 · 토글 화살표 · 이미지 · 하위 페이지 링크
 *
 * ProseMirror 의 `toDOM` 만으로는 **상호작용**을 만들 수 없다. 체크박스를
 * 누르고 토글을 접는 것은 DOM 이벤트를 받아 트랜잭션을 만드는 일이므로
 * 노드 뷰가 필요하다.
 *
 * React 노드 뷰를 쓰지 않는다. 여기서 필요한 것은 요소 하나와 클릭 핸들러이고,
 * React 를 끼우면 리렌더 경계를 관리해야 한다 — F-12-06 이 인용한 Tiptap 성능
 * 가이드가 정확히 그 반대를 권한다("에디터를 별도 컴포넌트로 격리해 리렌더를
 * 막아라"). 평범한 DOM 노드 뷰가 더 빠르고 더 단순하다.
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

export type NodeViewDeps = {
  isCollapsed: (blockId: string) => boolean
  toggleCollapsed: (blockId: string) => void
  /** 하위 페이지로 이동. */
  openPage: (pageId: string) => void
}

/** 컨테이너의 blockId 를 찾는다. 노드 뷰는 내용 노드만 받으므로 위로 올라간다. */
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

/**
 * to_do — 체크박스.
 *
 * 체크박스는 `contentEditable=false` 여야 한다. 그러지 않으면 캐럿이 그 안으로
 * 들어가고 사용자가 체크박스 "안에" 타이핑하려 한다.
 */
function todoNodeView(node: PmNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('li')
  dom.className = 'blk blk-to_do'
  dom.setAttribute('role', 'listitem')

  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'blk-checkbox'
  box.contentEditable = 'false'
  box.checked = Boolean((node.attrs.props as { checked?: boolean })?.checked)

  const content = document.createElement('span')
  content.className = 'blk-text'

  box.addEventListener('mousedown', (event) => {
    // mousedown 을 막지 않으면 클릭이 selection 을 옮겨 체크가 씹힌다.
    event.preventDefault()
  })
  box.addEventListener('click', (event) => {
    event.preventDefault()
    const pos = getPos()
    if (pos === undefined) return
    const current = view.state.doc.nodeAt(pos)
    if (!current) return
    const props = { ...(current.attrs.props as Record<string, unknown>) }
    props.checked = !props.checked
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, props }))
  })

  dom.append(box, content)

  return {
    dom,
    contentDOM: content,
    update: (updated) => {
      if (updated.type.name !== 'to_do') return false
      box.checked = Boolean((updated.attrs.props as { checked?: boolean })?.checked)
      return true
    },
    // 체크박스 클릭은 ProseMirror 가 아니라 우리가 처리한다.
    stopEvent: (event) => event.target === box,
    ignoreMutation: (mutation) => mutation.target === box || box.contains(mutation.target),
  }
}

/**
 * toggle — 접기 화살표.
 *
 * 접힘 상태는 **문서에 없다**(F-01-13: 뷰어별 상태). 그래서 밖에서 받고,
 * 여기서는 화살표 방향과 `data-collapsed` 만 반영한다. 실제로 자식을 숨기는
 * 것은 CSS 다 — DOM 에서 빼면 ProseMirror 의 위치 계산이 깨진다.
 */
function toggleNodeView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: NodeViewDeps,
): NodeView {
  const dom = document.createElement('div')
  dom.className = 'blk blk-toggle'

  const arrow = document.createElement('button')
  arrow.type = 'button'
  arrow.className = 'blk-toggle-arrow'
  arrow.contentEditable = 'false'
  arrow.setAttribute('aria-label', '접기/펼치기')

  const content = document.createElement('div')
  content.className = 'blk-text'

  const sync = (): void => {
    const id = containerIdAt(view, getPos)
    const collapsed = id !== '' && deps.isCollapsed(id)
    arrow.textContent = collapsed ? '▸' : '▾'
    arrow.setAttribute('aria-expanded', String(!collapsed))
  }

  arrow.addEventListener('mousedown', (event) => event.preventDefault())
  arrow.addEventListener('click', () => {
    const id = containerIdAt(view, getPos)
    if (id !== '') deps.toggleCollapsed(id)
    sync()
  })

  dom.append(arrow, content)
  sync()

  return {
    dom,
    contentDOM: content,
    update: (updated) => {
      if (updated.type.name !== 'toggle') return false
      sync()
      return true
    },
    stopEvent: (event) => event.target === arrow,
    ignoreMutation: (mutation) => mutation.target === arrow,
  }
}

/** image — MVP 는 URL 만. 업로드는 F-01-15(Phase 1). */
function imageNodeView(node: PmNode): NodeView {
  const dom = document.createElement('figure')
  dom.className = 'blk blk-image'

  const props = (node.attrs.props ?? {}) as { url?: string; caption?: string }
  if (typeof props.url === 'string' && props.url !== '') {
    const img = document.createElement('img')
    img.src = props.url
    img.alt = props.caption ?? ''
    dom.append(img)
  } else {
    const empty = document.createElement('div')
    empty.className = 'blk-image-empty'
    empty.textContent = '이미지 URL 이 아직 없습니다'
    dom.append(empty)
  }

  return { dom }
}

/** page_ref — 하위 페이지 링크. */
function pageRefNodeView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: NodeViewDeps,
): NodeView {
  const dom = document.createElement('div')
  dom.className = 'blk blk-page-ref'

  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'blk-page-link'
  link.textContent = String(node.attrs.title || '제목 없음')
  link.addEventListener('mousedown', (event) => event.preventDefault())
  link.addEventListener('click', () => {
    const id = containerIdAt(view, getPos)
    if (id !== '') deps.openPage(id)
  })

  dom.append(link)
  return { dom, stopEvent: () => true }
}

export function createNodeViews(deps: NodeViewDeps): Record<
  string,
  (node: PmNode, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    to_do: (node, view, getPos) => todoNodeView(node, view, getPos),
    toggle: (node, view, getPos) => toggleNodeView(node, view, getPos, deps),
    image: (node) => imageNodeView(node),
    page_ref: (node, view, getPos) => pageRefNodeView(node, view, getPos, deps),
  }
}
