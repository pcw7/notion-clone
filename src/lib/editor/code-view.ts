/**
 * 코드 블록의 노드 뷰 — 언어 · 줄바꿈 · 복사 · 캡션 · 빈 블록의 자리 표시 (잔여 묶음 8a-2 · F-01-14)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 모양 — 편집 영역이 첫 자식이고, 크롬은 그 뒤에 편집 불가로
 * ──────────────────────────────────────────────────────────────────────
 *
 *   div.blk.blk-code-block[data-block-type=code][data-wrap][data-empty][data-language]
 *     pre.blk-code[spellcheck=false]               ← contentDOM (8a-1 의 셀렉터 · CSS 그대로)
 *     div.blk-code-bar[contenteditable=false]      ← 언어 · 줄바꿈 · 복사 · 캡션 버튼(CSS 로 오른쪽 위에 올린다)
 *     div.blk-code-caption[contenteditable=false]  ← 캡션 글자(있을 때)
 *
 *   · 크롬을 `pre` **뒤에** 둔다 — 블록 손잡이 · 드롭 줄은 컨테이너의 첫 요소 자식(이 뷰의 dom)을 재므로 그대로이고, 노드 뷰 dom
 *     직속 위치를 PM 이 코드의 끝으로 읽는 규칙(`localPosFromDOM`)과도 맞는다. `data-block-id` 는 달지 않는다(컨테이너가 단다)
 *   · **`pre` 자체가 contentDOM 이다**(스키마의 toDOM 은 `pre > code` — 클립보드용이라 그대로). 안에 `code` 를 두면 `pre` 의 여백을
 *     눌렀을 때 캐럿이 contentDOM 밖(`pre` 안)에 서고, 그 자리의 입력은 아래 ④ 가 무시해 문서와 화면이 갈린다
 *   · 언어 목록 · 캡션 입력칸은 **여기 두지 않는다** — 편집기 밖의 React 오버레이다(`body-editor.tsx`). 참조 제목 · 멘션 이름이
 *     갱신될 때마다 편집기가 모든 노드 뷰를 새로 만들므로(`setProps({nodeViews})`) 여기 둔 열린 목록 · 쓰는 중인 캡션은 사라지고,
 *     편집 영역 안의 입력칸은 한글 조합 · 키 · 붙여넣기가 ProseMirror 로 새는 길을 막아야 한다. 밖에 두면 둘 다 없다
 *
 * ──────────────────────────────────────────────────────────────────────
 * ProseMirror 가 크롬에 반응하지 않게 — 네 겹(to_do · toggle 의 방식을 넓힌 것)
 * ──────────────────────────────────────────────────────────────────────
 *
 *   ① 크롬 요소에 contentEditable=false  ② 버튼 mousedown preventDefault(캐럿 · 포커스를 붙잡아 둔다)
 *   ③ `stopEvent` — 대상이 크롬 안이면 true(이벤트 종류로 거르지 않는다)
 *   ④ `ignoreMutation` — contentDOM 밖의 **DOM 변화**는 무시한다. **contentDOM 이 있는 노드 뷰는 기본값이 '관찰'이다** — 무시하지
 *     않으면 '복사됨' 같은 비동기 글자 하나가 노드 전체를 다시 그리게 한다(image-view 머리말의 경로). **선택 기록은 무시하지 않는다**
 *     — 코드에서 캡션까지 끌어 고른 선택을 PM 이 놓치면 복사(읽기 전용에서도 PM 이 받는다)가 낡은 선택을 싣는다. 크롬 안의 끝점은
 *     PM 이 코드의 끝으로 읽는다(`localPosFromDOM`)
 *
 * 키보드: 버튼은 탭 순서에 두지 않는다 — 언어 · 줄바꿈 · 캡션 · 복사의 키보드 경로는 블록 메뉴(Mod+/ → 코드)다. **읽기 전용에서는
 * 복사만 탭 순서에 선다** — 블록 메뉴가 열리지 않으므로(키 입력은 편집 처리기다) 그것이 유일한 경로다. 편집 중에는 두지 않는다 —
 * 들여쓸 수 없는 자리(첫 블록 · 제목 뒤)의 Tab 은 키맵이 먹지 않아 브라우저가 다음 탭 정지로 포커스를 옮기는데, 그것이 멀리 있는
 * 코드 블록의 복사 버튼이면 그리로 스크롤하고 Enter 가 클립보드를 덮어썼다(8a-2 리뷰). 편집 가능 여부가 바뀌어도 노드 뷰는 다시
 * 만들어지지 않으므로 편집기가 맞춘다(`node-views.ts` `syncReadOnlyTabStops` — 목차의 링크와 함께). 포커스가 서면 `:focus-within` 이 버튼 줄을 보인다
 *
 * ──────────────────────────────────────────────────────────────────────
 * 읽기 전용 — 누르는 순간에 묻는다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 편집 가능 여부가 바뀌어도(잠금 · 권한 강등 · 다시 여는 중) 노드 뷰는 다시 만들어지지도 update 되지도 않는다(`setProps({editable})`
 * 는 루트의 contenteditable 만 바꾼다). 그래서 ① 모양은 루트 속성으로 CSS 가 가르고(`.blk-editor[contenteditable]`), ② 문서를 쓰는
 * 핸들러는 누르는 순간 `view.editable` 을 묻는다. 읽기 전용에서 dispatch 하면 서버가 거부하고 편집기가 본문을 버리고 다시 연다.
 * 복사는 문서를 바꾸지 않으므로 읽기 전용에서도 된다(노션도 그렇다 — 8a-2 조사의 실측).
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { codeCaptionText, codeLanguageLabel, codeLanguageOf } from '../block/code.ts'
import type { BlockFormat } from '../block/types.ts'
import { setCodeWrapCommand } from './code-block.ts'
import { copyText } from './copy-text.ts'

export type CodeViewDeps = {
  /** 언어 목록을 연다 — 목록은 편집기 밖의 오버레이다(머리말). */
  openCodeLanguageMenu: (blockId: string) => void
  /** 캡션 입력을 연다 — 편집기 밖의 오버레이. */
  openCodeCaption: (blockId: string) => void
}

