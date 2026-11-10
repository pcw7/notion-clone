/**
 * 수락 전 원문 — 제안 마크를 뗀 문서 (SG-2 · F-05-12 · 판결 U-2)
 *
 * 이 파일이 지키는 것.
 *
 *   ① insert 마크 글(원자 포함)은 빠지고 delete 마크 글은 그냥 글로 남는다 · format 은 마크만 떨어진다 · 다른 서식은 그대로
 *   ② insert 와 delete 가 함께 선 글(남이 넣자는 글을 지우자고 한 것)은 원문에 없다
 *   ③ 뗀 마크는 sid 마다 처음 본 종류 · 사람과 그 sid 의 글(문서 차례로 이은 것)로 돌려준다
 *   ④ Y.Doc 읽기(`readBodyYDoc`)가 원문을 읽는다 — 행 투영 · 복제 · 색인이 받는 문서다
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import type { Mark, Node as PmNode } from '@tiptap/pm/model'

import { BODY_FRAGMENT, readBodyYDoc } from '../collab/ydoc.ts'
import { createInlineAtom } from './atom-marks.ts'
import { pmToDoc } from './pm-adapter.ts'
import { blockSchema, MENTION_NODE, SUGGESTION_DELETE_MARK, SUGGESTION_FORMAT_MARK, SUGGESTION_INSERT_MARK } from './schema.ts'
import { originalOf } from './suggestion-original.ts'

const ME = randomUUID()
const OTHER = randomUUID()
const ins = (sid: string, author = ME): Mark => blockSchema.marks[SUGGESTION_INSERT_MARK]!.create({ sid, author_id: author })
const del = (sid: string, author = ME): Mark => blockSchema.marks[SUGGESTION_DELETE_MARK]!.create({ sid, author_id: author })
const fmt = (sid: string, author = ME): Mark => blockSchema.marks[SUGGESTION_FORMAT_MARK]!.create({ sid, author_id: author })
const bold = (): Mark => blockSchema.marks.bold!.create()
const text = (s: string, ...marks: Mark[]): PmNode => blockSchema.text(s, marks)
const para = (inline: PmNode[], id: string = randomUUID()): PmNode =>
  blockSchema.nodes.blockContainer!.create({ blockId: id }, [blockSchema.nodes.paragraph!.create({ props: {}, format: {} }, inline)])
const docOf = (...containers: PmNode[]): PmNode =>
  blockSchema.nodes.doc!.create(null, blockSchema.nodes.blockGroup!.create(null, containers))
const runsOf = (doc: PmNode, i = 0) => pmToDoc(doc).blocks[i]!.title.map((r) => [r.type, r.plain_text, r.annotations.bold])

describe('수락 전 원문 (SG-2)', () => {
  test('★ insert 글(원자 포함)은 빠지고 delete 글은 그냥 글 · format 은 마크만 떨어진다 · 다른 서식은 남는다', () => {
    const mention = createInlineAtom(blockSchema.nodes[MENTION_NODE]!, { mention: { type: 'user', user: { id: OTHER } }, plainText: '@남' }, [ins('s-ins')])
    const doc = docOf(para([text('가'), text('나다', ins('s-ins')), mention, text('라', del('s-del')), text('마', bold(), fmt('s-fmt'))]))
    const { doc: original, suggestions } = originalOf(doc)

    assert.deepEqual(runsOf(original), [['text', '가라', false], ['text', '마', true]])
    let marked = 0
    original.descendants((node) => {
      if (node.marks.some((m) => m.type.name.startsWith('suggestion_'))) marked += 1
      return true
    })
    assert.equal(marked, 0, '원문에 제안 마크가 남았다')
    assert.deepEqual(
      suggestions.map((s) => [s.sid, s.kind, s.authorId, s.text]),
      [['s-ins', 'insert', ME, '나다'], ['s-del', 'delete', ME, '라'], ['s-fmt', 'format', ME, '마']],
    )
  })

  test('★ insert 와 delete 가 함께 선 글(남이 넣자는 글을 지우자) — 원문에 없고 두 sid 모두 돌려준다', () => {
    const doc = docOf(para([text('원'), text('새', ins('s-a', OTHER), del('s-b', ME))]))
    const { doc: original, suggestions } = originalOf(doc)
    assert.deepEqual(runsOf(original), [['text', '원', false]])
    assert.deepEqual(suggestions.map((s) => [s.sid, s.kind, s.authorId]).sort(), [['s-a', 'insert', OTHER], ['s-b', 'delete', ME]])
  })

  test('sid 하나의 글은 문서 차례로 잇는다 — 서식으로 갈린 조각 · 블록을 건너도 · 종류 · 사람은 처음 본 것', () => {
    const doc = docOf(
      para([text('가', del('s')), text('나', bold(), del('s'))]),
      para([text('다', del('s', OTHER))]),
    )
    const { suggestions } = originalOf(doc)
    assert.deepEqual(suggestions.map((s) => [s.sid, s.kind, s.authorId, s.text]), [['s', 'delete', ME, '가나다']])
  })

  test('제안이 없으면 받은 문서를 그대로 돌려준다', () => {
    const doc = docOf(para([text('그냥 글', bold())]))
    const read = originalOf(doc)
    assert.equal(read.doc, doc)
    assert.deepEqual(read.suggestions, [])
  })

  test('★ Y.Doc 읽기(readBodyYDoc)가 원문을 읽고 뗀 제안을 함께 돌려준다', () => {
    const id = randomUUID()
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(docOf(para([text('원래'), text('글', del('s-del')), text('새', ins('s-ins'))], id)), ydoc.getXmlFragment(BODY_FRAGMENT))
    const read = readBodyYDoc(ydoc, randomUUID())
    assert.deepEqual(read.doc.blocks.map((b) => [b.id, b.title.map((r) => r.plain_text).join('')]), [[id, '원래글']])
    assert.deepEqual(read.suggestions.map((s) => [s.sid, s.kind, s.text]), [['s-del', 'delete', '글'], ['s-ins', 'insert', '새']])
  })
})
