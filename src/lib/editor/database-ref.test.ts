/**
 * 인라인 데이터베이스 참조 노드 — 레지스트리 · 스키마 · 어댑터 · 검증 (26번 트랙 I-1 · F-04-14 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.5 [보강 I-1] ② ③
 *
 *   ① ★ 참조 타입 — 하위 페이지 · 데이터베이스만(`isRefType`) · 노드 이름 짝(`database` ↔ `database_ref`)
 *   ② ★ 문서 ↔ 편집기 왕복 — 이름 · format 을 싣지 않고 자리만(하위 페이지 참조와 같다)
 *   ③ 검증 — 데이터베이스 참조에 자식을 붙이면 거부한다(그 내용은 그 데이터베이스의 것이다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { isRefType } from '../block/types.ts'
import { textRun } from '../contracts/rich-text.ts'
import { blockTypeOfNode, DATABASE_REF_NODE, isRefNodeName, nodeNameOf, PAGE_REF_NODE } from './schema.ts'
import { docToPm, pmToDoc } from './pm-adapter.ts'
import { validateDoc, type EditorDoc } from './document.ts'

test('① ★ 참조 타입 — 하위 페이지 · 데이터베이스만 · 노드 이름 짝', () => {
  assert.deepEqual(['page', 'database', 'paragraph', 'toggle', 'unsupported'].map(isRefType), [true, true, false, false, false])
  assert.equal(nodeNameOf('database'), DATABASE_REF_NODE)
  assert.equal(blockTypeOfNode(DATABASE_REF_NODE), 'database')
  assert.deepEqual([PAGE_REF_NODE, DATABASE_REF_NODE, 'paragraph'].map(isRefNodeName), [true, true, false])
})

test('② ★ 문서 ↔ 편집기 왕복 — 이름 · format 을 싣지 않고 자리만', () => {
  const dbId = randomUUID()
  const front = randomUUID()
  const doc: EditorDoc = {
    blocks: [
      { id: front, type: 'paragraph', title: [textRun('앞')] },
      { id: dbId, type: 'database', title: [textRun('새어 나가면 안 되는 이름')], format: { block_color: 'red' } },
    ],
  }
  const back = pmToDoc(docToPm(doc))
  assert.deepEqual(back.blocks.map((b) => [b.id, b.type]), [[front, 'paragraph'], [dbId, 'database']])
  const ref = back.blocks[1]!
  assert.deepEqual(ref.title, [], '이름을 싣지 않는다')
  assert.deepEqual(ref.format ?? {}, {}, '색이 없는 타입 — format 도 남지 않는다')
})

test('③ 검증 — 데이터베이스 참조에 자식을 붙이면 거부한다', () => {
  const doc: EditorDoc = {
    blocks: [{ id: randomUUID(), type: 'database', title: [], children: [{ id: randomUUID(), type: 'paragraph', title: [textRun('안')] }] }],
  }
  const issues = validateDoc(doc)
  assert.equal(issues.length, 1)
  assert.match(issues[0]!.message, /인라인 데이터베이스/)
})
