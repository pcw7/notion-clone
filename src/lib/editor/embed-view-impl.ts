/**
 * 임베드 블록 노드 뷰의 몸 — F-09-10 (44번 트랙 EM-1 · 정본 §3.4 [보강 EM-1] ③ ④)
 *
 * 빈 상태는 주소 입력칸 하나 · 주소가 있으면 판(iframe) 아래에 서비스 이름 · "원래 주소 열기" · 캡션 단추 · "주소 고치기". 알려진 서비스는 바로
 * 그리고 일반 주소는 "불러오기"를 눌러야 그린다. 자기 출처 · http 일반은 그리지 않고 이유와 주소를 보인다. iframe 은 판이 바뀔 때만 다시 만든다
 * (캡션을 고쳐도 영상이 다시 로드되지 않는다). DOM 은 우리 것이다(`ignoreMutation`).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { readCaption } from '../block/image.ts'
import { EMBED_TYPE, MAX_EMBED_URL_LENGTH, isEmbedUrl, readEmbedUrl, withEmbedUrl } from '../block/embed-block.ts'
import { EMBED_ALLOW, EMBED_REFERRER_POLICY, EMBED_SANDBOX } from '../block/embed-attrs.ts'
import { embedPlanOf, ownHostsOf, type EmbedGeneric, type EmbedKnown } from '../block/embed-source.ts'
import type { EmbedViewDeps } from './embed-view.ts'

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

/** 격리된 iframe — 속성은 정본 ③ 그대로(`allow-top-navigation*` · `allow-modals` · 내려받기는 없다). */
function embedFrame(plan: EmbedKnown | EmbedGeneric): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.className = 'blk-embed-iframe'
  frame.setAttribute('data-testid', 'embed-frame')
  frame.setAttribute('sandbox', EMBED_SANDBOX)
  frame.setAttribute('allow', EMBED_ALLOW)
  frame.setAttribute('referrerpolicy', EMBED_REFERRER_POLICY)
  frame.setAttribute('loading', 'lazy')
  frame.setAttribute('title', plan.label)
  frame.src = plan.src
  return frame
}

