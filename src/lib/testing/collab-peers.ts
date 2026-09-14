/**
 * 테스트가 쓰는 동시 편집 참여자 — 에디터 없이 Y.Doc 에 편집을 쓴다.
 *
 * `edit` 은 ProseMirror 트랜잭션을 만들어 `updateYFragment` 로 Y.Doc 에 옮긴다 — y-prosemirror 의
 * `ySyncPlugin` 이 에디터 변경을 Y.Doc 에 쓸 때 부르는 함수와 같다. client id 를 고정하면 동시 삽입의
 * 순서가 결정론이 된다.
 *
 * ⚠ **편집하기 전의 문서가 올바를 때만 쓴다.** `initProseMirrorDoc` 은 구조 위반을 만나면 Y 요소를
 * 지운다(`collab/ydoc.ts` 머리말). 합친 뒤의 상태를 읽을 때는 `readBodyYDoc` 을 쓴다.
 */

import * as Y from 'yjs'
import { initProseMirrorDoc, updateYFragment } from 'y-prosemirror'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { BODY_FRAGMENT } from '../collab/ydoc.ts'
import { blockSchema } from '../editor/schema.ts'

/** `source` 의 상태로 시작하는 참여자. */
export function peer(source: Y.Doc, clientId: number): Y.Doc {
  const ydoc = new Y.Doc()
  ydoc.clientID = clientId
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(source))
  return ydoc
}

/** 에디터가 하는 쓰기 — ProseMirror 트랜잭션을 만들어 Y.Doc 에 옮긴다. */
export function edit(ydoc: Y.Doc, change: (tr: Transaction, doc: PmNode) => void): void {
  const fragment = ydoc.getXmlFragment(BODY_FRAGMENT)
  const { doc, meta } = initProseMirrorDoc(fragment, blockSchema)
  const tr = EditorState.create({ schema: blockSchema, doc }).tr
  change(tr, doc)
  ydoc.transact(() => updateYFragment(ydoc, fragment, tr.doc, meta), 'editor')
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
