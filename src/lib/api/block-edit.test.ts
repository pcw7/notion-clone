/**
 * 공개 API 의 본문 편집 — Y.Doc 에 쓰는 붙이기 · 고치기 · 지우기 (API-3 · F-09-01 · 순수 · DB 없음)
 *
 * 서버 명령과 같은 쓰기(`writeEditorChange` — 본문 세션의 `change` 가 부르는 것)로 Y.Doc 에 쓰고, 투영이 읽는 것(`readBodyYDoc`)으로 본다.
 *
 *   ★ 붙이기 — 빈 본문의 빈 문단은 갈아 끼운다 · 맨 위의 끝 · 처음 · 형제 뒤 · 블록 밑(자식 그룹이 있든 없든) · 표의 행 · 자리를 못 찾으면 알린다
 *   ★ 고치기 — 글을 주지 않은 고치기는 글 노드를 건드리지 않는다(그 안의 제안 마크가 남는다) · 글을 주면 갈아 끼운다 · 표의 셀
 *   ★ 지우기 — 형제 사이 · 그룹의 하나뿐인 자식(그룹째) · 본문의 마지막(빈 문서) · 표의 행 · 마지막 행은 거부
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type * as Y from 'yjs'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import { writeEditorChange } from '../collab/body-edit.ts'
import { createBodyYDoc, readBodyPm, readBodyYDoc } from '../collab/ydoc.ts'
import { textRun, toPlainText } from '../contracts/rich-text.ts'
import type { EditorBlock } from '../editor/document.ts'
import { findContainerById } from '../editor/pm-blocks.ts'
import { blockSchema } from '../editor/schema.ts'
import { appendBlocksIn, deleteBlockIn, updateBlockIn, type EditOutcome } from './block-edit.ts'

const PAGE = randomUUID()

const para = (text: string, children: EditorBlock[] = []): EditorBlock => ({ id: randomUUID(), type: 'paragraph', title: [textRun(text)], children })
const row = (...cells: string[]): EditorBlock => ({
  id: randomUUID(),
  type: 'table_row',
  title: [],
  properties: { cells: cells.map((c) => (c === '' ? [] : [textRun(c)])) },
})

function apply(ydoc: Y.Doc, edit: (tr: Transaction, doc: PmNode) => EditOutcome): EditOutcome {
  const box: { out: EditOutcome } = { out: 'ok' }
  writeEditorChange(ydoc, (tr, doc) => {
    box.out = edit(tr, doc)
  }, 'test')
  return box.out
}

const body = (ydoc: Y.Doc) => readBodyYDoc(ydoc, PAGE).doc
const texts = (blocks: readonly EditorBlock[]): string[] => blocks.map((b) => toPlainText(b.title))

test('★ 붙이기 — 빈 본문의 빈 문단은 갈아 끼운다(앞에 빈 줄이 남지 않는다) · 빈 본문에는 형제가 없다', () => {
  const ydoc = createBodyYDoc({ blocks: [] })
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'after', id: randomUUID() }, [para('x')])), 'after_not_found')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'end' }, [para('하나'), para('둘')])), 'ok')
  assert.deepEqual(texts(body(ydoc).blocks), ['하나', '둘'])
})

test('★ 붙이기 — 맨 위의 끝 · 처음 · 형제 뒤(id 그대로) · 자식은 형제가 아니다', () => {
  const kid = para('자식')
  const [a, b] = [para('가', [kid]), para('나')]
  const ydoc = createBodyYDoc({ blocks: [a, b] })
  const [end, start, after] = [para('끝'), para('처음'), para('가 뒤')]
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'end' }, [end])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'start' }, [start])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'after', id: a.id }, [after])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, null, { kind: 'after', id: kid.id }, [para('x')])), 'after_not_found')
  const read = body(ydoc)
  assert.deepEqual(texts(read.blocks), ['처음', '가', '가 뒤', '나', '끝'])
  assert.deepEqual(read.blocks.map((x) => x.id), [start.id, a.id, after.id, b.id, end.id])
})

test('★ 붙이기 — 블록 밑(자식 그룹이 있으면 그 안 · 없으면 새로) · 형제 뒤 · 모르는 부모', () => {
  const [k1, k2] = [para('k1'), para('k2')]
  const toggle: EditorBlock = { id: randomUUID(), type: 'toggle', title: [textRun('토글')], children: [k1, k2] }
  const leaf = para('잎')
  const ydoc = createBodyYDoc({ blocks: [toggle, leaf] })
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, toggle.id, { kind: 'end' }, [para('k3')])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, toggle.id, { kind: 'after', id: k1.id }, [para('k1 뒤')])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, toggle.id, { kind: 'start' }, [para('k0')])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, leaf.id, { kind: 'end' }, [para('잎의 자식', [para('손자')])])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, toggle.id, { kind: 'after', id: leaf.id }, [para('x')])), 'after_not_found')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, randomUUID(), { kind: 'end' }, [para('x')])), 'parent_not_found')
  const [t, l] = body(ydoc).blocks
  assert.deepEqual(texts(t.children ?? []), ['k0', 'k1', 'k1 뒤', 'k2', 'k3'])
  assert.deepEqual(texts(l.children ?? []), ['잎의 자식'])
  assert.deepEqual(texts(l.children?.[0].children ?? []), ['손자'])
})

test('★ 붙이기 · 지우기 — 표의 행(내용 노드 안의 행 노드) · 마지막 행은 지우지 않는다', () => {
  const [r1, r2] = [row('a', 'b'), row('c', '')]
  const table: EditorBlock = { id: randomUUID(), type: 'table', title: [], properties: {}, children: [r1, r2] }
  const ydoc = createBodyYDoc({ blocks: [table] })
  const [r0, r15] = [row('0', '0'), row('1.5', '')]
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, table.id, { kind: 'start' }, [r0])), 'ok')
  assert.equal(apply(ydoc, (tr, doc) => appendBlocksIn(tr, doc, table.id, { kind: 'after', id: r1.id }, [r15])), 'ok')
  const rows = () => (body(ydoc).blocks[0].children ?? []).map((r) => r.id)
  assert.deepEqual(rows(), [r0.id, r1.id, r15.id, r2.id])

  // 셀 고치기 — 같은 rowId
  const changed = { ...r2, properties: { cells: [[textRun('고침')], [textRun('셀')]] } }
  assert.equal(apply(ydoc, (tr, doc) => updateBlockIn(tr, doc, changed, { textChanged: false, cellsChanged: true })), 'ok')
  const after = body(ydoc).blocks[0].children?.[3]
  assert.deepEqual([after?.id, (after?.properties?.cells as unknown[][]).map((c) => toPlainText(c as never))], [r2.id, ['고침', '셀']])

  for (const id of [r0.id, r1.id, r15.id]) assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, id)), 'ok')
  assert.deepEqual(rows(), [r2.id])
  assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, r2.id)), 'last_row')
})

test('★ 고치기 — 글을 주지 않으면 글 노드를 건드리지 않는다(제안 마크가 남는다) · 글을 주면 갈아 끼운다', () => {
  const todo: EditorBlock = { id: randomUUID(), type: 'to_do', title: [textRun('원문')], properties: { checked: false } }
  const ydoc = createBodyYDoc({ blocks: [todo] })
  const sid = randomUUID()
  writeEditorChange(ydoc, (tr, doc) => {
    const at = findContainerById(doc, todo.id)!.contentPos + 1
    tr.insert(at + 2, blockSchema.text('제안', [blockSchema.marks.suggestion_insert!.create({ sid, author_id: randomUUID() })]))
  }, 'test')
  const suggested = () => {
    let found = false
    readBodyPm(ydoc).descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'suggestion_insert')) found = true
      return !found
    })
    return found
  }
  assert.equal(suggested(), true, '전제 — 제안 글이 있다')

  const checked = { ...todo, properties: { checked: true } }
  assert.equal(apply(ydoc, (tr, doc) => updateBlockIn(tr, doc, checked, { textChanged: false, cellsChanged: false })), 'ok')
  assert.equal(body(ydoc).blocks[0].properties?.checked, true)
  assert.equal(suggested(), true, '체크만 바꾼 고치기가 제안 글을 지웠다')
  assert.equal(toPlainText(body(ydoc).blocks[0].title), '원문', '읽기는 원문(제안 글은 빠진다)')

  const text = { ...checked, title: [textRun('새 글', { bold: true })] }
  assert.equal(apply(ydoc, (tr, doc) => updateBlockIn(tr, doc, text, { textChanged: true, cellsChanged: false })), 'ok')
  assert.deepEqual(body(ydoc).blocks[0].title, [textRun('새 글', { bold: true })])
  assert.equal(apply(ydoc, (tr, doc) => updateBlockIn(tr, doc, { ...text, id: randomUUID() }, { textChanged: true, cellsChanged: false })), 'not_found')
})

test('★ 지우기 — 형제 사이 · 그룹의 하나뿐인 자식은 그룹째 · 본문의 마지막은 빈 문서 · 없는 블록', () => {
  const only = para('하나뿐인 자식')
  const parent = para('부모', [only])
  const other = para('다른 것')
  const ydoc = createBodyYDoc({ blocks: [parent, other] })
  assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, only.id)), 'ok')
  assert.deepEqual(body(ydoc).blocks.map((b) => [toPlainText(b.title), b.children?.length ?? 0]), [['부모', 0], ['다른 것', 0]])
  assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, other.id)), 'ok')
  assert.deepEqual(texts(body(ydoc).blocks), ['부모'])
  assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, parent.id)), 'ok')
  assert.deepEqual(body(ydoc).blocks, [], '마지막 블록을 지우면 빈 문서')
  assert.equal(apply(ydoc, (tr, doc) => deleteBlockIn(tr, doc, randomUUID())), 'not_found')
})
