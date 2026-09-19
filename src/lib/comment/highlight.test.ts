/**
 * 코멘트 하이라이트 — 편집을 따라가는가 (F-05-07 · 코멘트 4b조각)
 *
 * DB 도 DOM 도 쓰지 않는다. 확인하는 것 셋.
 *
 *   ① 앵커가 가리키는 글자에 데코레이션이 그려진다 — 겹치면 둘로 남는다
 *   ② **그 뒤의 편집을 따라간다** — 앞에 친 글자는 범위를 밀고, 안에 친 글자는 범위를 늘린다. 내 편집만이 아니라
 *      **원격 편집**도 그래야 한다 — 처음에는 매핑만으로 따라가려 했는데 원격 편집에서 하이라이트가 통째로
 *      사라졌다(`highlight.ts` 머리말 · §3.3-138). 그래서 문서가 바뀔 때마다 Y.Doc 에 다시 묻는다
 *   ③ 풀리지 않거나 길이가 0 인 스레드는 그리지 않는다 — 본문에 그릴 자리가 없다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Decoration } from '@tiptap/pm/view'
import * as Y from 'yjs'

import { collabSchema } from '../collab/collab-schema.ts'
import { createBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { bind, edit, findBlock } from '../testing/collab-peers.ts'
import { textRangeAnchor, type TextRangeAnchor } from './anchor.ts'
import { commentDecorations, commentHighlightPlugin, drawnHighlights, setCommentThreads, type AnchoredThread } from './highlight.ts'

const A = 'aaaaaaaa-1111-4111-8111-111111111111'
const B = 'bbbbbbbb-1111-4111-8111-111111111111'

const para = (id: string, text: string): EditorBlock => ({ id, type: 'paragraph', title: [textRun(text)] })

function body(): Y.Doc {
  return createBodyYDoc({ blocks: [para(A, '가나다라마바사'), para(B, '둘째 문단')] })
}

function anchorOn(ydoc: Y.Doc, blockId: string, start: number, end: number): TextRangeAnchor {
  const anchor = textRangeAnchor(ydoc, blockId, start, end)
  assert.ok(anchor !== null, '앵커를 만들지 못했다')
  return anchor
}

const thread = (id: string, blockId: string, anchor: TextRangeAnchor): AnchoredThread => ({
  discussionId: id,
  blockId,
  anchor,
})

/** 데코레이션이 덮는 글자 — 에디터 문서에서 읽는다. */
const coveredBy = (doc: PmNode, decorations: readonly Decoration[]): string[] =>
  decorations.map((d) => doc.textBetween(d.from, d.to))

describe('하이라이트를 그린다', () => {
  test('앵커가 가리키는 글자를 덮고, 겹치면 둘로 남는다', () => {
    const ydoc = body()
    const editor = bind(ydoc, collabSchema, [commentHighlightPlugin({ ydoc })])
    const threads = [
      thread('d1', A, anchorOn(ydoc, A, 2, 5)),
      thread('d2', A, anchorOn(ydoc, A, 4, 7)),
      thread('d3', B, anchorOn(ydoc, B, 0, 2)),
    ]

    const decorations = commentDecorations(editor.state.doc, ydoc, threads)
    assert.deepEqual(coveredBy(editor.state.doc, decorations), ['다라마', '마바사', '둘째'])
    assert.deepEqual(
      decorations.map((d) => (d.spec as { discussionId: string }).discussionId),
      ['d1', 'd2', 'd3'],
      '겹치는 범위는 데코레이션 둘로 남는다 (05 F-05-07 중첩 렌더)',
    )
  })

  test('풀리지 않거나 길이가 0 이면 그리지 않는다', () => {
    const ydoc = body()
    const editor = bind(ydoc, collabSchema, [commentHighlightPlugin({ ydoc })])
    const anchor = anchorOn(ydoc, A, 2, 5)

    // 그 글자를 전부 지운다 — 앵커는 살아 있지만 길이가 0 이다.
    edit(ydoc, (tr: Transaction, doc: PmNode) => {
      const { pos } = findBlock(doc, A)
      tr.delete(pos + 2 + 2, pos + 2 + 5)
    })
    assert.deepEqual(commentDecorations(editor.state.doc, ydoc, [thread('d1', A, anchor)]), [])

    // 블록을 통째로 지우면 풀리지 않는다.
    const gone = body()
    const goneAnchor = anchorOn(gone, A, 2, 5)
    const goneEditor = bind(gone, collabSchema, [commentHighlightPlugin({ ydoc: gone })])
    edit(gone, (tr: Transaction, doc: PmNode) => {
      const { pos, node } = findBlock(doc, A)
      tr.delete(pos, pos + node.nodeSize)
    })
    assert.deepEqual(commentDecorations(goneEditor.state.doc, gone, [thread('d1', A, goneAnchor)]), [])
  })
})

describe('★ 하이라이트가 편집을 따라간다', () => {
  test('앞에 친 글자는 밀고, 안에 친 글자는 늘린다', () => {
    const ydoc = body()
    const editor = bind(ydoc, collabSchema, [commentHighlightPlugin({ ydoc })])
    setCommentThreads(editor, [thread('d1', A, anchorOn(ydoc, A, 2, 5))])

    const drawn = (): string[] =>
      drawnHighlights(editor.state).find().map((d) => editor.state.doc.textBetween(d.from, d.to))
    assert.deepEqual(drawn(), ['다라마'])

    // 앞에 친다 — 스레드 목록을 다시 넣지 않는다. 문서가 바뀌면 스스로 다시 풀어야 한다.
    editor.dispatch(editor.state.tr.insertText('앞앞', findBlock(editor.state.doc, A).pos + 2))
    assert.deepEqual(drawn(), ['다라마'], '밀렸을 뿐 같은 글자를 덮는다')

    // 안에 친다.
    editor.dispatch(editor.state.tr.insertText('XX', findBlock(editor.state.doc, A).pos + 2 + 5))
    assert.deepEqual(drawn(), ['다XX라마'], '범위 안에 친 글자는 하이라이트 안으로 들어온다')
  })

  test('★ 원격 편집도 따라간다 — 다른 참여자가 앞에 쳐도 같은 글자를 덮는다', () => {
    const ydoc = body()
    const editor = bind(ydoc, collabSchema, [commentHighlightPlugin({ ydoc })])
    setCommentThreads(editor, [thread('d1', A, anchorOn(ydoc, A, 2, 5))])

    const peerDoc = new Y.Doc()
    peerDoc.clientID = 4242
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc))
    edit(peerDoc, (tr: Transaction, doc: PmNode) => {
      tr.insertText('원격', findBlock(doc, A).pos + 2)
    })
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(ydoc)))

    assert.deepEqual(
      drawnHighlights(editor.state)
        .find()
        .map((d) => editor.state.doc.textBetween(d.from, d.to)),
      ['다라마'],
    )
    assert.ok(editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ').startsWith('원격가나다'), '원격 편집이 들어왔다')
  })
})