/** '복사됨' 을 보여 주는 시간. */
const COPIED_MS = 1500

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testId?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== '') node.className = className
  if (testId !== undefined) node.dataset.testid = testId
  return node
}

/** 컨테이너의 blockId — 노드 뷰는 내용 노드만 받으므로 위로 올라간다. */
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

export function codeNodeView(
  initial: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: CodeViewDeps,
): NodeView {
  let node = initial

  const dom = el('div', 'blk blk-code-block')
  dom.dataset.blockType = 'code'
  const pre = el('pre', 'blk-code')
  pre.spellcheck = false

  const bar = el('div', 'blk-code-bar')
  bar.contentEditable = 'false'
  const language = el('button', 'blk-code-lang blk-code-edit', 'code-language')
  language.type = 'button'
  language.setAttribute('aria-haspopup', 'listbox')
  // 오버레이를 연 트리거 — 다시 누르면 닫는다(`body-editor.tsx` `openCodeUi`). 바깥 누르기가 먼저 닫고 click 이 다시 열지 않게.
  language.dataset.codeUi = 'language'
  // 편집기 안에서 Tab 은 들여쓰기다 — 버튼에 Tab 으로 닿는 길이 없으므로 탭 순서에서 뺀다. 키보드 경로는 블록 메뉴(Mod+/)다(머리말).
  language.tabIndex = -1
  const languageLabel = el('span', 'blk-code-lang blk-code-readonly', 'code-language-label')
  const wrap = el('button', 'blk-code-edit', 'code-wrap-toggle')
  wrap.type = 'button'
  wrap.tabIndex = -1
  wrap.textContent = '줄바꿈'
  const copy = el('button', 'blk-code-copy', 'code-copy')
  copy.type = 'button'
  // 읽기 전용에서만 탭 순서에 선다 — 그때의 유일한 키보드 경로다(머리말 · 편집 가능 여부가 바뀌면 `syncReadOnlyTabStops`).
  copy.dataset.readonlyTab = ''
  copy.tabIndex = view.editable ? -1 : 0
  copy.setAttribute('aria-label', '코드 복사')
  copy.textContent = '복사'
  const addCaption = el('button', 'blk-code-edit', 'code-caption-add')
  addCaption.type = 'button'
  addCaption.tabIndex = -1
  addCaption.textContent = '캡션'
  addCaption.dataset.codeUi = 'caption'
  // 복사 결과를 읽어 준다 — 버튼 글자 바꾸기만으로는 화면 읽기 프로그램이 알리지 않는다.
  const announce = el('span', 'sr-only')
  announce.setAttribute('role', 'status')
  announce.setAttribute('aria-live', 'polite')
  bar.append(language, languageLabel, wrap, copy, addCaption, announce)

  const caption = el('div', 'blk-code-caption', 'code-caption')
  caption.contentEditable = 'false'
  caption.dataset.codeUi = 'caption'

  dom.append(pre, bar, caption)

  // 캐럿 · 포커스를 붙잡아 둔다 — 누르는 순간 선택이 옮겨 가면 PM 이 버튼 자리를 문서 위치로 읽는다. 버튼마다가 아니라 **줄 전체**
  // 에 건다 — 버튼 사이 틈을 누르면 편집 호스트가 포커스를 받아 PM 이 들고 있던 옛 캐럿(화면 밖일 수 있다)이 되살아났다(8a-2 리뷰).
  bar.addEventListener('mousedown', (event) => event.preventDefault())

  const blockId = (): string => containerIdAt(view, getPos)

  language.addEventListener('click', () => {
    if (!view.editable) return
    const id = blockId()
    if (id !== '') deps.openCodeLanguageMenu(id)
  })

  wrap.addEventListener('click', () => {
    if (!view.editable) return
    const id = blockId()
    if (id === '') return
    const on = (node.attrs.format as BlockFormat | undefined)?.code_wrap === true
    setCodeWrapCommand(id, !on)(view.state, view.dispatch.bind(view))
  })

  const openCaption = (): void => {
    if (!view.editable) return
    const id = blockId()
    if (id !== '') deps.openCodeCaption(id)
  }
  addCaption.addEventListener('click', openCaption)
  caption.addEventListener('mousedown', (event) => {
    if (view.editable) event.preventDefault()
  })
  caption.addEventListener('click', openCaption)

  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  copy.addEventListener('click', () => {
    // 화면(DOM)이 아니라 문서의 글자를 복사한다 — 자리 표시 · 크롬 글자가 섞이지 않는다.
    const pos = getPos()
    const current = pos === undefined ? null : view.state.doc.nodeAt(pos)
    const text = current?.textContent ?? node.textContent
    void copyText(text).then((ok) => {
      if (copiedTimer !== null) clearTimeout(copiedTimer)
      copy.textContent = ok ? '복사됨' : '복사 실패'
      announce.textContent = ok ? '코드를 복사했습니다.' : '코드를 복사하지 못했습니다.'
      copiedTimer = setTimeout(() => {
        copiedTimer = null
        copy.textContent = '복사'
        announce.textContent = ''
      }, COPIED_MS)
    })
  })

  /** attrs · 비었는지를 DOM 에 옮긴다 — 값이 바뀐 곳만 쓴다(글자마다 불린다). */
  const render = (current: PmNode): void => {
    const props = (current.attrs.props ?? {}) as Record<string, unknown>
    const format = (current.attrs.format ?? {}) as BlockFormat
    const lang = codeLanguageOf(props)
    const label = codeLanguageLabel(lang)
    if (language.textContent !== label) {
      language.textContent = label
      language.setAttribute('aria-label', `언어: ${label} — 바꾸기`)
      languageLabel.textContent = label
    }
    const langAttr = lang ?? ''
    if (dom.dataset.language !== langAttr) dom.dataset.language = langAttr
    const wrapped = format.code_wrap === true ? 'true' : 'false'
    if (dom.dataset.wrap !== wrapped) {
      dom.dataset.wrap = wrapped
      wrap.setAttribute('aria-pressed', wrapped)
    }
    const empty = current.content.size === 0 ? 'true' : 'false'
    if (dom.dataset.empty !== empty) {
      dom.dataset.empty = empty
      copy.disabled = empty === 'true'
    }
    const text = codeCaptionText(props)
    if (caption.textContent !== text) caption.textContent = text
    const hasCaption = text !== ''
    if (caption.hidden === hasCaption) caption.hidden = !hasCaption
    if (addCaption.hidden !== hasCaption) addCaption.hidden = hasCaption
  }
  render(node)

  return {
    dom,
    contentDOM: pre,
    update(updated) {
      if (updated.type !== node.type) return false
      node = updated
      render(updated)
      return true
    },
    stopEvent(event) {
      const target = event.target
      return target instanceof Node && (bar.contains(target) || caption.contains(target))
    },
    ignoreMutation(mutation) {
      // contentDOM(코드 글자) 안의 DOM 변화만 PM 이 읽는다. 크롬 · 캡션 · dom 의 속성 변화는 문서가 아니다. 선택은 늘 읽게 한다(머리말 ④).
      return mutation.type !== 'selection' && !pre.contains(mutation.target)
    },
    destroy() {
      if (copiedTimer !== null) clearTimeout(copiedTimer)
    },
  }
}

