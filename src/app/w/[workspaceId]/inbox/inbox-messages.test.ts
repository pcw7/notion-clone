/**
 * 인박스의 리마인더 줄 — 4c-3 (DOM · DB 없음)
 *
 *   ① 리마인더가 아니면 null(다른 줄이 그린다) · 속성 이름을 말한다 · 속성이 없어졌으면 "리마인더"만
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reminderInboxLine } from './inbox-messages.ts'

test('① 리마인더가 아니면 null · 속성 이름 · 이름이 없으면 리마인더만', () => {
  assert.equal(reminderInboxLine(null), null)
  assert.equal(reminderInboxLine({ propertyName: '마감' }), '"마감" 날짜의 리마인더가 울렸습니다.')
  assert.equal(reminderInboxLine({ propertyName: null }), '리마인더가 울렸습니다.')
})
