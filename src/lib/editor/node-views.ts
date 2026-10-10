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
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view'

import { BREADCRUMB_TYPE } from '../block/breadcrumb.ts'
import { CODE_TYPE } from '../block/code.ts'
import { EQUATION_TYPE } from '../block/equation.ts'
import { TOC_TYPE } from '../block/toc.ts'
import { breadcrumbNodeView, type BreadcrumbViewDeps } from './breadcrumb-view.ts'
import { codeNodeView, type CodeViewDeps } from './code-view.ts'
import { equationNodeView, type EquationViewDeps } from './equation-view.ts'
import { buttonNodeView, type ButtonViewDeps } from './button-view.ts'
import { BUTTON_TYPE } from '../block/button.ts'
import { inlineEquationNodeView, type InlineEquationViewDeps } from './inline-equation-view.ts'
import { imageNodeView, type ImageViewDeps } from './image-view.ts'
import { mentionDisplay, mentionTargetOf } from './mention-label.ts'
import { pageIconElement } from './page-icon-dom.ts'
import type { PageIcon } from '../block/page-icon.ts'
import { nodeNameOf } from './schema.ts'
import { tocNodeView, type TocViewDeps } from './toc-view.ts'

export type NodeViewDeps = ImageViewDeps & CodeViewDeps & TocViewDeps & BreadcrumbViewDeps & EquationViewDeps & InlineEquationViewDeps & ButtonViewDeps & {
  isCollapsed: (blockId: string) => boolean
  toggleCollapsed: (blockId: string) => void
  /** 하위 페이지로 이동. */
  openPage: (pageId: string) => void
  /**
   * 하위 페이지 참조의 제목 — 볼 수 있으면 평문, 볼 수 없으면 `null`, 모르면 `undefined`. 참조 노드는 제목을 싣지 않는다
   * (`schema.ts`) — 서버가 권한으로 거른 맵에서 읽는다(`loadPageBody` 의 `pageRefTitles`).
   */
  pageRefTitle: (pageId: string) => string | null | undefined
  /**
   * 멘션 노드가 그릴 이름 — 사람이면 이름, 페이지면 제목. 볼 수 없거나 없으면 `null`, 모르면 `undefined`. 노드에는 id 뿐이다
   * (정본 §3.9 `link_edge` 절) — 서버가 권한으로 거른 맵에서 읽는다(`block/mention-candidates.ts` `loadMentionLabels`).
   */
  mentionLabel: (kind: 'user' | 'page', id: string) => string | null | undefined
  /**
   * 하위 페이지 참조 · 페이지 멘션이 그릴 아이콘(8c-2) — 없거나 모르면 null(기본 글리프). 노드에는 없다(정본 §3.4 [보강] 페이지 아이콘
   * ③) — 서버가 제목과 같은 권한 필터로 준 맵에서 읽는다(볼 수 있고 아이콘이 있는 것만).
   */
  pageIcon: (pageId: string) => PageIcon | null
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
    // 읽기 전용이면 쓰지 않는다 — 읽기 전용 연결의 편집은 서버가 거부하고 편집기가 본문을 버리고 다시 연다(오류 배너). 노드 뷰는
    // 편집 가능 여부가 바뀌어도 다시 만들어지지 않으므로 누르는 순간에 묻는다(8a-2 가 찾은 옛 구멍).
    if (!view.editable) return
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
  // 제목은 노드에 없다 — 권한으로 거른 맵에서 읽는다. 볼 수 없는 페이지는 자리만 보이고 열리지 않는다(열어도 404 다).
  const id = containerIdAt(view, getPos)
  const title = deps.pageRefTitle(id)
  if (title === null) {
    // 볼 수 없는 페이지 — 아이콘도 없다(서버가 주지 않는다 · 자리만).
    link.textContent = '접근 권한 없음'
    link.disabled = true
    link.classList.add('blk-page-link-denied')
  } else {
    // 아이콘(8c-2) — 없으면 기본 글리프(페이지로 가는 줄). 아직 모르는 참조(`undefined`)도 글리프로 자리를 지킨다.
    const icon = pageIconElement(title === undefined ? null : deps.pageIcon(id), { fallback: true, className: 'blk-page-icon', workspaceId: deps.workspaceId })
    if (icon !== null) link.append(icon)
    link.append(title === undefined ? '하위 페이지' : title || '제목 없음')
  }
  link.addEventListener('mousedown', (event) => event.preventDefault())
  link.addEventListener('click', () => {
    const id = containerIdAt(view, getPos)
    if (id !== '' && deps.pageRefTitle(id) !== null) deps.openPage(id)
  })

  dom.append(link)
  return { dom, stopEvent: () => true }
}

/**
 * mention — 사람 · 페이지 칩. 이름은 노드에 없다(`schema.ts` — `plainText` 는 비어 있다). 권한으로 거른 맵에서 읽고,
 * 볼 수 없는 페이지는 자리만 보이고 열리지 않는다(하위 페이지 참조와 같은 규칙 · §3.2-22).
 */
