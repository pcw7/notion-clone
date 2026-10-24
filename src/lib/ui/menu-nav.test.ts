/**
 * 메뉴 항목 사이의 화살표 이동 (10n-43 · DOM 없음)
 *
 *   ① ↓ · ↑ 는 이웃으로 — 끝에서 돌아간다
 *   ② 항목 밖에서 시작하면 ↓ 첫 · ↑ 마지막 · Home · End
 *   ③ 항목이 없거나 이동 키가 아니면 null(키를 그대로 둔다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextMenuIndex } from './menu-nav.ts'

test('★ ① ↓ · ↑ 는 이웃으로 — 끝에서 돌아간다', () => {
  assert.equal(nextMenuIndex(0, 3, 'ArrowDown'), 1)
  assert.equal(nextMenuIndex(2, 3, 'ArrowDown'), 0, '마지막에서 ↓ 는 처음')
  assert.equal(nextMenuIndex(1, 3, 'ArrowUp'), 0)
  assert.equal(nextMenuIndex(0, 3, 'ArrowUp'), 2, '처음에서 ↑ 는 마지막')
})

test('② 항목 밖에서 시작하면 ↓ 첫 · ↑ 마지막 · Home · End', () => {
  assert.equal(nextMenuIndex(-1, 4, 'ArrowDown'), 0)
  assert.equal(nextMenuIndex(-1, 4, 'ArrowUp'), 3)
  assert.equal(nextMenuIndex(2, 4, 'Home'), 0)
  assert.equal(nextMenuIndex(0, 4, 'End'), 3)
})

test('③ 항목이 없거나 이동 키가 아니면 null', () => {
  assert.equal(nextMenuIndex(0, 0, 'ArrowDown'), null)
  assert.equal(nextMenuIndex(0, 3, 'Enter'), null)
  assert.equal(nextMenuIndex(0, 3, 'Tab'), null)
  assert.equal(nextMenuIndex(0, 3, 'a'), null)
})
