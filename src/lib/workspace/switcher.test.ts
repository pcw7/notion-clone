/**
 * 워크스페이스 스위처의 단축키 — 잔여 묶음 8j-1 (DOM · DB 없음)
 *
 *   ① Ctrl/Cmd + Shift + 1~9 — 자리(`code`)로 읽는다 · Alt · 조합 중 · 편집기가 쓴 키는 아니다
 *   ② 갈 곳 — 그 자리에 없거나 지금 있는 곳이면 null
 *   ③ 목록에 적는 것은 아홉째까지
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shortcutHint, shortcutTarget, workspaceShortcutIndex } from './switcher.ts'

const key = (over: Partial<Parameters<typeof workspaceShortcutIndex>[0]>) =>
  workspaceShortcutIndex({ code: 'Digit1', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, ...over })

test('★ ① Ctrl/Cmd + Shift + 숫자 — 자리로 읽는다', () => {
  assert.equal(key({}), 0)
  assert.equal(key({ code: 'Digit9' }), 8)
  assert.equal(key({ ctrlKey: false, metaKey: true, code: 'Digit3' }), 2)
  assert.equal(key({ code: 'Digit0' }), null)
  assert.equal(key({ code: 'Numpad1' }), null)
  assert.equal(key({ shiftKey: false }), null)
  assert.equal(key({ ctrlKey: false }), null)
  assert.equal(key({ altKey: true }), null)
  assert.equal(key({ isComposing: true }), null)
  assert.equal(key({ defaultPrevented: true }), null)
})

test('② 갈 곳 — 없는 자리 · 지금 있는 곳은 null', () => {
  const ids = ['a', 'b']
  assert.equal(shortcutTarget(ids, 'a', 1), 'b')
  assert.equal(shortcutTarget(ids, 'a', 0), null)
  assert.equal(shortcutTarget(ids, 'a', 2), null)
  assert.equal(shortcutTarget(ids, 'a', null), null)
})

test('③ 목록에 적는 단축키는 아홉째까지', () => {
  assert.equal(shortcutHint(0), 'Ctrl/Cmd + Shift + 1')
  assert.equal(shortcutHint(8), 'Ctrl/Cmd + Shift + 9')
  assert.equal(shortcutHint(9), null)
})
