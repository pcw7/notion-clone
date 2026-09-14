/**
 * 인라인 원자의 서식 거울 — CRDT 3b조각 (DB 없음)
 *
 * 이 파일이 지키는 것.
 *
 *   ① **만들 때 채운다** — `runsToInline` 이 만든 멘션 · 수식은 attr 이 마크와 같고, 서식이 없으면 null
 *   ② **편집이 바꾸면 맞춘다** — 마크를 걸거나 풀면 appendTransaction 이 attr 을 맞추고, 되돌리기 한 번에 둘 다
 *      돌아간다. 맞출 것이 없으면 트랜잭션을 붙이지 않는다
 *   ③ **읽을 때 되살린다** — 모르는 마크 · 만들 수 없는 마크 · 모양이 틀린 항목은 서식만 뺀다
 *
 * Y.Doc 을 지나는 왕복은 `collab/ydoc.test.ts` ④, 실제 바인딩으로 두 참여자 사이는 `collab/collab-schema.test.ts` ⑤ 가 본다.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { history, undo } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

import { textRun, type RichTextRun } from '../contracts/rich-text.ts'
import { atomMarksPlugin, marksFromAttr, syncAtomMarks } from './atom-marks.ts'
import { docToPm, runsToInline } from './pm-adapter.ts'
import { blockSchema } from './schema.ts'

const mention = (bold: boolean): RichTextRun => ({
  type: 'mention',
  annotations: { ...textRun('').annotations, bold },
  plain_text: '@누군가',
  href: null,
  mention: { type: 'user', user: { id: randomUUID() } } as RichTextRun['mention'],
})

const equation: RichTextRun = {
  type: 'equation',
  annotations: { ...textRun('').annotations, italic: true, color: 'red' },
  plain_text: 'x^2',
  href: null,
  equation: { expression: 'x^2' },
}

/** 문단 하나짜리 문서. 문단의 글자는 위치 3 부터다. */
const docOf = (runs: RichTextRun[]): PmNode => docToPm({ blocks: [{ id: randomUUID(), type: 'paragraph', title: runs }] })

function atomsOf(doc: PmNode): PmNode[] {
  const out: PmNode[] = []
  doc.descendants((node) => {
    if (node.type.name === 'mention' || node.type.name === 'equation') out.push(node)
    return true
  })
  return out
}

const mirrorOf = (node: PmNode) => ({ attr: node.attrs.marks ?? null, marks: node.marks.map((m) => m.toJSON()) })

// ── ① 만들 때 ─────────────────────────────────────────────────────────

describe('① 만들 때 채운다', () => {
  test('★ runsToInline 이 만든 멘션 · 수식은 attr 이 마크와 같고, 서식이 없으면 null 이다', () => {
    const [bold, eq, plain] = runsToInline([mention(true), equation, mention(false)])
    assert.deepEqual(mirrorOf(bold), { attr: [{ type: 'bold' }], marks: [{ type: 'bold' }] })
    assert.equal(eq.marks.length, 2)
    assert.deepEqual(eq.attrs.marks, eq.marks.map((m) => m.toJSON()))
    assert.equal(plain.attrs.marks, null)

    const state = EditorState.create({ doc: docOf([textRun('앞 '), mention(true), equation]) })
    assert.ok(syncAtomMarks(state) === null, '방금 만든 문서에 맞출 것이 있다')
  })
})

// ── ② 편집 ────────────────────────────────────────────────────────────

describe('② 편집이 바꾸면 맞춘다', () => {
  test('★ 마크를 걸면 attr 이 따라가고, 되돌리기 한 번에 마크와 attr 이 함께 돌아간다', () => {
    const doc = docOf([textRun('앞 '), mention(false)])
    const state = EditorState.create({ doc, plugins: [atomMarksPlugin(), history()] })
    assert.equal(atomsOf(state.doc)[0].attrs.marks, null)

    const result = state.applyTransaction(state.tr.addMark(3, 6, blockSchema.marks.bold.create()))
    assert.equal(result.transactions.length, 2, '거울 트랜잭션이 붙지 않았다')
    assert.deepEqual(mirrorOf(atomsOf(result.state.doc)[0]), { attr: [{ type: 'bold' }], marks: [{ type: 'bold' }] })

    const box: { state?: EditorState } = {}
    assert.equal(undo(result.state, (tr) => void (box.state = result.state.apply(tr))), true)
    assert.ok(box.state !== undefined)
    assert.deepEqual(mirrorOf(atomsOf(box.state.doc)[0]), { attr: null, marks: [] }, '되돌리기 한 번에 둘 다 돌아가지 않았다')
  })

  test('마크를 풀면 attr 이 null 로 돌아간다', () => {
    const state = EditorState.create({ doc: docOf([mention(true)]), plugins: [atomMarksPlugin()] })
    const next = state.apply(state.tr.removeMark(3, 4, blockSchema.marks.bold))
    assert.deepEqual(mirrorOf(atomsOf(next.doc)[0]), { attr: null, marks: [] })
  })

  test('맞출 것이 없으면 트랜잭션을 붙이지 않는다 — 글자만 쳐도', () => {
    const state = EditorState.create({ doc: docOf([textRun('앞 '), mention(true)]), plugins: [atomMarksPlugin()] })
    assert.equal(state.applyTransaction(state.tr.insertText('!', 3)).transactions.length, 1)
  })
})

// ── ③ 읽을 때 ─────────────────────────────────────────────────────────

describe('③ 읽을 때 되살린다', () => {
  test('★ 모르는 마크 · 만들 수 없는 마크 · 모양이 틀린 항목은 서식만 빼고, 나머지는 스키마 순서로 되살린다', () => {
    const marks = marksFromAttr([
      { type: 'bold' },
      { type: 'future_mark_from_newer_client' },
      { type: 'link' },
      { type: 'color', attrs: { color: 'red' } },
      3,
      null,
      'bold',
    ])
    // JSON 으로 비교한다 — ProseMirror 의 attr 객체는 프로토타입이 없어(`Object.create(null)`) 리터럴과 strict 비교가 어긋난다.
    assert.deepEqual(JSON.parse(JSON.stringify(marks)), [{ type: 'color', attrs: { color: 'red' } }, { type: 'bold' }])
    assert.deepEqual(marksFromAttr(null), [])
    assert.deepEqual(marksFromAttr({ type: 'bold' }), [])
  })
})