export function mountEmbed(dom: HTMLElement, node: PmNode, view: EditorView, getPos: () => number | undefined, deps: EmbedViewDeps): Omit<NodeView, 'dom'> {
  const stage = element('div', 'blk-embed-stage')
  const controls = element('div', 'blk-embed-controls')
  let current = node
  let failure = ''
  // 판을 그린 주소 · 일반 주소를 눌러서 불러온 주소 — 판은 이 둘이 바뀔 때만 다시 만든다
  let stageKey = ''
  let loadedUrl = ''

  const setUrl = (url: string | null): boolean => {
    if (!view.editable) return false
    const pos = getPos()
    if (pos === undefined) return false
    const found = view.state.doc.nodeAt(pos)
    if (!found || found.type.name !== EMBED_TYPE) return false
    const props = withEmbedUrl(found.attrs.props as Record<string, unknown>, url)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...found.attrs, props }))
    return true
  }

  const openLink = (url: string): HTMLAnchorElement => {
    const link = element('a', 'blk-embed-open', '원래 주소 열기')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.setAttribute('data-testid', 'embed-open')
    return link
  }

  const renderEmpty = (): void => {
    const form = element('form', 'blk-embed-url')
    // 브라우저의 `type="url"` 검사 대신 우리가 말한다 — http · https 만 받는다는 이유를 보여 줘야 한다
    form.noValidate = true
    const input = element('input', 'blk-embed-url-input')
    input.type = 'url'
    input.placeholder = '임베드할 주소 붙여넣기'
    input.setAttribute('aria-label', '임베드 주소')
    input.maxLength = MAX_EMBED_URL_LENGTH
    const add = element('button', 'blk-embed-url-add', '넣기')
    add.type = 'submit'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = input.value.trim()
      if (!isEmbedUrl(url)) {
        failure = `http 또는 https 로 시작하는 주소(${MAX_EMBED_URL_LENGTH}자 이하)만 넣을 수 있습니다.`
        render()
        return
      }
      if (!setUrl(url)) {
        failure = view.editable ? '임베드를 넣지 못했습니다 — 블록이 바뀌었습니다.' : '읽기 전용이라 임베드를 넣지 못했습니다.'
        render()
      }
    })
    form.append(input, add)
    controls.append(form)
  }

  /** 판 — 알려진 서비스는 바로 · 일반은 눌러야 · 그리지 않을 때는 이유와 주소. */
  const renderStage = (url: string): string => {
    const plan = embedPlanOf(url, ownHostsOf([window.location.origin]))
    const key = `${url}|${plan.kind}|${plan.kind === 'generic' ? String(loadedUrl === url) : ''}`
    if (key === stageKey && stage.parentElement === dom) return plan.kind === 'refused' ? '' : plan.label
    stageKey = key
    stage.replaceChildren()
    stage.removeAttribute('style')
    stage.dataset.kind = plan.kind
    if (plan.kind === 'refused') {
      const box = element('div', 'blk-embed-refused')
      box.setAttribute('data-testid', 'embed-refused')
      box.append(element('p', 'blk-embed-refused-reason', plan.reason))
      const link = element('a', 'blk-embed-refused-link', url)
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      box.append(link)
      stage.append(box)
      return ''
    }
    if (plan.kind === 'known') {
      if (plan.aspect !== undefined) stage.style.aspectRatio = String(plan.aspect)
      else stage.style.height = `${plan.height ?? 450}px`
      stage.append(embedFrame(plan))
      return plan.label
    }
    // 일반 — 눌러야 불러온다(남의 아무 주소가 저절로 열리지 않는다)
    stage.style.height = `${plan.height}px`
    if (loadedUrl === url) {
      stage.append(embedFrame(plan))
    } else {
      const facade = element('div', 'blk-embed-facade')
      facade.setAttribute('data-testid', 'embed-facade')
      facade.append(element('span', 'blk-embed-facade-host', plan.label), element('span', 'blk-embed-facade-note', '이 사이트의 화면을 이 페이지 안에 불러옵니다.'))
      const load = element('button', 'blk-embed-load', '불러오기')
      load.type = 'button'
      load.setAttribute('data-testid', 'embed-load')
      load.addEventListener('mousedown', (event) => event.preventDefault())
      load.addEventListener('click', () => {
        loadedUrl = url
        render()
      })
      facade.append(load)
      stage.append(facade)
    }
    return plan.label
  }

  const render = (): void => {
    controls.replaceChildren()
    controls.remove()
    const props = current.attrs.props as Record<string, unknown>
    const url = readEmbedUrl(props)
    const captionNode = dom.querySelector(':scope > .blk-embed-caption')
    captionNode?.remove()
    if (url !== null) {
      dom.dataset.state = 'ready'
      const label = renderStage(url)
      if (stage.parentElement !== dom) dom.prepend(stage)
      const caption = readCaption(props)
      if (caption !== '') dom.append(element('figcaption', 'blk-embed-caption', caption))
      if (label !== '') controls.append(element('span', 'blk-embed-label', label))
      controls.append(openLink(url))
      const captionButton = element('button', 'blk-embed-caption-open', caption === '' ? '캡션 추가' : '캡션 고치기')
      captionButton.type = 'button'
      captionButton.setAttribute('data-testid', 'embed-caption-open')
      captionButton.setAttribute('data-code-ui', 'embed_caption')
      captionButton.addEventListener('mousedown', (event) => event.preventDefault())
      captionButton.addEventListener('click', () => {
        if (!view.editable) return
        const id = containerIdAt(view, getPos)
        if (id !== '') deps.openEmbedCaption(id)
      })
      const edit = element('button', 'blk-embed-edit', '주소 고치기')
      edit.type = 'button'
      edit.setAttribute('data-testid', 'embed-edit')
      edit.addEventListener('mousedown', (event) => event.preventDefault())
      // 빈 상태로 되돌린다 — 캡션은 남는다(정본 ④)
      edit.addEventListener('click', () => void setUrl(null))
      controls.append(captionButton, edit)
    } else {
      dom.dataset.state = 'empty'
      stage.remove()
      stageKey = ''
      loadedUrl = ''
      const caption = readCaption(props)
      if (caption !== '') dom.append(element('figcaption', 'blk-embed-caption', caption))
      renderEmpty()
    }
    if (failure !== '') {
      const box = element('div', 'blk-embed-failure', failure)
      box.setAttribute('role', 'alert')
      controls.append(box)
    }
    if (controls.childElementCount > 0) dom.append(controls)
  }

  render()

  return {
    update: (updated) => {
      if (updated.type.name !== EMBED_TYPE) return false
      current = updated
      if (readEmbedUrl(updated.attrs.props) !== null) failure = ''
      render()
      return true
    },
    stopEvent: (event) => {
      const target = event.target
      return target instanceof Node && (controls.contains(target) || stage.contains(target))
    },
  }
}
