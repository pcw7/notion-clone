/**
 * 블록 수식의 노드 뷰 — KaTeX 로 그리고, 누르면 입력창 (Phase 2 1a · F-01-20)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   div.blk.blk-equation[data-block-type=equation][role=button]
 *     div.blk-equation-render            ← KaTeX 의 출력(디스플레이 모드)
 *     p.blk-equation-placeholder         ← 식이 없을 때 "수식을 입력하세요"
 *     div.blk-equation-error             ← 그리지 못한 식 — 원문을 붉게 · 까닭은 아래 줄(저장은 그대로다)
 *     code.blk-equation-source           ← KaTeX 를 불러 오는 동안의 원문
 *
 *   · KaTeX 는 **처음 보일 때 불러 온다**(`loadKatex` — 수식이 없는 페이지는 그 묶음을 받지 않는다). 다 불러 왔을 때 노드의 식이 그사이
 *     바뀌었으면 버린다
 *   · 누르면(편집할 수 있을 때) 입력창을 연다 — 입력창은 편집기 밖의 오버레이다(`equation-editor.tsx` · 코드 캡션과 같은 까닭). 읽기
 *     전용이면 그리기만 한다(F-01-20 *"권한 없음 — 렌더만, 입력창 열지 않음"*)
 *   · 원자 블록이다 — PM 이 누른 블록을 고르고(노드 선택), 골라진 상태의 Enter 도 입력창을 연다(`openEquationCommand`)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { equationExpressionOf } from '../block/equation.ts'
import { loadKatex, renderEquation } from './equation-render.ts'

export type EquationViewDeps = {
  /** 블록 수식의 입력창을 연다 — 편집기 밖의 오버레이(머리말). */
  openEquation: (blockId: string) => void
}

/** 빈 식의 자리 표시(F-01-20 엣지 케이스). */
export const EQUATION_PLACEHOLDER = '수식을 입력하세요'

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

const expressionOf = (node: PmNode): string => equationExpressionOf((node.attrs.props ?? {}) as Record<string, unknown>)

export function equationNodeView(initial: PmNode, view: EditorView, getPos: () => number | undefined, deps: EquationViewDeps): NodeView {
  let node = initial
  let shown: string | null = null

  const dom = document.createElement('div')
  dom.className = 'blk blk-equation'
  dom.dataset.blockType = 'equation'
  dom.contentEditable = 'false'
  dom.setAttribute('role', 'button')
  dom.setAttribute('aria-label', '블록 수식')

  const show = (child: HTMLElement): void => {
    dom.replaceChildren(child)
  }

  const render = (expression: string): void => {
    if (expression === shown) return
    shown = expression
    if (expression.trim() === '') {
      const empty = document.createElement('p')
      empty.className = 'blk-equation-placeholder'
      empty.textContent = EQUATION_PLACEHOLDER
      show(empty)
      return
    }
    // 불러 오는 동안은 원문 — 자리가 비어 줄이 출렁이지 않게.
    const source = document.createElement('code')
    source.className = 'blk-equation-source'
    source.textContent = expression
    show(source)
    void loadKatex(expression).then(
      (katex) => {
        if (shown !== expression) return
        const result = renderEquation(katex, expression)
        if (result.ok) {
          const out = document.createElement('div')
          out.className = 'blk-equation-render'
          // KaTeX 의 출력 — `trust: false` 라 원문의 글자는 이스케이프되고 링크 · 이미지 · 속성을 만들지 않는다(`equation-render.ts`).
          out.innerHTML = result.html
          show(out)
          return
        }
        const error = document.createElement('div')
        error.className = 'blk-equation-error'
        const raw = document.createElement('code')
        raw.textContent = expression
        const why = document.createElement('p')
        why.className = 'blk-equation-error-message'
        why.textContent = `수식을 그릴 수 없습니다 — ${result.message}`
        error.append(raw, why)
        show(error)
      },
      () => {
        // 불러 오지 못했다(네트워크) — 원문을 그대로 둔다. 다음에 식이 바뀌면 다시 시도한다.
        shown = null
      },
    )
  }

  dom.addEventListener('click', () => {
    if (!view.editable) return
    const id = containerIdAt(view, getPos)
    if (id !== '') deps.openEquation(id)
  })

  render(expressionOf(node))

  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      node = next
      render(expressionOf(next))
      return true
    },
    // 그린 것은 우리 DOM 이다 — PM 이 다시 읽지 않는다.
    ignoreMutation: () => true,
  }
}
