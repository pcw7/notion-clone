/**
 * AI 블록의 원문 · 해시 (AI-5 · F-10-04 · 순수)
 *
 *   ① 원문은 AI 블록을 모두 뺀다 — 자기 · 다른 AI 블록 · 그 결과(깊이와 상관없이) · 빈 줄 없음 · 컬럼은 틀이 아니다
 *   ② ★ 서버(Y.Doc → `readBodyYDoc`)와 편집기(`pmToDoc(originalOf(doc))`)가 같은 문서에서 같은 해시 — 제안 마크가 있어도
 *   ③ 해시 — 결정적 · 글이 다르면 다르다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { Node as PmNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'

import { BODY_FRAGMENT, readBodyYDoc } from '../collab/ydoc.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { blockSchema, SUGGESTION_DELETE_MARK, SUGGESTION_INSERT_MARK } from '../editor/schema.ts'
import { originalOf } from '../editor/suggestion-original.ts'
import { aiResultText, aiSourceLines, aiSourceText, aiTextHash, findBlockIn } from './block-source.ts'

const blk = (type: EditorBlock['type'], text: string, extra: Partial<EditorBlock> = {}): EditorBlock => ({
  id: randomUUID(),
  type,
  title: text === '' ? [] : [textRun(text)],
  properties: {},
  format: {},
  children: [],
  ...extra,
})
const ai = (children: EditorBlock[], kind = 'summary'): EditorBlock => ({ id: randomUUID(), type: 'ai_block', title: [], properties: { kind }, format: {}, children })

/** 그 글을 담은 텍스트 블록의 글 시작 위치. */
function textStart(doc: PmNode, text: string): number {
  let at = -1
  doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1
    return at < 0
  })
  assert.ok(at > 0, text)
  return at
}

/** 서버의 길 — PM 문서를 Y.Doc 에 싣고 원문으로 읽는다(`readBodyIn` 과 같은 읽기). */
function serverSource(doc: PmNode): string {
  const ydoc = new Y.Doc()
  prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment(BODY_FRAGMENT))
  return aiSourceText(readBodyYDoc(ydoc, randomUUID()).doc)
}
/** 편집기의 길 — 지금 문서에서(`ai-block-view-impl.ts`). */
const clientSource = (doc: PmNode): string => aiSourceText(pmToDoc(originalOf(doc).doc))

test('★ ① 원문은 AI 블록의 서브트리를 모두 뺀다 — 자기 · 다른 AI 블록 · 그 결과 · 목록 안에 끼운 것도', () => {
  const self = ai([blk('paragraph', '내 결과')])
  const other = ai([blk('to_do', '남의 결과', { children: [blk('paragraph', '남의 결과의 자식')] })], 'action_items')
  const nested = ai([blk('paragraph', '목록 안 결과')], 'custom')
  const doc = {
    blocks: [
      blk('heading_1', '회의록'),
      self,
      blk('paragraph', ''),
      blk('bulleted_list_item', '안건', { children: [blk('paragraph', '안건의 설명'), nested] }),
      other,
      blk('column_list', '', {
        children: [blk('column', '', { children: [blk('paragraph', '왼쪽')] }), blk('column', '', { children: [blk('to_do', '오른쪽', { properties: { checked: true } })] })],
      }),
    ],
  }
  assert.deepEqual(aiSourceLines(doc.blocks), ['# 회의록', '- 안건', '  안건의 설명', '왼쪽', '- [x] 오른쪽'])
  assert.ok(!aiSourceText(doc).includes('결과'), '어느 AI 블록의 결과도 들지 않는다')
  assert.equal(aiResultText(other.children!), '- [ ] 남의 결과\n  남의 결과의 자식', '결과의 글은 같은 꼴')
  assert.equal(findBlockIn(doc.blocks, nested.id), nested)
  assert.equal(findBlockIn(doc.blocks, randomUUID()), null)
})

test('★ ② 서버와 편집기가 같은 문서에서 같은 해시 — 넣자는 제안 글은 빠지고 지우자는 글은 남는다', () => {
  const doc = {
    blocks: [
      blk('heading_2', '주간 회의'),
      blk('paragraph', '결정: 출시는 다음 주 화요일'),
      ai([blk('paragraph', '예전 요약')]),
      blk('to_do', '김 대리가 문서 정리', { properties: { checked: false } }),
    ],
  }
  const state = EditorState.create({ doc: docToPm(doc) })
  const decided = textStart(state.doc, '결정: 출시는 다음 주 화요일') + '결정: 출시는 다음 주 화요일'.length
  const heading = textStart(state.doc, '주간 회의')
  const tr = state.tr
    .insert(decided, blockSchema.text(' 확정', [blockSchema.marks[SUGGESTION_INSERT_MARK]!.create({ sid: randomUUID(), author_id: randomUUID() })]))
    .addMark(heading, heading + '주간'.length, blockSchema.marks[SUGGESTION_DELETE_MARK]!.create({ sid: randomUUID(), author_id: randomUUID() }))
  const edited = tr.doc

  assert.ok(edited.textContent.includes('확정'), '제안 글은 편집기 문서에 있다')
  const server = serverSource(edited)
  assert.equal(server, '## 주간 회의\n결정: 출시는 다음 주 화요일\n- [ ] 김 대리가 문서 정리', '넣자는 글은 빠지고 지우자는 글은 남는다 · AI 블록은 빠진다')
  assert.equal(clientSource(edited), server)
  assert.equal(aiTextHash(clientSource(edited)), aiTextHash(server), '★ 같은 해시')
})

test('② 결과를 다시 쓰는 것은 원문의 해시를 바꾸지 않는다 · 본문을 고치면 바뀐다', () => {
  const head = blk('paragraph', '첫 줄 글입니다')
  const block = ai([blk('paragraph', '예전 결과')])
  const before = aiTextHash(clientSource(docToPm({ blocks: [head, block] })))
  const regenerated = aiTextHash(clientSource(docToPm({ blocks: [head, { ...block, children: [blk('bulleted_list_item', '새 결과')] }] })))
  assert.equal(regenerated, before)
  const changed = aiTextHash(clientSource(docToPm({ blocks: [blk('paragraph', '첫 줄 글입니다 — 고쳤다'), block] })))
  assert.notEqual(changed, before)
})

test('③ 해시 — 결정적 · 글이 다르면 다르다 · 길이를 담는다', () => {
  assert.equal(aiTextHash('가나다'), aiTextHash('가나다'))
  assert.notEqual(aiTextHash('가나다'), aiTextHash('가나라'))
  assert.notEqual(aiTextHash(''), aiTextHash(' '))
  assert.match(aiTextHash('abc'), /^3-[0-9a-f]{14}$/)
})
