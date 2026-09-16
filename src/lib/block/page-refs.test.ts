/**
 * 하위 페이지 참조 노드 변경 — CRDT 4b조각 (DB 없음)
 *
 * 이 파일이 지키는 것. 매번 `doc.check()` 로 스키마를 어기지 않았는지 본다.
 *
 *   ① **넣기** — 본문 끝 · 컨테이너 자식 끝(그룹이 없으면 만든다) · 빈 본문은 대체한다 · 이미 있으면 넣지 않는다
 *   ② **앞 형제 뒤에 넣기** — 앞 형제가 없으면 그 그룹의 맨 앞 · 앞 형제가 본문에 없어도 맨 앞
 *   ③ **빼기** — 형제가 있으면 그것만 · 컨테이너의 마지막 자식이면 그룹째 · 본문의 마지막 블록이면 빈 문단으로
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { EditorState } from '@tiptap/pm/state'

import type { EditorChange } from '../collab/body-edit.ts'
import { textRun } from '../contracts/rich-text.ts'
import type { EditorBlock, EditorDoc } from '../editor/document.ts'
import { docToPm, pmToDoc } from '../editor/pm-adapter.ts'
import { appendPageRef, insertPageRefAfter, removePageRef } from './page-refs.ts'

const para = (text: string, children: EditorBlock[] = []): EditorBlock => ({
  id: randomUUID(),
  type: 'paragraph',
  title: [textRun(text)],
  ...(children.length > 0 ? { children } : {}),
})
const pageRef = (): EditorBlock => ({ id: randomUUID(), type: 'page', title: [] })

/** 변경을 적용한 뒤 스키마를 확인하고 저장 가능한 문서로 읽는다. */
function apply(doc: EditorDoc, change: EditorChange): EditorDoc {
  const state = EditorState.create({ doc: docToPm(doc) })
  const tr = state.tr
  change(tr, state.doc)
  tr.doc.check()
  return pmToDoc(tr.doc)
}

/** 블록을 전위 순서로 `id` 또는 `부모id>id`. */
function shape(doc: EditorDoc): string[] {
  const out: string[] = []
  const walk = (blocks: readonly EditorBlock[], prefix: string): void => {
    for (const b of blocks) {
      out.push(`${prefix}${b.id}`)
      walk(b.children ?? [], `${prefix}${b.id}>`)
    }
  }
  walk(doc.blocks, '')
  return out
}

describe('① 넣기', () => {
  test('★ 본문 맨 뒤에 넣는다', () => {
    const [a, b] = [para('가'), para('나')]
    const id = randomUUID()
    const after = apply({ blocks: [a, b] }, appendPageRef(null, id))
    assert.deepEqual(shape(after), [a.id, b.id, id])
    assert.equal(after.blocks[2].type, 'page')
  })

  test('★ 빈 본문(빈 문단 하나)은 참조로 대체한다 — 빈 줄 행을 만들지 않는다', () => {
    const id = randomUUID()
    const after = apply({ blocks: [] }, appendPageRef(null, id))
    assert.deepEqual(shape(after), [id])
  })

  test('컨테이너의 자식 맨 뒤에 넣는다 — 그룹이 없으면 만들고, 있으면 끝에', () => {
    const lone = para('자식 없음')
    const id1 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [lone] }, appendPageRef(lone.id, id1))), [lone.id, `${lone.id}>${id1}`])

    const child = para('자식')
    const parent = para('부모', [child])
    const id2 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [parent] }, appendPageRef(parent.id, id2))), [
      parent.id,
      `${parent.id}>${child.id}`,
      `${parent.id}>${id2}`,
    ])
  })

  test('★ 이미 본문에 있는 참조는 다시 넣지 않는다', () => {
    const ref = pageRef()
    const after = apply({ blocks: [para('가'), ref] }, appendPageRef(null, ref.id))
    assert.equal(shape(after).filter((s) => s.endsWith(ref.id)).length, 1)
  })

  test('부모 컨테이너가 본문에 없으면 던진다', () => {
    assert.throws(() => apply({ blocks: [para('가')] }, appendPageRef(randomUUID(), randomUUID())), /본문에 없다/)
  })
})

describe('② 앞 형제 뒤에 넣기', () => {
  test('★ 앞 형제 바로 뒤에 넣는다 — 본문 최상위 · 컨테이너 안', () => {
    const [a, b] = [para('가'), para('나')]
    const id = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [a, b] }, insertPageRefAfter(id, null, a.id))), [a.id, id, b.id])

    const [c1, c2] = [para('하나'), para('둘')]
    const parent = para('부모', [c1, c2])
    const id2 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [parent] }, insertPageRefAfter(id2, parent.id, c1.id))), [
      parent.id,
      `${parent.id}>${c1.id}`,
      `${parent.id}>${id2}`,
      `${parent.id}>${c2.id}`,
    ])
  })

  test('★ 앞 형제가 없거나 본문에 없으면 그 그룹의 맨 앞 — 그룹이 없는 컨테이너면 만든다 · 빈 본문은 대체한다', () => {
    const [a, b] = [para('가'), para('나')]
    const id = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [a, b] }, insertPageRefAfter(id, null, null))), [id, a.id, b.id])
    const id2 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [a, b] }, insertPageRefAfter(id2, null, randomUUID()))), [id2, a.id, b.id])

    const lone = para('자식 없음')
    const id3 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [lone] }, insertPageRefAfter(id3, lone.id, null))), [lone.id, `${lone.id}>${id3}`])

    const id4 = randomUUID()
    assert.deepEqual(shape(apply({ blocks: [] }, insertPageRefAfter(id4, null, null))), [id4])
  })
})

describe('③ 빼기', () => {
  test('★ 형제가 있으면 그 참조만 뺀다', () => {
    const [a, ref, b] = [para('가'), pageRef(), para('나')]
    assert.deepEqual(shape(apply({ blocks: [a, ref, b] }, removePageRef(ref.id))), [a.id, b.id])
  })

  test('★ 컨테이너의 마지막 자식이면 그룹째 뺀다 — 빈 그룹을 남기지 않는다', () => {
    const ref = pageRef()
    const parent = para('부모', [ref])
    const after = apply({ blocks: [parent] }, removePageRef(ref.id))
    assert.deepEqual(shape(after), [parent.id])
    assert.equal(after.blocks[0].children?.length ?? 0, 0)
  })

  test('★ 본문의 마지막 블록이면 빈 문단으로 되돌린다 — 저장하면 빈 본문이다', () => {
    const ref = pageRef()
    assert.deepEqual(apply({ blocks: [ref] }, removePageRef(ref.id)), { blocks: [] })
  })

  test('본문에 없으면 아무것도 하지 않는다', () => {
    const a = para('가')
    assert.deepEqual(shape(apply({ blocks: [a] }, removePageRef(randomUUID()))), [a.id])
  })
})
