/**
 * 버전 되돌리기는 참조(하위 페이지 · 인라인 데이터베이스)를 지금 상태로 둔다 (26번 트랙 I-1b · F-11-04 · 순수)
 *
 * 정본: 00-canonical-data-model.md §3.7 [보강] 복원 ③ · §3.5 [보강 I-1] ⑤
 *
 *   ① ★ 대상 버전에 없는 지금의 데이터베이스 참조는 끝에 붙는다(되돌리기가 데이터베이스를 휴지통으로 보내지 않는다)
 *   ② ★ 대상 버전의 데이터베이스 참조 중 지금 살아 있지 않은 것은 빠진다(되살리기는 휴지통의 일이다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { textRun } from '../contracts/rich-text.ts'
import type { EditorDoc } from '../editor/document.ts'
import { keepCurrentChildren } from './restore.ts'

const para = (id: string, text: string) => ({ id, type: 'paragraph' as const, title: [textRun(text)] })
const db = (id: string) => ({ id, type: 'database' as const, title: [] })

test('① ★ 대상 버전에 없는 지금의 데이터베이스 참조는 끝에 붙는다', () => {
  const [p, d] = [randomUUID(), randomUUID()]
  const target: EditorDoc = { blocks: [para(p, '옛 글')] }
  const current: EditorDoc = { blocks: [para(p, '지금 글'), db(d)] }
  const next = keepCurrentChildren(target, current, new Set([d]))
  assert.deepEqual(next.blocks.map((b) => [b.id, b.type]), [[p, 'paragraph'], [d, 'database']])
})

test('② ★ 대상 버전의 데이터베이스 참조 중 지금 살아 있지 않은 것은 빠진다', () => {
  const [p, gone] = [randomUUID(), randomUUID()]
  const target: EditorDoc = { blocks: [para(p, '옛 글'), db(gone)] }
  const current: EditorDoc = { blocks: [para(p, '지금 글')] }
  const next = keepCurrentChildren(target, current, new Set())
  assert.deepEqual(next.blocks.map((b) => b.id), [p])
})
