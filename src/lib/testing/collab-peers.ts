/**
 * 테스트가 쓰는 동시 편집 참여자 — 에디터 없이 Y.Doc 에 편집을 쓴다.
 *
 * `edit` 은 ProseMirror 트랜잭션을 만들어 `updateYFragment` 로 Y.Doc 에 옮긴다 — y-prosemirror 의
 * `ySyncPlugin` 이 에디터 변경을 Y.Doc 에 쓸 때 부르는 함수와 같다. 문서는 바인딩과 같이 `collabSchema` 로
 * 읽으므로 구조 위반이 있어도 Y 요소를 지우지 않는다. 다만 위반 자리를 건드리는 편집은 ProseMirror 가 거부할 수
 * 있다(그 자리의 내용 규칙을 검사한다). client id 를 고정하면 동시 삽입의 순서가 결정론이 된다.
 *
 * `bind` 는 실제 `ySyncPlugin` 을 헤드리스로 붙인다 — 바인딩 코드가 그대로 돈다.
 */

import * as Y from 'yjs'
import { ySyncPlugin } from 'y-prosemirror'
import { EditorState, type Plugin, type PluginView, type Transaction } from '@tiptap/pm/state'
import type { Node as PmNode, Schema } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import { writeEditorChange, type EditorChange } from '../collab/body-edit.ts'
import { collabSchema } from '../collab/collab-schema.ts'
import { BODY_FRAGMENT } from '../collab/ydoc.ts'
import { atomMarksPlugin } from '../editor/atom-marks.ts'

/** `source` 의 상태로 시작하는 참여자. */
export function peer(source: Y.Doc, clientId: number): Y.Doc {
  const ydoc = new Y.Doc()
  ydoc.clientID = clientId
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(source))
  return ydoc
}

/** 에디터가 하는 쓰기 — 서버 명령 경로와 같은 함수로 Y.Doc 에 옮긴다(`collab/body-edit.ts`). */
export function edit(ydoc: Y.Doc, change: EditorChange): void {
  writeEditorChange(ydoc, change, 'editor')
}

export type FoundBlock = { readonly pos: number; readonly node: PmNode }

/** blockId 의 컨테이너 위치. 내용 노드는 `pos + 1`, 글자의 시작은 `pos + 2` 다. */
export function findBlock(doc: PmNode, blockId: string): FoundBlock {
  const hits: FoundBlock[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && node.attrs.blockId === blockId) hits.push({ pos, node })
    return hits.length === 0
  })
  if (hits.length !== 1) throw new Error(`블록이 없다: ${blockId}`)
  return hits[0]
}

/** 두 참여자가 서로의 update 를 받는다. */
export function exchange(a: Y.Doc, b: Y.Doc): void {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  Y.applyUpdate(b, toB)
  Y.applyUpdate(a, toA)
}

/** `ydoc` 에만 있고 `base` 에는 없는 변경 — 참여자가 서버로 보내는 update 다. */
export function changesSince(ydoc: Y.Doc, base: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(base))
}

export type BoundEditor = {
  readonly state: EditorState
  dispatch(tr: Transaction): void
  destroy(): void
}

/**
 * `ydoc` 에 `ySyncPlugin` 을 붙인 에디터 — EditorView 없이.
 *
 * 바인딩이 view 에서 쓰는 것만 흉내 낸다: `state` · `dispatch`(적용한 뒤 플러그인 뷰의 `update`) · `hasFocus`.
 * EditorView 처럼 초기화 도중의 dispatch 에서는 아직 만들어지지 않은 플러그인 뷰를 부르지 않는다.
 * 원격 update 는 `Y.applyUpdate(ydoc, …)` 로 넣는다 — 바인딩이 Y.Doc 을 관찰해 문서에 옮긴다.
 *
 * @param schema 에디터 상태의 스키마. 바인딩은 이것을 변환에 넘긴다(`collab-schema.ts` 머리말).
 * @param plugins 바인딩 옆에 둘 플러그인. 기본은 에디터에 있는 서식 거울(`editor/atom-marks.ts`).
 */
export function bind(ydoc: Y.Doc, schema: Schema = collabSchema, plugins: readonly Plugin[] = [atomMarksPlugin()]): BoundEditor {
  const all = [ySyncPlugin(ydoc.getXmlFragment(BODY_FRAGMENT)) as Plugin, ...plugins]
  let state = EditorState.create({ schema, plugins: all })
  // EditorView 처럼 플러그인 뷰를 전부 차례로 만든다. 만들어지는 도중의 dispatch 는 이미 만든 뷰만 부른다.
  const mounted: PluginView[] = []
  const view = {
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      const previous = state
      state = state.apply(tr)
      for (const pluginView of mounted) pluginView.update?.(view as unknown as EditorView, previous)
    },
    hasFocus: () => false,
  }
  for (const plugin of all) {
    const pluginView = plugin.spec.view?.(view as unknown as EditorView)
    if (pluginView !== undefined) mounted.push(pluginView)
  }
  return {
    get state() {
      return state
    },
    dispatch: view.dispatch,
    destroy: () => {
      for (const pluginView of mounted) pluginView.destroy?.()
    },
  }
}
