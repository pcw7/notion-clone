/**
 * relation 편집기의 지금 연결 — 페이지 잇기 (10n-40 · F-03-10, DB 없음)
 *
 *   ① 다음 페이지를 순서대로 뒤에 붙인다
 *   ② ★ 이미 있는 행은 거른다 — 편집기를 연 사이 고른 행이 다음 페이지에 다시 실려도 한 줄이다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appendRelatedPage } from './related-page.ts'

const row = (id: string) => ({ id, title: id })

test('① 다음 페이지를 순서대로 뒤에 붙인다', () => {
  assert.deepEqual(appendRelatedPage([row('a'), row('b')], [row('c'), row('d')]).map((r) => r.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(appendRelatedPage([], [row('a')]).map((r) => r.id), ['a'])
  assert.deepEqual(appendRelatedPage([row('a')], []).map((r) => r.id), ['a'])
})

test('★ ② 이미 있는 행은 거른다 — 방금 고른 행이 다음 페이지에 다시 실려도 한 줄', () => {
  // 첫 페이지 a · b 를 읽은 뒤 z 를 골랐다(목록 끝에 먼저 붙었다) — 다음 페이지가 c · z 를 싣는다
  assert.deepEqual(appendRelatedPage([row('a'), row('b'), row('z')], [row('c'), row('z')]).map((r) => r.id), ['a', 'b', 'z', 'c'])
})
