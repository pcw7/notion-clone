/**
 * 버튼 블록의 노드 뷰 — 라벨의 단추 · 결과 한 줄 · 설정(⚙) (자동화 5e-1 · F-08-06)
 *
 * ⚠ 이 파일은 브라우저에서만 로드된다(`document` 를 쓴다).
 *
 *   div.blk.blk-button[data-block-type=button]
 *     button.blk-button-press        ← 라벨(비면 "버튼"). 누르면 실행한다(편집할 수 있을 때만 — 08 *"클릭 권한 = 편집"*)
 *     span.blk-button-result         ← 결과 한 줄(버튼 속성과 같은 말)
 *     button.blk-button-settings     ← ⚙ — 설정 창(라벨 · 액션)을 연다. 편집할 수 있을 때만 선다
 *
 *   · 원자 블록이다 — 단추를 누른 것은 PM 이 처리하지 않는다(`stopEvent`). 블록의 나머지(여백)를 누르면 노드 선택이 된다
 *   · 누르는 동안은 단추를 막는다(연타 — 서버도 멱등 키로 막는다)
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView, NodeView } from '@tiptap/pm/view'

import { buttonDisplayLabel } from '../block/button.ts'

export type ButtonPressResult = { readonly text: string; readonly tone: 'ok' | 'warn' | 'error' }

export type ButtonViewDeps = {
  /** 누른다 — 서버에 실행을 부탁하고 결과 한 줄을 돌려준다(편집기 밖 · `body-editor.tsx`). */
  pressButtonBlock: (blockId: string) => Promise<ButtonPressResult>
  /** 설정 창을 연다 — 편집기 밖의 오버레이(라벨 · 액션). */
  openButtonBlock: (blockId: string) => void
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

const labelOf = (node: PmNode): string => buttonDisplayLabel((node.attrs.props ?? {}) as Record<string, unknown>)

export function buttonNodeView(initial: PmNode, view: EditorView, getPos: () => number | undefined, deps: ButtonViewDeps): NodeView {
  let node = initial

  const dom = document.createElement('div')
  dom.className = 'blk blk-button'
  dom.dataset.blockType = 'button'
  dom.contentEditable = 'false'

  const press = document.createElement('button')
  press.type = 'button'
  press.className = 'blk-button-press'
  press.dataset.testid = 'blk-button-press'
  press.setAttribute('data-testid', 'blk-button-press')

  const result = document.createElement('span')
  result.className = 'blk-button-result'
  result.setAttribute('role', 'status')
  result.setAttribute('data-testid', 'blk-button-result')

  const settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'blk-button-settings'
  settings.setAttribute('aria-label', '버튼 설정')
  settings.setAttribute('data-testid', 'blk-button-settings')
  settings.textContent = '⚙'

  dom.append(press, result, settings)

  const sync = (): void => {
    press.textContent = labelOf(node)
    // 편집할 수 없으면 누르지도 고치지도 않는다(08 — 클릭 권한은 편집)
    press.disabled = !view.editable
    settings.hidden = !view.editable
  }

  press.addEventListener('click', () => {
    if (!view.editable || press.dataset.busy === 'true') return
    const id = containerIdAt(view, getPos)
    if (id === '') return
    press.dataset.busy = 'true'
    press.disabled = true
    result.textContent = '실행하는 중…'
    result.dataset.tone = 'warn'
    void deps
      .pressButtonBlock(id)
      .then(
        (outcome) => {
          result.textContent = outcome.text
          result.dataset.tone = outcome.tone
        },
        () => {
          result.textContent = '실행하지 못했습니다.'
          result.dataset.tone = 'error'
        },
      )
      .finally(() => {
        delete press.dataset.busy
        press.disabled = !view.editable
      })
  })

  settings.addEventListener('click', () => {
    if (!view.editable) return
    const id = containerIdAt(view, getPos)
    if (id !== '') deps.openButtonBlock(id)
  })

  sync()

  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false
      node = next
      sync()
      return true
    },
    // 단추들은 우리가 처리한다 — PM 이 노드를 고르지 않게
    stopEvent: (event) => event.target instanceof HTMLElement && event.target.closest('button') !== null,
    // 그린 것은 우리 DOM 이다 — PM 이 다시 읽지 않는다.
    ignoreMutation: () => true,
  }
}
