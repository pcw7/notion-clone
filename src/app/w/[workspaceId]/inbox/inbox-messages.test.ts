/**
 * 인박스의 리마인더 · 담당 줄 — 4c-3 · 6h (DOM · DB 없음)
 *
 *   ① 리마인더가 아니면 null(다른 줄이 그린다) · 속성 이름을 말한다 · 속성이 없어졌으면 "리마인더"만
 *   ② 담당이 아니면 null · 사람 속성의 이름을 말한다 · 속성이 없어졌으면 "사람 속성"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assignmentInboxLine, automationInboxLabel, automationInboxLine, reminderInboxLine, suggestionInboxLine } from './inbox-messages.ts'

test('④ 제안(SG-4) — 아니면 null · 새 제안은 미리보기와 함께 · 수락은 수락했다고', () => {
  assert.equal(suggestionInboxLine(null, '글'), null)
  assert.equal(suggestionInboxLine({ accepted: false }, '새 글'), '제안했습니다: 새 글')
  assert.equal(suggestionInboxLine({ accepted: false }, null), '제안했습니다.')
  assert.equal(suggestionInboxLine({ accepted: true }, '새 글'), '제안을 수락했습니다.')
})

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

test('③ 알림 보내기 — 머리는 자동화 · 버튼, 한 줄은 보낸 이: 메시지 (보낸 이를 모르면 메시지만 · 메시지가 비면 알림)', () => {
  assert.equal(automationInboxLabel({ via: 'automation' }), '자동화')
  assert.equal(automationInboxLabel({ via: 'button' }), '버튼')
  assert.equal(automationInboxLine({ message: '새 행: 견적서', senderName: '김하나' }), '김하나: 새 행: 견적서')
  assert.equal(automationInboxLine({ message: '새 행: 견적서', senderName: null }), '새 행: 견적서')
  assert.equal(automationInboxLine({ message: '' }), '알림')
  assert.equal(automationInboxLine({ message: '', senderName: '김하나' }), '김하나: 알림')
})
