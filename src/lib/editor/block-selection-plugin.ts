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

import type { ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Selection } from '@tiptap/pm/state'
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

/**
 * ProseMirror 가 DOM selection 을 다시 읽어 선택을 만들 때, 그 경계가 **지금 블록
 * 선택의 경계와 같으면** 블록 선택을 그대로 돌려준다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 필요한가 — 블록 선택이 조용히 풀리는 경로
 * ──────────────────────────────────────────────────────────────────────
 *
 * `visible = false` 여도 PM 은 anchor·head 를 DOM selection 에 걸어 둔다. 그리고
 * 편집기 DOM 의 **속성 변경**을 문서 변경 후보로 등록해 그 범위를 다시 읽는다
 * (prosemirror-view `registerMutation` 의 attributes 분기). 다시 읽은 결과 내용이
 * 같아도, DOM selection 이 그 범위 안에 있으면 `selectionBetween` →
 * `TextSelection.between` 으로 선택을 **새로 만들어 dispatch** 한다(`readDOMChange`).
 *
 * 실제로 이 경로를 밟았다(#30). 당시 `body-editor.tsx` 가 접힘을 트랜잭션마다
 * 컨테이너 DOM 에 `data-collapsed` 로 **직접** 달았고, **접힌 토글을 블록 선택하면
 * 선택이 텍스트 선택으로 풀렸다.** 실제 브라우저로 확인했다 — 이 훅을 빼고 빌드하면
 * 관련 검사 3개가 실패하고 넣으면 통과한다. 헤드리스 테스트로는 잡히지 않는다
 * (MutationObserver 가 없다).
 *
 * 그 유발 원인은 접힘을 데코레이션으로 그리면서 사라졌다(`collapse-plugin.ts`).
 * 그래도 훅은 남긴다 — 편집기 DOM 을 바깥에서 건드리는 것은 우리 코드만이 아니다
 * (맞춤법 검사·번역·확장 프로그램). 어느 것이든 같은 경로로 블록 선택을 푼다.
 *
 * `selectionBetween` 은 이 prop 에 먼저 묻는다. `prosemirror-tables` 가
 * `CellSelection` 을 같은 훅으로 지킨다. 경계가 다르면(사용자가 다른 곳을 클릭)
 * null 을 돌려 평소대로 텍스트 선택이 되게 한다 — 블록 선택 모드에서 나가는 길이다.
 */
export function keepBlockSelection(
  state: EditorState,
  $anchor: ResolvedPos,
  $head: ResolvedPos,
): Selection | null {
  const sel = state.selection
  if (!isBlockSelection(sel)) return null
  if ($anchor.pos === sel.$anchorBlock.pos && $head.pos === sel.$headBlock.pos) return sel
  return null
}

export function blockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionPluginKey,
    props: {
      decorations: (state) => decorateBlockSelection(state) ?? undefined,

      createSelectionBetween: (view, $anchor, $head) => keepBlockSelection(view.state, $anchor, $head),

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
