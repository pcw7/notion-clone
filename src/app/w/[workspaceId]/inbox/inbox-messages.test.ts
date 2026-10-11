/**
 * 인박스의 리마인더 · 담당 줄 — 4c-3 · 6h (DOM · DB 없음)
 *
 *   ① 리마인더가 아니면 null(다른 줄이 그린다) · 속성 이름을 말한다 · 속성이 없어졌으면 "리마인더"만
 *   ② 담당이 아니면 null · 사람 속성의 이름을 말한다 · 속성이 없어졌으면 "사람 속성"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assignmentInboxLine, reminderInboxLine } from './inbox-messages.ts'

test('① 리마인더가 아니면 null · 속성 이름 · 이름이 없으면 리마인더만', () => {
  assert.equal(reminderInboxLine(null), null)
  assert.equal(reminderInboxLine({ propertyName: '마감' }), '"마감" 날짜의 리마인더가 울렸습니다.')
  assert.equal(reminderInboxLine({ propertyName: null }), '리마인더가 울렸습니다.')
})

test('② 담당이 아니면 null · 사람 속성 이름 · 이름이 없으면 사람 속성', () => {
  assert.equal(assignmentInboxLine(null), null)
  assert.equal(assignmentInboxLine({ propertyName: '담당' }), '"담당"에 회원님을 추가했습니다.')
  assert.equal(assignmentInboxLine({ propertyName: null }), '사람 속성에 회원님을 추가했습니다.')
})