function mentionNodeView(node: PmNode, _view: EditorView, _getPos: () => number | undefined, deps: NodeViewDeps): NodeView {
  const dom = document.createElement('span')
  dom.className = 'blk-mention'
  dom.contentEditable = 'false'
  const target = mentionTargetOf(node.attrs.mention)
  if (target === null) {
    // 날짜 등 아직 그리지 않는 멘션 — 저장된 평문이 있으면 그것, 없으면 표식만.
    dom.textContent = String(node.attrs.plainText || '@')
    return { dom, stopEvent: () => true }
  }
  dom.dataset.mentionKind = target.kind
  dom.dataset.mentionId = target.id
  // 글자는 목차의 줄과 같은 규칙이다(`mention-label.ts`). 페이지 칩은 그 앞에 아이콘(8c-2 — 볼 수 없으면 없다).
  const label = deps.mentionLabel(target.kind, target.id)
  const shown = mentionDisplay(target.kind, label)
  if (target.kind === 'page' && !shown.denied) {
    const icon = pageIconElement(label === undefined ? null : deps.pageIcon(target.id), { fallback: true, className: 'blk-page-icon', workspaceId: deps.workspaceId })
    if (icon !== null) dom.append(icon)
  }
  dom.append(shown.text)
  if (target.kind === 'user') {
    dom.classList.add('blk-mention-user')
    return { dom, stopEvent: () => true }
  }
  dom.classList.add('blk-mention-page')
  if (shown.denied) {
    dom.classList.add('blk-mention-denied')
    return { dom, stopEvent: () => true }
  }
  dom.setAttribute('role', 'link')
  dom.addEventListener('mousedown', (event) => event.preventDefault())
  dom.addEventListener('click', () => {
    if (deps.mentionLabel('page', target.id) !== null) deps.openPage(target.id)
  })
  return { dom, stopEvent: () => true }
}

export function createNodeViews(deps: NodeViewDeps): Record<
  string,
  (node: PmNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) => NodeView
> {
  return {
    to_do: (node, view, getPos) => todoNodeView(node, view, getPos),
    toggle: (node, view, getPos) => toggleNodeView(node, view, getPos, deps),
    image: (node, view, getPos) => imageNodeView(node, view, getPos, deps),
    // 키는 노드 이름이다 — 코드 블록의 노드는 `code_block`(8a-1).
    [nodeNameOf(CODE_TYPE)]: (node, view, getPos) => codeNodeView(node, view, getPos, deps),
    page_ref: (node, view, getPos) => pageRefNodeView(node, view, getPos, deps),
    // 목차(8b-1) — 목록은 `toc-plugin.ts` 가 단 노드 데코레이션에서 읽는다.
    [nodeNameOf(TOC_TYPE)]: (node, view, _getPos, decorations) => tocNodeView(node, view, decorations, deps),
    // breadcrumb(8b-2) — 경로는 `breadcrumb-plugin.ts` 가 단 노드 데코레이션에서 읽는다.
    [nodeNameOf(BREADCRUMB_TYPE)]: (node, view, _getPos, decorations) => breadcrumbNodeView(node, view, decorations, deps),
    // 블록 수식(Phase 2 1a) — 노드는 `equation_block`(인라인 수식이 `equation` 이다).
    [nodeNameOf(EQUATION_TYPE)]: (node, view, getPos) => equationNodeView(node, view, getPos, deps),
    // 버튼 블록(자동화 5e-1) — 라벨의 단추 · 설정은 편집기 밖의 오버레이.
    [nodeNameOf(BUTTON_TYPE)]: (node, view, getPos) => buttonNodeView(node, view, getPos, deps),
    mention: (node, view, getPos) => mentionNodeView(node, view, getPos, deps),
    // 인라인 수식(Phase 2 1b) — rich text 의 원자. 그리기는 블록 수식과 같은 한 곳(`equation-render.ts`).
    equation: (node, view, getPos) => inlineEquationNodeView(node, view, getPos, deps),
  }
}

/**
 * 읽기 전용에서만 탭 순서에 서는 것(코드 블록의 복사 버튼 · 목차 · breadcrumb 의 링크 — `data-readonly-tab`)의 탭 정지를 편집 가능 여부에 맞춘다 —
 * 편집기가 편집 가능 여부를 바꾼 뒤 부른다. 노드 뷰는 그때 다시 만들어지지 않는다(8a-2). 편집 중에는 Tab 이 들여쓰기라, 들여쓸 수
 * 없는 자리의 Tab 이 멀리 있는 그것으로 포커스를 옮겨 그리로 굴렀다. 크롬의 속성 변화는 노드 뷰의 `ignoreMutation` 이 거른다.
 *
 * ⚠ **증명하지 못한 방어** — e2e 의 잠금 장면은 연결을 다시 열며 편집기를 새로 만들어 이 길을 지나지 않는다(빼는 반사실에서 통과했다 ·
 * 8a-2). 다시 여는 중에 편집기가 만들어지는 장면을 e2e 로 세우지 못했다.
 */
export function syncReadOnlyTabStops(view: EditorView): void {
  for (const el of view.dom.querySelectorAll<HTMLElement>('[data-readonly-tab]')) el.tabIndex = view.editable ? -1 : 0
}
