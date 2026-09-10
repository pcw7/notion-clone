/**
 * 블록 선택의 화면 표현과 마우스 조작 — F-01-09 / F-12-12
 *
 * 상태는 `block-selection.ts` 의 `BlockSelection` 이 전부 갖고 있다. 이 파일은
 * 그것을 **보이게** 만들고 마우스로 만질 수 있게 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 하이라이트는 컨테이너에 건다
 * ──────────────────────────────────────────────────────────────────────
 *
 * 데코레이션은 최상위 블록의 `blockContainer` 하나에만 붙는다. 자손은 그 안에
 * 들어 있으므로 CSS 배경 하나로 subtree 전체가 칠해진다 — "자식이 있는 블록을
 * 선택하면 자식도 암묵적으로 포함된다"(F-01-09)가 화면에서도 그대로 보인다.
 * 자손마다 데코레이션을 달면 겹친 배경이 진해져서 선택 범위가 왜곡된다.
 *
 * F-12-12 가 요구한 `aria-selected` 도 같은 자리에 붙인다. 선택 개수 안내
 * (라이브 리전)는 화면 컴포넌트의 몫이다 — 이 파일은 DOM 을 만들지 않는다.
 */

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { BlockSelection, isBlockSelection } from './block-selection.ts'
import { containerAt } from './pm-blocks.ts'

export const blockSelectionPluginKey = new PluginKey('blockSelection')

export function decorateBlockSelection(state: EditorState): DecorationSet | null {
  const sel = state.selection
  if (!isBlockSelection(sel)) return null

  const decorations: Decoration[] = []
  for (const pos of sel.rootPositions) {
    const node = state.doc.nodeAt(pos)
    if (!node) continue
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: 'blk-selected',
        'aria-selected': 'true',
      }),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

export function blockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionPluginKey,
    props: {
      decorations: (state) => decorateBlockSelection(state) ?? undefined,

      /**
       * `Shift+클릭` — 클릭한 블록까지 선택을 늘린다 (F-01-09 시나리오).
       *
       * **블록 선택 모드일 때만** 가로챈다. 편집 모드의 shift+클릭은 텍스트 범위
       * 선택이고, 그건 브라우저가 우리보다 잘한다.
       */
      handleClick: (view, pos, event) => {
        if (!event.shiftKey) return false
        const sel = view.state.selection
        if (!isBlockSelection(sel)) return false

        const info = containerAt(view.state.doc.resolve(pos))
        if (!info) return false

        view.dispatch(
          view.state.tr.setSelection(
            BlockSelection.create(view.state.doc, sel.$anchorBlock.pos, info.pos),
          ),
        )
        return true
      },
    },
  })
}
