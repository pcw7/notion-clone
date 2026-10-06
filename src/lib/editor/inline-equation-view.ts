/**
 * 인라인 수식의 노드 뷰 — KaTeX 로 글자 사이에 그리고, 누르면 입력창 (Phase 2 1b · F-01-20)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   span.blk-equation[data-inline-equation][contenteditable=false]
 *     (KaTeX 의 인라인 출력)             ← 그렸다
 *     원문                                ← KaTeX 를 불러 오는 동안
 *     원문 + .blk-equation-invalid        ← 그리지 못했다(까닭은 title — 저장은 그대로다)
 *     "빈 수식"(.blk-equation-empty)      ← 식이 없다(참여자가 쓴 빈 수식 · 넣고 아직 쓰지 않은 수식)
 *
 * 그리기는 블록 수식과 같은 한 곳(`equation-render.ts` — `trust: false` 등 고정)이다. 서식(색 · 굵게)은 PM 이 노드 바깥에 마크로
 * 감싼다 — KaTeX 는 글자색을 이어받는다. 누르면(편집할 수 있을 때) 입력창 — 읽기 전용이면 그리기만 한다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { loadKatex, renderEquation } from './equation-render.ts'
import { inlineEquationRefAt, type InlineEquationRef } from './inline-equation.ts'

export type InlineEquationViewDeps = {
  /** 인라인 수식의 입력창을 연다 — 편집기 밖의 오버레이(블록 수식과 같은 입력창). */
  openInlineEquation: (ref: InlineEquationRef) => void
}

/** 빈 인라인 수식의 자리 표시. */
export const INLINE_EQUATION_EMPTY = '빈 수식'

const expressionOf = (node: PmNode): string => String(node.attrs.expression ?? '')

export function inlineEquationNodeView(
  initial: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
  deps: InlineEquationViewDeps,
): NodeView {
  let shown: string | null = null

  const dom = document.createElement('span')
  dom.className = 'blk-equation'
  dom.dataset.inlineEquation = ''
  dom.contentEditable = 'false'

  const render = (expression: string): void => {
    if (expression === shown) return
    shown = expression
    dom.classList.remove('blk-equation-invalid', 'blk-equation-empty')
    dom.removeAttribute('title')
    if (expression.trim() === '') {
      dom.classList.add('blk-equation-empty')
      dom.textContent = INLINE_EQUATION_EMPTY
      return
    }
    dom.textContent = expression
    void loadKatex(expression).then(
      (katex) => {
        if (shown !== expression) return
        const result = renderEquation(katex, expression, false)
        if (result.ok) {
          // KaTeX 의 출력 — `trust: false` 라 링크 · 이미지 · 속성을 만들지 않는다.
          dom.innerHTML = result.html
          return
        }
        dom.classList.add('blk-equation-invalid')
        dom.title = `수식을 그릴 수 없습니다 — ${result.message}`
      },
      () => {
        shown = null
      },
    )
  }

  dom.addEventListener('click', () => {
    if (!view.editable) return
    const pos = getPos()
    if (pos === undefined) return
    const ref = inlineEquationRefAt(view.state, pos)
    if (ref !== null) deps.openInlineEquation(ref)
  })

  render(expressionOf(initial))

  return {
    dom,
    update(next) {
      if (next.type !== initial.type) return false
      render(expressionOf(next))
      return true
    },
    ignoreMutation: () => true,
  }
}
