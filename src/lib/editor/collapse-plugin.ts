/**
 * 접힘을 그린다 — F-01-13
 *
 * 접힘 상태는 **문서에 없다**(F-01-13: *"문서 데이터로 저장하면 상대 화면이 멋대로
 * 접힘 → 로컬 저장 권장"*). 뷰어별 상태로 화면 컴포넌트가 들고 있고, 여기서는
 * 그것을 **데코레이션**으로 그리기만 한다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 데코레이션인가 — 예전 방식은 브라우저에서 동작하지 않았다
 * ──────────────────────────────────────────────────────────────────────
 *
 * W4 부터 `body-editor.tsx` 가 트랜잭션마다 컨테이너 DOM 에 `data-collapsed` 를
 * **직접** 달았다. 실제 브라우저에서 MutationObserver 로 관찰하니 이렇게 됐다:
 *
 *   ① `data-collapsed="true"` 가 붙는다
 *   ② ProseMirror 가 그 속성 변경을 "편집기 DOM 이 바깥에서 바뀌었다"로 감지해
 *      그 범위를 dirty 로 표시하고(`DOMObserver.flush` → `markDirty`)
 *   ③ **모델 기준으로 다시 그린다** — 컨테이너 요소가 DOM 에서 빠지고 새로 생긴다.
 *      새 요소에는 속성이 없다
 *
 * 그래서 토글을 접어도 자식이 숨겨지지 않았다. 화살표는 `▸` 로 바뀌는데 자식은
 * 그대로 보였다. DOM 을 쓰지 않는 헤드리스 테스트로는 보이지 않는 종류다.
 *
 * **ProseMirror 가 소유한 DOM 은 ProseMirror 만 고친다.** 데코레이션은 PM 이 직접
 * 속성을 다는 통로라 ②가 일어나지 않는다. 같은 이유로 `block-gutter.tsx` 는 드래그
 * 표시를 편집기 DOM 이 아니라 바깥 프레임에 단다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 내용 노드에도 단다 — 화살표가 따라오게
 * ──────────────────────────────────────────────────────────────────────
 *
 * 컨테이너의 속성은 CSS 가 자식을 숨기는 데 쓴다(`editor.css` ②). 토글 **내용
 * 노드**에도 같은 속성을 다는 이유는 화살표다. PM 은 노드의 데코레이션이 바뀌면 그
 * 노드 뷰의 `update` 를 부르므로, 병합·드롭이 **프로그램으로** 펼칠 때도
 * 화살표(▾/▸)와 `aria-expanded` 가 따라 바뀐다. 컨테이너에만 달면 내용 노드의 뷰는
 * 불리지 않아, 화살표를 직접 누를 때만 방향이 맞았다.
 */

import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const collapsePluginKey = new PluginKey('collapse')

const COLLAPSED = { 'data-collapsed': 'true' } as const

/** 접힌 블록마다 컨테이너와 내용 노드에 데코레이션을 단다. */
export function decorateCollapsed(
  doc: PmNode,
  isCollapsed: (blockId: string) => boolean,
): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'blockGroup') return true
    // blockContent(paragraph·heading…) 안에는 컨테이너가 없다. 들어가지 않는다 —
    // 트랜잭션마다 도는 자리라 인라인까지 훑으면 긴 문서에서 비싸다.
    if (name !== 'blockContainer') return false

    const id = String(node.attrs.blockId ?? '')
    // 자식이 없는 블록은 접을 것이 없다. 접힘 집합에 남아 있어도(자식을 다 지운
    // 경우) 그리지 않는다.
    if (id !== '' && node.childCount > 1 && isCollapsed(id)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, COLLAPSED))
      const content = node.child(0)
      decorations.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, COLLAPSED))
    }
    // 접혀 있어도 안으로 들어간다. 접힌 토글 안의 접힌 토글도 접힌 채로 그려야
    // 바깥을 펼쳤을 때 안쪽이 멋대로 펼쳐져 보이지 않는다.
    return true
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * @param isCollapsed 접힘 상태를 묻는 함수. 상태가 바뀌면 부르는 쪽이 빈
 *   트랜잭션을 dispatch 해 다시 그리게 한다(`body-editor.tsx` 의 `expandBlock`).
 *   데코레이션은 PM 이 매 갱신마다 이 prop 으로 다시 계산한다.
 */
export function collapsePlugin(isCollapsed: (blockId: string) => boolean): Plugin {
  return new Plugin({
    key: collapsePluginKey,
    props: {
      decorations: (state: EditorState) => decorateCollapsed(state.doc, isCollapsed),
    },
  })
}
